import sip from 'sip';
import { parse } from 'sdp-transform';
import { spawn } from 'child_process';

const HOST = '5eezfwavhxe.sip.livekit.cloud';
const PORT = 5060;

const localPort = 10000;
const sdp = [
  'v=0',
  'o=- 123456 123456 IN IP4 0.0.0.0',
  's=LiveKit Test',
  'c=IN IP4 0.0.0.0',
  't=0 0',
  'm=audio ' + localPort + ' RTP/AVP 0 101',
  'a=rtpmap:0 PCMU/8000',
  'a=rtpmap:101 telephone-event/8000',
  'a=sendrecv'
].join('\r\n') + '\r\n';

const callId = Math.floor(Math.random() * 1000000).toString() + '@1.1.1.1';
const fromTag = Math.floor(Math.random() * 1000000).toString();

sip.start({ port: 5060 }, (request) => {
  if (request.method === 'BYE') {
    sip.send(sip.makeResponse(request, 200, 'OK'));
    console.log('Received BYE, hung up.');
    process.exit(0);
  }
});

const req = {
  method: 'INVITE',
  uri: `sip:echo@${HOST}`,
  headers: {
    to: { uri: `sip:echo@${HOST}` },
    from: { uri: 'sip:test@1.1.1.1', params: { tag: fromTag } },
    'call-id': callId,
    cseq: { method: 'INVITE', seq: 1 },
    contact: [{ uri: 'sip:test@1.1.1.1:5060' }],
    'max-forwards': 70,
    'user-agent': 'Twilio',
    'x-livekit-room': 'test-room',
    'content-type': 'application/sdp',
  },
  content: sdp
};

console.log('Sending INVITE to', HOST);
let dialog;

sip.send(req, (rs) => {
  console.log('Received response:', rs.status, rs.reason);
  console.log('Headers:', JSON.stringify(rs.headers, null, 2));
  if (rs.content) console.log('Body:', rs.content);
  
  if (rs.status >= 300) {
    console.log('Failed to connect:', rs.status);
    process.exit(1);
  }
  
  if (rs.status === 200) {
    dialog = sip.dialog(req, rs);
    const ackReq = dialog.makeRequest('ACK');
    sip.send(ackReq);
    console.log('Sent ACK.');

    // Parse remote SDP
    const parsed = parse(rs.content);
    const remoteIp = parsed.connection?.ip || parsed.origin.address;
    const media = parsed.media.find(m => m.type === 'audio');
    const remotePort = media.port;

    console.log(`LiveKit accepted call. Remote RTP endpoint: ${remoteIp}:${remotePort}`);

    console.log('Starting ffmpeg to stream 5 seconds of audio...');
    const ffmpeg = spawn('ffmpeg', [
      '-re', 
      '-f', 'lavfi', 
      '-i', 'sine=frequency=1000:duration=5', 
      '-acodec', 'pcm_mulaw', 
      '-ar', '8000', 
      '-ac', '1', 
      '-f', 'rtp', 
      `rtp://${remoteIp}:${remotePort}`
    ]);

    ffmpeg.stderr.on('data', data => {
      // console.log(`ffmpeg: ${data}`);
    });

    ffmpeg.on('close', (code) => {
      console.log('ffmpeg finished encoding and streaming. Hanging up call.');
      const byeReq = dialog.makeRequest('BYE');
      sip.send(byeReq, (byeRs) => {
        console.log('BYE response:', byeRs.status);
        process.exit(0);
      });
    });
  }
});
