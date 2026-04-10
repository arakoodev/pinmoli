/**
 * Composable SIP call session phases.
 *
 * Four async functions that operate on CallHandle:
 *   openDialog  → INVITE → 200 OK → ACK → return CallHandle
 *   sendAudio   → load/transcode → sendRTPFromSocket (continues rtpStreamState)
 *   receiveAudio → receiveRTPAudio → save WAV → return path + count
 *   closeDialog  → BYE → close sockets → remove from store
 *
 * Used by both one-shot sip_test (via engine.ts) and interactive tools
 * (start_call/send_audio/receive_audio/end_call).
 */

import dgram from 'dgram';
import { generateCallId, generateTag, buildInviteRequest, buildAckRequest, buildByeRequest, buildCancelRequest } from './protocol.js';
import { buildSdp, parseSdpAnswer } from './sdp.js';
import { receiveRTPAudio, saveAsWAV, sendRTPFromSocket, sendDtmfFromSocket, loadAudioSample, buildRTPPacket } from './rtp-receiver.js';
import { transcodePcmuTo, CODEC_TABLE, type CodecInfo } from './codec.js';
import { DtmfDetector } from './dtmf.js';
import { storeCall, removeCall, type CallHandle } from './call-store.js';
import { createSession } from '../network/session.js';
import { runPreflight, resolveStunConfig } from '../network/preflight.js';
import type { TestEvent } from '../validation/schemas.js';

export interface OpenDialogConfig {
  uri: string;
  codecs: readonly string[];
  timeout?: number;
  mediaPort?: number; // 0 = random (default)
  maxDuration?: number; // seconds, default 300
  stunServer?: string; // STUN server (host or host:port). Default: PINMOLI_STUN_SERVER env or stun.l.google.com
  skipPreflight?: boolean; // Skip NAT type detection (e.g. user chose "proceed anyway")
}

function generateSdp(codecs: readonly string[], mediaPort: number, localIp: string): string {
  return buildSdp({
    sessionId: Date.now().toString(),
    sessionVersion: '1',
    origin: localIp,
    connection: localIp,
    mediaPort,
    codecs: [...codecs],
  });
}

/**
 * INVITE → wait for 200 OK → ACK → return populated CallHandle.
 * Stores the handle in the call store and starts a max-duration timer.
 */
export async function openDialog(
  config: OpenDialogConfig,
  onEvent: (event: TestEvent) => void,
): Promise<CallHandle> {
  // Parse SIP URI
  const uriMatch = config.uri.match(/^sips?:([^@]+@)?([^:;]+)(:(\d+))?/);
  if (!uriMatch) throw new Error('Invalid SIP URI format');

  const host = uriMatch[2];
  const port = parseInt(uriMatch[4] || '5060');

  const session = createSession('sip', 'INVITE', host);

  onEvent({
    type: 'info',
    timestamp: Date.now(),
    message: `Starting SIP INVITE to ${config.uri}`,
  });
  onEvent({
    type: 'info',
    timestamp: Date.now(),
    message: `Resolved: ${host}:${port} — session: ${session.name}`,
  });

  // Pre-flight: DNS + STUN + NAT type detection (unless skipped)
  if (!config.skipPreflight) {
    const preflight = await runPreflight(host, config.stunServer);
    for (const diag of preflight.diagnostics) {
      onEvent({ type: 'info', timestamp: Date.now(), message: `[preflight] ${diag}` });
    }
    if (preflight.natType === 'symmetric') {
      onEvent({
        type: 'info',
        timestamp: Date.now(),
        message: '[preflight] WARNING: Symmetric NAT detected — inbound RTP will likely fail. ' +
          'Consider using WebRTC (webrtc_test) or a TURN relay.',
        severity: 'warning',
      });
    }
    if (!preflight.sipHostResolved) {
      onEvent({
        type: 'info',
        timestamp: Date.now(),
        message: `[preflight] WARNING: DNS resolution failed for ${host} — INVITE will likely fail`,
        severity: 'warning',
      });
    }
  }

  // Resolve STUN config
  const stun = resolveStunConfig(config.stunServer);

  // Create separate sockets for SIP signaling and RTP media
  const sipSocket = dgram.createSocket('udp4');
  const rtpSocket = dgram.createSocket('udp4');

  const { stunDiscoverAddress } = await import('../network/utils.js');

  // Bind SIP socket
  await new Promise<void>((resolve, reject) => {
    sipSocket.once('error', reject);
    sipSocket.bind(0, () => {
      sipSocket.removeListener('error', reject);
      resolve();
    });
  });
  const sipPort = sipSocket.address().port;

  // Bind RTP socket
  const targetRtpPort = config.mediaPort ?? 0;
  await new Promise<void>((resolve, reject) => {
    rtpSocket.once('error', reject);
    rtpSocket.bind(targetRtpPort, () => {
      rtpSocket.removeListener('error', reject);
      resolve();
    });
  });

  // STUN-discover NAT-mapped address for the RTP socket
  const rtpStun = await stunDiscoverAddress(rtpSocket, stun.server, stun.port);
  const publicIp = rtpStun.ip;
  const rtpPort = rtpStun.port;

  onEvent({
    type: 'info',
    timestamp: Date.now(),
    message: `Public IP: ${publicIp}, RTP mapped to ${publicIp}:${rtpPort} (STUN via ${stun.server}), SIP via rport on local :${sipPort}`,
  });

  // Build INVITE
  const callId = generateCallId();
  const fromTag = generateTag();
  const branch = `z9hG4bK${generateTag()}`;
  const sdp = generateSdp(config.codecs, rtpPort, publicIp);
  const sipMessage = buildInviteRequest(config.uri, host, port, callId, fromTag, branch, sdp, publicIp, sipPort);

  session.logSignaling('>>>', 'SENT INVITE', sipMessage);

  onEvent({
    type: 'sip',
    timestamp: Date.now(),
    message: 'Sending INVITE request...',
    method: 'INVITE',
    rawMessage: sipMessage,
    sdpOffer: sdp,
  });

  // Send INVITE and wait for final response
  const timeout = config.timeout ?? 30000;
  const startTime = Date.now();
  const responses: Array<{ statusCode: number; statusText: string; response: string; receivedAt: number }> = [];

  let socketClosed = false;
  const safeClose = () => {
    if (!socketClosed) {
      socketClosed = true;
      try { sipSocket.close(); } catch (_e) { /* already closed */ }
      try { rtpSocket.close(); } catch (_e) { /* already closed */ }
    }
  };

  let timedOut = false;
  let retransmitTimer: ReturnType<typeof setTimeout> | null = null;
  const clearRetransmit = () => {
    if (retransmitTimer) { clearTimeout(retransmitTimer); retransmitTimer = null; }
  };

  // Keep a ref to the message handler so we can remove it after the promise resolves
  let sipMessageHandler: ((msg: Buffer) => void) | null = null;

  await new Promise<void>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      timedOut = true;
      clearRetransmit();
      const hasFinalResponse = responses.some(r => r.statusCode >= 200);

      if (responses.length === 0) {
        safeClose();
        reject(new Error('Request timeout'));
      } else if (!hasFinalResponse) {
        // Got only provisional (1xx) — send CANCEL before closing
        const cancelMessage = buildCancelRequest(config.uri, host, port, callId, fromTag, branch, publicIp, sipPort);
        session.logSignaling('>>>', 'SENT CANCEL', cancelMessage);
        sipSocket.send(cancelMessage, port, host, () => {
          const cancelTimeout = setTimeout(() => { safeClose(); reject(new Error('INVITE not answered')); }, 2000);
          cancelTimeout.unref();
          sipSocket.once('message', () => { clearTimeout(cancelTimeout); safeClose(); reject(new Error('INVITE not answered')); });
        });
      } else {
        safeClose();
        resolve();
      }
    }, timeout);
    timeoutId.unref();

    sipMessageHandler = (msg: Buffer) => {
      const response = msg.toString();
      const statusMatch = response.match(/SIP\/2\.0 (\d+) (.+)/);

      if (statusMatch) {
        const statusCode = parseInt(statusMatch[1]);
        const statusText = statusMatch[2].trim();

        responses.push({ statusCode, statusText, response, receivedAt: Date.now() });
        session.logSignaling('<<<', `RECEIVED ${statusCode} ${statusText}`, response);

        onEvent({
          type: 'sip',
          timestamp: Date.now(),
          message: `Received ${statusCode} ${statusText}`,
          status: statusCode,
          rawMessage: response,
        });

        if (statusCode >= 200) {
          clearRetransmit();
          clearTimeout(timeoutId);
          resolve();
        }
      }
    };

    sipSocket.on('message', sipMessageHandler);

    sipSocket.on('error', (err) => {
      clearRetransmit();
      clearTimeout(timeoutId);
      safeClose();
      reject(err);
    });

    sipSocket.send(sipMessage, port, host, (err) => {
      if (err) {
        clearRetransmit();
        clearTimeout(timeoutId);
        safeClose();
        reject(err);
        return;
      }
      // Start INVITE retransmission (RFC 3261 §17.1.1.2 Timer A)
      let retransmitDelay = 500; // T1 = 500ms
      const scheduleRetransmit = () => {
        retransmitTimer = setTimeout(() => {
          if (timedOut || responses.some(r => r.statusCode >= 200)) return;
          sipSocket.send(sipMessage, port, host);
          retransmitDelay = Math.min(retransmitDelay * 2, 4000); // cap at T2 = 4s
          scheduleRetransmit();
        }, retransmitDelay);
        retransmitTimer.unref();
      };
      scheduleRetransmit();
    });
  });

  // Clean up the INVITE message handler — the socket is now free for BYE etc.
  if (sipMessageHandler) {
    sipSocket.off('message', sipMessageHandler);
  }

  // Find 200 OK response
  const okResponse = responses.find(r => r.statusCode === 200);
  if (!okResponse) {
    safeClose();
    const highest = responses[responses.length - 1];
    throw new Error(`INVITE failed: received ${highest?.statusCode ?? 'no'} response`);
  }

  // Parse To-tag from 200 OK
  const toTagMatch = okResponse.response.match(/To:[^\r\n]*;tag=([^\s;>\r\n]+)/i);
  const toTag = toTagMatch ? toTagMatch[1] : '';

  // Parse SDP answer — extract negotiated codec + remote IP/port
  let remoteIp = host;
  let remotePort = 10000;
  let negotiatedCodec: CodecInfo = CODEC_TABLE.PCMU;

  if (okResponse.response.includes('Content-Type: application/sdp')) {
    const sdpMatch = okResponse.response.match(/v=0[\s\S]+/);
    if (sdpMatch) {
      const sdpAnswer = parseSdpAnswer(sdpMatch[0], host, 10000);
      remoteIp = sdpAnswer.remoteIp;
      remotePort = sdpAnswer.remotePort;
      negotiatedCodec = sdpAnswer.codec;

      onEvent({
        type: 'info',
        timestamp: Date.now(),
        message: 'SDP answer received',
        sdpAnswer: sdpMatch[0],
      });
      onEvent({
        type: 'info',
        timestamp: Date.now(),
        message: `Codec negotiated: ${negotiatedCodec.name} (PT=${negotiatedCodec.payloadType}, clock=${negotiatedCodec.clockRate}Hz)`,
      });
    }
  }

  // Send ACK (with To-tag from 200 OK per RFC 3261 Section 12.2.1.1)
  const ackMessage = buildAckRequest(config.uri, host, port, callId, fromTag, toTag, branch, publicIp, sipPort);
  session.logSignaling('>>>', 'SENT ACK', ackMessage);
  onEvent({ type: 'sip', timestamp: Date.now(), message: 'Sending ACK' });

  await new Promise<void>((resolve) => {
    sipSocket.send(ackMessage, port, host, () => resolve());
  });

  // NAT hole-punch: send a short burst of silence RTP immediately after ACK.
  // SIP signaling and RTP use separate UDP sockets. The NAT mapping for the
  // RTP socket only opens for return traffic once we send from it. Without
  // this, symmetric NATs drop the agent's inbound RTP because no outbound
  // packet has been sent from the RTP port to the remote media address.
  // 500ms of silence (25 packets × 20ms) is enough to open the pinhole.
  const silenceValue = negotiatedCodec.name === 'PCMA' ? 0xD5 : 0xFF; // silence byte per codec
  const silencePacket = Buffer.alloc(negotiatedCodec.packetSize, silenceValue);
  const silenceData = Buffer.concat(Array.from({ length: 25 }, () => silencePacket));
  const natPunchState = await sendRTPFromSocket(rtpSocket, silenceData, remoteIp, remotePort, {
    codec: negotiatedCodec,
  });

  onEvent({
    type: 'info',
    timestamp: Date.now(),
    message: `NAT hole-punch: sent ${natPunchState.packetsSent} silence packets to ${remoteIp}:${remotePort}`,
  });

  // Build CallHandle
  const maxDuration = config.maxDuration ?? 300;
  const handle: CallHandle = {
    callId,
    state: 'active',
    fromTag,
    toTag,
    branch,
    uri: config.uri,
    sipSocket,
    rtpSocket,
    host,
    port,
    publicIp,
    sipPort,
    remoteIp,
    remotePort,
    rtpPort,
    negotiatedCodec,
    rtpStreamState: natPunchState, // continue from NAT hole-punch SSRC/seq/ts
    dtmfDetector: new DtmfDetector(),
    cseqCounter: 2, // INVITE=1, ACK=1, next BYE=2
    session,
    turnCounter: 0,
    maxDurationTimer: (() => { const t = setTimeout(() => {}, 0); t.unref(); return t; })(),
    createdAt: startTime,
  };

  // Max duration auto-BYE timer
  clearTimeout(handle.maxDurationTimer);
  handle.maxDurationTimer = setTimeout(async () => {
    if (handle.state === 'active') {
      try { await closeDialog(handle, () => {}); } catch { /* best-effort */ }
    }
  }, maxDuration * 1000);
  handle.maxDurationTimer.unref();

  // Store in call-store
  storeCall(handle);

  onEvent({
    type: 'info',
    timestamp: Date.now(),
    message: `Call established — callId: ${callId}, codec: ${negotiatedCodec.name}`,
  });

  return handle;
}

/**
 * Load audio → transcode → send RTP from the call's socket.
 * Continues rtpStreamState across sends. Optionally sends DTMF digits.
 */
export async function sendAudio(
  handle: CallHandle,
  audioPath: string | null,
  onEvent: (event: TestEvent) => void,
  dtmfDigits?: string,
): Promise<void> {
  if (handle.state !== 'active') throw new Error(`Call ${handle.callId} is not active (state: ${handle.state})`);

  if (audioPath) {
    const pcmuData = loadAudioSample(audioPath);
    if (!pcmuData) {
      onEvent({ type: 'info', timestamp: Date.now(), message: `Audio file not found: ${audioPath} — skipping send` });
    } else {
      let sendData: Buffer | null = null;
      try {
        sendData = transcodePcmuTo(pcmuData, handle.negotiatedCodec);
      } catch (err) {
        onEvent({
          type: 'info',
          timestamp: Date.now(),
          message: `Cannot encode ${handle.negotiatedCodec.name} — skipping audio send (${err instanceof Error ? err.message : String(err)})`,
        });
      }

      if (sendData) {
        onEvent({
          type: 'info',
          timestamp: Date.now(),
          message: `Sending audio as ${handle.negotiatedCodec.name} to ${handle.remoteIp}:${handle.remotePort} from port ${handle.rtpPort}`,
        });

        const state = await sendRTPFromSocket(handle.rtpSocket, sendData, handle.remoteIp, handle.remotePort, {
          codec: handle.negotiatedCodec,
          initialState: handle.rtpStreamState ?? undefined,
        });

        handle.rtpStreamState = state;
        handle.turnCounter++;

        // Save outbound audio
        const sentFile = handle.session.file(`sent-audio-${handle.turnCounter}.wav`);
        saveAsWAV([sendData], sentFile, handle.negotiatedCodec);

        onEvent({
          type: 'info',
          timestamp: Date.now(),
          message: `Sent ${state.packetsSent} RTP packets — saved: ${sentFile}`,
        });
      }
    }
  }

  // DTMF digits (requires prior RTP state for stream continuity)
  if (dtmfDigits && handle.rtpStreamState) {
    onEvent({ type: 'info', timestamp: Date.now(), message: `Sending DTMF digits: ${dtmfDigits}` });

    const dtmfResult = await sendDtmfFromSocket(
      handle.rtpSocket,
      dtmfDigits,
      handle.remoteIp,
      handle.remotePort,
      handle.rtpStreamState,
    );

    handle.rtpStreamState = dtmfResult;

    for (const digit of dtmfDigits) {
      onEvent({ type: 'dtmf', timestamp: Date.now(), message: `Sent DTMF digit: ${digit}`, dtmfDigit: digit });
    }

    onEvent({
      type: 'info',
      timestamp: Date.now(),
      message: `Sent ${dtmfDigits.length} DTMF digits (${dtmfResult.packetsSent} RTP packets)`,
    });
  }
}

/**
 * Listen for RTP audio → save WAV → return path + packet count.
 * Increments handle.turnCounter for unique filenames.
 */
export async function receiveAudio(
  handle: CallHandle,
  duration: number,
  onEvent: (event: TestEvent) => void,
): Promise<{ filePath: string; packetsReceived: number }> {
  if (handle.state !== 'active') throw new Error(`Call ${handle.callId} is not active (state: ${handle.state})`);

  onEvent({
    type: 'info',
    timestamp: Date.now(),
    message: `Listening for audio on port ${handle.rtpPort} (${duration}s)...`,
  });

  // Send silence keepalive every 5s during the listen phase to keep NAT pinholes open.
  // Symmetric NATs expire UDP mappings after 30-60s of inactivity. Without keepalive,
  // the agent's RTP can't reach us if the mapping expires during a long listen.
  const silenceValue = handle.negotiatedCodec.name === 'PCMA' ? 0xD5 : 0xFF;
  const keepalivePkt = Buffer.alloc(handle.negotiatedCodec.packetSize, silenceValue);
  let keepaliveSeq = handle.rtpStreamState?.sequenceNumber ?? 0;
  let keepaliveTs = handle.rtpStreamState?.timestamp ?? 0;
  const keepaliveSsrc = handle.rtpStreamState?.ssrc ?? 0;
  const keepaliveInterval = setInterval(() => {
    keepaliveSeq = (keepaliveSeq + 1) & 0xFFFF;
    keepaliveTs = (keepaliveTs + handle.negotiatedCodec.clockRate / 50) >>> 0;
    const pkt = buildRTPPacket({
      payloadType: handle.negotiatedCodec.payloadType,
      sequenceNumber: keepaliveSeq,
      timestamp: keepaliveTs,
      ssrc: keepaliveSsrc,
      payload: keepalivePkt,
    });
    handle.rtpSocket.send(pkt, handle.remotePort, handle.remoteIp);
  }, 5000);
  keepaliveInterval.unref();

  const result = await receiveRTPAudio(handle.rtpSocket, duration, {
    dtmfDetector: handle.dtmfDetector,
    acceptedPayloadTypes: [handle.negotiatedCodec.payloadType],
  });

  clearInterval(keepaliveInterval);
  // Update stream state so subsequent sends continue cleanly
  if (handle.rtpStreamState) {
    handle.rtpStreamState.sequenceNumber = keepaliveSeq;
    handle.rtpStreamState.timestamp = keepaliveTs;
  }

  handle.turnCounter++;
  const filePath = handle.session.file(`agent-response-${handle.turnCounter}.wav`);

  if (result.packetsReceived > 0) {
    saveAsWAV(result.audioData, filePath, handle.negotiatedCodec);

    onEvent({
      type: 'info',
      timestamp: Date.now(),
      message: `Received ${result.packetsReceived} RTP packets — saved: ${filePath}`,
    });
  } else {
    onEvent({
      type: 'info',
      timestamp: Date.now(),
      message: `No audio received (${duration}s timeout)`,
    });
  }

  return { filePath, packetsReceived: result.packetsReceived };
}

/**
 * BYE → close sockets → clear timer → remove from store.
 * Safe to call multiple times (no-ops if already terminated).
 */
export async function closeDialog(
  handle: CallHandle,
  onEvent: (event: TestEvent) => void,
): Promise<void> {
  if (handle.state === 'terminated') return;

  handle.state = 'terminated';
  clearTimeout(handle.maxDurationTimer);

  // Build and send BYE
  const byeMessage = buildByeRequest(
    handle.uri, handle.host, handle.port,
    handle.callId, handle.fromTag, handle.toTag, handle.branch,
    handle.publicIp, handle.sipPort, handle.cseqCounter,
  );
  handle.session.logSignaling('>>>', 'SENT BYE', byeMessage);
  handle.cseqCounter++;

  onEvent({ type: 'sip', timestamp: Date.now(), message: 'Sending BYE' });

  await new Promise<void>((resolve) => {
    handle.sipSocket.send(byeMessage, handle.port, handle.host, () => resolve());
  });

  // Wait briefly for BYE response
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, 1000);
    timeout.unref();
    handle.sipSocket.once('message', () => {
      clearTimeout(timeout);
      resolve();
    });
  });

  // Close sockets
  try { handle.sipSocket.close(); } catch (_) { /* already closed */ }
  try { handle.rtpSocket.close(); } catch (_) { /* already closed */ }

  removeCall(handle.callId);

  onEvent({ type: 'sip', timestamp: Date.now(), message: 'Call terminated' });
}
