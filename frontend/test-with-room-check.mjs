/**
 * Sends INVITE and simultaneously polls for rooms to verify session creation.
 */
import sip from 'sip';
import http from 'http';
import os from 'os';
import { RoomServiceClient, AgentDispatchClient } from 'livekit-server-sdk';

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
  const livekitUrl = process.env.LIVEKIT_URL;
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;

  if (!livekitUrl || !apiKey || !apiSecret) {
    console.error('Missing LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET');
    process.exit(1);
  }

  const roomClient = new RoomServiceClient(livekitUrl, apiKey, apiSecret);
  const dispatchClient = new AgentDispatchClient(livekitUrl, apiKey, apiSecret);

  const endpoint = process.env.LIVEKIT_ENDPOINT || 'sip:5eezfwavhxe.sip.livekit.cloud';
  const host = endpoint.replace('sip:', '');

  const sdp = [
    'v=0',
    'o=PostmanForVoice 53655765 2353687637 IN IP4 ' + publicIp,
    's=-',
    'c=IN IP4 ' + publicIp,
    't=0 0',
    'm=audio 10000 RTP/AVP 111 0 101',
    'a=rtpmap:111 opus/48000/2',
    'a=fmtp:111 minptime=10;useinbandfec=1',
    'a=rtpmap:0 PCMU/8000',
    'a=rtpmap:101 telephone-event/8000',
    'a=sendrecv'
  ].join('\r\n') + '\r\n';

  sip.start({ port: 5066, publicAddress: publicIp }, (request) => {
    if (request.method === 'BYE') {
      sip.send(sip.makeResponse(request, 200, 'OK'));
      console.log('[SIP] Received BYE');
    }
  });

  const callId = Math.floor(Math.random() * 1000000).toString() + '@' + publicIp;
  const req = {
    method: 'INVITE',
    uri: `sip:+1234567890@${host}`,
    headers: {
      to: { uri: `sip:+1234567890@${host}` },
      from: { uri: `sip:test-runner@${publicIp}`, params: { tag: Math.floor(Math.random() * 1000000).toString() } },
      'call-id': callId,
      cseq: { method: 'INVITE', seq: 1 },
      contact: [{ uri: `sip:test-runner@${publicIp}:5066` }],
      'max-forwards': 70,
      'user-agent': 'PostmanForVoice/1.0',
      'content-type': 'application/sdp',
      allow: 'INVITE, ACK, BYE, CANCEL, OPTIONS',
    },
    content: sdp
  };

  let gotRinging = false;
  let gotOk = false;

  console.log(`[SIP] Sending INVITE to ${host}`);
  console.log(`[SIP] Public IP: ${publicIp}`);

  // Start room polling
  let pollCount = 0;
  const pollInterval = setInterval(async () => {
    pollCount++;
    try {
      const rooms = await roomClient.listRooms();
      if (rooms.length > 0) {
        console.log(`\n[ROOMS] Found ${rooms.length} room(s) at poll #${pollCount}:`);
        for (const r of rooms) {
          console.log(`  Name: ${r.name} | Participants: ${r.numParticipants} | Created: ${new Date(Number(r.creationTime) * 1000).toISOString()}`);
          try {
            const participants = await roomClient.listParticipants(r.name);
            let agentFound = false;
            for (const p of participants) {
              const isAgent = p.kind === 1 || p.kind === 'AGENT';
              console.log(`    -> ${p.identity} (state=${p.state}, kind=${p.kind})${isAgent ? ' *** AGENT ***' : ''}`);
              if (isAgent) agentFound = true;
            }
            if (agentFound) {
              console.log('\n  [SUCCESS] Agent participant detected in room!');
            }
            if (participants.length === 0) {
              console.log(`    -> (no participants yet)`);
            }
          } catch {}
          // Check agent dispatches for this room
          try {
            const dispatches = await dispatchClient.listDispatch(r.name);
            for (const d of dispatches) {
              console.log(`    dispatch: ${d.id} agentName="${d.agentName}" state=${JSON.stringify(d.state)}`);
            }
            if (dispatches.length === 0) {
              console.log(`    (no agent dispatches — automatic dispatch mode)`);
            }
          } catch {}
        }
      } else if (pollCount <= 3 || pollCount % 5 === 0) {
        console.log(`[ROOMS] Poll #${pollCount}: 0 rooms`);
      }
    } catch (e) {
      if (pollCount <= 2) console.log(`[ROOMS] Poll error: ${e.message}`);
    }
  }, 2000);

  sip.send(req, (rs) => {
    if (rs.status === 100) {
      console.log('[SIP] <- 100 Trying');
    } else if (rs.status === 180 && !gotRinging) {
      gotRinging = true;
      console.log('[SIP] <- 180 Ringing — dispatch rule matched, waiting for agent...');
      console.log('[SIP]    To tag:', rs.headers?.to?.params?.tag || 'none');
    } else if (rs.status === 200 && !gotOk) {
      gotOk = true;
      console.log('[SIP] <- 200 OK — AGENT ANSWERED!');
      clearInterval(pollInterval);

      // Send ACK
      sip.send({
        method: 'ACK',
        uri: req.uri,
        headers: {
          to: rs.headers.to,
          from: req.headers.from,
          'call-id': req.headers['call-id'],
          cseq: { method: 'ACK', seq: 1 },
          via: [],
          'max-forwards': 70,
        }
      });
      console.log('[SIP] -> ACK sent');

      // Hang up after 5s
      setTimeout(() => {
        sip.send({
          method: 'BYE',
          uri: req.uri,
          headers: {
            to: rs.headers.to,
            from: req.headers.from,
            'call-id': req.headers['call-id'],
            cseq: { method: 'BYE', seq: 2 },
            via: [],
            'max-forwards': 70,
          }
        });
        console.log('[SIP] -> BYE sent');
        setTimeout(() => process.exit(0), 2000);
      }, 5000);
    } else if (rs.status === 503) {
      console.log('[SIP] <- 503 (TCP disconnected by LiveKit — agent never joined)');
      clearInterval(pollInterval);
      process.exit(1);
    } else if (rs.status >= 300 && rs.status !== 503) {
      console.log(`[SIP] <- ${rs.status} ${rs.reason}`);
    }
  });

  // Timeout after 70s
  setTimeout(() => {
    console.log('[TIMEOUT] No response after 70s. Exiting.');
    clearInterval(pollInterval);
    process.exit(1);
  }, 70000);
}

main();
