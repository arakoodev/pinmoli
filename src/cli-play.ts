/**
 * pinmoli-play — Standalone audio playback CLI with pi-tui visualization.
 *
 * Architecture (mirrors maestro-cli):
 *   1. Pre-compute waveform peaks once via ffmpeg PCM extraction
 *   2. Spawn ffplay as background "audio thread" (no display window)
 *   3. Main loop polls wall-clock elapsed time at 50ms
 *   4. Threshold check: only re-render when position advanced ≥ 1 sub-block
 *   5. pi-tui Component renders waveform + progress bar with playhead
 *
 * Usage:
 *   node bin/pinmoli-play.mjs <file-or-sample> [--list] [--info]
 *
 * Bundled into bin/pinmoli-play.mjs for host-side execution.
 */

import { spawn, execFileSync, type ChildProcess } from 'child_process';
import { existsSync, readdirSync, statSync } from 'fs';
import { resolve, basename, dirname } from 'path';
import { fileURLToPath } from 'url';
import { TUI, ProcessTerminal, type Component } from '@mariozechner/pi-tui';

// ---- Path resolution ----

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// When bundled into bin/pinmoli-play.mjs, project root is one dir up
const PROJECT_ROOT = resolve(__dirname, '..');
const SAMPLES_DIR = resolve(PROJECT_ROOT, 'audio-samples');
const CAPTURES_DIR = resolve(PROJECT_ROOT, 'captures');

// ---- Color helpers ----
const reset = '\x1b[0m';
const bold = (s: string) => `\x1b[1m${s}${reset}`;
const dim = (s: string) => `\x1b[2m${s}${reset}`;
const green = (s: string) => `\x1b[32m${s}${reset}`;
const yellow = (s: string) => `\x1b[33m${s}${reset}`;
const cyan = (s: string) => `\x1b[36m${s}${reset}`;
const red = (s: string) => `\x1b[31m${s}${reset}`;

// ---- File resolution ----

function resolveFile(input: string): string | null {
  // Absolute or cwd-relative
  if (existsSync(input)) return resolve(input);

  // Built-in sample (voice-hello → audio-samples/voice-hello.wav)
  const sample = resolve(SAMPLES_DIR, `${input}.wav`);
  if (existsSync(sample)) return sample;

  // Search latest session in captures/
  if (existsSync(CAPTURES_DIR)) {
    const sessions = readdirSync(CAPTURES_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => ({ name: d.name, mtime: statSync(resolve(CAPTURES_DIR, d.name)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);

    for (const session of sessions) {
      const sessionDir = resolve(CAPTURES_DIR, session.name);
      const found = findInDir(sessionDir, input);
      if (found) return found;
    }
  }

  return null;
}

function findInDir(dir: string, target: string): string | null {
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = resolve(dir, e.name);
      if (e.isFile()) {
        if (e.name === target || e.name === `${target}.wav`) return full;
      } else if (e.isDirectory()) {
        const nested = findInDir(full, target);
        if (nested) return nested;
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

// ---- ffprobe ----

interface AudioInfo {
  durationSec: number;
  codec: string;
  sampleRate: number;
  channels: number;
}

function probeAudio(file: string): AudioInfo | null {
  try {
    const out = execFileSync('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration:stream=codec_name,sample_rate,channels',
      '-of', 'default=noprint_wrappers=1',
      file,
    ], { encoding: 'utf8', timeout: 5000 });

    const lines = out.split('\n');
    const get = (key: string): string => {
      const line = lines.find(l => l.startsWith(`${key}=`));
      return line ? line.slice(key.length + 1) : '';
    };

    return {
      durationSec: parseFloat(get('duration')) || 0,
      codec: get('codec_name'),
      sampleRate: parseInt(get('sample_rate')) || 0,
      channels: parseInt(get('channels')) || 0,
    };
  } catch {
    return null;
  }
}

// ---- Waveform pre-computation ----

/**
 * Decode the entire audio file to PCM16 mono 8kHz, then compute peak amplitude
 * per "bucket" — one bucket per visualization column.
 *
 * Returns normalized peaks (0-1) for the given number of buckets.
 */
function computeWaveform(file: string, numBuckets: number): number[] {
  try {
    // ffmpeg: decode any format → PCM16 mono 8kHz → stdout
    const pcm = execFileSync('ffmpeg', [
      '-i', file,
      '-f', 's16le', '-ar', '8000', '-ac', '1',
      '-loglevel', 'error',
      'pipe:1',
    ], { maxBuffer: 100 * 1024 * 1024, timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] });

    const totalSamples = pcm.length / 2;
    if (totalSamples === 0) return new Array(numBuckets).fill(0);

    const samplesPerBucket = Math.max(1, Math.floor(totalSamples / numBuckets));
    const peaks: number[] = [];
    let maxAbs = 1;

    for (let b = 0; b < numBuckets; b++) {
      const start = b * samplesPerBucket;
      const end = Math.min(start + samplesPerBucket, totalSamples);
      let peak = 0;
      for (let i = start; i < end; i++) {
        const sample = pcm.readInt16LE(i * 2);
        const abs = Math.abs(sample);
        if (abs > peak) peak = abs;
      }
      peaks.push(peak);
      if (peak > maxAbs) maxAbs = peak;
    }

    // Normalize to 0-1
    return peaks.map(p => p / maxAbs);
  } catch {
    return new Array(numBuckets).fill(0);
  }
}

// ---- Format helpers ----

function formatDuration(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// ---- Playback Component ----

const VIS_HEIGHT = 8;
// 8 vertical sub-blocks (Unicode lower blocks) for sub-row precision
const VBLOCKS = [' ', '▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];
// 8 horizontal sub-blocks for progress bar (eighths)
const HBLOCKS = [' ', '▏', '▎', '▍', '▌', '▋', '▊', '▉', '█'];

class PlaybackComponent implements Component {
  private peaks: number[] = [];
  private peaksWidth = 0;
  private startedAt: number;
  private pausedAt: number | null = null;
  private totalPausedMs = 0;
  private finished = false;
  private cachedLines: string[] | null = null;
  private cachedWidth = 0;
  private cachedSubPos = -1;

  constructor(
    private file: string,
    private info: AudioInfo,
  ) {
    this.startedAt = Date.now();
  }

  /** Wall-clock elapsed seconds (excluding pauses) */
  get elapsedSec(): number {
    if (this.finished) return this.info.durationSec;
    const now = this.pausedAt ?? Date.now();
    return Math.max(0, (now - this.startedAt - this.totalPausedMs) / 1000);
  }

  get isPaused(): boolean {
    return this.pausedAt !== null;
  }

  pause(): void {
    if (this.pausedAt === null) {
      this.pausedAt = Date.now();
      this.invalidate();
    }
  }

  resume(): void {
    if (this.pausedAt !== null) {
      this.totalPausedMs += Date.now() - this.pausedAt;
      this.pausedAt = null;
      this.invalidate();
    }
  }

  markFinished(): void {
    this.finished = true;
    this.invalidate();
  }

  invalidate(): void {
    this.cachedLines = null;
    this.cachedSubPos = -1;
  }

  render(width: number): string[] {
    const visWidth = Math.max(20, width - 4);

    // Lazy-compute waveform when width is known
    if (this.peaks.length === 0 || this.peaksWidth !== visWidth) {
      this.peaks = computeWaveform(this.file, visWidth);
      this.peaksWidth = visWidth;
      this.invalidate();
    }

    // Threshold check: only redraw when position has advanced ≥ 1 sub-block
    // (mirrors maestro-cli main.py:695-709)
    const dur = this.info.durationSec || 1;
    const elapsed = Math.min(this.elapsedSec, dur);
    const subBlocksTotal = visWidth * 8;
    const subPos = Math.floor((elapsed / dur) * subBlocksTotal);

    if (this.cachedLines && this.cachedWidth === width && this.cachedSubPos === subPos) {
      return this.cachedLines;
    }

    const lines: string[] = [];
    const playheadCol = Math.min(visWidth - 1, Math.floor((elapsed / dur) * visWidth));

    // Header
    const fileName = basename(this.file);
    const codecLabel = `${this.info.codec} ${this.info.sampleRate}Hz`;
    lines.push(` ${bold('▶')} ${cyan(fileName)} ${dim(codecLabel)}`);
    lines.push('');

    // Waveform — VIS_HEIGHT rows
    for (let row = 0; row < VIS_HEIGHT; row++) {
      const rowLine: string[] = [' '];
      for (let col = 0; col < visWidth; col++) {
        const peak = this.peaks[col] || 0;
        // Center the wave: each row represents a vertical position
        // Peak fills from center outward
        const halfHeight = VIS_HEIGHT / 2;
        const peakRows = peak * halfHeight;
        const distFromCenter = Math.abs(row - (halfHeight - 0.5));
        const filled = Math.max(0, peakRows - distFromCenter);
        const subBlock = Math.min(8, Math.max(0, Math.round(filled * 8)));

        // Color: green before playhead, dim after
        const block = VBLOCKS[subBlock];
        if (col <= playheadCol) {
          rowLine.push(green(block));
        } else {
          rowLine.push(dim(block));
        }
      }
      lines.push(rowLine.join(''));
    }
    lines.push('');

    // Progress bar with sub-block precision
    const progressBarWidth = visWidth - 14; // reserve for time labels
    if (progressBarWidth > 4) {
      const subBlocksProgress = (elapsed / dur) * progressBarWidth * 8;
      const fullCells = Math.floor(subBlocksProgress / 8);
      const remainder = Math.floor(subBlocksProgress % 8);

      const filled = '█'.repeat(fullCells);
      const partial = remainder > 0 ? HBLOCKS[remainder] : '';
      const empty = ' '.repeat(Math.max(0, progressBarWidth - fullCells - (remainder > 0 ? 1 : 0)));

      const elapsedStr = formatDuration(elapsed);
      const totalStr = formatDuration(dur);
      const status = this.isPaused ? yellow('║') : (this.finished ? green('✓') : cyan('▶'));

      lines.push(
        ` ${status} ${cyan(elapsedStr)}${dim('/')}${dim(totalStr)} ${cyan('│')}${green(filled + partial)}${empty}${cyan('│')}`
      );
    }

    lines.push('');
    lines.push(` ${dim('Space: pause/resume   q/Ctrl+C: quit')}`);

    this.cachedLines = lines;
    this.cachedWidth = width;
    this.cachedSubPos = subPos;
    return lines;
  }
}

// ---- Player ----

interface PlayerHandle {
  process: ChildProcess;
  command: string;
}

function spawnPlayer(file: string, paused: boolean): PlayerHandle | null {
  // Try ffplay first (most common, handles mu-law natively)
  try {
    const args = ['-nodisp', '-autoexit', '-loglevel', 'quiet'];
    if (paused) args.push('-paused');
    args.push(file);
    const proc = spawn('ffplay', args, { stdio: ['ignore', 'ignore', 'ignore'] });
    return { process: proc, command: 'ffplay' };
  } catch {
    /* try next */
  }

  // Fallback: ffmpeg → paplay
  try {
    const ffmpeg = spawn('ffmpeg', [
      '-i', file,
      '-f', 's16le', '-ar', '44100', '-ac', '1',
      '-loglevel', 'error',
      'pipe:1',
    ], { stdio: ['ignore', 'pipe', 'ignore'] });
    const paplay = spawn('paplay', ['--raw', '--rate=44100', '--channels=1', '--format=s16le'],
      { stdio: ['pipe', 'ignore', 'ignore'] });
    ffmpeg.stdout?.pipe(paplay.stdin!);
    return { process: paplay, command: 'paplay' };
  } catch {
    return null;
  }
}

// ---- List mode ----

function listSession(sessionPath?: string): void {
  let dir: string;
  if (sessionPath) {
    dir = resolve(sessionPath);
  } else if (existsSync(CAPTURES_DIR)) {
    const sessions = readdirSync(CAPTURES_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => ({ name: d.name, mtime: statSync(resolve(CAPTURES_DIR, d.name)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    if (sessions.length === 0) {
      console.log('No sessions found in captures/');
      return;
    }
    dir = resolve(CAPTURES_DIR, sessions[0].name);
  } else {
    console.log('captures/ directory not found');
    return;
  }

  console.log(`${bold('Session:')} ${basename(dir)}`);
  console.log('');

  const wavs: string[] = [];
  const collect = (d: string) => {
    try {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const full = resolve(d, e.name);
        if (e.isFile() && e.name.endsWith('.wav')) wavs.push(full);
        else if (e.isDirectory()) collect(full);
      }
    } catch { /* ignore */ }
  };
  collect(dir);
  wavs.sort();

  if (wavs.length === 0) {
    console.log('  (no WAV files found)');
    return;
  }

  for (const wav of wavs) {
    const rel = wav.slice(dir.length + 1);
    const info = probeAudio(wav);
    const dur = info ? formatDuration(info.durationSec) : '?';
    let label = '';
    if (rel.includes('agent-response')) label = green('[agent]');
    else if (rel.includes('sent-audio')) label = yellow('[sent]');
    else if (rel.includes('audio-samples')) label = dim('[sample]');
    console.log(`  ${dur.padStart(6)} ${label} ${rel}`);
  }
  console.log('');
  console.log(dim('Play with: pinmoli-play <path>'));
}

// ---- Main ----

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    console.log(`pinmoli-play — Play Pinmoli WAV files with terminal visualization

Usage:
  pinmoli-play <file-or-sample>      Play a WAV file
  pinmoli-play --list [session-dir]  List WAVs in a session
  pinmoli-play --info <file>         Show file info

File resolution:
  1. Exact path (absolute or relative)
  2. Built-in sample: voice-hello, sine-440hz, sine-1000hz, dtmf-123, silence
  3. Filename in latest captures/ session

Examples:
  pinmoli-play voice-hello
  pinmoli-play captures/.../agent-response-2.wav
  pinmoli-play agent-response-2.wav
  pinmoli-play --list`);
    process.exit(0);
  }

  if (args[0] === '--list') {
    listSession(args[1]);
    process.exit(0);
  }

  if (args[0] === '--info') {
    const file = resolveFile(args[1] || '');
    if (!file) {
      console.error(red(`File not found: ${args[1]}`));
      process.exit(1);
    }
    const info = probeAudio(file);
    console.log(`${bold('File:')} ${file}`);
    if (info) {
      console.log(`Codec: ${info.codec}`);
      console.log(`Sample rate: ${info.sampleRate}Hz`);
      console.log(`Channels: ${info.channels}`);
      console.log(`Duration: ${formatDuration(info.durationSec)} (${info.durationSec.toFixed(2)}s)`);
    }
    process.exit(0);
  }

  // Play mode
  const file = resolveFile(args[0]);
  if (!file) {
    console.error(red(`File not found: ${args[0]}`));
    console.error('');
    console.error('Searched:');
    console.error(`  - Exact path`);
    console.error(`  - ${SAMPLES_DIR}/${args[0]}.wav`);
    console.error(`  - Latest session in ${CAPTURES_DIR}/`);
    console.error('');
    console.error('Use --list to see available WAVs.');
    process.exit(1);
  }

  const info = probeAudio(file);
  if (!info || info.durationSec === 0) {
    console.error(red(`Cannot probe audio file: ${file}`));
    process.exit(1);
  }

  // Spawn audio player
  const player = spawnPlayer(file, false);
  if (!player) {
    console.error(red('No audio player found. Install ffmpeg (provides ffplay).'));
    process.exit(1);
  }

  // Setup pi-tui
  const terminal = new ProcessTerminal();
  const tui = new TUI(terminal, false);
  const playback = new PlaybackComponent(file, info);
  tui.addChild(playback);
  tui.start();

  let done = false;

  // Audio process completion
  player.process.on('close', () => {
    playback.markFinished();
    tui.requestRender();
    setTimeout(() => {
      done = true;
      cleanup();
    }, 200);
  });

  player.process.on('error', () => {
    done = true;
    cleanup();
  });

  // Polling loop — mirrors maestro-cli's 10ms event loop
  // pi-tui's diff renderer means re-rendering is cheap; the threshold check
  // inside PlaybackComponent.render() prevents wasted work
  const pollInterval = setInterval(() => {
    if (done) return;
    tui.requestRender();
    if (playback.elapsedSec >= info.durationSec) {
      // Audio should be done; let the close handler clean up
    }
  }, 50);

  // Keyboard input — pause/resume/quit
  const inputUnsub = tui.addInputListener((data: string) => {
    if (data === ' ') {
      if (playback.isPaused) {
        playback.resume();
        // Restart player from current position would need a more complex setup;
        // for now, pause/resume only affects the visual (audio keeps playing).
        // TODO: implement true pause via SIGSTOP/SIGCONT or ffmpeg seeking
      } else {
        playback.pause();
      }
      tui.requestRender();
      return { consume: true };
    }
    if (data === 'q' || data === '\x03' /* Ctrl+C */) {
      done = true;
      cleanup();
      return { consume: true };
    }
    return undefined;
  });

  const playerProcess = player.process;
  function cleanup() {
    clearInterval(pollInterval);
    inputUnsub();
    try { playerProcess.kill(); } catch { /* */ }
    try { tui.stop(); } catch { /* */ }
    process.exit(0);
  }

  // Safety timeout: 2 minutes max
  const safetyTimer = setTimeout(() => {
    if (!done) cleanup();
  }, 120000);
  safetyTimer.unref();
}

main().catch(err => {
  console.error(red(`Error: ${err.message}`));
  process.exit(1);
});
