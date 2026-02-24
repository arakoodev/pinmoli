/**
 * SIP Test Engine
 * Executes SIP tests and streams events
 */

import dgram from 'dgram';
import { generateCallId, generateTag } from './protocol.js';
import { buildSdp } from './sdp.js';
import { getAudioSamplePath } from './audio.js';
import { receiveRTPAudio, saveAsWAV, sendRTPFromSocket, loadAudioSample } from './rtp-receiver.js';
import type { TestConfig, SipEvent } from '../validation/schemas.js';
import { resolve } from 'path';

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

    const user = uriMatch[1]?.replace('@', '') || 'test';
    const host = uriMatch[2];
    const port = parseInt(uriMatch[4] || '5060');

    yield {
      type: 'info',
      timestamp: Date.now(),
      message: `Resolved: ${host}:${port}`
    };

    // Create separate sockets for SIP signaling and RTP media
    const sipSocket = dgram.createSocket('udp4');
    const rtpSocket = dgram.createSocket('udp4');

    // Get local IP for SDP and SIP headers (throws if no routable interface)
    const { getLocalIp } = await import('../network/utils.js');
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
    const rtpPort = rtpSocket.address().port;
    
    yield {
      type: 'info',
      timestamp: Date.now(),
      message: `SIP socket bound to ${localIp}:${sipPort}, RTP socket bound to port ${rtpPort}`
    };

    // Build SIP request
    const callId = generateCallId();
    const fromTag = generateTag();
    const branch = `z9hG4bK${generateTag()}`;

    let sipMessage = '';
    let sdp = '';
    
    if (config.method === 'OPTIONS') {
      sipMessage = buildOptionsRequest(config.uri, host, port, callId, fromTag, branch, localIp, sipPort);
    } else if (config.method === 'INVITE') {
      sdp = generateSdp(config.codecs, rtpPort, localIp);
      sipMessage = buildInviteRequest(config.uri, host, port, callId, fromTag, branch, sdp, localIp, sipPort);
    } else if (config.method === 'REGISTER') {
      sipMessage = buildRegisterRequest(config.uri, host, port, callId, fromTag, branch, localIp, sipPort);
    }

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
    
    await new Promise<void>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        safeClose();
        if (responses.length === 0) {
          reject(new Error('Request timeout'));
        } else {
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

        // Parse SDP answer
        let remoteIp = host;
        let remotePort = config.mediaPort;
        
        if (resp.response.includes('Content-Type: application/sdp')) {
          const sdpMatch = resp.response.match(/v=0[\s\S]+/);
          if (sdpMatch) {
            yield {
              type: 'info',
              timestamp: Date.now(),
              message: 'SDP answer received',
              sdpAnswer: sdpMatch[0]
            };

            // Extract remote IP and port from SDP
            const cMatch = sdpMatch[0].match(/c=IN IP4 ([\d.]+)/);
            const mMatch = sdpMatch[0].match(/m=audio (\d+)/);
            if (cMatch) remoteIp = cMatch[1];
            if (mMatch) remotePort = parseInt(mMatch[1]);
          }
        }

        // Send ACK (with To-tag from 200 OK per RFC 3261 Section 12.2.1.1)
        const ackMessage = buildAckRequest(config.uri, host, port, callId, fromTag, toTag, branch, localIp, sipPort);
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

        // ---- Phase 1: Listen for agent greeting (if sendDelay > 0) ----
        if (sendDelay > 0) {
          const greetingFile = resolve(process.cwd(), 'audio-samples', `agent-greeting-${Date.now()}.wav`);

          yield {
            type: 'info',
            timestamp: Date.now(),
            message: `Listening for agent greeting on port ${rtpPort} (${sendDelay}s)...`
          };

          const greetingResult = await receiveRTPAudio(rtpSocket, sendDelay);

          if (greetingResult.packetsReceived > 0) {
            saveAsWAV(greetingResult.audioData, greetingFile);

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

        // ---- Phase 2: Send audio + listen for reply ----
        const responseFile = resolve(process.cwd(), 'audio-samples', `agent-response-${Date.now()}.wav`);

        yield {
          type: 'info',
          timestamp: Date.now(),
          message: `Listening for agent response on port ${rtpPort} (${waitTime}s)...`
        };

        const rtpPromise = receiveRTPAudio(rtpSocket, waitTime);

        // Send audio from the SAME socket (fixes port mismatch bug)
        if (pcmuData) {
          yield {
            type: 'info',
            timestamp: Date.now(),
            message: `Sending audio (${sample}) to ${remoteIp}:${remotePort} from port ${rtpPort}`
          };

          const { packetsSent } = await sendRTPFromSocket(rtpSocket, pcmuData, remoteIp, remotePort);

          yield {
            type: 'info',
            timestamp: Date.now(),
            message: `Sent ${packetsSent} RTP packets`
          };
        } else {
          yield {
            type: 'info',
            timestamp: Date.now(),
            message: `Audio sample not found: ${sample} — skipping send`
          };
        }

        // Wait for receiver to finish (agent responds after we stop sending)
        const { packetsReceived, audioData } = await rtpPromise;

        if (packetsReceived > 0) {
          saveAsWAV(audioData, responseFile);

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

        const totalTime = sendDelay + waitTime;
        yield {
          type: 'info',
          timestamp: Date.now(),
          message: sendDelay > 0
            ? `Call was active for ${totalTime}s (${sendDelay}s greeting + ${waitTime}s response)`
            : `Call was active for ${waitTime}s`
        };

        // Send BYE to hang up (with To-tag for dialog matching)
        const byeMessage = buildByeRequest(config.uri, host, port, callId, fromTag, toTag, branch, localIp, sipPort);
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

    const duration = Date.now() - startTime;

    yield {
      type: 'info',
      timestamp: Date.now(),
      message: `Test completed successfully in ${duration}ms`
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
