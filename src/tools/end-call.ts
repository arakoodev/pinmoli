/**
 * end_call tool — hang up an active call (BYE → close sockets → cleanup).
 */

import type { AgentTool } from '@mariozechner/pi-agent-core';
import { EndCallConfigSchema, type TestEvent } from '../validation/schemas.js';
import { getCall } from '../sip/call-store.js';
import { closeDialog } from '../sip/call-session.js';

export const endCallTool: AgentTool = {
  name: 'end_call',
  label: 'End Call',
  description: 'End an active SIP call. Sends BYE, closes sockets, and cleans up. Always call this when done with an interactive call.',
  parameters: EndCallConfigSchema,

  async execute(toolCallId, params, signal, onUpdate) {
    const config = params as { callId: string };
    const handle = getCall(config.callId);

    if (!handle) {
      return {
        content: [{ type: 'text', text: `No active call with ID: ${config.callId}` }],
        details: { error: 'call_not_found', callId: config.callId },
      };
    }

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
      const durationMs = Date.now() - handle.createdAt;

      // Write session metadata before closing
      handle.session.writeMetadata({
        session: handle.session.name,
        config: { uri: handle.uri, method: 'INVITE', codec: handle.negotiatedCodec.name },
        startTime: new Date(handle.createdAt).toISOString(),
        duration: durationMs,
        succeeded: true,
        timedOut: false,
        publicIp: handle.publicIp,
        rtpPort: handle.rtpPort,
        turns: handle.turnCounter,
      });

      await closeDialog(handle, emit);

      const seconds = (durationMs / 1000).toFixed(1);

      return {
        content: [{
          type: 'text',
          text: `Call ended — duration: ${seconds}s, turns: ${handle.turnCounter}, session: ${handle.session.dir}`,
        }],
        details: {
          callId: config.callId,
          durationMs,
          turns: handle.turnCounter,
          sessionDir: handle.session.dir,
          events,
        },
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Failed to end call: ${error instanceof Error ? error.message : String(error)}` }],
        details: { error: error instanceof Error ? error.message : String(error), events },
      };
    }
  },
};
