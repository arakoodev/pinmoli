import net from 'net';

const HOST = '5eezfwavhxe.sip.livekit.cloud';
const PORT = 5060;

const sdp = `v=0
` +
  `o=- 123456 123456 IN IP4 127.0.0.1
` +
  `s=-
` +
  `c=IN IP4 127.0.0.1
` +
  `t=0 0
` +
  `m=audio 10000 RTP/AVP 0 8 101
` +
  `a=rtpmap:0 PCMU/8000
` +
  `a=rtpmap:8 PCMA/8000
` +
  `a=rtpmap:101 telephone-event/8000
` +
  `a=sendrecv
`;

const message = 
  `INVITE sip:test@${HOST} SIP/2.0
` +
  `Via: SIP/2.0/TCP 127.0.0.1:${PORT};branch=z9hG4bK-invite-1234
` +
  `Max-Forwards: 70
` +
  `To: <sip:test@${HOST}>
` +
  `From: "Test" <sip:test@127.0.0.1>;tag=1234
` +
  `Call-ID: invite-1234@127.0.0.1
` +
  `CSeq: 1 INVITE
` +
  `Contact: <sip:test@127.0.0.1:${PORT}>
` +
  `Content-Type: application/sdp
` +
  `Content-Length: ${sdp.length}
` +
  `
` +
  sdp;

const client = net.createConnection({ host: HOST, port: PORT }, () => {
  console.log(`Connected via TCP to ${HOST}:${PORT}`);
  console.log('Sending INVITE');
  client.write(message);
});

client.on('data', (data) => {
  console.log(`Received from TCP ${PORT}:`);
  console.log(data.toString());
  client.end();
  process.exit(0);
});

client.on('error', (err) => {
  console.log(`TCP ${PORT} Error:`, err.message);
  process.exit(1);
});

setTimeout(() => {
  console.log(`Timeout on TCP ${PORT}`);
  client.destroy();
  process.exit(1);
}, 5000);
