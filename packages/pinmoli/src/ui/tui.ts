/**
 * Pinmoli TUI
 *
 * Dual-mode implementation:
 * - Interactive mode (no terminal arg): full pi-tui with Editor, Box, Text
 * - Test mode (TestTerminal passed): direct terminal.write() for synchronous assertions
 */

import {
  TUI,
  ProcessTerminal,
  Box,
  Text,
  Editor,
  Key,
  matchesKey,
  type Terminal,
  type EditorTheme,
} from '@mariozechner/pi-tui';
import { ToolOutputSection } from './tool-output.js';

export class PinmoliTUI {
  private messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }> = [];

  // Interactive mode (full pi-tui)
  private tui?: TUI;
  private chatContainer?: Box;
  private editor?: Editor;
  private hintText?: Text;

  // Tool output sections
  private activeToolOutput?: ToolOutputSection;
  private toolOutputs: ToolOutputSection[] = [];

  // Streaming assistant message
  private streamingText?: Text;
  private streamingContent = '';

  // Ctrl+C / Escape state machine
  private isAgentBusy = false;
  private quitArmed = false;
  private quitTimer?: ReturnType<typeof setTimeout>;

  /** Called when user presses Ctrl+C/Escape while agent is busy */
  onInterrupt?: () => void;

  // Test mode (direct writes)
  private terminal?: Terminal;
  private inputBuffer = '';
  private pendingInputResolve?: (text: string) => void;
  private testStarted = false;

  constructor(terminal?: Terminal) {
    if (terminal) {
      // Test mode: direct writes for synchronous assertions
      this.terminal = terminal;
    } else {
      // Interactive mode: full pi-tui
      const processTerminal = new ProcessTerminal();
      this.tui = new TUI(processTerminal, true);

      // Chat messages container
      this.chatContainer = new Box(1, 0);

      // Editor for input
      const theme: EditorTheme = {
        borderColor: (str: string) => `\x1b[36m${str}\x1b[0m`,
        selectList: {
          selectedPrefix: (str: string) => `\x1b[36m${str}\x1b[0m`,
          selectedText: (str: string) => `\x1b[1;36m${str}\x1b[0m`,
          description: (str: string) => `\x1b[2m${str}\x1b[0m`,
          scrollInfo: (str: string) => `\x1b[2m${str}\x1b[0m`,
          noMatch: (str: string) => `\x1b[2m${str}\x1b[0m`,
        }
      };
      this.editor = new Editor(this.tui, theme, { paddingX: 1 });

      this.tui.addChild(this.chatContainer);
      this.tui.addChild(this.editor);
      this.tui.setFocus(this.editor);

      // Hint text (shown below editor for "Press Ctrl+C again to exit")
      this.hintText = new Text('', 1, 0);
      this.tui.addChild(this.hintText);

      // Ctrl+C, Escape, and Ctrl+O handlers
      this.tui.addInputListener((data) => {
        // Escape: let Editor close autocomplete first
        if (matchesKey(data, Key.escape)) {
          if (this.editor!.isShowingAutocomplete()) {
            return undefined;
          }
        }

        if (matchesKey(data, Key.ctrl('c')) || matchesKey(data, Key.escape)) {
          // Priority 1: If agent is busy, abort it
          if (this.isAgentBusy) {
            this.onInterrupt?.();
            this.clearQuitArmed();
            return { consume: true };
          }

          // Priority 2: If editor has text, clear it
          if (this.editor!.getText().trim()) {
            this.editor!.setText('');
            this.tui!.requestRender();
            this.clearQuitArmed();
            return { consume: true };
          }

          // Priority 3: Double-tap to quit
          if (this.quitArmed) {
            this.clearQuitArmed();
            this.stop();
            process.exit(0);
          }

          // Arm quit — show hint, start timeout
          this.quitArmed = true;
          this.showHint('Press Ctrl+C again to exit');
          this.quitTimer = setTimeout(() => {
            this.clearQuitArmed();
          }, 2000);

          return { consume: true };
        }

        // Any other key clears the quit-armed state
        if (this.quitArmed) {
          this.clearQuitArmed();
        }

        if (matchesKey(data, Key.ctrl('o'))) {
          const last = this.toolOutputs[this.toolOutputs.length - 1];
          if (last) {
            last.toggle();
            this.tui!.requestRender();
          }
          return { consume: true };
        }
        return undefined;
      });
    }
  }

  start(): void {
    if (this.tui) {
      // Interactive mode
      this.tui.start();
      const header = new Text(
        '\x1b[1mPinmoli\x1b[0m \x1b[2m— SIP Testing Agent\x1b[0m',
        1, 0
      );
      this.chatContainer!.addChild(header);
      this.addMessage(
        'assistant',
        "Hi! I'm your SIP/WebRTC testing assistant. What would you like to test?"
      );
    } else {
      // Test mode
      this.ensureTestStarted();
      this.terminal!.write('\n┌─────────────────────────────────────────┐\n');
      this.terminal!.write('│  Pinmoli - SIP Testing Agent           │\n');
      this.terminal!.write('└─────────────────────────────────────────┘\n');
      this.addMessage(
        'assistant',
        "Hi! I'm your SIP/WebRTC testing assistant. What would you like to test?"
      );
    }
  }

  addMessage(role: 'user' | 'assistant' | 'system', content: string): void {
    this.messages.push({ role, content });

    if (this.tui) {
      // Interactive mode: add as pi-tui Text component
      // Finalize any active tool output first
      if (this.activeToolOutput) {
        this.activeToolOutput.markComplete();
        this.activeToolOutput = undefined;
      }
      let prefix = '';
      if (role === 'user') prefix = '\x1b[1;32mYou: \x1b[0m';
      else if (role === 'assistant') prefix = '\x1b[1;34mPinmoli: \x1b[0m';
      const msg = new Text(prefix + content, 1, 0);
      this.chatContainer!.addChild(msg);
      this.tui.requestRender();
    } else {
      // Test mode: direct write
      let prefix = '';
      if (role === 'user') prefix = '\nYou: ';
      else if (role === 'assistant') prefix = '\nPinmoli: ';
      else if (role === 'system') prefix = '\n';
      this.terminal!.write(prefix + content + '\n');
    }
  }

  streamMessage(content: string): void {
    if (this.tui) {
      // Interactive mode: append to active tool output section
      if (this.activeToolOutput) {
        this.activeToolOutput.addLine(content.replace(/^\n/, '').replace(/\n$/, ''));
        this.tui.requestRender();
      }
    } else {
      // Test mode: direct write
      this.terminal!.write(content);
    }
  }

  onToolStart(toolName: string): void {
    if (this.tui) {
      // Interactive mode: create collapsible section in chat
      const section = new ToolOutputSection(toolName);
      this.activeToolOutput = section;
      this.toolOutputs.push(section);
      this.chatContainer!.addChild(section);
      this.tui.requestRender();
    } else {
      // Test mode: direct write
      this.terminal!.write(`\n[Tool] Executing ${toolName}...\n`);
    }
  }

  onToolEnd(success = true): void {
    if (this.tui) {
      // Interactive mode: collapse the section
      if (this.activeToolOutput) {
        this.activeToolOutput.markComplete(success);
        this.activeToolOutput = undefined;
        this.tui.requestRender();
      }
    } else {
      // Test mode: direct write
      this.terminal!.write('[Tool] Complete\n');
    }
  }

  startAssistantStream(): void {
    if (this.tui) {
      // Finalize any active tool output
      if (this.activeToolOutput) {
        this.activeToolOutput.markComplete();
        this.activeToolOutput = undefined;
      }
      this.streamingContent = '';
      const prefix = '\x1b[1;34mPinmoli: \x1b[0m';
      this.streamingText = new Text(prefix, 1, 0);
      this.chatContainer!.addChild(this.streamingText);
      this.tui.requestRender();
    } else {
      this.streamingContent = '';
      this.terminal!.write('\nPinmoli: ');
    }
  }

  appendAssistantStream(delta: string): void {
    this.streamingContent += delta;
    if (this.tui) {
      const prefix = '\x1b[1;34mPinmoli: \x1b[0m';
      this.streamingText?.setText(prefix + this.streamingContent);
      this.tui.requestRender();
    } else {
      this.terminal!.write(delta);
    }
  }

  endAssistantStream(): string {
    const content = this.streamingContent;
    this.streamingText = undefined;
    this.streamingContent = '';
    if (!this.tui) {
      this.terminal!.write('\n');
    }
    if (content) {
      this.messages.push({ role: 'assistant', content });
    }
    return content;
  }

  async getUserInput(): Promise<string> {
    if (this.tui) {
      // Interactive mode: use Editor
      return new Promise((resolve) => {
        this.editor!.onSubmit = (text) => {
          this.editor!.setText('');
          this.editor!.addToHistory(text);
          this.editor!.onSubmit = undefined;
          resolve(text);
        };
      });
    } else {
      // Test mode: direct input handling
      this.ensureTestStarted();
      this.terminal!.write('\n> ');
      return new Promise((resolve) => {
        this.pendingInputResolve = resolve;
      });
    }
  }

  clear(): void {
    if (this.tui) {
      this.chatContainer!.clear();
      this.activeToolOutput = undefined;
      this.toolOutputs = [];
      this.tui.requestRender();
    } else {
      this.terminal!.clearScreen();
    }
  }

  stop(): void {
    if (this.tui) {
      this.tui.stop();
    } else {
      this.terminal?.stop();
    }
  }

  // --- Ctrl+C / Escape helpers ---

  setAgentBusy(busy: boolean): void {
    this.isAgentBusy = busy;
  }

  showHint(text: string): void {
    if (this.hintText) {
      this.hintText.setText(`\x1b[2m  ${text}\x1b[0m`);
      this.tui?.requestRender();
    }
  }

  clearQuitArmed(): void {
    this.quitArmed = false;
    if (this.quitTimer) {
      clearTimeout(this.quitTimer);
      this.quitTimer = undefined;
    }
    if (this.hintText) {
      this.hintText.setText('');
      this.tui?.requestRender();
    }
  }

  // --- Test mode helpers ---

  private ensureTestStarted(): void {
    if (this.terminal && !this.testStarted) {
      this.testStarted = true;
      this.terminal.start(
        (data) => this.onTestInput(data),
        () => {}
      );
    }
  }

  private onTestInput(data: string): void {
    if (!this.pendingInputResolve) return;

    this.inputBuffer += data;
    // Handle both \r (raw mode) and \n (test mode)
    const nlIdx = this.inputBuffer.search(/[\r\n]/);
    if (nlIdx >= 0) {
      const line = this.inputBuffer.substring(0, nlIdx).trim();
      this.inputBuffer = this.inputBuffer.substring(nlIdx + 1);
      const resolver = this.pendingInputResolve;
      this.pendingInputResolve = undefined;
      resolver(line);
    }
  }
}
