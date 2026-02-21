import { describe, it, expect } from 'vitest';
import sip from 'sip';
import http from 'http';
import os from 'os';

// Detect local IP
const nets = os.networkInterfaces();
let localIp = '127.0.0.1';
for (const name in nets) {
  for (const iface of nets[name]!) {
    if (iface.family === 'IPv4' && !iface.internal) {
      localIp = iface.address;
    }
  }
}

function getPublicIp(): Promise<string> {
  return new Promise((resolve) => {
    http.get('http://ifconfig.me/ip', { timeout: 5000 }, (res) => {
      let data = '';
      res.on('data', (chunk: string) => (data += chunk));
      res.on('end', () => resolve(data.trim()));
    }).on('error', () => resolve(localIp));
  });
}

describe('LiveKit SIP Trunk Connection', () => {
  it('should successfully send an OPTIONS request and receive a 200 OK', () => {
    return new Promise<void>(async (resolve, reject) => {
      // Parse the endpoint from .env, or fallback to the one we know for testing
      const endpoint = process.env.LIVEKIT_ENDPOINT || 'sip:5eezfwavhxe.sip.livekit.cloud';
      const publicIp = await getPublicIp();

      // Initialize the sip stack
      sip.start({ port: 5060, publicAddress: publicIp }, () => {
        // Drop any unexpected incoming requests
      });

      const req = {
        method: 'OPTIONS',
        uri: endpoint,
        headers: {
          to: { uri: endpoint },
          from: { 
            uri: 'sip:test-runner@127.0.0.1', 
            params: { tag: Math.floor(Math.random() * 1000000).toString() } 
          },
          'call-id': Math.floor(Math.random() * 1000000).toString() + '@127.0.0.1',
          cseq: { method: 'OPTIONS', seq: 1 },
          contact: [{ uri: 'sip:test-runner@127.0.0.1:5060' }],
          'max-forwards': 70
        }
      };

      const timeout = setTimeout(() => {
        sip.stop();
        reject(new Error('Timeout waiting for SIP response from LiveKit'));
      }, 5000);

      sip.send(req, (rs) => {
        clearTimeout(timeout);
        try {
          // Assert that we received a legitimate response (200 OK)
          expect(rs.status).toBe(200);
          expect(rs.headers.to.uri).toBe(endpoint);
          
          sip.stop();
          resolve();
        } catch (err) {
          sip.stop();
          reject(err);
        }
      });
    });
  }, 10000); // 10 second timeout for the test case
});
