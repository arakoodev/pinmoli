import {
  PhoneCall,
  Settings,
  History,
  FolderOpen,
  Send,
  Save,
  Activity
} from "lucide-react";

export default function VoiceWorkspace() {
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
          <button className="w-full flex items-center space-x-2 px-2 py-1.5 rounded hover:bg-zinc-800 text-sm text-left">
            <FolderOpen className="w-4 h-4 text-zinc-400" />
            <span>SIPconnect 1.1 Tests</span>
          </button>
          <button className="w-full flex items-center space-x-2 px-2 py-1.5 rounded hover:bg-zinc-800 text-sm text-left">
            <FolderOpen className="w-4 h-4 text-zinc-400" />
            <span>Vendor Emulators</span>
          </button>
          
          <div className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2 px-2 mt-6">
            History
          </div>
          <button className="w-full flex items-center space-x-2 px-2 py-1.5 rounded hover:bg-zinc-800 text-sm text-left">
            <History className="w-4 h-4 text-zinc-400" />
            <span className="truncate">INVITE sip:agent@livekit</span>
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
          <button className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-1.5 rounded text-sm font-medium flex items-center space-x-2 transition-colors">
            <span>Send</span>
            <Send className="w-4 h-4" />
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
              Signaling (Headers)
            </button>
            <button className="border-b-2 border-transparent hover:text-zinc-300 text-zinc-500 py-3 text-sm font-medium">
              Media (SDP/RTP)
            </button>
            <button className="border-b-2 border-transparent hover:text-zinc-300 text-zinc-500 py-3 text-sm font-medium">
              Authentication
            </button>
            <button className="border-b-2 border-transparent hover:text-zinc-300 text-zinc-500 py-3 text-sm font-medium">
              PCAP Profiles
            </button>
          </div>

          {/* Tab Panel */}
          <div className="flex-1 overflow-y-auto p-4 flex flex-col">
            {/* Headers Section */}
            <div className="mb-8">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-medium text-zinc-300">SIP Headers</h3>
                <button className="text-xs text-indigo-400 hover:text-indigo-300">+ Add Header</button>
              </div>
              <div className="space-y-3">
                {/* Key Value Row */}
                <div className="flex space-x-3">
                  <input type="text" defaultValue="User-Agent" className="w-1/3 bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-indigo-500" />
                  <input type="text" defaultValue="NishirLabs/1.0" className="flex-1 bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-indigo-500" />
                </div>
                <div className="flex space-x-3">
                  <input type="text" defaultValue="X-Vendor-Emulation" className="w-1/3 bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-indigo-500" />
                  <select className="flex-1 bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-indigo-500">
                    <option>None (Standard RFC 3261)</option>
                    <option>Cisco CUCM</option>
                    <option>Avaya Aura</option>
                    <option>CTStage</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Response Area Container - Split bottom */}
            <div className="flex-1 border-t border-zinc-800 pt-4 flex flex-col min-h-[200px]">
              <div className="flex items-center space-x-4 mb-2">
                <h3 className="text-sm font-medium text-zinc-300 flex items-center">
                  <Activity className="w-4 h-4 mr-2 text-green-500" />
                  Real-time Logs
                </h3>
                <span className="text-xs text-zinc-500 bg-zinc-900 px-2 py-0.5 rounded">Status: Disconnected</span>
              </div>
              <div className="flex-1 bg-black rounded border border-zinc-800 p-3 font-mono text-xs overflow-y-auto">
                <div className="text-zinc-600">{"// Connecting to WSS Signaling Gateway..."}</div>
                <div className="text-zinc-600">{"// Ready to initiate test"}</div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
