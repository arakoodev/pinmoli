/**
 * SIP Test Tool
 * Executes SIP tests (OPTIONS, INVITE, REGISTER)
 */

import type { AgentTool } from '@mariozechner/pi-agent-core';
import { TestConfigSchema, type SipEvent } from '../validation/schemas.js';
import { runSipTest } from '../sip/engine.js';

export const sipTestTool: AgentTool = {
  name: 'sip_test',
  label: 'SIP Test',
  description: `Execute a SIP test (OPTIONS, INVITE, or REGISTER).

IMPORTANT: Before calling this tool, confirm with the user:
1. URI: For LiveKit (*.sip.livekit.cloud), URI must contain a phone number (sip:+1XXXXXXXXXX@host). Bare host gives 404.
2. INVITE: Confirm audio sample, sendDelay (recommend 8 for voice agents that speak first), responseWaitTime.
3. REGISTER: Ask about auth credentials.

Skip confirmation only if the user explicitly provided all parameters or said "use defaults".`,
  parameters: TestConfigSchema,
  
  async execute(toolCallId, params, signal, onUpdate) {
    const config = params as any;

    const events: SipEvent[] = [];
    const t0 = Date.now();

    try {
      // Stream events as they happen
      for await (const event of runSipTest(config)) {
        events.push(event);

        // Build verbose output lines
        const elapsed = `+${((event.timestamp - t0) / 1000).toFixed(3)}s`;
        const lines: string[] = [];

        lines.push(`[${event.type.toUpperCase()}] ${elapsed} ${event.message}`);

        // Show raw SIP messages (request sent / response received)
        if (event.rawMessage) {
          lines.push('  ┌──────────────────────────────────────');
          for (const line of event.rawMessage.split(/\r?\n/)) {
            if (line.trim()) lines.push(`  │ ${line}`);
          }
          lines.push('  └──────────────────────────────────────');
        }

        // Show SDP offer/answer inline (when no rawMessage already contains it)
        if (event.sdpOffer && !event.rawMessage) {
          lines.push('  SDP Offer:');
          for (const line of event.sdpOffer.split(/\r?\n/)) {
            if (line.trim()) lines.push(`    ${line}`);
          }
        }
        if (event.sdpAnswer && !event.rawMessage) {
          lines.push('  SDP Answer:');
          for (const line of event.sdpAnswer.split(/\r?\n/)) {
            if (line.trim()) lines.push(`    ${line}`);
          }
        }

        // Show error recovery hints
        if (event.recovery) {
          lines.push(`  Recovery: ${event.recovery}`);
        }

        // Stream to TUI via onUpdate
        onUpdate?.({
          content: [{
            type: 'text',
            text: lines.join('\n')
          }],
          details: { event }
        });

        // Check for abort signal
        if (signal?.aborted) {
          break;
        }
      }
      
      // Find final status
      const finalEvent = events[events.length - 1];
      const statusEvent = events.find(e => e.status);
      
      let summary = '';
      if (finalEvent?.type === 'error') {
        summary = `❌ Test failed: ${finalEvent.message}`;
        if (finalEvent.recovery) {
          summary += `\n\nRecovery: ${finalEvent.recovery}`;
        }
      } else if (statusEvent) {
        summary = `✓ Test successful! Server responded with ${statusEvent.status}`;
        if (config.codecs) {
          summary += `\nCodecs tested: ${config.codecs.join(', ')}`;
        }
      } else {
        summary = 'Test completed';
      }
      
      return {
        content: [{
          type: 'text',
          text: summary
        }],
        details: { events, config, success: finalEvent?.type !== 'error' }
      };
      
    } catch (error) {
      const errorEvent: SipEvent = {
        type: 'error',
        timestamp: Date.now(),
        message: error instanceof Error ? error.message : String(error),
        severity: 'fatal',
        code: 'SIP_ERROR'
      };
      
      events.push(errorEvent);
      
      return {
        content: [{
          type: 'text',
          text: `❌ Test failed: ${errorEvent.message}`
        }],
        details: { events, config, success: false }
      };
    }
  }
};
