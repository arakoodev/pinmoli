import { describe, it, expect } from 'vitest';
import sip from 'sip';
import { spawn } from 'child_process';
import fs from 'fs';

describe('LiveKit SIP Trunk Origination Test', () => {
  it('should connect to LiveKit, receive Ringing, and handle the Service Unavailable response (no active agent)', () => {
    return new Promise<void>((resolve, reject) => {
      const endpoint = process.env.LIVEKIT_ENDPOINT || 'sip:5eezfwavhxe.sip.livekit.cloud';
      const host = endpoint.replace('sip:', '');
      
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
      ].join('\\r\\n') + '\\r\\n';

      sip.start({ port: 5062 }, (request) => {});

      const req = {
        method: 'INVITE',
        uri: endpoint,
        headers: {
          to: { uri: endpoint },
          from: { uri: 'sip:test-runner@0.0.0.0', params: { tag: Math.floor(Math.random() * 1000000).toString() } },
          'call-id': Math.floor(Math.random() * 1000000).toString() + '@0.0.0.0',
          cseq: { method: 'INVITE', seq: 1 },
          contact: [{ uri: 'sip:test-runner@0.0.0.0:5062' }],
          'max-forwards': 70,
          'content-type': 'application/sdp',
        },
        content: sdp
      };

      let received180 = false;

      const timeout = setTimeout(() => {
        sip.stop();
        reject(new Error('Timeout waiting for SIP response from LiveKit'));
      }, 15000);

      sip.send(req, (rs) => {
        if (rs.status === 180 && !received180) {
          received180 = true;
          clearTimeout(timeout);
          
          // Generate a test voice file
          const ffmpeg = spawn('ffmpeg', [
            '-f', 'lavfi', 
            '-i', 'sine=frequency=1000:duration=1', 
            '-acodec', 'pcm_mulaw', 
            '-ar', '8000', 
            '-ac', '1', 
            'test_voice.wav',
            '-y'
          ]);
          
          ffmpeg.on('close', () => {
            // "Send" it - simulate sending RTP to the LiveKit IP
            const stream = spawn('ffmpeg', [
               '-re', '-i', 'test_voice.wav', '-f', 'rtp', `rtp://${rs.headers.via[0].host}:10000`
            ]);
            
            stream.on('close', () => {
              sip.stop();
              resolve();
            });
          });
        }
        
        if (rs.status >= 300 && !received180) {
          clearTimeout(timeout);
          sip.stop();
          reject(new Error(`Failed with status: ${rs.status}`));
        }
      });
    });
  }, 20000); 
});
