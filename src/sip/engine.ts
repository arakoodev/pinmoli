/**
 * SIP Test Engine
 * Executes SIP tests and streams events
 */

import dgram from 'dgram';
import { generateCallId, generateTag } from './protocol.js';
import { buildSdp, parseSdpAnswer } from './sdp.js';
import { getAudioSamplePath } from './audio.js';
import { receiveRTPAudio, saveAsWAV, sendRTPFromSocket, sendDtmfFromSocket, loadAudioSample, type RtpStreamState } from './rtp-receiver.js';
import { transcodePcmuTo, CODEC_TABLE, type CodecInfo } from './codec.js';
import { DtmfDetector } from './dtmf.js';
import { createSession } from '../network/session.js';
import type { TestConfig, SipEvent } from '../validation/schemas.js';

/**
 * Generate SDP for INVITE
 */
function generateSdp(codecs: readonly string[], mediaPort: number, localIp: string): string {
  return buildSdp({
    sessionId: Date.now().toString(),
    sessionVersion: '1',
    origin: localIp,
    connection: localIp,
    mediaPort,
    codecs: [...codecs]
  });
}

/**
 * Execute a SIP test and stream events
 */
export async function* runSipTest(config: TestConfig): AsyncGenerator<SipEvent> {
  yield {
    type: 'info',
    timestamp: Date.now(),
    message: `Starting SIP ${config.method} test to ${config.uri}`
  };

  try {
    // Parse SIP URI
    const uriMatch = config.uri.match(/^sips?:([^@]+@)?([^:;]+)(:(\d+))?/);
    if (!uriMatch) {
      throw new Error('Invalid SIP URI format');
    }

    const _user = uriMatch[1]?.replace('@', '') || 'test';
    const host = uriMatch[2];
    const port = parseInt(uriMatch[4] || '5060');

    // Create session directory for all artifacts
    const session = createSession('sip', config.method, host);

    yield {
      type: 'info',
      timestamp: Date.now(),
      message: `Resolved: ${host}:${port} — session: ${session.name}`
    };

    // Create separate sockets for SIP signaling and RTP media
    const sipSocket = dgram.createSocket('udp4');
    const rtpSocket = dgram.createSocket('udp4');

    // Get local IP for fallback
    const { getLocalIp, stunDiscoverAddress } = await import('../network/utils.js');
    const localIp = getLocalIp();

    // Bind SIP socket
    await new Promise<void>((resolve, reject) => {
      sipSocket.once('error', reject);
      sipSocket.bind(0, () => {
        sipSocket.removeListener('error', reject);
        resolve();
      });
    });
    const sipPort = sipSocket.address().port;

    // Bind RTP socket to media port (use 0 if 10000 to avoid conflicts)
    const targetRtpPort = config.mediaPort === 10000 ? 0 : config.mediaPort;
    await new Promise<void>((resolve, reject) => {
      rtpSocket.once('error', reject);
      rtpSocket.bind(targetRtpPort, () => {
        rtpSocket.removeListener('error', reject);
        resolve();
      });
    });

    // STUN-discover the RTP socket's NAT-mapped address.
    // This is the address remote peers must send RTP to.
    const stunResult = await stunDiscoverAddress(rtpSocket);
    const publicIp = stunResult.ip;
    const rtpPort = stunResult.port;

    yield {
      type: 'info',
      timestamp: Date.now(),
      message: `SIP socket bound to ${localIp}:${sipPort}, RTP mapped to ${publicIp}:${rtpPort} (STUN)`
    };

    // Build SIP request
    const callId = generateCallId();
    const fromTag = generateTag();
    const branch = `z9hG4bK${generateTag()}`;

    let sipMessage = '';
    let sdp = '';
    
    if (config.method === 'OPTIONS') {
      sipMessage = buildOptionsRequest(config.uri, host, port, callId, fromTag, branch, publicIp, sipPort);
    } else if (config.method === 'INVITE') {
      sdp = generateSdp(config.codecs, rtpPort, publicIp);
      sipMessage = buildInviteRequest(config.uri, host, port, callId, fromTag, branch, sdp, publicIp, sipPort);
    } else if (config.method === 'REGISTER') {
      sipMessage = buildRegisterRequest(config.uri, host, port, callId, fromTag, branch, publicIp, sipPort);
    }

    // Log outbound request to session
    session.logSignaling('>>>', `SENT ${config.method}`, sipMessage);

    yield {
      type: 'sip',
      timestamp: Date.now(),
      message: `Sending ${config.method} request...`,
      method: config.method,
      rawMessage: sipMessage,
      ...(config.method === 'INVITE' && { sdpOffer: sdp })
    };

    // Send request
    const startTime = Date.now();
    const responses: Array<{ statusCode: number; statusText: string; response: string }> = [];
    
    let socketClosed = false;
    const safeClose = () => {
      if (!socketClosed) {
        socketClosed = true;
        try { sipSocket.close(); } catch (_e) { /* already closed */ }
        try { rtpSocket.close(); } catch (_e) { /* already closed */ }
      }
    };
    
    let timedOut = false;

    await new Promise<void>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        timedOut = true;
        const hasFinalResponse = responses.some(r => r.statusCode >= 200);

        if (responses.length === 0) {
          safeClose();
          reject(new Error('Request timeout'));
        } else if (!hasFinalResponse && config.method === 'INVITE') {
          // Got only provisional (1xx) responses — send CANCEL before closing
          const cancelMessage = buildCancelRequest(config.uri, host, port, callId, fromTag, branch, publicIp, sipPort);
          session.logSignaling('>>>', 'SENT CANCEL', cancelMessage);
          sipSocket.send(cancelMessage, port, host, () => {
            // Wait briefly for 487 Request Terminated, then close
            const cancelTimeout = setTimeout(() => { safeClose(); resolve(); }, 2000);
            sipSocket.once('message', () => { clearTimeout(cancelTimeout); safeClose(); resolve(); });
          });
        } else {
          safeClose();
          resolve();
        }
      }, config.timeout);

      sipSocket.on('message', (msg) => {
        const response = msg.toString();
        const statusMatch = response.match(/SIP\/2\.0 (\d+) (.+)/);

        if (statusMatch) {
          const statusCode = parseInt(statusMatch[1]);
          const statusText = statusMatch[2].trim();
          const duration = Date.now() - startTime;

          responses.push({ statusCode, statusText, response });

          // Log received response to session
          session.logSignaling('<<<', `RECEIVED ${statusCode} ${statusText}`, response);

          // Emit response immediately for yielding
          sipSocket.emit('response', { statusCode, statusText, duration, response });

          // Close on final response (2xx, 3xx, 4xx, 5xx, 6xx) - but NOT for INVITE
          if (statusCode >= 200 && config.method !== 'INVITE') {
            clearTimeout(timeoutId);
            safeClose();
            resolve();
          } else if (statusCode >= 200 && config.method === 'INVITE') {
            // For INVITE, keep socket open for ACK/BYE
            clearTimeout(timeoutId);
            resolve();
          }
          // Keep waiting for provisional responses (1xx)
        }
      });

      sipSocket.on('error', (err) => {
        clearTimeout(timeoutId);
        safeClose();
        reject(err);
      });

      sipSocket.send(sipMessage, port, host, (err) => {
        if (err) {
          clearTimeout(timeoutId);
          safeClose();
          reject(err);
        }
      });
    });

    // Yield all responses
    let inviteHandled = false;
    for (const resp of responses) {
      yield {
        type: 'sip',
        timestamp: Date.now(),
        message: `Received ${resp.statusCode} ${resp.statusText}`,
        status: resp.statusCode,
        rawMessage: resp.response
      };

      // Handle 200 OK for INVITE - send ACK and audio (only once)
      if (resp.statusCode === 200 && config.method === 'INVITE' && !inviteHandled) {
        inviteHandled = true;
        // Parse To-tag from response (RFC 3261: required for in-dialog ACK/BYE)
        const toTagMatch = resp.response.match(/To:[^\r\n]*;tag=([^\s;>\r\n]+)/i);
        const toTag = toTagMatch ? toTagMatch[1] : '';

        // Parse SDP answer — extract negotiated codec + remote IP/port
        let remoteIp = host;
        let remotePort = config.mediaPort;
        let negotiatedCodec: CodecInfo = CODEC_TABLE.PCMU;

        if (resp.response.includes('Content-Type: application/sdp')) {
          const sdpMatch = resp.response.match(/v=0[\s\S]+/);
          if (sdpMatch) {
            const sdpAnswer = parseSdpAnswer(sdpMatch[0], host, config.mediaPort);
            remoteIp = sdpAnswer.remoteIp;
            remotePort = sdpAnswer.remotePort;
            negotiatedCodec = sdpAnswer.codec;

            yield {
              type: 'info',
              timestamp: Date.now(),
              message: 'SDP answer received',
              sdpAnswer: sdpMatch[0]
            };

            yield {
              type: 'info',
              timestamp: Date.now(),
              message: `Codec negotiated: ${negotiatedCodec.name} (PT=${negotiatedCodec.payloadType}, clock=${negotiatedCodec.clockRate}Hz)`
            };
          }
        }

        // Send ACK (with To-tag from 200 OK per RFC 3261 Section 12.2.1.1)
        const ackMessage = buildAckRequest(config.uri, host, port, callId, fromTag, toTag, branch, publicIp, sipPort);
        session.logSignaling('>>>', 'SENT ACK', ackMessage);
        yield {
          type: 'sip',
          timestamp: Date.now(),
          message: 'Sending ACK'
        };

        await new Promise<void>((resolve) => {
          sipSocket.send(ackMessage, port, host, () => resolve());
        });

        // Resolve audio sample
        const sample = config.audioSample || 'voice-hello';
        const samplePath = getAudioSamplePath(sample);
        const pcmuData = samplePath ? loadAudioSample(samplePath) : null;

        const sendDelay = config.sendDelay ?? 0;
        const waitTime = config.responseWaitTime ?? 10;

        // Shared DTMF detector for incoming digits across all phases
        const dtmfDetector = new DtmfDetector();

        // ---- Phase 1: Listen for agent greeting (if sendDelay > 0) ----
        if (sendDelay > 0) {
          const greetingFile = session.file('agent-greeting.wav');

          yield {
            type: 'info',
            timestamp: Date.now(),
            message: `Listening for agent greeting on port ${rtpPort} (${sendDelay}s)...`
          };

          const greetingResult = await receiveRTPAudio(rtpSocket, sendDelay, {
            dtmfDetector,
            acceptedPayloadTypes: [negotiatedCodec.payloadType],
          });

          if (greetingResult.packetsReceived > 0) {
            saveAsWAV(greetingResult.audioData, greetingFile, negotiatedCodec);

            yield {
              type: 'info',
              timestamp: Date.now(),
              message: `Received ${greetingResult.packetsReceived} greeting RTP packets from agent`
            };

            yield {
              type: 'info',
              timestamp: Date.now(),
              message: `Agent greeting saved to: ${greetingFile}`
            };
          } else {
            yield {
              type: 'info',
              timestamp: Date.now(),
              message: `No greeting audio received (${sendDelay}s timeout)`
            };
          }
        }

        // ---- Phase 2: Send audio, then listen for reply ----
        const responseFile = session.file('agent-response.wav');

        // Send audio FIRST (from the SAME socket — fixes port mismatch bug)
        let audioStreamState: RtpStreamState | undefined;
        if (pcmuData) {
          // Transcode PCMU audio to negotiated codec if needed
          let sendData: Buffer | null = null;
          try {
            sendData = transcodePcmuTo(pcmuData, negotiatedCodec);
          } catch (err) {
            yield {
              type: 'info',
              timestamp: Date.now(),
              message: `Cannot encode ${negotiatedCodec.name} — sending silence, inbound audio still recording (${err instanceof Error ? err.message : String(err)})`
            };
          }

          if (sendData) {
            yield {
              type: 'info',
              timestamp: Date.now(),
              message: `Sending audio as ${negotiatedCodec.name} (${sample}) to ${remoteIp}:${remotePort} from port ${rtpPort}`
            };

            audioStreamState = await sendRTPFromSocket(rtpSocket, sendData, remoteIp, remotePort, { codec: negotiatedCodec });

            // Save outbound audio
            const sentFile = session.file('sent-audio.wav');
            saveAsWAV([sendData], sentFile, negotiatedCodec);
            yield {
              type: 'info',
              timestamp: Date.now(),
              message: `Outbound audio saved: ${sentFile}`
            };

            yield {
              type: 'info',
              timestamp: Date.now(),
              message: `Sent ${audioStreamState.packetsSent} RTP packets`
            };
          }
        } else {
          yield {
            type: 'info',
            timestamp: Date.now(),
            message: `Audio sample not found: ${sample} — skipping send`
          };
        }

        // ---- Phase 2.5: Send DTMF digits (if configured) ----
        if (config.dtmfDigits && audioStreamState) {
          yield {
            type: 'info',
            timestamp: Date.now(),
            message: `Sending DTMF digits: ${config.dtmfDigits}`
          };

          const dtmfResult = await sendDtmfFromSocket(
            rtpSocket,
            config.dtmfDigits,
            remoteIp,
            remotePort,
            audioStreamState,
          );

          for (const digit of config.dtmfDigits) {
            yield {
              type: 'dtmf',
              timestamp: Date.now(),
              message: `Sent DTMF digit: ${digit}`,
              dtmfDigit: digit,
            };
          }

          yield {
            type: 'info',
            timestamp: Date.now(),
            message: `Sent ${config.dtmfDigits.length} DTMF digits (${dtmfResult.packetsSent} RTP packets)`
          };
        }

        // ---- Phase 3: Listen for agent response AFTER send completes ----
        // Agent may take 15-20s to process audio and respond.
        // Timer starts now (after send), so responseWaitTime is pure listen time.
        yield {
          type: 'info',
          timestamp: Date.now(),
          message: `Listening for agent response on port ${rtpPort} (${waitTime}s)...`
        };

        const { packetsReceived, audioData } = await receiveRTPAudio(rtpSocket, waitTime, {
          dtmfDetector,
          acceptedPayloadTypes: [negotiatedCodec.payloadType],
        });

        if (packetsReceived > 0) {
          saveAsWAV(audioData, responseFile, negotiatedCodec);

          yield {
            type: 'info',
            timestamp: Date.now(),
            message: `Received ${packetsReceived} RTP packets from agent`
          };

          yield {
            type: 'info',
            timestamp: Date.now(),
            message: `Agent response saved to: ${responseFile}`
          };
        } else {
          yield {
            type: 'info',
            timestamp: Date.now(),
            message: `No audio received from agent (${waitTime}s timeout)`
          };
        }

        // ---- DTMF detection summary ----
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
            message: `Detected incoming DTMF: ${dtmfDetector.digits}`
          };
        }

        const totalTime = sendDelay + waitTime;
        yield {
          type: 'info',
          timestamp: Date.now(),
          message: sendDelay > 0
            ? `Call was active for ${totalTime}s (${sendDelay}s greeting + ${waitTime}s response)`
            : `Call was active for ${waitTime}s`
        };

        // Send BYE to hang up (with To-tag for dialog matching)
        const byeMessage = buildByeRequest(config.uri, host, port, callId, fromTag, toTag, branch, publicIp, sipPort);
        session.logSignaling('>>>', 'SENT BYE', byeMessage);
        yield {
          type: 'sip',
          timestamp: Date.now(),
          message: 'Sending BYE'
        };

        await new Promise<void>((resolve) => {
          sipSocket.send(byeMessage, port, host, () => resolve());
        });

        // Wait for BYE response
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(resolve, 1000);
          sipSocket.once('message', () => {
            clearTimeout(timeout);
            resolve();
          });
        });

        safeClose();

        yield {
          type: 'sip',
          timestamp: Date.now(),
          message: 'Call terminated'
        };
      }

      // Parse SDP if present in other responses
      if (resp.statusCode >= 200 && resp.response.includes('Content-Type: application/sdp') && config.method !== 'INVITE') {
        const sdpMatch = resp.response.match(/v=0[\s\S]+/);
        if (sdpMatch) {
          yield {
            type: 'info',
            timestamp: Date.now(),
            message: 'SDP answer received',
            sdpAnswer: sdpMatch[0]
          };
        }
      }
    }

    // Detect unanswered INVITE: got provisional (1xx) but no final response
    if (config.method === 'INVITE' && !inviteHandled && timedOut) {
      const highestStatus = responses.length > 0
        ? Math.max(...responses.map(r => r.statusCode))
        : 0;

      yield {
        type: 'error',
        timestamp: Date.now(),
        message: `INVITE not answered: got ${highestStatus} (${responses.length} provisional) but no 200 OK within ${config.timeout}ms`,
        severity: 'error',
        code: 'INVITE_UNANSWERED',
        recovery: highestStatus === 180
          ? 'Got 180 Ringing — voice agent may not be running or dispatch rule is not matching. Check agent deployment and dispatch rules.'
          : highestStatus === 100
            ? 'Got 100 Trying — SIP proxy accepted but could not reach the agent. Check if the agent process is running.'
            : 'No provisional response at all — check SIP URI, trunk configuration, and network connectivity.'
      };

      yield {
        type: 'sip',
        timestamp: Date.now(),
        message: 'Sent CANCEL (unanswered INVITE)',
        method: 'CANCEL'
      };
    }

    const duration = Date.now() - startTime;
    const hasFinalSuccess = responses.some(r => r.statusCode >= 200 && r.statusCode < 300);
    const succeeded = config.method === 'INVITE' ? inviteHandled : hasFinalSuccess;

    // Write session metadata
    session.writeMetadata({
      session: session.name,
      config: { uri: config.uri, method: config.method, codecs: config.codecs, transport: config.transport },
      startTime: new Date(startTime).toISOString(),
      duration,
      succeeded,
      timedOut,
      responses: responses.map(r => ({ status: r.statusCode, text: r.statusText })),
      publicIp,
      rtpPort,
    });

    yield {
      type: succeeded ? 'info' : 'error',
      timestamp: Date.now(),
      message: succeeded
        ? `Test completed successfully in ${duration}ms — session: ${session.dir}`
        : `Test failed after ${duration}ms — session: ${session.dir}`,
      ...(succeeded ? {} : { severity: 'error' as const, code: timedOut ? 'TIMEOUT' : 'NO_SUCCESS_RESPONSE' })
    };

  } catch (error) {
    yield {
      type: 'error',
      timestamp: Date.now(),
      message: error instanceof Error ? error.message : String(error),
      severity: 'fatal',
      code: 'SIP_ERROR',
      recovery: 'Check network connectivity and SIP server configuration'
    };
  }
}

function buildOptionsRequest(uri: string, host: string, port: number, callId: string, fromTag: string, branch: string, localIp: string, localPort: number): string {
  return [
    `OPTIONS ${uri} SIP/2.0`,
    `Via: SIP/2.0/UDP ${localIp}:${localPort};branch=${branch}`,
    `From: <sip:pinmoli@pinmoli.local>;tag=${fromTag}`,
    `To: <${uri}>`,
    `Call-ID: ${callId}`,
    `CSeq: 1 OPTIONS`,
    `Contact: <sip:pinmoli@${localIp}:${localPort}>`,
    `Max-Forwards: 70`,
    `User-Agent: Pinmoli/0.1.0`,
    `Content-Length: 0`,
    '',
    ''
  ].join('\r\n');
}

function buildInviteRequest(uri: string, host: string, port: number, callId: string, fromTag: string, branch: string, sdp: string, localIp: string, localPort: number): string {
  return [
    `INVITE ${uri} SIP/2.0`,
    `Via: SIP/2.0/UDP ${localIp}:${localPort};branch=${branch}`,
    `From: <sip:pinmoli@pinmoli.local>;tag=${fromTag}`,
    `To: <${uri}>`,
    `Call-ID: ${callId}`,
    `CSeq: 1 INVITE`,
    `Contact: <sip:pinmoli@${localIp}:${localPort}>`,
    `Max-Forwards: 70`,
    `User-Agent: Pinmoli/0.1.0`,
    `Content-Type: application/sdp`,
    `Content-Length: ${sdp.length}`,
    '',
    sdp
  ].join('\r\n');
}

function buildAckRequest(uri: string, host: string, port: number, callId: string, fromTag: string, toTag: string, branch: string, localIp: string, localPort: number): string {
  return [
    `ACK ${uri} SIP/2.0`,
    `Via: SIP/2.0/UDP ${localIp}:${localPort};branch=${branch}`,
    `From: <sip:pinmoli@pinmoli.local>;tag=${fromTag}`,
    `To: <${uri}>${toTag ? `;tag=${toTag}` : ''}`,
    `Call-ID: ${callId}`,
    `CSeq: 1 ACK`,
    `Max-Forwards: 70`,
    `User-Agent: Pinmoli/0.1.0`,
    `Content-Length: 0`,
    '',
    ''
  ].join('\r\n');
}

function buildByeRequest(uri: string, host: string, port: number, callId: string, fromTag: string, toTag: string, branch: string, localIp: string, localPort: number): string {
  return [
    `BYE ${uri} SIP/2.0`,
    `Via: SIP/2.0/UDP ${localIp}:${localPort};branch=${branch}`,
    `From: <sip:pinmoli@pinmoli.local>;tag=${fromTag}`,
    `To: <${uri}>${toTag ? `;tag=${toTag}` : ''}`,
    `Call-ID: ${callId}`,
    `CSeq: 2 BYE`,
    `Max-Forwards: 70`,
    `User-Agent: Pinmoli/0.1.0`,
    `Content-Length: 0`,
    '',
    ''
  ].join('\r\n');
}

function buildCancelRequest(uri: string, host: string, port: number, callId: string, fromTag: string, branch: string, localIp: string, localPort: number): string {
  // CANCEL reuses the INVITE's branch and CSeq number (RFC 3261 Section 9.1)
  return [
    `CANCEL ${uri} SIP/2.0`,
    `Via: SIP/2.0/UDP ${localIp}:${localPort};branch=${branch}`,
    `From: <sip:pinmoli@pinmoli.local>;tag=${fromTag}`,
    `To: <${uri}>`,
    `Call-ID: ${callId}`,
    `CSeq: 1 CANCEL`,
    `Max-Forwards: 70`,
    `User-Agent: Pinmoli/0.1.0`,
    `Content-Length: 0`,
    '',
    ''
  ].join('\r\n');
}

function buildRegisterRequest(uri: string, host: string, port: number, callId: string, fromTag: string, branch: string, localIp: string, localPort: number): string {
  return [
    `REGISTER ${uri} SIP/2.0`,
    `Via: SIP/2.0/UDP ${localIp}:${localPort};branch=${branch}`,
    `From: <${uri}>;tag=${fromTag}`,
    `To: <${uri}>`,
    `Call-ID: ${callId}`,
    `CSeq: 1 REGISTER`,
    `Contact: <sip:pinmoli@${localIp}:${localPort}>`,
    `Max-Forwards: 70`,
    `User-Agent: Pinmoli/0.1.0`,
    `Expires: 3600`,
    `Content-Length: 0`,
    '',
    ''
  ].join('\r\n');
}
