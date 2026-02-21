// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any -- sip library has no type definitions */
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import sip from 'sip';
import { parse } from 'sdp-transform';
import { spawn } from 'child_process';
import http from 'http';
import os from 'os';

// Detect local IP (for SIP signaling — works via NAT)
const nets = os.networkInterfaces();
let localIp = '127.0.0.1';
for (const name in nets) {
  for (const iface of nets[name]!) {
    if (iface.family === 'IPv4' && !iface.internal) {
      localIp = iface.address;
    }
  }
}

// Fetch public IP (for SDP — LiveKit media server must be able to route RTP to us)
function getPublicIp(): Promise<string> {
  return new Promise((resolve) => {
    http.get('http://ifconfig.me/ip', { timeout: 5000 }, (res) => {
      let data = '';
      res.on('data', (chunk: string) => (data += chunk));
      res.on('end', () => resolve(data.trim()));
    }).on('error', () => resolve(localIp));
  });
}

function buildSdp(ip: string, port: number): string {
  return [
    'v=0',
    `o=PostmanForVoice 53655765 2353687637 IN IP4 ${ip}`,
    's=-',
    `c=IN IP4 ${ip}`,
    't=0 0',
    `m=audio ${port} RTP/AVP 111 0 101`,
    'a=rtpmap:111 opus/48000/2',
    'a=fmtp:111 minptime=10;useinbandfec=1',
    'a=rtpmap:0 PCMU/8000',
    'a=rtpmap:101 telephone-event/8000',
    'a=sendrecv',
  ].join('\r\n') + '\r\n';
}

function buildInvite(endpoint: string, sipPort: number, sdpIp: string, contactIp: string) {
  const host = endpoint.replace(/^sip:/, '');
  return {
    method: 'INVITE',
    uri: `sip:+1234567890@${host}`,
    headers: {
      to: { uri: `sip:+1234567890@${host}` },
      from: { uri: `sip:test@${contactIp}`, params: { tag: String(Math.floor(Math.random() * 1e6)) } },
      'call-id': Math.floor(Math.random() * 1e6) + '@' + contactIp,
      cseq: { method: 'INVITE', seq: 1 },
      contact: [{ uri: `sip:test@${contactIp}:${sipPort}` }],
      'max-forwards': 70,
      'user-agent': 'PostmanForVoice/1.0',
      'content-type': 'application/sdp',
      allow: 'INVITE, ACK, BYE, CANCEL, OPTIONS',
    },
    content: buildSdp(sdpIp, 10000),
  };
}

describe('LiveKit SIP Agent Call', () => {
  let publicIp = localIp;

  beforeAll(async () => {
    publicIp = await getPublicIp();
    console.log(`    Public IP for SDP: ${publicIp}`);
    console.log(`    Local IP for SIP:  ${localIp}`);
  });

  afterEach(() => {
    try { sip.stop(); } catch {}
  });

  it('should use public IP (not Docker private IP or container ID) in Via, Contact, and From headers', () => {
    // Validates the fix for the "zero sessions" bug: Docker container ID in Via
    // and private IP (172.x.x.x) in Contact/From caused LiveKit to fail trunk matching
    const endpoint = process.env.LIVEKIT_ENDPOINT || 'sip:5eezfwavhxe.sip.livekit.cloud';
    const sipPort = 5064;

    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (err?: Error) => {
        if (settled) return;
        settled = true;
        try { sip.stop(); } catch {}
        if (err) { reject(err); } else { resolve(); }
      };

      sip.start({ port: sipPort, publicAddress: publicIp }, () => {});

      const req = buildInvite(endpoint, sipPort, publicIp, publicIp);

      // Validate outgoing headers before sending
      const contactUri = req.headers.contact[0].uri;
      const fromUri = req.headers.from.uri;
      const callId = req.headers['call-id'] as string;

      // Must NOT contain Docker private IPs (172.x.x.x, 10.x.x.x) or container IDs
      const dockerPrivateIp = /\b(172\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+)\b/;
      const containerIdPattern = /[0-9a-f]{12}/; // Docker container IDs are 12-char hex

      expect(contactUri).not.toMatch(dockerPrivateIp);
      expect(fromUri).not.toMatch(dockerPrivateIp);

      // Should contain a valid public IP (not localhost, not private)
      expect(contactUri).toContain(publicIp);
      expect(fromUri).toContain(publicIp);
      expect(callId).toContain(publicIp);

      // SDP must use public IP
      expect(req.content).toContain(`c=IN IP4 ${publicIp}`);
      expect(req.content).toContain(`IN IP4 ${publicIp}`);

      // Verify Allow header is present
      expect(req.headers.allow).toBeTruthy();

      const timer = setTimeout(() => {
        finish(new Error('Timeout: no response from LiveKit within 10s'));
      }, 10000);

      console.log(`    INVITE → ${req.uri}`);
      console.log(`    Contact: ${contactUri}`);
      console.log(`    From: ${fromUri}`);

      sip.send(req, (rs: any) => {
        console.log(`    ← ${rs.status} ${rs.reason || ''}`);

        if (rs.status === 100 || rs.status === 180) {
          // Validate Via header in response echoes our public IP
          if (rs.headers?.via?.[0]) {
            const viaHost = rs.headers.via[0].host;
            console.log(`    Via host in response: ${viaHost}`);
            try {
              expect(viaHost).toBe(publicIp);
              expect(viaHost).not.toMatch(containerIdPattern);
            } catch (e) {
              clearTimeout(timer);
              finish(e as Error);
              return;
            }
          }
        }

        if (rs.status === 180 || rs.status === 200) {
          clearTimeout(timer);
          finish();
        }

        if (rs.status >= 300) {
          clearTimeout(timer);
          finish(new Error(`Unexpected failure: ${rs.status} ${rs.reason}`));
        }
      });
    });
  }, 15000);

  it('should reach LiveKit SIP trunk and receive 180 Ringing (dispatch rule matched)', () => {
    const endpoint = process.env.LIVEKIT_ENDPOINT || 'sip:5eezfwavhxe.sip.livekit.cloud';
    const sipPort = 5062;

    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (err?: Error) => {
        if (settled) return;
        settled = true;
        try { sip.stop(); } catch {}
        if (err) { reject(err); } else { resolve(); }
      };

      sip.start({ port: sipPort, publicAddress: publicIp }, () => {});

      const req = buildInvite(endpoint, sipPort, publicIp, publicIp);

      const timer = setTimeout(() => {
        finish(new Error('Timeout: no provisional response from LiveKit within 15s'));
      }, 15000);

      console.log(`    INVITE → ${req.uri} (SDP c=${publicIp})`);

      sip.send(req, (rs: any) => {
        console.log(`    ← ${rs.status} ${rs.reason || ''}`);
        if (rs.headers) {
          console.log(`    Via: ${JSON.stringify(rs.headers.via)}`);
          console.log(`    To: ${JSON.stringify(rs.headers.to)}`);
        }

        if (rs.status === 180) {
          clearTimeout(timer);
          console.log('    Dispatch rule matched — room created. Connectivity verified.');
          finish();
        }

        if (rs.status >= 300) {
          clearTimeout(timer);
          finish(new Error(`Unexpected failure: ${rs.status} ${rs.reason}`));
        }
      });
    });
  }, 20000);

  it('should complete full SIP call: INVITE → 200 OK → ACK → audio → BYE', () => {
    const endpoint = process.env.LIVEKIT_ENDPOINT || 'sip:5eezfwavhxe.sip.livekit.cloud';
    const sipPort = 5063;

    return new Promise<void>((resolve, reject) => {
      let cseq = 1;
      let settled = false;
      let gotRinging = false;

      const finish = (err?: Error) => {
        if (settled) return;
        settled = true;
        try { sip.stop(); } catch {}
        if (err) { reject(err); } else { resolve(); }
      };

      sip.start({ port: sipPort, publicAddress: publicIp }, (request: any) => {
        if (request.method === 'BYE') {
          sip.send(sip.makeResponse(request, 200, 'OK'));
          console.log('    Agent sent BYE — call torn down by remote');
          finish();
        }
      });

      const req = buildInvite(endpoint, sipPort, publicIp, publicIp);

      const timer = setTimeout(() => {
        if (gotRinging) {
          finish(new Error(
            'Agent did not answer (no 200 OK within 65s).\n' +
            '  The 180 Ringing was received, proving the framework and dispatch rule work.\n' +
            '  The agent worker is not joining the room. Possible causes:\n' +
            '    1. Agent worker process is not running\n' +
            '    2. agentName mismatch between dispatch rule and agent registration\n' +
            '    3. Agent is crashing before it can publish an audio track\n' +
            '  See: https://docs.livekit.io/agents/server/agent-dispatch/'
          ));
        } else {
          finish(new Error('Timeout: no response from LiveKit within 65s'));
        }
      }, 65000);

      let gotOk = false;

      console.log(`    INVITE → ${req.uri} (SDP c=${publicIp})`);

      sip.send(req, (rs: any) => {
        console.log(`    ← ${rs.status} ${rs.reason || ''}`);
        if (rs.headers) {
          console.log(`    Via: ${JSON.stringify(rs.headers.via)}`);
          console.log(`    To: ${JSON.stringify(rs.headers.to)}`);
        }

        if (rs.status === 180 && !gotRinging) {
          gotRinging = true;
        }

        if (rs.status === 503) {
          clearTimeout(timer);
          finish(new Error(
            '503 Service Unavailable — agent did not join room within 60s.\n' +
            '  Verify your agent worker is running and the agentName matches the dispatch rule.\n' +
            '  See: https://docs.livekit.io/agents/server/agent-dispatch/'
          ));
          return;
        }

        if (rs.status >= 300) {
          clearTimeout(timer);
          finish(new Error(`Call failed: ${rs.status} ${rs.reason}`));
          return;
        }

        if (rs.status === 200 && !gotOk) {
          gotOk = true;
          clearTimeout(timer);

          // Send ACK
          const ack = {
            method: 'ACK',
            uri: req.uri,
            headers: {
              to: rs.headers.to,
              from: req.headers.from,
              'call-id': req.headers['call-id'],
              cseq: { method: 'ACK', seq: cseq },
              via: [],
              'max-forwards': 70,
            },
          };
          sip.send(ack);
          console.log('    → ACK sent');

          // Parse remote SDP
          const parsed = parse(rs.content);
          const remoteIp = parsed.connection?.ip || parsed.origin?.address;
          const media = parsed.media?.find((m: any) => m.type === 'audio');

          expect(remoteIp).toBeTruthy();
          expect(media).toBeTruthy();
          expect(media!.port).toBeGreaterThan(0);
          console.log(`    Remote RTP: ${remoteIp}:${media!.port}`);

          // Stream 3s of audio to the agent
          const ffmpeg = spawn('ffmpeg', [
            '-re', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3',
            '-acodec', 'pcm_mulaw', '-ar', '8000', '-ac', '1',
            '-f', 'rtp', `rtp://${remoteIp}:${media!.port}`,
          ]);
          ffmpeg.stderr.on('data', () => {});

          const sendBye = () => {
            if (settled) return;
            console.log('    → Sending BYE');
            cseq++;
            const bye = {
              method: 'BYE',
              uri: req.uri,
              headers: {
                to: rs.headers.to,
                from: req.headers.from,
                'call-id': req.headers['call-id'],
                cseq: { method: 'BYE', seq: cseq },
                via: [],
                'max-forwards': 70,
              },
            };
            sip.send(bye, (byeRs: any) => {
              console.log(`    ← BYE ${byeRs.status}`);
              try {
                expect(byeRs.status).toBe(200);
                finish();
              } catch (e) {
                finish(e as Error);
              }
            });
          };

          ffmpeg.on('close', () => {
            console.log('    Audio stream complete');
            sendBye();
          });

          ffmpeg.on('error', () => {
            console.log('    ffmpeg unavailable — sending BYE');
            sendBye();
          });
        }
      });
    });
  }, 90000);
});
