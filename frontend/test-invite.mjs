import dgram from 'dgram';

const HOST = '5eezfwavhxe.sip.livekit.cloud';
const PORT = 5060;

const client = dgram.createSocket('udp4');

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

const message = Buffer.from(
  `INVITE sip:test@${HOST} SIP/2.0
` +
  `Via: SIP/2.0/UDP 127.0.0.1:5060;branch=z9hG4bK-invite-1234
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
  `Contact: <sip:test@127.0.0.1:5060>
` +
  `Content-Type: application/sdp
` +
  `Content-Length: ${sdp.length}
` +
  `
` +
  sdp
);

client.on('message', (msg, rinfo) => {
  console.log(`Received from UDP ${rinfo.address}:${rinfo.port}`);
  console.log(msg.toString());
  client.close();
  process.exit(0);
});

client.send(message, PORT, HOST, (err) => {
  if (err) {
    console.error(err);
    client.close();
  } else {
    console.log('INVITE request sent via UDP');
  }
});

// timeout
setTimeout(() => {
  console.log('Timeout waiting for UDP response');
  client.close();
  process.exit(1);
}, 5000);
