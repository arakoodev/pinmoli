/**
 * Unified SIP test engine — accepts parameterized input from the UI
 * and streams structured events back via stdout (parsed by server.mjs).
 *
 * Usage: node src/lib/sip-engine.mjs <json-params-base64>
 */
import sip from 'sip';
import { parse as parseSdp } from 'sdp-transform';
import { spawn } from 'child_process';
import http from 'http';
import os from 'os';

// ── Helpers ──────────────────────────────────────────────────────────

function getLocalIp() {
  const interfaces = os.networkInterfaces();
  for (const name in interfaces) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return '127.0.0.1';
}

function getPublicIp() {
  return new Promise((resolve) => {
    http.get('http://ifconfig.me/ip', { timeout: 5000 }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve(data.trim()));
    }).on('error', () => resolve(getLocalIp()));
  });
}

function emit(event) {
  process.stdout.write(JSON.stringify(event) + '\n');
}

// ── Custom Header Merging ────────────────────────────────────────────
// Never allow custom headers to overwrite transaction-critical fields.
// This prevents the bug where ...customHeaders silently destroys to/from/cseq.
const SIP_RESERVED_HEADERS = new Set([
  'to', 'from', 'call-id', 'cseq', 'contact', 'via', 'max-forwards',
]);

function mergeCustomHeaders(baseHeaders, customHeaders) {
  const merged = { ...baseHeaders };
  for (const [key, value] of Object.entries(customHeaders)) {
    if (SIP_RESERVED_HEADERS.has(key.toLowerCase())) {
      emit({
        type: 'diagnostic',
        severity: 'warning',
        message: `Custom header "${key}" ignored — overwriting transaction-critical SIP headers is not allowed.`,
        timestamp: Date.now(),
      });
      continue;
    }
    merged[key] = value;
  }
  return merged;
}

// ── SDP Builder ──────────────────────────────────────────────────────

function buildSdp(publicIp, mediaPort, codecs) {
  const lines = [
    'v=0',
    `o=PostmanForVoice ${Date.now()} ${Date.now()} IN IP4 ${publicIp}`,
    's=-',
    `c=IN IP4 ${publicIp}`,
    't=0 0',
  ];

  const payloadTypes = [];
  const rtpmapLines = [];

  if (codecs.includes('opus')) {
    payloadTypes.push(111);
    rtpmapLines.push('a=rtpmap:111 opus/48000/2');
    rtpmapLines.push('a=fmtp:111 minptime=10;useinbandfec=1');
  }
  if (codecs.includes('PCMU')) {
    payloadTypes.push(0);
    rtpmapLines.push('a=rtpmap:0 PCMU/8000');
  }
  if (codecs.includes('PCMA')) {
    payloadTypes.push(8);
    rtpmapLines.push('a=rtpmap:8 PCMA/8000');
  }
  if (codecs.includes('G722')) {
    payloadTypes.push(9);
    rtpmapLines.push('a=rtpmap:9 G722/8000');
  }

  // Always include telephone-event
  payloadTypes.push(101);
  rtpmapLines.push('a=rtpmap:101 telephone-event/8000');

  lines.push(`m=audio ${mediaPort} RTP/AVP ${payloadTypes.join(' ')}`);
  lines.push(...rtpmapLines);
  lines.push('a=sendrecv');

  return lines.join('\r\n') + '\r\n';
}

// ── SDP CRLF Normalization ───────────────────────────────────────────
// Browser textareas produce LF (\n). SDP requires CRLF (\r\n) per RFC 4566.
function normalizeSdpLineEndings(sdp) {
  // First strip any existing \r to avoid double-CR, then replace all \n with \r\n
  return sdp.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');
}

// ── Audio Streaming ──────────────────────────────────────────────────

function streamAudio(source, remoteIp, remotePort, opts = {}) {
  return new Promise((resolve, reject) => {
    let ffmpegArgs;

    switch (source) {
      case 'tone':
        ffmpegArgs = [
          '-re', '-f', 'lavfi',
          '-i', `sine=frequency=${opts.frequency || 1000}:duration=${opts.duration || 5}`,
          '-acodec', 'pcm_mulaw', '-ar', '8000', '-ac', '1',
          '-f', 'rtp', `rtp://${remoteIp}:${remotePort}`,
        ];
        break;

      case 'tts': {
        // Generate wav first, then stream
        const espeak = spawn('espeak-ng', ['-w', '/tmp/tts-prompt.wav', opts.text || 'Hello']);
        espeak.on('close', () => {
          const ff = spawn('ffmpeg', [
            '-re', '-i', '/tmp/tts-prompt.wav',
            '-acodec', 'pcm_mulaw', '-ar', '8000', '-ac', '1',
            '-f', 'rtp', `rtp://${remoteIp}:${remotePort}`,
          ]);
          ff.on('close', (code) => resolve(code));
          ff.on('error', reject);
        });
        espeak.on('error', reject);
        return;
      }

      case 'file':
        ffmpegArgs = [
          '-re', '-i', opts.filePath,
          '-acodec', 'pcm_mulaw', '-ar', '8000', '-ac', '1',
          '-f', 'rtp', `rtp://${remoteIp}:${remotePort}`,
        ];
        break;

      case 'silence':
      default:
        ffmpegArgs = [
          '-re', '-f', 'lavfi',
          '-i', 'anullsrc=r=8000:cl=mono',
          '-t', String(opts.duration || 5),
          '-acodec', 'pcm_mulaw', '-ar', '8000', '-ac', '1',
          '-f', 'rtp', `rtp://${remoteIp}:${remotePort}`,
        ];
        break;
    }

    const ff = spawn('ffmpeg', ffmpegArgs);
    ff.on('close', (code) => resolve(code));
    ff.on('error', reject);
  });
}

// ── Diagnostic Analysis ──────────────────────────────────────────────

const UNROUTABLE_RE = /^0\.0\.0\.0$/;
const PRIVATE_IP_RE = /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/;

function analyzeSipMessage(direction, msg) {
  const insights = [];

  if (msg.headers) {
    // Check Via header for hostname instead of IP
    const via = msg.headers.via;
    if (via && Array.isArray(via)) {
      for (const v of via) {
        if (v.host && !/^\d+\.\d+\.\d+\.\d+$/.test(v.host)) {
          insights.push({
            severity: 'error',
            message: `Via header contains hostname "${v.host}" instead of IP. SIP stack may be using os.hostname(). Pass publicAddress to sip.start().`,
          });
        }
        if (v.host && PRIVATE_IP_RE.test(v.host)) {
          insights.push({
            severity: 'warning',
            message: `Via header contains private IP ${v.host}. Remote platform may not be able to route responses.`,
          });
        }
      }
    }

    // Check Contact header for private IP
    const contact = msg.headers.contact;
    if (contact && Array.isArray(contact)) {
      for (const c of contact) {
        const uriMatch = c.uri && c.uri.match(/@(\d+\.\d+\.\d+\.\d+)/);
        if (uriMatch && PRIVATE_IP_RE.test(uriMatch[1])) {
          insights.push({
            severity: 'warning',
            message: `Contact URI "${c.uri}" contains private IP. Unreachable from remote platform.`,
          });
        }
      }
    }
  }

  // Check SDP content for unroutable IPs
  if (msg.content) {
    const connMatch = msg.content.match(/c=IN IP4 (\S+)/);
    if (connMatch) {
      if (UNROUTABLE_RE.test(connMatch[1])) {
        insights.push({
          severity: 'error',
          message: `SDP connection address is ${connMatch[1]} (unroutable) — media negotiation will fail silently.`,
        });
      } else if (PRIVATE_IP_RE.test(connMatch[1])) {
        insights.push({
          severity: 'warning',
          message: `SDP connection address is a private IP (${connMatch[1]}). Media may be unreachable from remote.`,
        });
      }
    }
  }

  return insights;
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  // Parse params from command line (base64 JSON)
  const paramsJson = Buffer.from(process.argv[2] || 'e30=', 'base64').toString();
  const params = JSON.parse(paramsJson);

  const {
    method = 'OPTIONS',
    uri = 'sip:agent@example.com',
    headers: customHeaders = {},
    sdp: sdpConfig = {},
    audio = {},
  } = params;

  const codecs = sdpConfig.codecs || ['opus', 'PCMU'];
  const mediaPort = sdpConfig.mediaPort || 10000;
  const customSdp = sdpConfig.customSdp || null;

  const publicIp = await getPublicIp();
  const localIp = getLocalIp();
  const startTime = Date.now();

  emit({
    type: 'info',
    event: 'init',
    message: `Public IP: ${publicIp} | Local IP: ${localIp}`,
    timestamp: Date.now(),
  });

  // FIX: Use fixed port matching Docker port exposure (5060).
  // Random ports produce Contact headers advertising unreachable endpoints.
  const sipPort = 5060;

  sip.start({ port: sipPort, publicAddress: publicIp }, (request) => {
    if (request.method === 'BYE') {
      sip.send(sip.makeResponse(request, 200, 'OK'));
      emit({
        type: 'sip',
        event: 'receive',
        direction: 'in',
        method: 'BYE',
        timestamp: Date.now(),
        elapsed: Date.now() - startTime,
      });
      emit({
        type: 'sip',
        event: 'send',
        direction: 'out',
        status: 200,
        reason: 'OK',
        method: 'BYE',
        timestamp: Date.now(),
        elapsed: Date.now() - startTime,
      });
      emit({ type: 'info', event: 'complete', message: 'Remote ended the call.' });
      setTimeout(() => process.exit(0), 500);
    }
  });

  emit({
    type: 'info',
    event: 'start',
    message: `Sending ${method} to ${uri}`,
    timestamp: Date.now(),
  });

  // ── OPTIONS ────────────────────────────────────────────────────────
  if (method === 'OPTIONS') {
    const baseHeaders = {
      to: { uri },
      from: { uri: `sip:test@${publicIp}`, params: { tag: String(Date.now()) } },
      'call-id': `${Date.now()}@${publicIp}`,
      cseq: { method: 'OPTIONS', seq: 1 },
      contact: [{ uri: `sip:test@${publicIp}:${sipPort}` }],
      'max-forwards': 70,
      'user-agent': 'PostmanForVoice/1.0',
    };

    const req = {
      method: 'OPTIONS',
      uri,
      headers: mergeCustomHeaders(baseHeaders, customHeaders),
    };

    emit({
      type: 'sip',
      event: 'send',
      direction: 'out',
      method: 'OPTIONS',
      uri,
      headers: req.headers,
      timestamp: Date.now(),
      elapsed: 0,
    });

    sip.send(req, (rs) => {
      emit({
        type: 'sip',
        event: 'receive',
        direction: 'in',
        status: rs.status,
        reason: rs.reason,
        headers: rs.headers,
        timestamp: Date.now(),
        elapsed: Date.now() - startTime,
      });
      emit({ type: 'info', event: 'complete', message: `OPTIONS completed: ${rs.status} ${rs.reason}` });
      setTimeout(() => process.exit(0), 500);
    });

    setTimeout(() => {
      emit({ type: 'error', event: 'timeout', message: 'No response after 10s' });
      process.exit(1);
    }, 10000);
    return;
  }

  // ── REGISTER ───────────────────────────────────────────────────────
  if (method === 'REGISTER') {
    const host = uri.replace(/^sip:/, '');
    const baseHeaders = {
      to: { uri: `sip:${params.auth?.username || 'user'}@${host}` },
      from: { uri: `sip:${params.auth?.username || 'user'}@${host}`, params: { tag: String(Date.now()) } },
      'call-id': `${Date.now()}@${publicIp}`,
      cseq: { method: 'REGISTER', seq: 1 },
      contact: [{ uri: `sip:${params.auth?.username || 'user'}@${publicIp}:${sipPort}`, params: { expires: 3600 } }],
      'max-forwards': 70,
      'user-agent': 'PostmanForVoice/1.0',
      expires: 3600,
    };

    const req = {
      method: 'REGISTER',
      uri,
      headers: mergeCustomHeaders(baseHeaders, customHeaders),
    };

    emit({
      type: 'sip',
      event: 'send',
      direction: 'out',
      method: 'REGISTER',
      uri,
      headers: req.headers,
      timestamp: Date.now(),
      elapsed: 0,
    });

    sip.send(req, (rs) => {
      emit({
        type: 'sip',
        event: 'receive',
        direction: 'in',
        status: rs.status,
        reason: rs.reason,
        headers: rs.headers,
        timestamp: Date.now(),
        elapsed: Date.now() - startTime,
      });

      if (rs.status === 401 && rs.headers['www-authenticate']) {
        emit({
          type: 'info',
          event: 'auth-required',
          message: 'Server requires authentication (401). Provide credentials in the Auth tab.',
          details: rs.headers['www-authenticate'],
        });
      }

      emit({ type: 'info', event: 'complete', message: `REGISTER completed: ${rs.status} ${rs.reason}` });
      setTimeout(() => process.exit(0), 500);
    });

    setTimeout(() => {
      emit({ type: 'error', event: 'timeout', message: 'No response after 10s' });
      process.exit(1);
    }, 10000);
    return;
  }

  // ── INVITE ─────────────────────────────────────────────────────────
  if (method === 'INVITE') {
    // FIX: Normalize custom SDP line endings (textarea gives LF, SDP requires CRLF)
    const sdpContent = customSdp
      ? normalizeSdpLineEndings(customSdp)
      : buildSdp(publicIp, mediaPort, codecs);
    const callId = `${Date.now()}@${publicIp}`;

    const baseHeaders = {
      to: { uri },
      from: { uri: `sip:test-runner@${publicIp}`, params: { tag: String(Date.now()) } },
      'call-id': callId,
      cseq: { method: 'INVITE', seq: 1 },
      contact: [{ uri: `sip:test-runner@${publicIp}:${sipPort}` }],
      'max-forwards': 70,
      'user-agent': 'PostmanForVoice/1.0',
      'content-type': 'application/sdp',
      allow: 'INVITE, ACK, BYE, CANCEL, OPTIONS',
    };

    const req = {
      method: 'INVITE',
      uri,
      headers: mergeCustomHeaders(baseHeaders, customHeaders),
      content: sdpContent,
    };

    // Emit outbound INVITE with offer SDP
    emit({
      type: 'sip',
      event: 'send',
      direction: 'out',
      method: 'INVITE',
      uri,
      headers: req.headers,
      sdpOffer: sdpContent,
      timestamp: Date.now(),
      elapsed: 0,
    });

    // Check our own outbound message for issues
    const outboundInsights = analyzeSipMessage('out', req);
    for (const insight of outboundInsights) {
      emit({ type: 'diagnostic', ...insight, timestamp: Date.now() });
    }

    // FIX: CSeq counter management.
    // ACK reuses the INVITE's CSeq (1). Do NOT increment before ACK.
    // BYE gets the next sequential CSeq (2).
    let cseqCounter = 1;
    let hasRung = false;
    let answered = false;

    sip.send(req, (rs) => {
      const elapsed = Date.now() - startTime;

      // Analyze inbound response
      const insights = analyzeSipMessage('in', rs);
      for (const insight of insights) {
        emit({ type: 'diagnostic', ...insight, timestamp: Date.now() });
      }

      if (rs.status === 100) {
        emit({
          type: 'sip',
          event: 'receive',
          direction: 'in',
          status: 100,
          reason: 'Trying',
          headers: rs.headers,
          timestamp: Date.now(),
          elapsed,
        });
      } else if (rs.status === 180 && !hasRung) {
        hasRung = true;
        emit({
          type: 'sip',
          event: 'receive',
          direction: 'in',
          status: 180,
          reason: 'Ringing',
          headers: rs.headers,
          timestamp: Date.now(),
          elapsed,
        });
      } else if (rs.status === 200 && !answered) {
        answered = true;

        emit({
          type: 'sip',
          event: 'receive',
          direction: 'in',
          status: 200,
          reason: 'OK',
          headers: rs.headers,
          sdpAnswer: rs.content || null,
          timestamp: Date.now(),
          elapsed,
        });

        // Send ACK — ACK reuses the INVITE's CSeq number (no increment)
        const ack = {
          method: 'ACK',
          uri: req.uri,
          headers: {
            to: rs.headers.to,
            from: req.headers.from,
            'call-id': req.headers['call-id'],
            cseq: { method: 'ACK', seq: cseqCounter },
            via: [],
            'max-forwards': 70,
          },
        };
        sip.send(ack);

        emit({
          type: 'sip',
          event: 'send',
          direction: 'out',
          method: 'ACK',
          timestamp: Date.now(),
          elapsed: Date.now() - startTime,
        });

        // Parse answer SDP for media endpoint
        let remoteIp, remotePort;
        if (rs.content) {
          try {
            const parsed = parseSdp(rs.content);
            remoteIp = parsed.connection?.ip || parsed.origin?.address;
            const media = parsed.media?.find((m) => m.type === 'audio');
            remotePort = media?.port;

            // SDP analysis
            if (remoteIp && PRIVATE_IP_RE.test(remoteIp)) {
              emit({
                type: 'diagnostic',
                severity: 'warning',
                message: `Remote SDP has private IP ${remoteIp} — media may be unreachable`,
                timestamp: Date.now(),
              });
            }

            // Report negotiated codec
            if (media?.rtp) {
              const negotiated = media.rtp.map((r) => `${r.codec}/${r.rate}`).join(', ');
              emit({
                type: 'info',
                event: 'codec-negotiated',
                message: `Codecs negotiated: ${negotiated}`,
                timestamp: Date.now(),
              });
            }

            emit({
              type: 'info',
              event: 'media-established',
              message: `Media endpoint: ${remoteIp}:${remotePort}`,
              timestamp: Date.now(),
            });
          } catch (e) {
            emit({ type: 'error', event: 'sdp-parse-error', message: `Failed to parse answer SDP: ${e.message}` });
          }
        }

        // Stream audio if we have a media endpoint
        if (remoteIp && remotePort) {
          const audioSource = audio.source || 'silence';
          emit({
            type: 'info',
            event: 'audio-start',
            message: `Streaming audio (${audioSource}) to ${remoteIp}:${remotePort}`,
            timestamp: Date.now(),
          });

          streamAudio(audioSource, remoteIp, remotePort, {
            frequency: audio.frequency,
            duration: audio.duration || 5,
            text: audio.ttsText,
            filePath: audio.filePath,
          }).then(() => {
            emit({
              type: 'info',
              event: 'audio-complete',
              message: 'Audio streaming complete. Sending BYE.',
              timestamp: Date.now(),
            });

            // Send BYE — increment CSeq ONCE (from 1 → 2)
            cseqCounter++;
            const bye = {
              method: 'BYE',
              uri: req.uri,
              headers: {
                to: rs.headers.to,
                from: req.headers.from,
                'call-id': req.headers['call-id'],
                cseq: { method: 'BYE', seq: cseqCounter },
                via: [],
                'max-forwards': 70,
              },
            };
            sip.send(bye);

            emit({
              type: 'sip',
              event: 'send',
              direction: 'out',
              method: 'BYE',
              timestamp: Date.now(),
              elapsed: Date.now() - startTime,
            });

            setTimeout(() => {
              emit({ type: 'info', event: 'complete', message: 'Call completed.' });
              process.exit(0);
            }, 2000);
          });
        } else {
          // No media to stream — just hang up after a short wait
          setTimeout(() => {
            cseqCounter++;
            sip.send({
              method: 'BYE',
              uri: req.uri,
              headers: {
                to: rs.headers.to,
                from: req.headers.from,
                'call-id': req.headers['call-id'],
                cseq: { method: 'BYE', seq: cseqCounter },
                via: [],
                'max-forwards': 70,
              },
            });
            emit({
              type: 'sip',
              event: 'send',
              direction: 'out',
              method: 'BYE',
              timestamp: Date.now(),
              elapsed: Date.now() - startTime,
            });
            emit({ type: 'info', event: 'complete', message: 'Call completed (no media).' });
            setTimeout(() => process.exit(0), 1000);
          }, 2000);
        }
      } else if (rs.status === 503) {
        emit({
          type: 'sip',
          event: 'receive',
          direction: 'in',
          status: 503,
          reason: 'Service Unavailable',
          headers: rs.headers,
          timestamp: Date.now(),
          elapsed,
        });
        emit({
          type: 'diagnostic',
          severity: 'error',
          message: 'Received 503 — remote platform dropped the connection. Possible causes: (1) Agent worker not running, (2) ACK not sent after 200 OK, (3) agent timeout after 60s. Note: the sip library generates a synthetic 503 when the remote peer disconnects.',
          timestamp: Date.now(),
        });

        if (hasRung) {
          emit({
            type: 'diagnostic',
            severity: 'error',
            message: '180 Ringing was received before 503 — the platform created a room but the agent never joined within the timeout. Check agent deployment and dispatch rule configuration.',
            timestamp: Date.now(),
          });
        }

        emit({ type: 'info', event: 'complete', message: 'Call failed.' });
        setTimeout(() => process.exit(1), 500);
      } else if (rs.status >= 300) {
        emit({
          type: 'sip',
          event: 'receive',
          direction: 'in',
          status: rs.status,
          reason: rs.reason || '',
          headers: rs.headers,
          timestamp: Date.now(),
          elapsed,
        });
        emit({ type: 'info', event: 'complete', message: `Call failed: ${rs.status} ${rs.reason}` });
        setTimeout(() => process.exit(1), 500);
      }
    });

    // Timeout after 70s
    setTimeout(() => {
      emit({ type: 'error', event: 'timeout', message: 'No final response after 70s' });
      process.exit(1);
    }, 70000);
  }
}

main().catch((err) => {
  emit({ type: 'error', event: 'fatal', message: err.message });
  process.exit(1);
});
