import { Server } from 'socket.io';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let io;

export function initSocketServer(httpServer) {
  io = new Server(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST']
    }
  });

  io.on('connection', (socket) => {
    console.log('Client connected to UI logging socket');
    let activeProcess = null;

    socket.on('start-test', (data) => {
      console.log('Starting test from UI:', data);

      // Kill any existing test process for this socket
      if (activeProcess) {
        activeProcess.kill();
        activeProcess = null;
      }

      // Encode params as base64 JSON for the sip-engine child process
      const params = {
        method: data.method || 'OPTIONS',
        uri: data.uri || 'sip:agent@example.com',
        transport: data.transport || 'auto',
        headers: data.headers || {},
        sdp: {
          codecs: data.codecs || ['opus', 'PCMU'],
          mediaPort: data.mediaPort || 10000,
          customSdp: data.customSdp || null,
        },
        audio: data.audio || { source: 'silence', duration: 5 },
        auth: data.auth || {},
      };

      const paramsB64 = Buffer.from(JSON.stringify(params)).toString('base64');
      const enginePath = path.join(__dirname, 'src', 'lib', 'sip-engine.mjs');

      socket.emit('log', {
        type: 'info',
        event: 'init',
        message: `Initiating ${params.method} to ${params.uri}...`,
        timestamp: Date.now(),
      });

      const testProcess = spawn('node', [enginePath, paramsB64], {
        cwd: __dirname,
      });
      activeProcess = testProcess;

      // Buffer partial lines from stdout
      let stdoutBuffer = '';
      testProcess.stdout.on('data', (chunk) => {
        stdoutBuffer += chunk.toString();
        const lines = stdoutBuffer.split('\n');
        // Keep the last incomplete line in the buffer
        stdoutBuffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line);
            socket.emit('log', event);
          } catch {
            // Non-JSON output — send as plain info
            socket.emit('log', { type: 'info', message: line.trim(), timestamp: Date.now() });
          }
        }
      });

      testProcess.stderr.on('data', (chunk) => {
        const msg = chunk.toString().trim();
        // Ignore known noisy errors from sip library disconnections
        if (msg.includes('Error: remote peer disconnected')) return;
        if (msg.includes('MaxListenersExceededWarning')) return;
        socket.emit('log', { type: 'error', message: msg, timestamp: Date.now() });
      });

      testProcess.on('close', (code) => {
        // Flush remaining buffer
        if (stdoutBuffer.trim()) {
          try {
            socket.emit('log', JSON.parse(stdoutBuffer));
          } catch {
            socket.emit('log', { type: 'info', message: stdoutBuffer.trim(), timestamp: Date.now() });
          }
        }
        activeProcess = null;
        socket.emit('test-complete', { code });
      });
    });

    socket.on('stop-test', () => {
      if (activeProcess) {
        activeProcess.kill();
        activeProcess = null;
        socket.emit('log', { type: 'system', message: 'Test stopped by user.', timestamp: Date.now() });
        socket.emit('test-complete', { code: -1 });
      }
    });

    socket.on('disconnect', () => {
      if (activeProcess) {
        activeProcess.kill();
        activeProcess = null;
      }
    });
  });

  return io;
}
