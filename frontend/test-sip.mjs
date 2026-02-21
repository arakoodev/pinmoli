import sip from 'sip';

const HOST = '5eezfwavhxe.sip.livekit.cloud';

sip.start({ port: 5060 }, (request) => {
  // Just drop incoming requests for this test
});

const req = {
  method: 'OPTIONS',
  uri: `sip:${HOST}`,
  headers: {
    to: { uri: `sip:${HOST}` },
    from: { uri: 'sip:test@127.0.0.1', params: { tag: Math.floor(Math.random() * 1000000).toString() } },
    'call-id': Math.floor(Math.random() * 1000000).toString() + '@127.0.0.1',
    cseq: { method: 'OPTIONS', seq: 1 },
    contact: [{ uri: 'sip:test@127.0.0.1:5060' }],
    'max-forwards': 70
  }
};

console.log('Sending OPTIONS to', HOST);
sip.send(req, (rs) => {
  console.log('Received response status:', rs.status);
  console.log('Response headers:', rs.headers);
  process.exit(0);
});

setTimeout(() => {
  console.log('Timeout waiting for response');
  process.exit(1);
}, 5000);
