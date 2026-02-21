import sip from 'sip';
import os from 'os';

const networkInterfaces = os.networkInterfaces();
let localIp = '127.0.0.1';
for (const interfaceName in networkInterfaces) {
  for (const iface of networkInterfaces[interfaceName]) {
    if (iface.family === 'IPv4' && !iface.internal) {
      localIp = iface.address;
    }
  }
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

sip.start({ port: 5060 }, (request) => {});

async function testExtension(ext) {
  return new Promise((resolve) => {
    console.log(`
Testing extension: ${ext}`);
    const callId = Math.floor(Math.random() * 1000000).toString() + '@' + localIp;
    
    const sdp = [
      'v=0',
      'o=- 123456 123456 IN IP4 ' + localIp,
      's=-',
      'c=IN IP4 ' + localIp,
      't=0 0',
      'm=audio 10000 RTP/AVP 0',
      'a=rtpmap:0 PCMU/8000',
      'a=sendrecv'
    ].join('\\r\\n') + '\\r\\n';

    const req = {
      method: 'INVITE',
      uri: `sip:${ext}@${host}`,
      headers: {
        to: { uri: `sip:${ext}@${host}` },
        from: { uri: `sip:tester@${localIp}`, params: { tag: Math.floor(Math.random() * 1000000).toString() } },
        'call-id': callId,
        cseq: { method: 'INVITE', seq: 1 },
        contact: [{ uri: `sip:tester@${localIp}:5060;transport=tcp` }],
        'max-forwards': 70,
        'content-type': 'application/sdp',
      },
      content: sdp
    };

    let resolved = false;

    // Timeout quickly if it just rings forever (LiveKit takes 60s to 503, we don't want to wait that long for all)
    // Wait, if it rings, the agent has 60 seconds to answer. If we timeout early, we might miss it.
    // Let's wait 15 seconds per extension.
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
  for (const ext of extensions) {
    const success = await testExtension(ext);
    if (success) {
      console.log('Found a working extension! Exiting.');
      process.exit(0);
    }
  }
  console.log('None of the extensions worked.');
  process.exit(1);
}

run();