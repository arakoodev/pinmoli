import { AgentDispatchClient, RoomServiceClient } from 'livekit-server-sdk';
import sip from 'sip';
import http from 'http';
import os from 'os';

const url = process.env.LIVEKIT_URL;
const key = process.env.LIVEKIT_API_KEY;
const secret = process.env.LIVEKIT_API_SECRET;

const dispatchClient = new AgentDispatchClient(url, key, secret);
const roomClient = new RoomServiceClient(url, key, secret);

const nets = os.networkInterfaces();
let localIp = '127.0.0.1';
for (const name in nets) {
  for (const iface of nets[name]) {
    if (iface.family === 'IPv4' && !iface.internal) localIp = iface.address;
  }
}
const publicIp = await new Promise(resolve => {
  http.get('http://ifconfig.me/ip', { timeout: 5000 }, res => {
    let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(d.trim()));
  }).on('error', () => resolve(localIp));
});

// Start SIP call
sip.start({ port: 5068, publicAddress: publicIp }, req => {
  if (req.method === 'BYE') sip.send(sip.makeResponse(req, 200, 'OK'));
});

const host = '5eezfwavhxe.sip.livekit.cloud';
const sdp = [
  'v=0', 'o=- 1 1 IN IP4 ' + publicIp, 's=-', 'c=IN IP4 ' + publicIp, 't=0 0',
  'm=audio 10000 RTP/AVP 111 0 101',
  'a=rtpmap:111 opus/48000/2', 'a=fmtp:111 minptime=10;useinbandfec=1',
  'a=rtpmap:0 PCMU/8000', 'a=rtpmap:101 telephone-event/8000', 'a=sendrecv'
].join('\r\n') + '\r\n';

const inviteReq = {
  method: 'INVITE', uri: `sip:+1234567890@${host}`,
  headers: {
    to: { uri: `sip:+1234567890@${host}` },
    from: { uri: `sip:test@${publicIp}`, params: { tag: String(Math.random() * 1e6 | 0) } },
    'call-id': (Math.random() * 1e6 | 0) + '@' + publicIp,
    cseq: { method: 'INVITE', seq: 1 },
    contact: [{ uri: `sip:test@${publicIp}:5068` }],
    'max-forwards': 70, 'user-agent': 'PostmanForVoice/1.0',
    'content-type': 'application/sdp', allow: 'INVITE, ACK, BYE, CANCEL, OPTIONS',
  },
  content: sdp
};

console.log('Sending INVITE...');
let gotOk = false;
sip.send(inviteReq, rs => {
  if (rs.status === 100) console.log('100 Trying');
  if (rs.status === 180) console.log('180 Ringing');
  if (rs.status === 200 && !gotOk) {
    gotOk = true;
    console.log('200 OK — AGENT ANSWERED!');
  }
});

// Wait for room creation, then inspect dispatches
await new Promise(r => setTimeout(r, 12000));

const rooms = await roomClient.listRooms();
console.log(`\n=== ${rooms.length} room(s) found ===`);
for (const room of rooms) {
  console.log(`\nRoom: ${room.name} | Participants: ${room.numParticipants}`);

  // List dispatches
  try {
    const dispatches = await dispatchClient.listDispatch(room.name);
    console.log(`  Dispatches: ${dispatches.length}`);
    for (const d of dispatches) {
      console.log(`    id=${d.id} agentName="${d.agentName}" room=${d.room} metadata=${d.metadata}`);
    }
    if (dispatches.length === 0) {
      console.log('  NO DISPATCHES — LiveKit is not dispatching any agent to this room!');
    }
  } catch (e) {
    console.log(`  Dispatch list error: ${e.message}`);
  }

  // List participants
  const parts = await roomClient.listParticipants(room.name);
  for (const p of parts) {
    console.log(`  Participant: ${p.identity} | kind=${p.kind} | state=${p.state}`);
  }
}

process.exit(0);
