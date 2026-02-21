import sip from 'sip';
import http from 'http';
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
  const HOST = '5eezfwavhxe.sip.livekit.cloud';

  sip.start({ port: 5060, publicAddress: publicIp }, () => {
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
}

main();
