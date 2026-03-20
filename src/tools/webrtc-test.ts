/**
 * WebRTC Test Tool
 * Executes WebRTC voice agent tests via WHIP signaling
 */

import type { AgentTool } from '@mariozechner/pi-agent-core';
import { WebRtcTestConfigSchema, type TestEvent, type WebRtcTestConfig } from '../validation/schemas.js';
import { runWebRtcTest } from '../webrtc/engine.js';
import { buildFlowFromEvents, writeFlowJson } from '../network/flow.js';
import { getSessionRoot } from '../network/session.js';
import { basename, resolve } from 'path';
import { readdirSync } from 'fs';

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

      // Write flow.json to the test session directory
      const testDir = findWebRtcTestDir(events);
      if (testDir) {
        const flow = buildFlowFromEvents(events, {
          protocol: 'webrtc',
          uri: config.whipEndpoint,
        });
        const flowSession = { file: (name: string) => resolve(testDir.startsWith('/') ? testDir : resolve(getSessionRoot(), basename(testDir)), name) } as Parameters<typeof writeFlowJson>[0];
        writeFlowJson(flowSession, flow);
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
        details: { events, config, success: finalEvent?.type !== 'error', testDir: testDir ? basename(testDir) : undefined }
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

      // Write flow.json even on error
      const testDir = findWebRtcTestDir(events);
      if (testDir) {
        const flow = buildFlowFromEvents(events, {
          protocol: 'webrtc',
          uri: config.whipEndpoint,
        });
        const flowSession = { file: (name: string) => resolve(testDir, name) } as Parameters<typeof writeFlowJson>[0];
        writeFlowJson(flowSession, flow);
      }

      return {
        content: [{
          type: 'text',
          text: `Test failed: ${errorEvent.message}`
        }],
        details: { events, config, success: false, testDir: testDir ? basename(testDir) : undefined }
      };
    }
  }
};

/**
 * Find the test session directory from WebRTC engine events.
 * The engine emits "session: <name>" in its first info event.
 */
function findWebRtcTestDir(events: TestEvent[]): string | undefined {
  for (const ev of events) {
    if (ev.type === 'info' && ev.message.includes('session:')) {
      const match = ev.message.match(/session:\s+(.+?)$/);
      if (match) return match[1].trim();
    }
  }
  // Fallback: scan session root for most recent webrtc-* dir
  try {
    const root = getSessionRoot();
    const dirs = readdirSync(root, { withFileTypes: true })
      .filter(d => d.isDirectory() && d.name.startsWith('webrtc-'))
      .map(d => d.name)
      .sort()
      .reverse();
    if (dirs.length > 0) return resolve(root, dirs[0]);
  } catch { /* no captures dir */ }
  return undefined;
}
