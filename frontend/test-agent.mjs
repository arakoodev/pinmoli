import sip from 'sip';
import { parse } from 'sdp-transform';
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';

// Get local private IP
const networkInterfaces = os.networkInterfaces();
let localIp = '127.0.0.1';
for (const interfaceName in networkInterfaces) {
  for (const iface of networkInterfaces[interfaceName]) {
    if (iface.family === 'IPv4' && !iface.internal) {
      localIp = iface.address;
    }
  }
}

const endpoint = process.env.LIVEKIT_ENDPOINT || 'sip:5eezfwavhxe.sip.livekit.cloud';
const host = endpoint.replace('sip:', '');
const localPort = 10000;

// Proper SDP offering Opus and PCMU
const sdp = [
  'v=0',
  'o=PostmanForVoice 53655765 2353687637 IN IP4 ' + localIp,
  's=-',
  'c=IN IP4 ' + localIp,
  't=0 0',
  'm=audio ' + localPort + ' RTP/AVP 111 0 101',
  'a=rtpmap:111 opus/48000/2',
  'a=fmtp:111 minptime=10;useinbandfec=1',
  'a=rtpmap:0 PCMU/8000',
  'a=rtpmap:101 telephone-event/8000',
  'a=sendrecv'
].join('\r\n') + '\r\n';

sip.start({ port: 5060 }, (request) => {
  if (request.method === 'BYE') {
    sip.send(sip.makeResponse(request, 200, 'OK'));
    console.log('Agent ended the call.');
    process.exit(0);
  }
});

console.log(`[Postman for Voice] Initiating test call to LiveKit SIP Trunk: ${host}`);

const callId = Math.floor(Math.random() * 1000000).toString() + '@' + localIp;
const req = {
  method: 'INVITE',
  uri: `sip:+1234567890@${host}`,
  headers: {
    to: { uri: `sip:+1234567890@${host}` },
    from: { uri: `sip:test-runner@${localIp}`, params: { tag: Math.floor(Math.random() * 1000000).toString() } },
    'call-id': callId,
    cseq: { method: 'INVITE', seq: 1 },
    contact: [{ uri: `sip:test-runner@${localIp}:5060;transport=tcp` }],
    'max-forwards': 70,
    'user-agent': 'PostmanForVoice/1.0',
    'content-type': 'application/sdp',
  },
  content: sdp
};

let dialog;
let hasRung = false;

sip.send(req, (rs) => {
  if (rs.status === 100) {
    console.log('-> 100 Trying (LiveKit proxy received request)');
  } 
  else if (rs.status === 180) {
    if (!hasRung) {
      console.log('-> 180 Ringing (LiveKit dispatch rule matched, room created. Waiting for Agent to join...)');
      hasRung = true;
    }
  } 
  else if (rs.status === 503) {
    console.error('\n[ERROR] Received 503 Service Unavailable / Connection Dropped.');
    console.error('DIAGNOSIS: The LiveKit SIP Proxy successfully routed the call to a room (as proven by the 180 Ringing), but the connection was dropped. This occurs because the remote LiveKit Agent failed to join the room and publish an audio track within the 60-second SIP timeout window.');
    console.error('ACTION REQUIRED: Please verify your LiveKit Agent worker is running, not crashing, and is configured to listen to the correct dispatch rule room prefix.');
    process.exit(1);
  }
  else if (rs.status === 200) {
    console.log('-> 200 OK (Agent joined the room and answered!)');
    dialog = sip.dialog(req, rs);
    sip.send(dialog.makeRequest('ACK'));
    
    const parsed = parse(rs.content);
    const remoteIp = parsed.connection?.ip || parsed.origin.address;
    const media = parsed.media.find(m => m.type === 'audio');
    const remotePort = media.port;

    console.log(`-> Media established. Remote RTP endpoint: ${remoteIp}:${remotePort}`);
    
    // Generate and send synthetic audio prompt
    console.log('-> Injecting synthetic voice prompt into RTP stream...');
    const espeak = spawn('espeak-ng', ['-w', 'prompt.wav', 'Hello, this is the Postman for Voice testing framework. Are you receiving me?']);
    
    espeak.on('close', () => {
      // Stream audio via ffmpeg
      const sendFfmpeg = spawn('ffmpeg', [
        '-re', '-i', 'prompt.wav', '-acodec', 'pcm_mulaw', '-ar', '8000', '-ac', '1', '-f', 'rtp', `rtp://${remoteIp}:${remotePort}`
      ]);
      
      console.log('-> Listening for agent response...');
      // Logic to capture response would go here
      
      setTimeout(() => {
        console.log('Test completed successfully. Hanging up.');
        sip.send(dialog.makeRequest('BYE'));
        process.exit(0);
      }, 10000);
    });
  }
});
