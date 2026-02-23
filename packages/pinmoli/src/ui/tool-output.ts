/**
 * ToolOutputSection — Collapsible tool output component for pi-tui
 *
 * Renders a collapsible section showing streaming tool events.
 * Auto-expanded while running, auto-collapsed when complete.
 * Ctrl+O toggles expansion.
 */

import type { Component } from '@mariozechner/pi-tui';

export class ToolOutputSection implements Component {
  private toolName: string;
  private lines: string[] = [];
  private complete = false;
  private _expanded = true;
  private success = true;
  private _cache?: string[];
  private _cacheWidth?: number;

  constructor(toolName: string) {
    this.toolName = toolName;
  }

  addLine(text: string): void {
    this.lines.push(text);
    this.invalidate();
  }

  markComplete(success = true): void {
    this.complete = true;
    this.success = success;
    this._expanded = false;
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
    if (this._cache && this._cacheWidth === width) {
      return this._cache;
    }

    const arrow = this._expanded ? '\u25BC' : '\u25B6';
    const icon = this.complete
      ? (this.success ? '\u2713' : '\u2717')
      : '\u27F3';
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
        // Indent + dim for event lines, truncate to width
        const indented = `   \x1b[2m${line}\x1b[0m`;
        result.push(indented);
      }
    }

    this._cache = result;
    this._cacheWidth = width;
    return result;
  }
}
