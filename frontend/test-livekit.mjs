import dgram from 'dgram';

const HOST = '5eezfwavhxe.sip.livekit.cloud';
const PORT = 5060;

const client = dgram.createSocket('udp4');

const message = Buffer.from(
  `OPTIONS sip:${HOST} SIP/2.0
` +
  `Via: SIP/2.0/UDP 127.0.0.1:5060;branch=z9hG4bK-1234
` +
  `Max-Forwards: 70
` +
  `To: <sip:${HOST}>
` +
  `From: "Test" <sip:test@127.0.0.1>;tag=1234
` +
  `Call-ID: 1234@127.0.0.1
` +
  `CSeq: 1 OPTIONS
` +
  `Contact: <sip:test@127.0.0.1:5060>
` +
  `Accept: application/sdp
` +
  `Content-Length: 0
` +
  `
`
);

client.on('message', (msg, rinfo) => {
  console.log(`Received from ${rinfo.address}:${rinfo.port}`);
  console.log(msg.toString());
  client.close();
});

client.send(message, PORT, HOST, (err) => {
  if (err) {
    console.error(err);
    client.close();
  } else {
    console.log('OPTIONS request sent');
  }
});

// timeout
setTimeout(() => {
  console.log('Timeout waiting for response');
  client.close();
}, 5000);
