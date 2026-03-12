/**
 * Notification & feedback sound system using Web Audio API.
 * Generates sounds programmatically — no audio files needed.
 */

type SoundType = 'notification' | 'error' | 'warning' | 'success' | 'typing' | 'complete' | 'message'

interface SoundConfig {
  masterVolume: number
  muted: boolean
  volumes: Record<SoundType, number>
}

const DEFAULT_CONFIG: SoundConfig = {
  masterVolume: 0.3,
  muted: false,
  volumes: {
    notification: 0.5,
    error: 0.6,
    warning: 0.5,
    success: 0.5,
    typing: 0.1,
    complete: 0.5,
    message: 0.4,
  },
}

let audioCtx: AudioContext | null = null
let config: SoundConfig = { ...DEFAULT_CONFIG }

function getAudioCtx(): AudioContext {
  if (!audioCtx) {
    audioCtx = new AudioContext()
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume()
  }
  return audioCtx
}

function loadConfig(): void {
  try {
    const saved = localStorage.getItem('orion:sound-config')
    if (saved) config = { ...DEFAULT_CONFIG, ...JSON.parse(saved) }
  } catch { /* use defaults */ }
}

function saveConfig(): void {
  try {
    localStorage.setItem('orion:sound-config', JSON.stringify(config))
  } catch { /* ignore */ }
}

loadConfig()

/* ── Sound Generators ──────────────────────────────────── */

function playTone(
  frequency: number,
  duration: number,
  type: OscillatorType = 'sine',
  volume: number = 0.5,
  ramp?: { to: number; duration: number },
): void {
  const ctx = getAudioCtx()
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()

  osc.type = type
  osc.frequency.value = frequency
  gain.gain.value = volume * config.masterVolume

  if (ramp) {
    osc.frequency.linearRampToValueAtTime(ramp.to, ctx.currentTime + ramp.duration)
  }

  // Fade out to avoid clicks
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration)

  osc.connect(gain)
  gain.connect(ctx.destination)
  osc.start(ctx.currentTime)
  osc.stop(ctx.currentTime + duration)
}

function playChord(
  frequencies: number[],
  duration: number,
  type: OscillatorType = 'sine',
  volume: number = 0.3,
): void {
  for (const freq of frequencies) {
    playTone(freq, duration, type, volume / frequencies.length)
  }
}

const SOUND_FUNCTIONS: Record<SoundType, (vol: number) => void> = {
  notification: (vol) => {
    // Gentle two-note chime: C5 → E5
    playTone(523, 0.15, 'sine', vol)
    setTimeout(() => playTone(659, 0.2, 'sine', vol * 0.8), 100)
  },

  error: (vol) => {
    // Low descending tone: A3 → F3
    playTone(220, 0.3, 'triangle', vol, { to: 175, duration: 0.3 })
  },

  warning: (vol) => {
    // Two quick notes: E4 → E4 (repeated)
    playTone(330, 0.1, 'triangle', vol)
    setTimeout(() => playTone(330, 0.15, 'triangle', vol * 0.7), 150)
  },

  success: (vol) => {
    // Pleasant ascending: C4 → E4 → G4
    playTone(262, 0.1, 'sine', vol)
    setTimeout(() => playTone(330, 0.1, 'sine', vol), 80)
    setTimeout(() => playTone(392, 0.2, 'sine', vol * 0.8), 160)
  },

  typing: (vol) => {
    // Very subtle key click
    const ctx = getAudioCtx()
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 0.02, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (data.length * 0.1))
    }
    const source = ctx.createBufferSource()
    const gain = ctx.createGain()
    source.buffer = buffer
    gain.gain.value = vol * config.masterVolume * 0.3
    source.connect(gain)
    gain.connect(ctx.destination)
    source.start()
  },

  complete: (vol) => {
    // Task complete fanfare: C4 → E4 → G4 → C5
    playTone(262, 0.12, 'sine', vol)
    setTimeout(() => playTone(330, 0.12, 'sine', vol), 100)
    setTimeout(() => playTone(392, 0.12, 'sine', vol), 200)
    setTimeout(() => playTone(523, 0.25, 'sine', vol * 0.9), 300)
  },

  message: (vol) => {
    // Chat message: soft ding
    playTone(880, 0.08, 'sine', vol)
    setTimeout(() => playTone(1100, 0.12, 'sine', vol * 0.6), 50)
  },
}

/* ── Public API ────────────────────────────────────────── */

export function playSound(type: SoundType): void {
  if (config.muted) return
  const vol = config.volumes[type] ?? 0.5
  try {
    SOUND_FUNCTIONS[type]?.(vol)
  } catch { /* Audio not available */ }
}

export function setMasterVolume(volume: number): void {
  config.masterVolume = Math.max(0, Math.min(1, volume))
  saveConfig()
}

export function setSoundVolume(type: SoundType, volume: number): void {
  config.volumes[type] = Math.max(0, Math.min(1, volume))
  saveConfig()
}

export function setMuted(muted: boolean): void {
  config.muted = muted
  saveConfig()
}

export function isMuted(): boolean {
  return config.muted
}

export function getMasterVolume(): number {
  return config.masterVolume
}

export function getSoundConfig(): SoundConfig {
  return { ...config }
}
