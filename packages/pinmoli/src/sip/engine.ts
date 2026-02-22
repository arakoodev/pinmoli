/**
 * SIP Test Engine
 * Executes SIP tests and streams events
 */

import dgram from 'dgram';
import { spawn } from 'child_process';
import { generateCallId, generateTag } from './protocol.js';
import { buildSdp } from './sdp.js';
import type { TestConfig, SipEvent } from '../validation/schemas.js';

/**
 * Generate SDP for INVITE
 */
function generateSdp(codecs: readonly string[], mediaPort: number): string {
  return buildSdp({
    sessionId: Date.now().toString(),
    sessionVersion: '1',
    origin: '0.0.0.0',
    connection: '0.0.0.0',
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

    // Create UDP socket
    const socket = dgram.createSocket('udp4');
    
    yield {
      type: 'info',
      timestamp: Date.now(),
      message: 'UDP socket created'
    };

    // Build SIP request
    const callId = generateCallId();
    const fromTag = generateTag();
    const branch = `z9hG4bK${generateTag()}`;

    let sipMessage = '';
    
    if (config.method === 'OPTIONS') {
      sipMessage = buildOptionsRequest(config.uri, host, port, callId, fromTag, branch);
    } else if (config.method === 'INVITE') {
      const sdp = generateSdp(config.codecs, config.mediaPort);
      sipMessage = buildInviteRequest(config.uri, host, port, callId, fromTag, branch, sdp);
    } else if (config.method === 'REGISTER') {
      sipMessage = buildRegisterRequest(config.uri, host, port, callId, fromTag, branch);
    }

    yield {
      type: 'sip',
      timestamp: Date.now(),
      message: `Sending ${config.method} request...`,
      method: config.method
    };

    // Send request
    const startTime = Date.now();
    const responses: Array<{ statusCode: number; statusText: string; response: string }> = [];
    
    await new Promise<void>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        socket.close();
        if (responses.length === 0) {
          reject(new Error('Request timeout'));
        } else {
          resolve();
        }
      }, config.timeout);

      socket.on('message', (msg) => {
        const response = msg.toString();
        const statusMatch = response.match(/SIP\/2\.0 (\d+) (.+)/);
        
        if (statusMatch) {
          const statusCode = parseInt(statusMatch[1]);
          const statusText = statusMatch[2].trim();
          const duration = Date.now() - startTime;

          responses.push({ statusCode, statusText, response });

          // Emit response immediately for yielding
          socket.emit('response', { statusCode, statusText, duration, response });

          // Close on final response (2xx, 3xx, 4xx, 5xx, 6xx) - but NOT for INVITE
          if (statusCode >= 200 && config.method !== 'INVITE') {
            clearTimeout(timeoutId);
            socket.close();
            resolve();
          } else if (statusCode >= 200 && config.method === 'INVITE') {
            // For INVITE, keep socket open for ACK/BYE
            clearTimeout(timeoutId);
            resolve();
          }
          // Keep waiting for provisional responses (1xx)
        }
      });

      socket.on('error', (err) => {
        clearTimeout(timeoutId);
        socket.close();
        reject(err);
      });

      socket.send(sipMessage, port, host, (err) => {
        if (err) {
          clearTimeout(timeoutId);
          socket.close();
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
        status: resp.statusCode
      };

      // Handle 200 OK for INVITE - send ACK and audio (only once)
      if (resp.statusCode === 200 && config.method === 'INVITE' && !inviteHandled) {
        inviteHandled = true;
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

        // Send ACK
        const ackMessage = buildAckRequest(config.uri, host, port, callId, fromTag, branch);
        yield {
          type: 'sip',
          timestamp: Date.now(),
          message: 'Sending ACK'
        };

        await new Promise<void>((resolve) => {
          socket.send(ackMessage, port, host, () => resolve());
        });

        // Send audio with ffmpeg
        yield {
          type: 'info',
          timestamp: Date.now(),
          message: `Streaming audio to ${remoteIp}:${remotePort}`
        };

        const audioSent = await sendAudio(remoteIp, remotePort);
        
        if (audioSent) {
          yield {
            type: 'info',
            timestamp: Date.now(),
            message: 'Audio stream complete (3s sine tone)'
          };
        } else {
          yield {
            type: 'info',
            timestamp: Date.now(),
            message: 'ffmpeg not available - skipping audio'
          };
        }

        // Send BYE to hang up
        const byeMessage = buildByeRequest(config.uri, host, port, callId, fromTag, branch);
        yield {
          type: 'sip',
          timestamp: Date.now(),
          message: 'Sending BYE'
        };

        await new Promise<void>((resolve) => {
          socket.send(byeMessage, port, host, () => resolve());
        });

        // Wait for BYE response
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(resolve, 1000);
          socket.once('message', () => {
            clearTimeout(timeout);
            resolve();
          });
        });

        socket.close();

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

/**
 * Send audio using ffmpeg
 */
async function sendAudio(remoteIp: string, remotePort: number): Promise<boolean> {
  return new Promise((resolve) => {
    const ffmpeg = spawn('ffmpeg', [
      '-re', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3',
      '-acodec', 'pcm_mulaw', '-ar', '8000', '-ac', '1',
      '-f', 'rtp', `rtp://${remoteIp}:${remotePort}`,
    ]);

    ffmpeg.on('close', (code) => {
      resolve(code === 0);
    });

    ffmpeg.on('error', () => {
      resolve(false);
    });

    // Timeout after 5 seconds
    setTimeout(() => {
      ffmpeg.kill();
      resolve(false);
    }, 5000);
  });
}

function buildOptionsRequest(uri: string, host: string, port: number, callId: string, fromTag: string, branch: string): string {
  return [
    `OPTIONS ${uri} SIP/2.0`,
    `Via: SIP/2.0/UDP 0.0.0.0:5060;branch=${branch}`,
    `From: <sip:pinmoli@pinmoli.local>;tag=${fromTag}`,
    `To: <${uri}>`,
    `Call-ID: ${callId}`,
    `CSeq: 1 OPTIONS`,
    `Contact: <sip:pinmoli@0.0.0.0:5060>`,
    `Max-Forwards: 70`,
    `User-Agent: Pinmoli/0.1.0`,
    `Content-Length: 0`,
    '',
    ''
  ].join('\r\n');
}

function buildInviteRequest(uri: string, host: string, port: number, callId: string, fromTag: string, branch: string, sdp: string): string {
  return [
    `INVITE ${uri} SIP/2.0`,
    `Via: SIP/2.0/UDP 0.0.0.0:5060;branch=${branch}`,
    `From: <sip:pinmoli@pinmoli.local>;tag=${fromTag}`,
    `To: <${uri}>`,
    `Call-ID: ${callId}`,
    `CSeq: 1 INVITE`,
    `Contact: <sip:pinmoli@0.0.0.0:5060>`,
    `Max-Forwards: 70`,
    `User-Agent: Pinmoli/0.1.0`,
    `Content-Type: application/sdp`,
    `Content-Length: ${sdp.length}`,
    '',
    sdp
  ].join('\r\n');
}

function buildAckRequest(uri: string, host: string, port: number, callId: string, fromTag: string, branch: string): string {
  return [
    `ACK ${uri} SIP/2.0`,
    `Via: SIP/2.0/UDP 0.0.0.0:5060;branch=${branch}`,
    `From: <sip:pinmoli@pinmoli.local>;tag=${fromTag}`,
    `To: <${uri}>`,
    `Call-ID: ${callId}`,
    `CSeq: 1 ACK`,
    `Max-Forwards: 70`,
    `User-Agent: Pinmoli/0.1.0`,
    `Content-Length: 0`,
    '',
    ''
  ].join('\r\n');
}

function buildByeRequest(uri: string, host: string, port: number, callId: string, fromTag: string, branch: string): string {
  return [
    `BYE ${uri} SIP/2.0`,
    `Via: SIP/2.0/UDP 0.0.0.0:5060;branch=${branch}`,
    `From: <sip:pinmoli@pinmoli.local>;tag=${fromTag}`,
    `To: <${uri}>`,
    `Call-ID: ${callId}`,
    `CSeq: 2 BYE`,
    `Max-Forwards: 70`,
    `User-Agent: Pinmoli/0.1.0`,
    `Content-Length: 0`,
    '',
    ''
  ].join('\r\n');
}

function buildRegisterRequest(uri: string, host: string, port: number, callId: string, fromTag: string, branch: string): string {
  return [
    `REGISTER ${uri} SIP/2.0`,
    `Via: SIP/2.0/UDP 0.0.0.0:5060;branch=${branch}`,
    `From: <${uri}>;tag=${fromTag}`,
    `To: <${uri}>`,
    `Call-ID: ${callId}`,
    `CSeq: 1 REGISTER`,
    `Contact: <sip:pinmoli@0.0.0.0:5060>`,
    `Max-Forwards: 70`,
    `User-Agent: Pinmoli/0.1.0`,
    `Expires: 3600`,
    `Content-Length: 0`,
    '',
    ''
  ].join('\r\n');
}
