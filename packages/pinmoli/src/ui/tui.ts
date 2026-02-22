/**
 * Pinmoli TUI
 * Simple console-based UI with streaming support
 */

export class PinmoliTUI {
  private messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }> = [];

  /**
   * Add a message to the chat
   */
  addMessage(role: 'user' | 'assistant' | 'system', content: string): void {
    this.messages.push({ role, content });
    this.render();
  }

  /**
   * Stream a message (for real-time updates)
   */
  streamMessage(content: string): void {
    process.stdout.write(content);
  }

  /**
   * Render the TUI
   */
  render(): void {
    // Simple console rendering for now
    const lastMessage = this.messages[this.messages.length - 1];
    if (lastMessage) {
      let prefix = '';
      if (lastMessage.role === 'user') {
        prefix = '\nYou: ';
      } else if (lastMessage.role === 'assistant') {
        prefix = '\nPinmoli: ';
      } else if (lastMessage.role === 'system') {
        prefix = '\n';
      }
      console.log(prefix + lastMessage.content);
    }
  }

  /**
   * Get user input
   */
  async getUserInput(): Promise<string> {
    process.stdout.write('\n> ');
    return new Promise((resolve) => {
      process.stdin.once('data', (data) => {
        resolve(data.toString().trim());
      });
    });
  }

  /**
   * Start the TUI
   */
  start(): void {
    console.log('\n┌─────────────────────────────────────────┐');
    console.log('│  Pinmoli - SIP Testing Agent           │');
    console.log('└─────────────────────────────────────────┘');
    this.addMessage('assistant', "Hi! I'm your SIP/WebRTC testing assistant. What would you like to test?");
  }

  /**
   * Clear the screen
   */
  clear(): void {
    console.clear();
  }
}
