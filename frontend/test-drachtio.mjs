import Srf from 'drachtio-srf';
import http from 'http';
import os from 'os';

const srf = new Srf();
srf.connect({
  host: 'drachtio',
  port: 9022,
  secret: 'cymru'
});

srf.on('connect', (err, hostport) => {
  console.log(`Connected to Drachtio server at ${hostport}`);
  runTest();
});

srf.on('error', (err) => {
  console.error(`Error connecting to drachtio: ${err}`);
  process.exit(1);
});

function getPublicIp() {
  return new Promise((resolve) => {
    http.get('http://ifconfig.me/ip', (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data.trim()));
    }).on('error', () => resolve('127.0.0.1'));
  });
}

async function runTest() {
  const publicIp = await getPublicIp();
  const endpoint = process.env.LIVEKIT_ENDPOINT || 'sip:5eezfwavhxe.sip.livekit.cloud';
  
  const sdp = [
    'v=0',
    `o=drachtio 53655765 2353687637 IN IP4 ${publicIp}`,
    's=-',
    `c=IN IP4 ${publicIp}`,
    't=0 0',
    'm=audio 10000 RTP/AVP 0 101',
    'a=rtpmap:0 PCMU/8000',
    'a=rtpmap:101 telephone-event/8000',
    'a=sendrecv'
  ].join('\r\n') + '\r\n';

  console.log(`Dialing LiveKit via Drachtio SIP Proxy...`);

  try {
    const { dialog } = await srf.createUAC(endpoint, {
      localSdp: sdp,
      headers: {
        'User-Agent': 'Drachtio/Postman-for-Voice'
      }
    }, {
      cbProvisional: (res) => {
        console.log(`Received provisional response: ${res.status}`);
      }
    });

    console.log('Call connected successfully! Received 200 OK.');
    console.log(`Remote SDP: ${dialog.remote.sdp}`);
    
    // We would inject audio here, but first let's see if Drachtio can get a 200 OK.
    setTimeout(() => {
      dialog.destroy();
      console.log('Test completed.');
      process.exit(0);
    }, 5000);

  } catch (err) {
    console.error(`Call failed with status: ${err.status}`);
    process.exit(1);
  }
}
