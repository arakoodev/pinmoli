/**
 * ToolOutputSection — Collapsible tool output component for pi-tui
 *
 * Renders a collapsible section showing streaming tool events.
 * Auto-expanded while running, auto-collapsed when complete.
 * Ctrl+O toggles expansion.
 * Animated spinner while running (same frames/timing as pi-tui Loader).
 */

import type { Component, TUI } from '@mariozechner/pi-tui';

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export class ToolOutputSection implements Component {
  private toolName: string;
  private lines: string[] = [];
  private complete = false;
  private _expanded = true;
  private success = true;
  private _cache?: string[];
  private _cacheWidth?: number;
  private spinnerFrame = 0;
  private spinnerTimer?: ReturnType<typeof setInterval>;
  private ui?: TUI;

  constructor(toolName: string, ui?: TUI) {
    this.toolName = toolName;
    this.ui = ui;
    this.startSpinner();
  }

  private startSpinner(): void {
    // eslint-disable-next-line pinmoli/no-setinterval-in-ui -- TODO: migrate to pi-tui Loader
    this.spinnerTimer = setInterval(() => {
      this.spinnerFrame = (this.spinnerFrame + 1) % SPINNER_FRAMES.length;
      this.invalidate();
      this.ui?.requestRender();
    }, 80);
  }

  private stopSpinner(): void {
    if (this.spinnerTimer) {
      clearInterval(this.spinnerTimer);
      this.spinnerTimer = undefined;
    }
  }

  addLine(text: string): void {
    this.lines.push(text);
    this.invalidate();
  }

  markComplete(success = true): void {
    this.complete = true;
    this.success = success;
    this._expanded = false;
    this.stopSpinner();
    this.invalidate();
  }

  toggle(): void {
    this._expanded = !this._expanded;
    this.invalidate();
  }

  get expanded(): boolean {
    return this._expanded;
  }

  invalidate(): void {
    this._cache = undefined;
    this._cacheWidth = undefined;
  }

  render(width: number): string[] {
    if (this._cache && this._cacheWidth === width && this.complete) {
      return this._cache;
    }

    const arrow = this._expanded ? '\u25BC' : '\u25B6';
    const icon = this.complete
      ? (this.success ? '\u2713' : '\u2717')
      : SPINNER_FRAMES[this.spinnerFrame];
    const count = this.lines.length;
    const header = ` ${arrow} ${icon} ${this.toolName} (${count} event${count !== 1 ? 's' : ''})`;

    const result: string[] = [];

    // Dim header when complete + collapsed, bright when running
    if (this.complete && !this._expanded) {
      result.push(`\x1b[2m${header}\x1b[0m`);
    } else {
      result.push(`\x1b[1;33m${header}\x1b[0m`);
    }

    if (this._expanded) {
      for (const line of this.lines) {
        // Split multi-line content (verbose SIP messages)
        const sublines = line.split('\n');
        for (const subline of sublines) {
          result.push(`   \x1b[2m${subline}\x1b[0m`);
        }
      }
    }

    this._cache = result;
    this._cacheWidth = width;
    return result;
  }
}
