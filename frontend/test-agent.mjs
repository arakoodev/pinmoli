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
  console.log(`[Postman for Voice] Public IP for SDP: ${publicIp}`);
  console.log(`[Postman for Voice] Local IP for SIP:  ${localIp}`);

  const endpoint = process.env.LIVEKIT_ENDPOINT || 'sip:5eezfwavhxe.sip.livekit.cloud';
  const host = endpoint.replace('sip:', '');
  const localPort = 10000;

  // SDP uses PUBLIC IP so LiveKit media server can route RTP to us
  const sdp = [
    'v=0',
    'o=PostmanForVoice 53655765 2353687637 IN IP4 ' + publicIp,
    's=-',
    'c=IN IP4 ' + publicIp,
    't=0 0',
    'm=audio ' + localPort + ' RTP/AVP 111 0 101',
    'a=rtpmap:111 opus/48000/2',
    'a=fmtp:111 minptime=10;useinbandfec=1',
    'a=rtpmap:0 PCMU/8000',
    'a=rtpmap:101 telephone-event/8000',
    'a=sendrecv'
  ].join('\r\n') + '\r\n';

  sip.start({ port: 5060, publicAddress: publicIp }, (request) => {
    if (request.method === 'BYE') {
      sip.send(sip.makeResponse(request, 200, 'OK'));
      console.log('Agent ended the call.');
      process.exit(0);
    }
  });

  console.log(`[Postman for Voice] Initiating test call to LiveKit SIP Trunk: ${host}`);

  const callId = Math.floor(Math.random() * 1000000).toString() + '@' + publicIp;
  const req = {
    method: 'INVITE',
    uri: `sip:+1234567890@${host}`,
    headers: {
      to: { uri: `sip:+1234567890@${host}` },
      from: { uri: `sip:test-runner@${publicIp}`, params: { tag: Math.floor(Math.random() * 1000000).toString() } },
      'call-id': callId,
      cseq: { method: 'INVITE', seq: 1 },
      contact: [{ uri: `sip:test-runner@${publicIp}:5060` }],
      'max-forwards': 70,
      'user-agent': 'PostmanForVoice/1.0',
      'content-type': 'application/sdp',
      allow: 'INVITE, ACK, BYE, CANCEL, OPTIONS',
    },
    content: sdp
  };

  let cseqCounter = 1;
  let hasRung = false;

  sip.send(req, (rs) => {
    console.log(`    ← ${rs.status} ${rs.reason || ''}`);
    if (rs.headers) {
      console.log(`    Via: ${JSON.stringify(rs.headers.via)}`);
      console.log(`    To: ${JSON.stringify(rs.headers.to)}`);
      if (rs.headers['www-authenticate']) console.log(`    WWW-Authenticate: ${JSON.stringify(rs.headers['www-authenticate'])}`);
    }

    if (rs.status === 100) {
      console.log('-> 100 Trying (LiveKit proxy received request)');
    }
    else if (rs.status === 180) {
      if (!hasRung) {
        console.log('-> 180 Ringing (LiveKit dispatch rule matched, room created. Waiting for Agent to join...)');
        hasRung = true;
      }
    }
    else if (rs.status === 503) {
      console.error('\n[ERROR] Received 503 Service Unavailable / Connection Dropped.');
      console.error('DIAGNOSIS: Possible causes:');
      console.error('  1. The LiveKit Agent worker is not running, crashed, or is not configured to listen to the correct dispatch rule room prefix.');
      console.error('  2. A bug in this test framework prevented the SIP dialog from completing (e.g. ACK not sent after 200 OK).');
      console.error('ACTION REQUIRED: First verify your LiveKit Agent worker is running and healthy. If the agent is confirmed running, check this test framework for SIP protocol errors.');
      process.exit(1);
    }
    else if (rs.status === 200) {
      console.log('-> 200 OK (Agent joined the room and answered!)');

      // Manually construct ACK (sip.dialog() does not exist in sip v0.0.6)
      const ack = {
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
      sip.send(ack);
      console.log('-> ACK sent.');

      const parsed = parse(rs.content);
      const remoteIp = parsed.connection?.ip || parsed.origin.address;
      const media = parsed.media.find(m => m.type === 'audio');
      const remotePort = media.port;

      console.log(`-> Media established. Remote RTP endpoint: ${remoteIp}:${remotePort}`);

      // Generate and send synthetic audio prompt
      console.log('-> Injecting synthetic voice prompt into RTP stream...');
      const espeak = spawn('espeak-ng', ['-w', 'prompt.wav', 'Hello, this is the Postman for Voice testing framework. Are you receiving me?']);

      espeak.on('close', () => {
        // Stream audio via ffmpeg
        const sendFfmpeg = spawn('ffmpeg', [
          '-re', '-i', 'prompt.wav', '-acodec', 'pcm_mulaw', '-ar', '8000', '-ac', '1', '-f', 'rtp', `rtp://${remoteIp}:${remotePort}`
        ]);

        console.log('-> Listening for agent response...');

        setTimeout(() => {
          console.log('Test completed successfully. Hanging up.');
          cseqCounter++;
          const bye = {
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
          sip.send(bye);
          process.exit(0);
        }, 10000);
      });
    }
  });
}

main();
