/**
 * receive_audio tool — listen for audio on an active call.
 * Returns WAV file path and packet count.
 */

import type { AgentTool } from '@mariozechner/pi-agent-core';
import { ReceiveAudioConfigSchema, type ReceiveAudioConfig, type TestEvent } from '../validation/schemas.js';
import { getCall } from '../sip/call-store.js';
import { receiveAudio } from '../sip/call-session.js';

export const receiveAudioTool: AgentTool = {
  name: 'receive_audio',
  label: 'Receive Audio',
  description: 'Listen for audio on an active call. Records incoming RTP packets for the specified duration and saves as WAV. Use after start_call to capture agent greeting, or after send_audio to capture agent response.',
  parameters: ReceiveAudioConfigSchema,

  async execute(toolCallId, params, signal, onUpdate) {
    const config = params as ReceiveAudioConfig;
    const handle = getCall(config.callId);

    if (!handle) {
      return {
        content: [{ type: 'text', text: `No active call with ID: ${config.callId}` }],
        details: { error: 'call_not_found', callId: config.callId },
      };
    }

    const duration = config.duration ?? 10;
    const events: TestEvent[] = [];
    const t0 = Date.now();

    const emit = (ev: TestEvent) => {
      events.push(ev);
      const elapsed = `+${((ev.timestamp - t0) / 1000).toFixed(3)}s`;
      onUpdate?.({
        content: [{ type: 'text', text: `[${ev.type.toUpperCase()}] ${elapsed} ${ev.message}` }],
        details: { event: ev },
      });
    };

    try {
      const result = await receiveAudio(handle, duration, emit);

      const summary = result.packetsReceived > 0
        ? `Received ${result.packetsReceived} RTP packets (${duration}s) — saved: ${result.filePath}`
        : `No audio received (${duration}s timeout)`;

      return {
        content: [{ type: 'text', text: summary }],
        details: {
          callId: config.callId,
          filePath: result.filePath,
          packetsReceived: result.packetsReceived,
          duration,
          events,
        },
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Failed to receive audio: ${error instanceof Error ? error.message : String(error)}` }],
        details: { error: error instanceof Error ? error.message : String(error), events },
      };
    }
  },
};
