/**
 * SIP Test Engine
 * Executes SIP tests and streams events
 */

import dgram from 'dgram';
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
    
    await new Promise<void>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        socket.close();
        reject(new Error('Request timeout'));
      }, config.timeout);

      socket.on('message', (msg) => {
        clearTimeout(timeoutId);
        const response = msg.toString();
        const statusMatch = response.match(/SIP\/2\.0 (\d+) (.+)/);
        
        if (statusMatch) {
          const statusCode = parseInt(statusMatch[1]);
          const statusText = statusMatch[2];
          const duration = Date.now() - startTime;

          socket.close();
          resolve();

          // This will be yielded after the promise resolves
          setTimeout(() => {
            socket.emit('response', { statusCode, statusText, duration, response });
          }, 0);
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

      // Capture response for yielding
      socket.once('response', (data: any) => {
        setTimeout(() => {
          socket.emit('yield-response', data);
        }, 0);
      });
    });

    // Wait for response event
    const responseData: any = await new Promise((resolve) => {
      socket.once('yield-response', resolve);
    });

    const duration = Date.now() - startTime;

    yield {
      type: 'sip',
      timestamp: Date.now(),
      message: `Received ${responseData.statusCode} ${responseData.statusText} (${duration}ms)`,
      status: responseData.statusCode
    };

    // Parse SDP if present
    if (responseData.response.includes('Content-Type: application/sdp')) {
      const sdpMatch = responseData.response.match(/v=0[\s\S]+/);
      if (sdpMatch) {
        yield {
          type: 'info',
          timestamp: Date.now(),
          message: 'SDP answer received',
          sdpAnswer: sdpMatch[0]
        };
      }
    }

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
