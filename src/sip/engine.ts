/**
 * SIP Test Engine
 * Executes SIP tests and streams events.
 *
 * INVITE: delegates to composable call-session phases (openDialog/sendAudio/receiveAudio/closeDialog).
 * OPTIONS/REGISTER: inline implementation.
 */

import dgram from 'dgram';
import { generateCallId, generateTag, buildOptionsRequest, buildRegisterRequest } from './protocol.js';
import { getAudioSamplePath, getLatestSessionSample } from './audio.js';
import { openDialog, sendAudio, receiveAudio, closeDialog } from './call-session.js';
import type { CallHandle } from './call-store.js';
import { createSession } from '../network/session.js';
import type { TestConfig, SipEvent, TestEvent } from '../validation/schemas.js';

/**
 * Execute a SIP test and stream events
 */
export async function* runSipTest(config: TestConfig): AsyncGenerator<SipEvent> {
  yield {
    type: 'info',
    timestamp: Date.now(),
    message: `Starting SIP ${config.method} test to ${config.uri}`
  };

  // INVITE uses composable call-session phases (shared with interactive tools)
  if (config.method === 'INVITE') {
    yield* runInviteComposable(config);
    return;
  }

  // OPTIONS / REGISTER — inline implementation
  yield* runSimpleMethod(config);
}

/**
 * INVITE path: composable call-session phases.
 * openDialog → receiveAudio (greeting) → sendAudio → receiveAudio (response) → closeDialog
 */
async function* runInviteComposable(config: TestConfig): AsyncGenerator<SipEvent> {
  const collected: TestEvent[] = [];
  const emit = (ev: TestEvent) => { collected.push(ev); };
  let handle: CallHandle | undefined;

  try {
    handle = await openDialog({
      uri: config.uri,
      codecs: config.codecs,
      timeout: config.timeout,
      mediaPort: config.mediaPort === 10000 ? 0 : config.mediaPort,
    }, emit);

    for (const ev of collected) yield ev;
    collected.length = 0;

    // Resolve audio sample: explicit → latest session-generated → built-in voice-hello
    const sample = config.audioSample || getLatestSessionSample() || 'voice-hello';
    const samplePath = getAudioSamplePath(sample);

    const sendDelay = config.sendDelay ?? 0;
    const waitTime = config.responseWaitTime ?? 10;

    // Phase 1: Listen for agent greeting (if sendDelay > 0)
    if (sendDelay > 0) {
      await receiveAudio(handle, sendDelay, emit);
      for (const ev of collected) yield ev;
      collected.length = 0;
    }

    // Phase 2: Send audio + DTMF
    if (samplePath) {
      await sendAudio(handle, samplePath, emit, config.dtmfDigits);
      for (const ev of collected) yield ev;
      collected.length = 0;
    } else {
      yield {
        type: 'info',
        timestamp: Date.now(),
        message: `Audio sample not found: ${sample} — skipping send`
      };
    }

    // Phase 3: Listen for agent response AFTER send completes
    await receiveAudio(handle, waitTime, emit);
    for (const ev of collected) yield ev;
    collected.length = 0;

    // DTMF detection summary
    if (handle.dtmfDetector.digits) {
      for (const det of handle.dtmfDetector.allDetections) {
        yield {
          type: 'dtmf',
          timestamp: Date.now(),
          message: `Received DTMF digit: ${det.digit}`,
          dtmfDigit: det.digit,
          dtmfDuration: det.duration,
        };
      }
      yield {
        type: 'info',
        timestamp: Date.now(),
        message: `Detected incoming DTMF: ${handle.dtmfDetector.digits}`
      };
    }

    const totalTime = sendDelay + waitTime;
    yield {
      type: 'info',
      timestamp: Date.now(),
      message: sendDelay > 0
        ? `Call was active for ${totalTime}s (${sendDelay}s greeting + ${waitTime}s response)`
        : `Call was active for ${waitTime}s`
    };

    // Close dialog (BYE + cleanup)
    await closeDialog(handle, emit);
    for (const ev of collected) yield ev;
    collected.length = 0;

    // Write session metadata
    const duration = Date.now() - handle.createdAt;
    handle.session.writeMetadata({
      session: handle.session.name,
      config: { uri: config.uri, method: config.method, codecs: config.codecs, transport: config.transport },
      startTime: new Date(handle.createdAt).toISOString(),
      duration,
      succeeded: true,
      timedOut: false,
      publicIp: handle.publicIp,
      rtpPort: handle.rtpPort,
    });

    yield {
      type: 'info',
      timestamp: Date.now(),
      message: `Test completed successfully in ${duration}ms — session: ${handle.session.dir}`
    };

  } catch (error) {
    // Yield any buffered events
    for (const ev of collected) yield ev;
    collected.length = 0;

    // Clean up if handle was created
    if (handle && handle.state !== 'terminated') {
      try { await closeDialog(handle, () => {}); } catch { /* best effort */ }
    }

    const msg = error instanceof Error ? error.message : String(error);
    const isTimeout = msg.includes('timeout');
    const isUnanswered = msg.includes('not answered');

    if (isUnanswered) {
      yield {
        type: 'error',
        timestamp: Date.now(),
        message: `INVITE not answered within ${config.timeout}ms`,
        severity: 'error',
        code: 'INVITE_UNANSWERED',
        recovery: 'Voice agent may not be running or dispatch rule is not matching. Check agent deployment and dispatch rules.'
      };
      yield {
        type: 'sip',
        timestamp: Date.now(),
        message: 'Sent CANCEL (unanswered INVITE)',
        method: 'CANCEL'
      };
    } else {
      yield {
        type: 'error',
        timestamp: Date.now(),
        message: msg,
        severity: 'fatal',
        code: isTimeout ? 'TIMEOUT' : 'SIP_ERROR',
        recovery: 'Check network connectivity and SIP server configuration'
      };
    }
  }
}

/**
 * OPTIONS / REGISTER — simple request/response (no dialog, no media).
 */
async function* runSimpleMethod(config: TestConfig): AsyncGenerator<SipEvent> {
  try {
    // Parse SIP URI
    const uriMatch = config.uri.match(/^sips?:([^@]+@)?([^:;]+)(:(\d+))?/);
    if (!uriMatch) throw new Error('Invalid SIP URI format');

    const host = uriMatch[2];
    const port = parseInt(uriMatch[4] || '5060');

    const session = createSession('sip', config.method, host);

    yield {
      type: 'info',
      timestamp: Date.now(),
      message: `Resolved: ${host}:${port} — session: ${session.name}`
    };

    const sipSocket = dgram.createSocket('udp4');
    const rtpSocket = dgram.createSocket('udp4');

    const { stunDiscoverAddress } = await import('../network/utils.js');

    // Bind sockets
    await new Promise<void>((resolve, reject) => {
      sipSocket.once('error', reject);
      sipSocket.bind(0, () => { sipSocket.removeListener('error', reject); resolve(); });
    });
    const sipPort = sipSocket.address().port;

    await new Promise<void>((resolve, reject) => {
      rtpSocket.once('error', reject);
      rtpSocket.bind(0, () => { rtpSocket.removeListener('error', reject); resolve(); });
    });

    const rtpStun = await stunDiscoverAddress(rtpSocket);
    const publicIp = rtpStun.ip;
    const rtpPort = rtpStun.port;

    yield {
      type: 'info',
      timestamp: Date.now(),
      message: `Public IP: ${publicIp}, RTP mapped to ${publicIp}:${rtpPort} (STUN), SIP via rport on local :${sipPort}`
    };

    // Build SIP request
    const callId = generateCallId();
    const fromTag = generateTag();
    const branch = `z9hG4bK${generateTag()}`;

    let sipMessage = '';
    if (config.method === 'OPTIONS') {
      sipMessage = buildOptionsRequest(config.uri, host, port, callId, fromTag, branch, publicIp, sipPort);
    } else if (config.method === 'REGISTER') {
      sipMessage = buildRegisterRequest(config.uri, host, port, callId, fromTag, branch, publicIp, sipPort);
    }

    session.logSignaling('>>>', `SENT ${config.method}`, sipMessage);

    yield {
      type: 'sip',
      timestamp: Date.now(),
      message: `Sending ${config.method} request...`,
      method: config.method,
      rawMessage: sipMessage
    };

    // Send request and wait for response
    const startTime = Date.now();
    const responses: Array<{ statusCode: number; statusText: string; response: string; receivedAt: number }> = [];

    let socketClosed = false;
    const safeClose = () => {
      if (!socketClosed) {
        socketClosed = true;
        try { sipSocket.close(); } catch (_e) { /* already closed */ }
        try { rtpSocket.close(); } catch (_e) { /* already closed */ }
      }
    };

    let timedOut = false;

    await new Promise<void>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        timedOut = true;
        if (responses.length === 0) {
          safeClose();
          reject(new Error('Request timeout'));
        } else {
          safeClose();
          resolve();
        }
      }, config.timeout);

      sipSocket.on('message', (msg) => {
        const response = msg.toString();
        const statusMatch = response.match(/SIP\/2\.0 (\d+) (.+)/);

        if (statusMatch) {
          const statusCode = parseInt(statusMatch[1]);
          const statusText = statusMatch[2].trim();

          responses.push({ statusCode, statusText, response, receivedAt: Date.now() });
          session.logSignaling('<<<', `RECEIVED ${statusCode} ${statusText}`, response);

          if (statusCode >= 200) {
            clearTimeout(timeoutId);
            safeClose();
            resolve();
          }
        }
      });

      sipSocket.on('error', (err) => {
        clearTimeout(timeoutId);
        safeClose();
        reject(err);
      });

      sipSocket.send(sipMessage, port, host, (err) => {
        if (err) { clearTimeout(timeoutId); safeClose(); reject(err); }
      });
    });

    // Yield responses
    for (const resp of responses) {
      yield {
        type: 'sip',
        timestamp: resp.receivedAt,
        message: `Received ${resp.statusCode} ${resp.statusText}`,
        status: resp.statusCode,
        rawMessage: resp.response
      };

      // Parse SDP if present
      if (resp.statusCode >= 200 && resp.response.includes('Content-Type: application/sdp')) {
        const sdpMatch = resp.response.match(/v=0[\s\S]+/);
        if (sdpMatch) {
          yield {
            type: 'info',
            timestamp: Date.now(),
            message: 'SDP answer received',
            sdpAnswer: sdpMatch[0]
          };
        }
      }
    }

    const duration = Date.now() - startTime;
    const succeeded = responses.some(r => r.statusCode >= 200 && r.statusCode < 300);

    session.writeMetadata({
      session: session.name,
      config: { uri: config.uri, method: config.method, codecs: config.codecs, transport: config.transport },
      startTime: new Date(startTime).toISOString(),
      duration,
      succeeded,
      timedOut,
      responses: responses.map(r => ({ status: r.statusCode, text: r.statusText })),
      publicIp,
      rtpPort,
    });

    yield {
      type: succeeded ? 'info' : 'error',
      timestamp: Date.now(),
      message: succeeded
        ? `Test completed successfully in ${duration}ms — session: ${session.dir}`
        : `Test failed after ${duration}ms — session: ${session.dir}`,
      ...(succeeded ? {} : { severity: 'error' as const, code: timedOut ? 'TIMEOUT' : 'NO_SUCCESS_RESPONSE' })
    };

  } catch (error) {
    yield {
      type: 'error',
      timestamp: Date.now(),
      message: error instanceof Error ? error.message : String(error),
      severity: 'fatal',
      code: 'SIP_ERROR',
      recovery: 'Check network connectivity and SIP server configuration'
    };
  }
}
