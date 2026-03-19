/**
 * WebRTC Test Engine
 * Executes WebRTC voice agent tests via WHIP signaling + werift media.
 * Async generator pattern mirrors src/sip/engine.ts.
 */

import {
  RTCPeerConnection,
  RtpPacket,
  RtpHeader,
  useOPUS,
  usePCMU,
} from 'werift';
import { whipOffer, whipDelete, WhipError } from './whip.js';
import { createSession } from '../network/session.js';
import { loadAudioAsFrames, saveReceivedAudio, savePayloadsAsWav, type AudioFrameConfig } from './audio-frames.js';
import { getAudioSamplePath } from '../sip/audio.js';
import { DTMF_EVENT_MAP, DTMF_DEFAULTS, DtmfDetector, planDtmfDigit } from '../sip/dtmf.js';
import type { WebRtcTestConfig, TestEvent } from '../validation/schemas.js';

/**
 * Execute a WebRTC voice agent test and stream events.
 */
export async function* runWebRtcTest(config: WebRtcTestConfig): AsyncGenerator<TestEvent> {
  const t0 = Date.now();

  // Extract host from WHIP URL for session naming
  let whipHost = 'unknown';
  try { whipHost = new URL(config.whipEndpoint).hostname; } catch (_e) { /* use default */ }
  const session = createSession('webrtc', 'whip', whipHost);

  yield {
    type: 'info',
    timestamp: Date.now(),
    message: `Starting WebRTC test to ${config.whipEndpoint} — session: ${session.name}`,
  };

  const codec = config.codec ?? 'opus';
  const audioConfig: AudioFrameConfig = codec === 'opus'
    ? { sampleRate: 48000, channels: 2 }
    : { sampleRate: 8000, channels: 1 };

  const iceServers = config.iceServers ?? [{ urls: 'stun:stun.l.google.com:19302' }];
  const connectionTimeout = config.timeout ?? 10000;

  // --- Create PeerConnection ---
  yield {
    type: 'info',
    timestamp: Date.now(),
    message: 'Creating PeerConnection...',
  };

  const codecs = codec === 'opus'
    ? [useOPUS(), usePCMU()]
    : [usePCMU(), useOPUS()];

  const pc = new RTCPeerConnection({
    iceServers,
    codecs: { audio: codecs },
  });

  // Track received raw RTP payloads + DTMF
  const receivedPayloads: Buffer[] = [];
  const dtmfDetector = new DtmfDetector();
  let resourceUrl = '';

  try {
    // --- Add audio transceiver ---
    const transceiver = pc.addTransceiver('audio', { direction: 'sendrecv' });

    yield {
      type: 'info',
      timestamp: Date.now(),
      message: `Added audio transceiver (${codec}, sendrecv)`,
    };

    // Listen for incoming RTP on receiver track — store raw codec payloads
    transceiver.receiver.track.onReceiveRtp.subscribe((rtpPacket: RtpPacket) => {
      const pt = rtpPacket.header.payloadType;
      dtmfDetector.feed(pt, rtpPacket.payload, rtpPacket.header.timestamp);
      // Skip telephone-event packets from audio accumulation
      if (pt === DTMF_DEFAULTS.payloadType) return;
      // Store raw payload — decoded at save time via savePayloadsAsWav
      receivedPayloads.push(Buffer.from(rtpPacket.payload));
    });

    // --- Create and send SDP offer ---
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    session.logSignaling('>>>', 'WHIP OFFER (SDP)', offer.sdp ?? '');

    yield {
      type: 'webrtc',
      timestamp: Date.now(),
      message: `Sending WHIP offer to ${config.whipEndpoint}`,
      rawMessage: offer.sdp,
    };

    // --- WHIP signaling ---
    let sdpAnswer: string;
    try {
      const result = await whipOffer(
        config.whipEndpoint,
        offer.sdp!,
        config.bearerToken
      );
      sdpAnswer = result.sdpAnswer;
      resourceUrl = result.resourceUrl;
    } catch (err) {
      if (err instanceof WhipError) {
        session.logSignaling('<<<', `WHIP ERROR ${err.message}`, '');
        yield {
          type: 'error',
          timestamp: Date.now(),
          message: err.message,
          severity: 'fatal',
          code: 'WHIP_HTTP_ERROR',
          recovery: 'Check WHIP endpoint URL and authentication token',
        };
        return;
      }
      throw err;
    }

    session.logSignaling('<<<', 'WHIP ANSWER (SDP)', sdpAnswer);

    yield {
      type: 'webrtc',
      timestamp: Date.now(),
      message: 'Received SDP answer',
      rawMessage: sdpAnswer,
      sdpOffer: offer.sdp,
      sdpAnswer,
    };

    // --- Apply remote description ---
    await pc.setRemoteDescription({ type: 'answer', sdp: sdpAnswer });

    // --- Wait for ICE + DTLS connection ---
    yield {
      type: 'info',
      timestamp: Date.now(),
      message: 'ICE gathering + DTLS handshake...',
    };

    await waitForConnection(pc, connectionTimeout);

    yield {
      type: 'webrtc',
      timestamp: Date.now(),
      message: `ICE connected (state: ${pc.iceConnectionState})`,
    };

    yield {
      type: 'info',
      timestamp: Date.now(),
      message: `DTLS handshake complete (connection: ${pc.connectionState})`,
    };

    // --- Phase 1: Listen for agent greeting (if sendDelay > 0) ---
    const sendDelay = config.sendDelay ?? 0;
    const responseWaitTime = config.responseWaitTime ?? 10;

    if (sendDelay > 0) {
      yield {
        type: 'info',
        timestamp: Date.now(),
        message: `Listening for agent greeting (${sendDelay}s)...`,
      };

      const greetingPayloadsBefore = receivedPayloads.length;
      await sleep(sendDelay * 1000);
      const greetingPayloadsReceived = receivedPayloads.length - greetingPayloadsBefore;

      if (greetingPayloadsReceived > 0) {
        const greetingFile = session.file('agent-greeting.wav');
        savePayloadsAsWav(
          receivedPayloads.slice(greetingPayloadsBefore),
          codec,
          audioConfig,
          greetingFile,
        );

        yield {
          type: 'info',
          timestamp: Date.now(),
          message: `Received ${greetingPayloadsReceived} greeting packets from agent`,
        };
        yield {
          type: 'info',
          timestamp: Date.now(),
          message: `Agent greeting saved: ${greetingFile}`,
        };
      } else {
        yield {
          type: 'info',
          timestamp: Date.now(),
          message: `No greeting audio received (${sendDelay}s timeout)`,
        };
      }
    }

    // --- Phase 2: Send audio ---
    const sample = config.audioSample ?? 'voice-hello';
    const samplePath = getAudioSamplePath(sample);

    // RTP state — shared between audio send and DTMF send for stream continuity
    const ssrc = (Math.random() * 0xFFFFFFFF) >>> 0;
    let sequenceNumber = (Math.random() * 0xFFFF) >>> 0;
    let timestamp = 0;
    const samplesPerFrame = audioConfig.sampleRate === 48000 ? 960 : 160;
    const payloadType = codec === 'opus' ? 96 : 0;

    if (samplePath) {
      yield {
        type: 'info',
        timestamp: Date.now(),
        message: `Sending audio (${sample})...`,
      };

      const frames = loadAudioAsFrames(samplePath, audioConfig);

      // Save outbound audio to captures/audio/
      const outboundFile = session.file('sent-audio.wav');
      saveReceivedAudio(frames, audioConfig, outboundFile);
      yield {
        type: 'info',
        timestamp: Date.now(),
        message: `Outbound audio saved: ${outboundFile}`,
      };

      let framesSent = 0;

      for (const frame of frames) {
        const payload = Buffer.alloc(frame.length * 2);
        for (let i = 0; i < frame.length; i++) {
          payload.writeInt16LE(frame[i], i * 2);
        }

        const header = new RtpHeader();
        header.payloadType = payloadType;
        header.sequenceNumber = sequenceNumber & 0xFFFF;
        header.timestamp = timestamp >>> 0;
        header.ssrc = ssrc;
        header.marker = framesSent === 0;

        const rtpPacket = new RtpPacket(header, payload);

        try {
          transceiver.sender.sendRtp(rtpPacket);
        } catch {
          // Connection may have closed — stop sending
          break;
        }

        framesSent++;
        sequenceNumber++;
        timestamp += samplesPerFrame;

        // Pace at 20ms per frame
        await sleep(20);
      }

      const audioDuration = (framesSent * 20 / 1000).toFixed(1);
      yield {
        type: 'info',
        timestamp: Date.now(),
        message: `Sent ${framesSent} frames (${audioDuration}s of audio)`,
      };
    } else {
      yield {
        type: 'info',
        timestamp: Date.now(),
        message: `Audio sample not found: ${sample} — skipping send`,
      };
    }

    // --- Phase 2.5: Send DTMF digits (if configured) ---
    if (config.dtmfDigits) {
      yield {
        type: 'info',
        timestamp: Date.now(),
        message: `Sending DTMF digits: ${config.dtmfDigits}`,
      };

      let dtmfPacketsSent = 0;
      for (const digit of config.dtmfDigits) {
        const eventCode = DTMF_EVENT_MAP[digit];
        if (eventCode === undefined) continue;

        const packets = planDtmfDigit(eventCode);
        const digitTimestamp = timestamp;

        for (let i = 0; i < packets.length; i++) {
          const desc = packets[i];
          const header = new RtpHeader();
          header.payloadType = DTMF_DEFAULTS.payloadType;
          header.sequenceNumber = sequenceNumber & 0xFFFF;
          header.timestamp = digitTimestamp >>> 0;
          header.ssrc = ssrc;
          header.marker = desc.marker;

          const rtpPacket = new RtpPacket(header, desc.payload);

          try {
            transceiver.sender.sendRtp(rtpPacket);
          } catch {
            break;
          }

          dtmfPacketsSent++;
          sequenceNumber++;

          // Pace packets
          if (i < packets.length - 1) {
            const nextOffset = packets[i + 1].timeOffsetMs;
            await sleep(nextOffset - desc.timeOffsetMs);
          }
        }

        yield {
          type: 'dtmf',
          timestamp: Date.now(),
          message: `Sent DTMF digit: ${digit}`,
          dtmfDigit: digit,
        };

        // Advance timestamp past this digit + inter-digit gap
        const totalMs = DTMF_DEFAULTS.digitDurationMs + DTMF_DEFAULTS.interDigitGapMs;
        timestamp += Math.floor(totalMs * DTMF_DEFAULTS.clockRate / 1000);

        // Wait inter-digit gap
        await sleep(DTMF_DEFAULTS.interDigitGapMs);
      }

      yield {
        type: 'info',
        timestamp: Date.now(),
        message: `Sent ${config.dtmfDigits.length} DTMF digits (${dtmfPacketsSent} packets)`,
      };
    }

    // --- Phase 3: Listen for agent response ---
    yield {
      type: 'info',
      timestamp: Date.now(),
      message: `Listening for agent response (${responseWaitTime}s)...`,
    };

    const responsePayloadsBefore = receivedPayloads.length;
    await sleep(responseWaitTime * 1000);
    const responsePayloadsReceived = receivedPayloads.length - responsePayloadsBefore;

    if (responsePayloadsReceived > 0) {
      const responseFile = session.file('agent-response.wav');
      savePayloadsAsWav(
        receivedPayloads.slice(responsePayloadsBefore),
        codec,
        audioConfig,
        responseFile,
      );

      yield {
        type: 'info',
        timestamp: Date.now(),
        message: `Received ${responsePayloadsReceived} packets from agent`,
      };
      yield {
        type: 'info',
        timestamp: Date.now(),
        message: `Response saved: ${responseFile}`,
      };
    } else {
      yield {
        type: 'info',
        timestamp: Date.now(),
        message: `No audio received from agent (${responseWaitTime}s timeout)`,
      };
    }

    // --- DTMF detection summary ---
    if (dtmfDetector.digits) {
      for (const det of dtmfDetector.allDetections) {
        yield {
          type: 'dtmf',
          timestamp: Date.now(),
          message: `Received DTMF digit: ${det.digit}`,
          dtmfDigit: det.digit,
          dtmfDuration: det.duration,
        };
      }
      yield {
        type: 'info',
        timestamp: Date.now(),
        message: `Detected incoming DTMF: ${dtmfDetector.digits}`,
      };
    }

    // --- Teardown ---
    pc.close();

    if (resourceUrl) {
      try {
        await whipDelete(resourceUrl, config.bearerToken);
        yield {
          type: 'webrtc',
          timestamp: Date.now(),
          message: 'Session ended (WHIP DELETE)',
        };
      } catch {
        yield {
          type: 'info',
          timestamp: Date.now(),
          message: 'WHIP DELETE failed (session may already be closed)',
        };
      }
    }

    const duration = Date.now() - t0;
    yield {
      type: 'info',
      timestamp: Date.now(),
      message: `Test complete (${duration}ms)`,
    };

  } catch (error) {
    // Clean up on error
    try { pc.close(); } catch { /* already closed */ }
    if (resourceUrl) {
      try { await whipDelete(resourceUrl, config.bearerToken); } catch { /* best effort */ }
    }

    const message = error instanceof Error ? error.message : String(error);
    let code = 'WEBRTC_ERROR';
    let recovery = 'Check network connectivity and WHIP endpoint configuration';

    if (message.includes('ICE')) {
      code = 'ICE_FAILED';
      recovery = 'ICE connectivity failed. Check firewall/NAT. Try adding a TURN server.';
    } else if (message.includes('DTLS')) {
      code = 'DTLS_FAILED';
      recovery = 'DTLS handshake failed. The remote may not support the offered fingerprint.';
    } else if (message.includes('timeout') || message.includes('Timeout')) {
      code = 'TIMEOUT';
      recovery = 'No response within timeout. Check that the voice agent is running.';
    }

    yield {
      type: 'error',
      timestamp: Date.now(),
      message,
      severity: 'fatal',
      code,
      recovery,
    };
  }
}

/**
 * Wait for ICE + DTLS connection to reach 'connected' state.
 * Rejects on timeout or 'failed'/'closed' state.
 */
function waitForConnection(
  pc: RTCPeerConnection,
  timeoutMs: number
): Promise<void> {
  return new Promise((resolve, reject) => {
    // Check if already connected
    if (pc.connectionState === 'connected') {
      resolve();
      return;
    }

    const timeout = setTimeout(() => {
      reject(new Error(
        `Connection timeout after ${timeoutMs}ms (ICE: ${pc.iceConnectionState}, connection: ${pc.connectionState})`
      ));
    }, timeoutMs);
    timeout.unref();

    pc.connectionStateChange.subscribe((state: string) => {
      if (state === 'connected') {
        clearTimeout(timeout);
        resolve();
      } else if (state === 'failed' || state === 'closed') {
        clearTimeout(timeout);
        reject(new Error(`Connection ${state} (ICE: ${pc.iceConnectionState})`));
      }
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref();
  });
}
