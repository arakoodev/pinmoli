/**
 * WebRTC Test Tool
 * Executes WebRTC voice agent tests via WHIP signaling
 */

import type { AgentTool } from '@mariozechner/pi-agent-core';
import { WebRtcTestConfigSchema, type TestEvent, type WebRtcTestConfig } from '../validation/schemas.js';
import { runWebRtcTest } from '../webrtc/engine.js';

export const webrtcTestTool: AgentTool = {
  name: 'webrtc_test',
  label: 'WebRTC Test',
  description: `Execute a WebRTC voice agent test. Connects to a WHIP endpoint,
negotiates ICE/DTLS/SRTP, sends audio, and captures the agent's response.

IMPORTANT: Before calling this tool, confirm with the user:
1. WHIP endpoint URL (must be HTTPS, or HTTP for local dev)
2. Bearer token (required for LiveKit, Cloudflare, etc.)
3. Audio sample and sendDelay (recommend 5-8 for agents that speak first)

Skip confirmation only if the user explicitly provided all parameters or said "use defaults".`,
  parameters: WebRtcTestConfigSchema,

  async execute(toolCallId, params, signal, onUpdate) {
    const config = params as WebRtcTestConfig;

    const events: TestEvent[] = [];
    const t0 = Date.now();

    try {
      for await (const event of runWebRtcTest(config)) {
        events.push(event);

        // Build verbose output lines
        const elapsed = `+${((event.timestamp - t0) / 1000).toFixed(3)}s`;
        const lines: string[] = [];

        lines.push(`[${event.type.toUpperCase()}] ${elapsed} ${event.message}`);

        // Show raw SDP messages
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

      // Build summary
      const finalEvent = events[events.length - 1];
      let summary = '';

      if (finalEvent?.type === 'error') {
        summary = `Test failed: ${finalEvent.message}`;
        if (finalEvent.recovery) {
          summary += `\n\nRecovery: ${finalEvent.recovery}`;
        }
      } else {
        const receivedEvent = events.find(e => e.message.includes('Received') && e.message.includes('frames from agent'));
        const sentEvent = events.find(e => e.message.includes('Sent') && e.message.includes('frames'));
        summary = 'WebRTC test completed.';
        if (sentEvent) summary += ` ${sentEvent.message}.`;
        if (receivedEvent) summary += ` ${receivedEvent.message}.`;
      }

      return {
        content: [{
          type: 'text',
          text: summary
        }],
        details: { events, config, success: finalEvent?.type !== 'error' }
      };

    } catch (error) {
      const errorEvent: TestEvent = {
        type: 'error',
        timestamp: Date.now(),
        message: error instanceof Error ? error.message : String(error),
        severity: 'fatal',
        code: 'WEBRTC_ERROR'
      };

      events.push(errorEvent);

      return {
        content: [{
          type: 'text',
          text: `Test failed: ${errorEvent.message}`
        }],
        details: { events, config, success: false }
      };
    }
  }
};
