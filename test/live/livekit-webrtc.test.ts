/**
 * Live WebRTC test against a real WHIP endpoint.
 * Requires LIVEKIT_WHIP_URL and LIVEKIT_WHIP_TOKEN env vars.
 *
 * Run: docker compose exec pinmoli npx vitest run test/live/livekit-webrtc.test.ts
 */

import { describe, it, expect } from 'vitest';
import { runWebRtcTest } from '../../src/webrtc/engine.js';
import type { TestEvent } from '../../src/validation/schemas.js';

const WHIP_URL = process.env.LIVEKIT_WHIP_URL;
const WHIP_TOKEN = process.env.LIVEKIT_WHIP_TOKEN;

describe.skipIf(!WHIP_URL || !WHIP_TOKEN)('LiveKit WebRTC (live)', () => {
  it('connects via WHIP and exchanges audio', async () => {
    const events: TestEvent[] = [];

    for await (const event of runWebRtcTest({
      whipEndpoint: WHIP_URL!,
      bearerToken: WHIP_TOKEN!,
      codec: 'opus',
      audioSample: 'voice-hello',
      sendDelay: 5,
      responseWaitTime: 10,
      timeout: 15000,
    })) {
      events.push(event);
    }

    // Should not have fatal errors
    const fatalErrors = events.filter(e => e.type === 'error' && e.severity === 'fatal');
    expect(fatalErrors).toHaveLength(0);

    // Should have completed
    const completeEvent = events.find(e => e.message.includes('Test complete'));
    expect(completeEvent).toBeDefined();

    // Should have received SDP answer
    const answerEvent = events.find(e => e.sdpAnswer);
    expect(answerEvent).toBeDefined();
  }, 60000);
});
