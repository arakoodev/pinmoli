import { Server } from 'socket.io';
import { spawn } from 'child_process';
import path from 'path';

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

    socket.on('start-test', (data) => {
      console.log('Starting LiveKit agent test from UI:', data);
      
      socket.emit('log', { type: 'info', message: 'Initiating test container process...' });
      
      const testProcess = spawn('node', ['test-agent.mjs'], {
        cwd: process.cwd()
      });

      testProcess.stdout.on('data', (data) => {
        const output = data.toString();
        
        // Custom parsing to categorize LiveKit SIP behavior for the UI
        if (output.includes('180 Ringing')) {
          socket.emit('log', { type: 'success', message: '-> 180 Ringing: LiveKit dispatch rule matched. Room created. Waiting for Agent to join...' });
        } else if (output.includes('200 OK')) {
          socket.emit('log', { type: 'success', message: '-> 200 OK: Agent joined the room and answered!' });
        } else if (output.includes('503 Service Unavailable')) {
          socket.emit('log', { 
            type: 'error', 
            message: `-> 503 Service Unavailable / Connection Dropped

DIAGNOSIS: The LiveKit SIP Proxy successfully routed the call to a room (as proven by the 180 Ringing), but the connection was dropped. This occurs because the remote LiveKit Agent failed to join the room and publish an audio track within the 60-second SIP timeout window.

ACTION REQUIRED: Please verify your LiveKit Agent worker is running, not crashing, and is configured to listen to the correct dispatch rule room prefix.` 
          });
        } else {
          socket.emit('log', { type: 'info', message: output.trim() });
        }
      });

      testProcess.stderr.on('data', (data) => {
        const errorMsg = data.toString().trim();
        // Ignore standard Node.js event emitter warnings from the sip library disconnection
        if (!errorMsg.includes('Error: remote peer disconnected')) {
          socket.emit('log', { type: 'error', message: errorMsg });
        }
      });

      testProcess.on('close', (code) => {
        socket.emit('log', { type: 'system', message: `Test process exited with code ${code}` });
        socket.emit('test-complete', { code });
      });
    });
  });

  return io;
}
