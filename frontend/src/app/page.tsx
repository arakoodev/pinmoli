'use client';
import {
  PhoneCall,
  Settings,
  History,
  FolderOpen,
  Send,
  Save,
  Activity,
  Play
} from "lucide-react";
import { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';

export default function VoiceWorkspace() {
  const [logs, setLogs] = useState<{type: string, message: string}[]>([]);
  const [status, setStatus] = useState('Disconnected');
  const [isRunning, setIsRunning] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Setup Socket.IO connection
    const socket = io();

    socket.on('connect', () => {
      setStatus('Ready');
    });

    socket.on('disconnect', () => {
      setStatus('Disconnected');
    });

    socket.on('log', (log) => {
      setLogs(prev => [...prev, log]);
    });

    socket.on('test-complete', () => {
      setIsRunning(false);
      setStatus('Completed');
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  useEffect(() => {
    // Auto-scroll logs
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const startTest = () => {
    setIsRunning(true);
    setStatus('Running...');
    setLogs([]); // Clear previous logs
    const socket = io();
    socket.emit('start-test', { target: 'sip:agent@livekit.cloud' });
  };

  return (
    <div className="flex h-screen bg-zinc-950 text-zinc-300 font-sans">
      {/* Sidebar - Collections & History */}
      <aside className="w-64 border-r border-zinc-800 bg-zinc-900/50 flex flex-col">
        <div className="p-4 border-b border-zinc-800 flex items-center space-x-2">
          <PhoneCall className="w-5 h-5 text-indigo-500" />
          <span className="font-semibold text-zinc-100">Voice Workspace</span>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          <div className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2 px-2 mt-4">
            Collections
          </div>
          <button className="w-full flex items-center space-x-2 px-2 py-1.5 rounded hover:bg-zinc-800 text-sm text-left text-indigo-400 font-medium">
            <Play className="w-4 h-4" />
            <span>Agent Connect Test</span>
          </button>
          
          <div className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2 px-2 mt-6">
            History
          </div>
          <button className="w-full flex items-center space-x-2 px-2 py-1.5 rounded hover:bg-zinc-800 text-sm text-left opacity-50 cursor-not-allowed">
            <History className="w-4 h-4 text-zinc-400" />
            <span className="truncate">INVITE sip:echo...</span>
          </button>
        </div>
        <div className="p-4 border-t border-zinc-800">
          <button className="flex items-center space-x-2 text-sm text-zinc-400 hover:text-zinc-100">
            <Settings className="w-4 h-4" />
            <span>Settings</span>
          </button>
        </div>
      </aside>

      {/* Main Workspace */}
      <main className="flex-1 flex flex-col min-w-0 bg-zinc-950">
        {/* Top Bar - Request URL */}
        <header className="h-14 border-b border-zinc-800 flex items-center px-4 space-x-2 bg-zinc-900/30">
          <select className="bg-zinc-800 border border-zinc-700 text-zinc-100 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-indigo-500">
            <option>INVITE</option>
            <option>REGISTER</option>
            <option>OPTIONS</option>
          </select>
          <input 
            type="text" 
            placeholder="sip:agent@example.com" 
            className="flex-1 bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-sm text-zinc-100 focus:outline-none focus:border-indigo-500"
            defaultValue="sip:agent@livekit.cloud"
          />
          <button 
            onClick={startTest}
            disabled={isRunning}
            className={`${isRunning ? 'bg-zinc-700 text-zinc-400' : 'bg-indigo-600 hover:bg-indigo-500 text-white'} px-4 py-1.5 rounded text-sm font-medium flex items-center space-x-2 transition-colors`}
          >
            <span>{isRunning ? 'Running...' : 'Run Test'}</span>
            {!isRunning && <Send className="w-4 h-4" />}
          </button>
          <button className="bg-zinc-800 hover:bg-zinc-700 text-zinc-300 px-3 py-1.5 rounded text-sm font-medium flex items-center space-x-2 transition-colors">
            <Save className="w-4 h-4" />
          </button>
        </header>

        {/* Workspace Content */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Tabs */}
          <div className="flex border-b border-zinc-800 bg-zinc-900/20 px-4 space-x-6">
            <button className="border-b-2 border-indigo-500 text-indigo-400 py-3 text-sm font-medium">
              Diagnostic Logs
            </button>
            <button className="border-b-2 border-transparent hover:text-zinc-300 text-zinc-500 py-3 text-sm font-medium">
              Signaling (Headers)
            </button>
            <button className="border-b-2 border-transparent hover:text-zinc-300 text-zinc-500 py-3 text-sm font-medium">
              Media (SDP/RTP)
            </button>
          </div>

          {/* Tab Panel */}
          <div className="flex-1 overflow-y-auto p-4 flex flex-col">
            {/* Response Area Container */}
            <div className="flex-1 flex flex-col min-h-[200px]">
              <div className="flex items-center space-x-4 mb-2">
                <h3 className="text-sm font-medium text-zinc-300 flex items-center">
                  <Activity className={`w-4 h-4 mr-2 ${isRunning ? 'text-indigo-500 animate-pulse' : 'text-green-500'}`} />
                  Live SIP Interception
                </h3>
                <span className="text-xs text-zinc-500 bg-zinc-900 px-2 py-0.5 rounded border border-zinc-800">Status: {status}</span>
              </div>
              <div className="flex-1 bg-black rounded border border-zinc-800 p-4 font-mono text-sm overflow-y-auto shadow-inner whitespace-pre-wrap leading-relaxed">
                {logs.length === 0 ? (
                  <div className="text-zinc-600">{"// Waiting for test execution..."}</div>
                ) : (
                  logs.map((log, i) => (
                    <div key={i} className={`mb-1 ${log.type === 'error' ? 'text-red-400 font-medium' : log.type === 'success' ? 'text-green-400' : log.type === 'system' ? 'text-zinc-500' : 'text-zinc-300'}`}>
                      {log.message}
                    </div>
                  ))
                )}
                <div ref={logEndRef} />
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
