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

async function main() {
  const publicIp = await getPublicIp();
  const host = '5eezfwavhxe.sip.livekit.cloud';

  sip.start({ port: 5060, publicAddress: publicIp }, () => {});

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
    uri: `sip:${host}`,
    headers: {
      to: { uri: `sip:${host}` },
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

  console.log(`Calling ${host} without user part...`);

  sip.send(req, (rs) => {
    console.log('Response:', rs.status, rs.reason);
    if (rs.status >= 300) {
      process.exit(1);
    }
    if (rs.status === 200) {
      console.log('SUCCESS');
      process.exit(0);
    }
  });
}

main();
