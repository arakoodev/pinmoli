import net from 'net';

const HOST = '5eezfwavhxe.sip.livekit.cloud';

function testTCP(port) {
  return new Promise((resolve) => {
    console.log(`Trying TCP on port ${port}...`);
    const client = net.createConnection({ host: HOST, port: port }, () => {
      console.log(`Connected via TCP to ${HOST}:${port}`);
      const message = 
        `OPTIONS sip:${HOST} SIP/2.0
` +
        `Via: SIP/2.0/TCP 127.0.0.1:${port};branch=z9hG4bK-1234
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
        `Contact: <sip:test@127.0.0.1:${port}>
` +
        `Accept: application/sdp
` +
        `Content-Length: 0
` +
        `
`;
      client.write(message);
    });

    client.on('data', (data) => {
      console.log(`Received from TCP ${port}:`);
      console.log(data.toString());
      client.end();
      resolve();
    });

    client.on('error', (err) => {
      console.log(`TCP ${port} Error:`, err.message);
      resolve();
    });

    setTimeout(() => {
      console.log(`Timeout on TCP ${port}`);
      client.destroy();
      resolve();
    }, 5000);
  });
}

import tls from 'tls';
function testTLS(port) {
  return new Promise((resolve) => {
    console.log(`Trying TLS on port ${port}...`);
    const client = tls.connect(port, HOST, { rejectUnauthorized: false }, () => {
      console.log(`Connected via TLS to ${HOST}:${port}`);
      const message = 
        `OPTIONS sip:${HOST} SIP/2.0
` +
        `Via: SIP/2.0/TLS 127.0.0.1:${port};branch=z9hG4bK-1234
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
        `Contact: <sip:test@127.0.0.1:${port}>
` +
        `Accept: application/sdp
` +
        `Content-Length: 0
` +
        `
`;
      client.write(message);
    });

    client.on('data', (data) => {
      console.log(`Received from TLS ${port}:`);
      console.log(data.toString());
      client.end();
      resolve();
    });

    client.on('error', (err) => {
      console.log(`TLS ${port} Error:`, err.message);
      resolve();
    });

    setTimeout(() => {
      console.log(`Timeout on TLS ${port}`);
      client.destroy();
      resolve();
    }, 5000);
  });
}

async function run() {
  await testTCP(5060);
  await testTLS(5061);
}
run();
