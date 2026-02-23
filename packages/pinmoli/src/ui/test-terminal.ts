import type { Terminal } from '@mariozechner/pi-tui';

export class TestTerminal implements Terminal {
  output: string[] = [];
  private inputHandler?: (data: string) => void;
  private _columns = 80;
  private _rows = 24;

  start(onInput: (data: string) => void, _onResize: () => void): void {
    this.inputHandler = onInput;
  }
  stop(): void {}
  async drainInput(): Promise<void> {}
  write(data: string): void { this.output.push(data); }
  get columns(): number { return this._columns; }
  get rows(): number { return this._rows; }
  get kittyProtocolActive(): boolean { return false; }
  moveBy(_lines: number): void {}
  hideCursor(): void {}
  showCursor(): void {}
  clearLine(): void {}
  clearFromCursor(): void {}
  clearScreen(): void { this.output = []; }
  setTitle(_title: string): void {}

  // Test helpers
  simulateInput(data: string): void { this.inputHandler?.(data); }
  getFullOutput(): string { return this.output.join(''); }
  clearOutput(): void { this.output = []; }
}
