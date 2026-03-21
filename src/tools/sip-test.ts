/**
 * SIP Test Tool
 * Executes SIP tests (OPTIONS, INVITE, REGISTER)
 */

import type { AgentTool } from '@mariozechner/pi-agent-core';
import { TestConfigSchema, type SipEvent, type TestConfig } from '../validation/schemas.js';
import { runSipTest } from '../sip/engine.js';
import { buildFlowFromEvents, writeFlowJson } from '../network/flow.js';
import { getSessionRoot } from '../network/session.js';
import { basename, resolve } from 'path';
import { readdirSync } from 'fs';

export const sipTestTool: AgentTool = {
  name: 'sip_test',
  label: 'SIP Test',
  description: `Execute a SIP test (OPTIONS, INVITE, or REGISTER). Call this tool immediately with the parameters the user provided — do NOT ask for confirmation. Use sensible defaults for anything not specified: codecs ["PCMU"], transport "udp", timeout 30000. For INVITE, audioSample is optional (omit to listen silently).`,
  parameters: TestConfigSchema,
  
  async execute(toolCallId, params, signal, onUpdate) {
    const config = params as TestConfig;

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
      
      // Write flow.json to the test session directory
      const testDir = findTestDir(events);
      if (testDir) {
        const flow = buildFlowFromEvents(events, {
          protocol: 'sip',
          method: config.method,
          uri: config.uri,
        });
        const sessionRoot = getSessionRoot();
        const dirName = basename(testDir);
        // Create a minimal session object for writeFlowJson
        const flowSession = { file: (name: string) => resolve(testDir.startsWith('/') ? testDir : resolve(sessionRoot, dirName), name) } as { file: (name: string) => string };
        writeFlowJson(flowSession as Parameters<typeof writeFlowJson>[0], flow);
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
        details: { events, config, success: finalEvent?.type !== 'error', testDir: testDir ? basename(testDir) : undefined }
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

      // Write flow.json even on error
      const testDir = findTestDir(events);
      if (testDir) {
        const flow = buildFlowFromEvents(events, {
          protocol: 'sip',
          method: config.method,
          uri: config.uri,
        });
        const flowSession = { file: (name: string) => resolve(testDir, name) } as Parameters<typeof writeFlowJson>[0];
        writeFlowJson(flowSession, flow);
      }

      return {
        content: [{
          type: 'text',
          text: `❌ Test failed: ${errorEvent.message}`
        }],
        details: { events, config, success: false, testDir: testDir ? basename(testDir) : undefined }
      };
    }
  }
};

/**
 * Find the test session directory from engine events.
 * The SIP engine emits "session: <name>" in its info events.
 */
function findTestDir(events: SipEvent[]): string | undefined {
  for (const ev of events) {
    if (ev.type === 'info' && ev.message.includes('session:')) {
      // "Test completed successfully in 1234ms — session: /app/captures/..."
      // or "Resolved: host:port — session: sip-invite-host-20260320-065114"
      const match = ev.message.match(/session:\s+(.+?)$/);
      if (match) return match[1].trim();
    }
  }
  // Fallback: scan session root for most recent sip-* dir
  try {
    const root = getSessionRoot();
    const dirs = readdirSync(root, { withFileTypes: true })
      .filter(d => d.isDirectory() && d.name.startsWith('sip-'))
      .map(d => d.name)
      .sort()
      .reverse();
    if (dirs.length > 0) return resolve(root, dirs[0]);
  } catch { /* no captures dir */ }
  return undefined;
}
