/**
 * start_call tool — begin an interactive multi-turn SIP call.
 * Returns a callId for subsequent send_audio/receive_audio/end_call.
 */

import type { AgentTool } from '@mariozechner/pi-agent-core';
import { StartCallConfigSchema, type StartCallConfig, type TestEvent } from '../validation/schemas.js';
import { openDialog } from '../sip/call-session.js';

export const startCallTool: AgentTool = {
  name: 'start_call',
  label: 'Start Call',
  description: 'Start an interactive SIP call (INVITE → 200 OK → ACK). Returns a callId for use with send_audio, receive_audio, and end_call. Use this for multi-turn conversations where you need to listen, respond, listen again, etc. For simple one-shot tests, use sip_test instead.',
  parameters: StartCallConfigSchema,

  async execute(toolCallId, params, signal, onUpdate) {
    const config = params as StartCallConfig;
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
      const handle = await openDialog({
        uri: config.uri,
        codecs: config.codecs ?? ['PCMU'],
        timeout: config.timeout,
      }, emit);

      return {
        content: [{
          type: 'text',
          text: `Call started — callId: ${handle.callId}, codec: ${handle.negotiatedCodec.name}, remote: ${handle.remoteIp}:${handle.remotePort}`,
        }],
        details: {
          callId: handle.callId,
          codec: handle.negotiatedCodec.name,
          remoteIp: handle.remoteIp,
          remotePort: handle.remotePort,
          sessionDir: handle.session.dir,
          events,
        },
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: `Failed to start call: ${error instanceof Error ? error.message : String(error)}`,
        }],
        details: { error: error instanceof Error ? error.message : String(error), events },
      };
    }
  },
};
