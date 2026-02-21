import sip from 'sip';
import os from 'os';
import http from 'http';

const networkInterfaces = os.networkInterfaces();
let localIp = '127.0.0.1';
for (const interfaceName in networkInterfaces) {
  for (const iface of networkInterfaces[interfaceName]) {
    if (iface.family === 'IPv4' && !iface.internal) {
      localIp = iface.address;
    }
  }
}

function getPublicIp() {
  return new Promise((resolve) => {
    http.get('http://ifconfig.me/ip', { timeout: 5000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data.trim()));
    }).on('error', () => resolve(localIp));
  });
}

const host = '5eezfwavhxe.sip.livekit.cloud';

const extensions = [
  '+1234567890',
  '',
  'agent',
  'test',
  'echo',
  '1000',
  '0000',
  'main',
  'support',
  'voice',
  'bot',
  '+14155552671', // Twilio test number
  '+18005551212',
  'hello'
];

async function testExtension(ext, publicIp) {
  return new Promise((resolve) => {
    console.log(`
Testing extension: ${ext}`);
    const callId = Math.floor(Math.random() * 1000000).toString() + '@' + publicIp;

    const sdp = [
      'v=0',
      'o=- 123456 123456 IN IP4 ' + publicIp,
      's=-',
      'c=IN IP4 ' + publicIp,
      't=0 0',
      'm=audio 10000 RTP/AVP 0',
      'a=rtpmap:0 PCMU/8000',
      'a=sendrecv'
    ].join('\r\n') + '\r\n';

    const req = {
      method: 'INVITE',
      uri: `sip:${ext}@${host}`,
      headers: {
        to: { uri: `sip:${ext}@${host}` },
        from: { uri: `sip:tester@${publicIp}`, params: { tag: Math.floor(Math.random() * 1000000).toString() } },
        'call-id': callId,
        cseq: { method: 'INVITE', seq: 1 },
        contact: [{ uri: `sip:tester@${publicIp}:5060` }],
        'max-forwards': 70,
        'content-type': 'application/sdp',
        allow: 'INVITE, ACK, BYE, CANCEL, OPTIONS',
      },
      content: sdp
    };

    let resolved = false;

    // Wait 15 seconds per extension
    const timer = setTimeout(() => {
      if (!resolved) {
        console.log(`Timeout on ${ext} (Agent didn't answer in 15s)`);
        resolved = true;
        resolve(false);
      }
    }, 15000);

    sip.send(req, (rs) => {
      if (rs.status === 100 || rs.status === 180) {
        // ignore provisional
      } else if (rs.status === 200 || rs.status === 183) {
        console.log(`SUCCESS! Extension ${ext} answered with ${rs.status}`);
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          resolve(true);
        }
      } else {
        console.log(`Extension ${ext} rejected with ${rs.status}`);
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          resolve(false);
        }
      }
    });
  });
}

async function run() {
  const publicIp = await getPublicIp();
  sip.start({ port: 5060, publicAddress: publicIp }, () => {});

  for (const ext of extensions) {
    const success = await testExtension(ext, publicIp);
    if (success) {
      console.log('Found a working extension! Exiting.');
      process.exit(0);
    }
  }
  console.log('None of the extensions worked.');
  process.exit(1);
}

run();
