import sip from 'sip';
import dgram from 'dgram';
import type { TestConfig, SipEvent } from '../validation/schemas.js';
import { getLocalIp } from '../network/utils.js';
import { buildSdp } from '../sip/sdp.js';
import { generateCallId, generateTag } from '../sip/protocol.js';

interface SipResponse {
  status: number;
  reason: string;
  headers: Record<string, string | string[]>;
  content?: string;
}

/**
 * Real SIP transport implementation
 */
export async function* executeSipTest(config: TestConfig): AsyncGenerator<SipEvent> {
  const localIp = await getLocalIp();
  
  // Parse SIP URI properly
  const uriMatch = config.uri.match(/^sips?:(?:([^@]+)@)?([^:;?]+)(?::(\d+))?/);
  if (!uriMatch) {
    yield {
      type: 'error',
      timestamp: Date.now(),
      message: `Invalid SIP URI: ${config.uri}`
    };
    return;
  }

  const domain = uriMatch[2];
  const port = uriMatch[3] ? parseInt(uriMatch[3]) : 5060;

  yield {
    type: 'network',
    timestamp: Date.now(),
    message: `Resolving ${domain}:${port}...`
  };

  const socket = dgram.createSocket('udp4');
  const localPort = 5060 + Math.floor(Math.random() * 1000);

  await new Promise<void>((resolve) => {
    socket.bind(localPort, () => resolve());
  });

  yield {
    type: 'network',
    timestamp: Date.now(),
    message: `Bound to ${localIp}:${localPort}`
  };

  const callId = generateCallId();
  const fromTag = generateTag();
  const branch = `z9hG4bK${Math.random().toString(36).substring(7)}`;

  // Build SDP offer
  const sdpOffer = buildSdp({
    sessionId: Date.now().toString(),
    sessionVersion: Date.now().toString(),
    origin: localIp,
    connection: localIp,
    mediaPort: config.mediaPort || 10000,
    codecs: config.codecs
  });

  // Build SIP request
  const request = {
    method: config.method,
    uri: config.uri,
    version: '2.0',
    headers: {
      via: [{
        version: '2.0',
        protocol: 'UDP',
        host: localIp,
        port: localPort,
        params: { branch }
      }],
      from: {
        uri: `sip:pinmoli@${localIp}`,
        params: { tag: fromTag }
      },
      to: { uri: config.uri },
      'call-id': callId,
      cseq: { seq: 1, method: config.method },
      contact: [{ uri: `sip:pinmoli@${localIp}:${localPort}` }],
      'max-forwards': 70,
      'user-agent': 'Pinmoli/0.1.0',
      'content-type': 'application/sdp',
      'content-length': Buffer.byteLength(sdpOffer)
    },
    content: sdpOffer
  };

  yield {
    type: 'sip',
    timestamp: Date.now(),
    method: config.method,
    message: `Sending ${config.method} to ${config.uri}`,
    sdpOffer
  };

  // Send request
  const message = sip.stringify(request);
  
  let socketClosed = false;
  const closeSocket = () => {
    if (!socketClosed) {
      socketClosed = true;
      try {
        socket.close();
      } catch (e) {
        // Socket already closed
      }
    }
  };

  const response = await new Promise<SipResponse>((resolve, reject) => {
    const timeout = setTimeout(() => {
      closeSocket();
      reject(new Error('Request timeout'));
    }, config.timeout || 5000);

    socket.once('message', (msg) => {
      clearTimeout(timeout);
      const parsed = sip.parse(msg.toString()) as SipResponse;
      closeSocket();
      resolve(parsed);
    });

    socket.send(message, port, domain, (err) => {
      if (err) {
        clearTimeout(timeout);
        closeSocket();
        reject(err);
      }
    });
  });

  yield {
    type: 'sip',
    timestamp: Date.now(),
    method: config.method,
    status: response.status,
    message: `${response.status} ${response.reason}`,
    sdpAnswer: response.content
  };
}
