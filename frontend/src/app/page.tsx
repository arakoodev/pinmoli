'use client';

import { Send, Square, Activity } from 'lucide-react';
import { useState, useEffect, useRef, useCallback } from 'react';
import io from 'socket.io-client';
import Sidebar from '@/components/Sidebar';
import SipTimeline, { type SipEvent } from '@/components/SipTimeline';
import SdpDiff from '@/components/SdpDiff';
import DiagnosticInsights from '@/components/DiagnosticInsights';
import HeaderEditor from '@/components/HeaderEditor';
import CodecPicker from '@/components/CodecPicker';
import AudioControls from '@/components/AudioControls';
import PresetSelector from '@/components/PresetSelector';
import {
  defaultConfig,
  addToCollection,
  addToHistory,
  type RequestConfig,
  type SavedRequest,
} from '@/lib/collections';
import type { SipPreset } from '@/lib/presets';

type Tab = 'timeline' | 'sdp' | 'diagnostics';
type ConfigTab = 'headers' | 'sdp' | 'auth' | 'audio';

export default function VoiceWorkspace() {
  // ── State ──────────────────────────────────────────────────────────
  const [config, setConfig] = useState<RequestConfig>(defaultConfig());
  const [events, setEvents] = useState<SipEvent[]>([]);
  const [status, setStatus] = useState('Disconnected');
  const [isRunning, setIsRunning] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>('timeline');
  const [configTab, setConfigTab] = useState<ConfigTab>('headers');
  const socketRef = useRef<ReturnType<typeof io> | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);
  // Refs to track current values for the test-complete closure
  // (avoids stale closure bug where useEffect captures initial state)
  const eventsRef = useRef<SipEvent[]>([]);
  const configRef = useRef<RequestConfig>(config);

  // Keep refs in sync with state (for stale closure avoidance)
  eventsRef.current = events;
  configRef.current = config;

  // Derived SDP state from events
  const sdpOffer = events.find((e) => e.sdpOffer)?.sdpOffer || null;
  const sdpAnswer = events.find((e) => e.sdpAnswer)?.sdpAnswer || null;

  // ── Socket.io ──────────────────────────────────────────────────────
  useEffect(() => {
    const socket = io();
    socketRef.current = socket;

    socket.on('connect', () => setStatus('Ready'));
    socket.on('disconnect', () => setStatus('Disconnected'));

    socket.on('log', (event: SipEvent) => {
      setEvents((prev) => [...prev, event]);
    });

    socket.on('test-complete', ({ code }: { code: number }) => {
      setIsRunning(false);
      setStatus(code === 0 ? 'Completed' : 'Failed');

      // Use refs to access current values (avoids stale closure)
      const currentEvents = eventsRef.current;
      const currentConfig = configRef.current;
      const lastStatus = currentEvents.find(
        (e) => e.type === 'sip' && e.status && e.status >= 200
      );
      addToHistory({
        id: `hist-${Date.now()}`,
        config: currentConfig,
        timestamp: Date.now(),
        result: code === 0 ? 'success' : 'error',
        statusCode: lastStatus?.status,
      });
    });

    return () => {
      socket.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [events]);

  // ── Actions ────────────────────────────────────────────────────────
  const startTest = useCallback(() => {
    if (!socketRef.current) return;
    setIsRunning(true);
    setStatus('Running...');
    setEvents([]);

    socketRef.current.emit('start-test', {
      method: config.method,
      uri: config.uri,
      transport: config.transport,
      headers: config.headers,
      codecs: config.codecs,
      customSdp: config.customSdp,
      audio: config.audio,
      auth: config.auth,
    });
  }, [config]);

  const stopTest = useCallback(() => {
    if (!socketRef.current) return;
    socketRef.current.emit('stop-test');
    setIsRunning(false);
    setStatus('Stopped');
  }, []);

  const handleLoadConfig = useCallback((loaded: RequestConfig) => {
    setConfig(loaded);
  }, []);

  const handleSaveConfig = useCallback(
    (collectionId: string) => {
      const name = prompt('Name for this request:');
      if (!name) return;
      const item: SavedRequest = {
        id: `req-${Date.now()}`,
        name,
        config,
        createdAt: Date.now(),
      };
      addToCollection(collectionId, item);
    },
    [config]
  );

  const handlePresetSelect = useCallback(
    (preset: SipPreset, uri: string, headers: Record<string, string>) => {
      setConfig((prev) => ({
        ...prev,
        uri,
        transport: preset.transport,
        headers: { ...prev.headers, ...headers },
        codecs: preset.codecs,
        auth: preset.authRequired ? prev.auth : { username: '', password: '' },
      }));
    },
    []
  );

  // ── Render ─────────────────────────────────────────────────────────
  const tabs: { id: Tab; label: string }[] = [
    { id: 'timeline', label: 'SIP Timeline' },
    { id: 'sdp', label: 'SDP' },
    { id: 'diagnostics', label: 'Diagnostics' },
  ];

  const configTabs: { id: ConfigTab; label: string }[] = [
    { id: 'headers', label: 'Headers' },
    { id: 'sdp', label: 'SDP / Codecs' },
    { id: 'auth', label: 'Auth' },
    { id: 'audio', label: 'Audio' },
  ];

  const diagnosticCount = events.filter((e) => e.type === 'diagnostic').length;

  return (
    <div className="flex h-screen bg-zinc-950 text-zinc-300 font-sans">
      {/* Sidebar */}
      <Sidebar
        currentConfig={config}
        onLoadConfig={handleLoadConfig}
        onSaveConfig={handleSaveConfig}
      />

      {/* Main Workspace */}
      <main className="flex-1 flex flex-col min-w-0 bg-zinc-950">
        {/* Top Bar — Method + URI + Preset + Run */}
        <header className="h-14 border-b border-zinc-800 flex items-center px-4 gap-2 bg-zinc-900/30">
          <select
            value={config.method}
            onChange={(e) =>
              setConfig({ ...config, method: e.target.value as RequestConfig['method'] })
            }
            className="bg-zinc-800 border border-zinc-700 text-zinc-100 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-indigo-500"
          >
            <option value="INVITE">INVITE</option>
            <option value="REGISTER">REGISTER</option>
            <option value="OPTIONS">OPTIONS</option>
          </select>

          <input
            type="text"
            value={config.uri}
            onChange={(e) => setConfig({ ...config, uri: e.target.value })}
            placeholder="sip:agent@example.com"
            className="flex-1 bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-sm text-zinc-100 font-mono focus:outline-none focus:border-indigo-500"
          />

          <select
            value={config.transport}
            onChange={(e) =>
              setConfig({ ...config, transport: e.target.value as RequestConfig['transport'] })
            }
            className="bg-zinc-800 border border-zinc-700 text-zinc-400 rounded px-2 py-1.5 text-xs focus:outline-none focus:border-indigo-500"
          >
            <option value="auto">Auto</option>
            <option value="udp">UDP</option>
            <option value="tcp">TCP</option>
          </select>

          <PresetSelector onSelect={handlePresetSelect} />

          {isRunning ? (
            <button
              onClick={stopTest}
              className="bg-red-600 hover:bg-red-500 text-white px-4 py-1.5 rounded text-sm font-medium flex items-center gap-2 transition-colors"
            >
              <Square className="w-3.5 h-3.5" />
              Stop
            </button>
          ) : (
            <button
              onClick={startTest}
              className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-1.5 rounded text-sm font-medium flex items-center gap-2 transition-colors"
            >
              Run
              <Send className="w-3.5 h-3.5" />
            </button>
          )}
        </header>

        {/* Config Tabs + Response Area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Config Section */}
          <div className="border-b border-zinc-800">
            <div className="flex border-b border-zinc-800/50 bg-zinc-900/20 px-4">
              {configTabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setConfigTab(tab.id)}
                  className={`py-2 px-3 text-xs font-medium border-b-2 transition-colors ${
                    configTab === tab.id
                      ? 'border-indigo-500 text-indigo-400'
                      : 'border-transparent text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="max-h-56 overflow-y-auto">
              {configTab === 'headers' && (
                <HeaderEditor
                  headers={config.headers}
                  onChange={(headers) => setConfig({ ...config, headers })}
                />
              )}
              {configTab === 'sdp' && (
                <CodecPicker
                  selected={config.codecs}
                  onChange={(codecs) => setConfig({ ...config, codecs })}
                  customSdp={config.customSdp}
                  onCustomSdpChange={(customSdp) => setConfig({ ...config, customSdp })}
                />
              )}
              {configTab === 'auth' && (
                <div className="p-4 space-y-3">
                  <h4 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
                    SIP Authentication
                  </h4>
                  <div className="space-y-2">
                    <div>
                      <label className="text-xs text-zinc-500 block mb-1">Username</label>
                      <input
                        type="text"
                        value={config.auth.username}
                        onChange={(e) =>
                          setConfig({
                            ...config,
                            auth: { ...config.auth, username: e.target.value },
                          })
                        }
                        placeholder="sip-user"
                        className="w-64 bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-sm text-zinc-200 font-mono focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-zinc-500 block mb-1">Password</label>
                      <input
                        type="password"
                        value={config.auth.password}
                        onChange={(e) =>
                          setConfig({
                            ...config,
                            auth: { ...config.auth, password: e.target.value },
                          })
                        }
                        placeholder="password"
                        className="w-64 bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-sm text-zinc-200 font-mono focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                  </div>
                  <p className="text-[11px] text-zinc-600">
                    Used for SIP REGISTER authentication (Digest auth). Required for Twilio, Asterisk, and most PBX platforms.
                  </p>
                </div>
              )}
              {configTab === 'audio' && (
                <AudioControls
                  config={config.audio}
                  onChange={(audio) => setConfig({ ...config, audio })}
                />
              )}
            </div>
          </div>

          {/* Response Section */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Response tabs */}
            <div className="flex items-center border-b border-zinc-800 bg-zinc-900/20 px-4">
              <div className="flex flex-1">
                {tabs.map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`py-2.5 px-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5 ${
                      activeTab === tab.id
                        ? 'border-indigo-500 text-indigo-400'
                        : 'border-transparent text-zinc-500 hover:text-zinc-300'
                    }`}
                  >
                    {tab.label}
                    {tab.id === 'diagnostics' && diagnosticCount > 0 && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-900/50 text-red-400 font-bold">
                        {diagnosticCount}
                      </span>
                    )}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-2">
                <Activity
                  className={`w-4 h-4 ${isRunning ? 'text-indigo-500 animate-pulse' : 'text-zinc-600'}`}
                />
                <span className="text-xs text-zinc-500 bg-zinc-900 px-2 py-0.5 rounded border border-zinc-800">
                  {status}
                </span>
              </div>
            </div>

            {/* Response panel */}
            <div className="flex-1 overflow-y-auto bg-zinc-950">
              {activeTab === 'timeline' && <SipTimeline events={events} />}
              {activeTab === 'sdp' && <SdpDiff offer={sdpOffer} answer={sdpAnswer} />}
              {activeTab === 'diagnostics' && <DiagnosticInsights events={events} />}
              <div ref={logEndRef} />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
