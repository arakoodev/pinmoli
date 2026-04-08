import { describe, it, expect } from 'vitest';
import { spawnSync } from 'child_process';
import dgram from 'dgram';
import {
  sendRTPFromSocket,
  receiveRTPAudio,
  parseRTPPacket,
} from '../../src/sip/rtp-receiver.js';
import { parseSdpAnswer } from '../../src/sip/sdp.js';
import { transcodePcmuTo } from '../../src/sip/codec.js';

/**
 * Loopback tests: exercises the full codec pipeline locally.
 * Sends RTP with the negotiated codec, receives with the correct filter,
 * verifies payload type and packet size are correct.
 *
 * No external endpoints needed — tests the real code path end-to-end.
 */

function hasFfmpeg(): boolean {
  const result = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' });
  return !result.error && result.status === 0;
}

const describeCodecLoopback = hasFfmpeg() ? describe : describe.skip;

describeCodecLoopback('Codec Pipeline Loopback', () => {
  it('PCMU: send and receive with correct PT=0', async () => {
    // Simulate SDP answer selecting PCMU
    const sdp = [
      'v=0', 'o=- 1 1 IN IP4 127.0.0.1', 's=-',
      'c=IN IP4 127.0.0.1', 't=0 0',
      'm=audio 20000 RTP/AVP 0 101',
      'a=rtpmap:0 PCMU/8000',
      'a=rtpmap:101 telephone-event/8000',
    ].join('\r\n');

    const { codec } = parseSdpAnswer(sdp, '127.0.0.1', 5060);
    expect(codec.name).toBe('PCMU');

    // Create loopback sockets
    const recvSocket = dgram.createSocket('udp4');
    await new Promise<void>(r => recvSocket.bind(0, r));
    const port = recvSocket.address().port;

    const sendSocket = dgram.createSocket('udp4');
    await new Promise<void>(r => sendSocket.bind(0, r));

    // Prepare PCMU audio (3 packets = 480 bytes)
    const pcmuData = Buffer.alloc(480, 0x7F);
    const sendData = transcodePcmuTo(pcmuData, codec);
    expect(sendData).toBe(pcmuData); // Identity for PCMU

    // Start receiver
    const recvPromise = receiveRTPAudio(recvSocket, 0.5, {
      acceptedPayloadTypes: [codec.payloadType],
    });

    // Send
    const result = await sendRTPFromSocket(sendSocket, sendData, '127.0.0.1', port, { codec });
    expect(result.packetsSent).toBe(3);

    const recv = await recvPromise;
    expect(recv.packetsReceived).toBe(3);
    expect(recv.audioData.length).toBe(3);

    recvSocket.close();
    sendSocket.close();
  });

  it('PCMA: transcode PCMU→PCMA, send with PT=8, receive with PCMA filter', async () => {
    // Simulate SDP answer selecting PCMA
    const sdp = [
      'v=0', 'o=- 1 1 IN IP4 127.0.0.1', 's=-',
      'c=IN IP4 127.0.0.1', 't=0 0',
      'm=audio 30000 RTP/AVP 8 101',
      'a=rtpmap:8 PCMA/8000',
      'a=rtpmap:101 telephone-event/8000',
    ].join('\r\n');

    const { codec } = parseSdpAnswer(sdp, '127.0.0.1', 5060);
    expect(codec.name).toBe('PCMA');
    expect(codec.payloadType).toBe(8);

    const recvSocket = dgram.createSocket('udp4');
    await new Promise<void>(r => recvSocket.bind(0, r));
    const port = recvSocket.address().port;

    const sendSocket = dgram.createSocket('udp4');
    await new Promise<void>(r => sendSocket.bind(0, r));

    // Prepare PCMU audio and transcode to PCMA
    const pcmuData = Buffer.alloc(480, 0x7F);
    const pcmaData = transcodePcmuTo(pcmuData, codec);
    expect(pcmaData).not.toBe(pcmuData); // Should be a new buffer
    expect(pcmaData.length).toBe(pcmuData.length); // Same size

    // Capture raw packets to verify PT
    const rawPackets: Buffer[] = [];
    const rawHandler = (msg: Buffer) => rawPackets.push(Buffer.from(msg));
    recvSocket.on('message', rawHandler);

    // Start receiver with PCMA filter
    const recvPromise = receiveRTPAudio(recvSocket, 0.5, {
      acceptedPayloadTypes: [8], // PCMA
    });

    // Send as PCMA
    const result = await sendRTPFromSocket(sendSocket, pcmaData, '127.0.0.1', port, { codec });
    expect(result.packetsSent).toBe(3);

    const recv = await recvPromise;
    recvSocket.off('message', rawHandler);

    // Verify packets were received
    expect(recv.packetsReceived).toBe(3);

    // Verify the RTP packets have PT=8
    for (const raw of rawPackets) {
      const parsed = parseRTPPacket(raw);
      if (parsed) {
        expect(parsed.payloadType).toBe(8);
      }
    }

    recvSocket.close();
    sendSocket.close();
  });

  it('PCMA receiver ignores PCMU packets', async () => {
    const recvSocket = dgram.createSocket('udp4');
    await new Promise<void>(r => recvSocket.bind(0, r));
    const port = recvSocket.address().port;

    const sendSocket = dgram.createSocket('udp4');
    await new Promise<void>(r => sendSocket.bind(0, r));

    // Start receiver that only accepts PCMA (PT=8)
    const recvPromise = receiveRTPAudio(recvSocket, 0.5, {
      acceptedPayloadTypes: [8],
    });

    // Send PCMU data (PT=0) — should be ignored by receiver
    const pcmuData = Buffer.alloc(480, 0x7F);
    await sendRTPFromSocket(sendSocket, pcmuData, '127.0.0.1', port);

    const recv = await recvPromise;
    expect(recv.packetsReceived).toBe(0); // All ignored

    recvSocket.close();
    sendSocket.close();
  });

  it('G722: parseSdpAnswer extracts G722, transcodePcmuTo returns different buffer', async () => {
    const sdp = [
      'v=0', 'o=- 1 1 IN IP4 127.0.0.1', 's=-',
      'c=IN IP4 127.0.0.1', 't=0 0',
      'm=audio 40000 RTP/AVP 9 101',
      'a=rtpmap:9 G722/8000',
      'a=rtpmap:101 telephone-event/8000',
    ].join('\r\n');

    const { codec } = parseSdpAnswer(sdp, '127.0.0.1', 5060);
    expect(codec.name).toBe('G722');
    expect(codec.payloadType).toBe(9);
    expect(codec.clockRate).toBe(8000);

    // G722 transcoding requires ffmpeg — test that it produces output
    const pcmuData = Buffer.alloc(480, 0x7F);
    const g722Data = transcodePcmuTo(pcmuData, codec);
    expect(g722Data.length).toBeGreaterThan(0);
    // G722 output should be different from input
    expect(g722Data).not.toEqual(pcmuData);
  });

  it('full pipeline: parse SDP → transcode → send → receive → verify PT', async () => {
    // This is the exact flow that engine.ts follows after 200 OK
    const sdpAnswer = [
      'v=0', 'o=- 999 1 IN IP4 10.0.0.1', 's=-',
      'c=IN IP4 10.0.0.1', 't=0 0',
      'm=audio 50000 RTP/AVP 8 0 101',
      'a=rtpmap:8 PCMA/8000',
      'a=rtpmap:0 PCMU/8000',
      'a=rtpmap:101 telephone-event/8000',
    ].join('\r\n');

    // Step 1: Parse SDP answer
    const { codec, remoteIp, remotePort } = parseSdpAnswer(sdpAnswer, '127.0.0.1', 5060);
    expect(codec.name).toBe('PCMA'); // First non-telephone-event codec
    expect(remoteIp).toBe('10.0.0.1');
    expect(remotePort).toBe(50000);

    // Step 2: Transcode PCMU → PCMA
    const pcmuData = Buffer.alloc(160, 0x7F); // 1 packet
    const sendData = transcodePcmuTo(pcmuData, codec);
    expect(sendData.length).toBe(160);

    // Step 3: Send with codec PT
    const recvSocket = dgram.createSocket('udp4');
    await new Promise<void>(r => recvSocket.bind(0, r));
    const port = recvSocket.address().port;

    const sendSocket = dgram.createSocket('udp4');
    await new Promise<void>(r => sendSocket.bind(0, r));

    const recvPromise = receiveRTPAudio(recvSocket, 0.3, {
      acceptedPayloadTypes: [codec.payloadType],
    });

    const streamState = await sendRTPFromSocket(sendSocket, sendData, '127.0.0.1', port, { codec });
    expect(streamState.packetsSent).toBe(1);

    // Step 4: Verify received
    const recv = await recvPromise;
    expect(recv.packetsReceived).toBe(1);
    expect(recv.audioData[0].length).toBe(160);

    recvSocket.close();
    sendSocket.close();
  });
});
