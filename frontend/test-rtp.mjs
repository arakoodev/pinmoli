import sip from 'sip';
import { parse } from 'sdp-transform';
import { spawn } from 'child_process';
import http from 'http';
import os from 'os';

// Get local private IP (for SIP signaling — works via NAT)
const networkInterfaces = os.networkInterfaces();
let localIp = '127.0.0.1';
for (const interfaceName in networkInterfaces) {
  for (const iface of networkInterfaces[interfaceName]) {
    if (iface.family === 'IPv4' && !iface.internal) {
      localIp = iface.address;
    }
  }
}

// Fetch public IP (for SDP — LiveKit must be able to route RTP media to us)
function getPublicIp() {
  return new Promise((resolve) => {
    http.get('http://ifconfig.me/ip', { timeout: 5000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data.trim()));
    }).on('error', () => resolve(localIp));
  });
}

async function main() {
  const publicIp = await getPublicIp();
  console.log(`Public IP for SDP: ${publicIp}`);

  const HOST = '5eezfwavhxe.sip.livekit.cloud';

  const localPort = 10000;
  // SDP uses PUBLIC IP so LiveKit media server can route RTP to us
  const sdp = [
    'v=0',
    'o=- 123456 123456 IN IP4 ' + publicIp,
    's=LiveKit Test',
    'c=IN IP4 ' + publicIp,
    't=0 0',
    'm=audio ' + localPort + ' RTP/AVP 0 101',
    'a=rtpmap:0 PCMU/8000',
    'a=rtpmap:101 telephone-event/8000',
    'a=sendrecv'
  ].join('\r\n') + '\r\n';

  const callId = Math.floor(Math.random() * 1000000).toString() + '@' + publicIp;
  const fromTag = Math.floor(Math.random() * 1000000).toString();

  sip.start({ port: 5060, publicAddress: publicIp }, (request) => {
    if (request.method === 'BYE') {
      sip.send(sip.makeResponse(request, 200, 'OK'));
      console.log('Received BYE, hung up.');
      process.exit(0);
    }
  });

  const req = {
    method: 'INVITE',
    uri: `sip:echo@${HOST}`,
    headers: {
      to: { uri: `sip:echo@${HOST}` },
      from: { uri: `sip:test@${publicIp}`, params: { tag: fromTag } },
      'call-id': callId,
      cseq: { method: 'INVITE', seq: 1 },
      contact: [{ uri: `sip:test@${publicIp}:5060` }],
      'max-forwards': 70,
      'user-agent': 'Twilio',
      'x-livekit-room': 'test-room',
      'content-type': 'application/sdp',
      allow: 'INVITE, ACK, BYE, CANCEL, OPTIONS',
    },
    content: sdp
  };

  console.log('Sending INVITE to', HOST);
  let cseqCounter = 1;

  sip.send(req, (rs) => {
    console.log('Received response:', rs.status, rs.reason);
    console.log('Headers:', JSON.stringify(rs.headers, null, 2));
    if (rs.content) console.log('Body:', rs.content);

    if (rs.status >= 300) {
      console.log('Failed to connect:', rs.status);
      process.exit(1);
    }

    if (rs.status === 200) {
      // Manually construct ACK (sip.dialog() does not exist in sip v0.0.6)
      const ackReq = {
        method: 'ACK',
        uri: req.uri,
        headers: {
          to: rs.headers.to,
          from: req.headers.from,
          'call-id': req.headers['call-id'],
          cseq: { method: 'ACK', seq: cseqCounter },
          via: [],
          'max-forwards': 70,
        }
      };
      sip.send(ackReq);
      console.log('Sent ACK.');

      // Parse remote SDP
      const parsed = parse(rs.content);
      const remoteIp = parsed.connection?.ip || parsed.origin.address;
      const media = parsed.media.find(m => m.type === 'audio');
      const remotePort = media.port;

      console.log(`LiveKit accepted call. Remote RTP endpoint: ${remoteIp}:${remotePort}`);

      console.log('Starting ffmpeg to stream 5 seconds of audio...');
      const ffmpeg = spawn('ffmpeg', [
        '-re',
        '-f', 'lavfi',
        '-i', 'sine=frequency=1000:duration=5',
        '-acodec', 'pcm_mulaw',
        '-ar', '8000',
        '-ac', '1',
        '-f', 'rtp',
        `rtp://${remoteIp}:${remotePort}`
      ]);

      ffmpeg.stderr.on('data', data => {
        // console.log(`ffmpeg: ${data}`);
      });

      ffmpeg.on('close', (code) => {
        console.log('ffmpeg finished encoding and streaming. Hanging up call.');
        cseqCounter++;
        const byeReq = {
          method: 'BYE',
          uri: req.uri,
          headers: {
            to: rs.headers.to,
            from: req.headers.from,
            'call-id': req.headers['call-id'],
            cseq: { method: 'BYE', seq: cseqCounter },
            via: [],
            'max-forwards': 70,
          }
        };
        sip.send(byeReq, (byeRs) => {
          console.log('BYE response:', byeRs.status);
          process.exit(0);
        });
      });
    }
  });
}

main();
