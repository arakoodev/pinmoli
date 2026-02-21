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

sip.start({ port: 5060 }, (request) => {});

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
  uri: `sip:${host}`,
  headers: {
    to: { uri: `sip:${host}` },
    from: { uri: `sip:tester@${localIp}`, params: { tag: Math.floor(Math.random() * 1000000).toString() } },
    'call-id': callId,
    cseq: { method: 'INVITE', seq: 1 },
    contact: [{ uri: `sip:tester@${localIp}:5060;transport=tcp` }],
    'max-forwards': 70,
    'content-type': 'application/sdp',
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
