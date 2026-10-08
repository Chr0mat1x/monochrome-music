import type { Mode, Track } from '../types'

const MODE_INTERVALS: Record<Mode, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
}

const PROGRESSIONS: Record<Mode, number[]> = {
  major: [0, 5, 3, 4],
  minor: [0, 5, 2, 6],
  dorian: [0, 3, 0, 6],
  lydian: [0, 1, 4, 0],
  mixolydian: [0, 6, 3, 0],
  phrygian: [0, 1, 0, 6],
}

function mulberry32(a: number) {
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const midiToFreq = (m: number) => 440 * Math.pow(2, (m - 69) / 12)
const degreeToMidi = (key: number, mode: Mode, degree: number, octave: number) => {
  const scale = MODE_INTERVALS[mode]
  const len = scale.length
  const oct = Math.floor(degree / len)
  const idx = ((degree % len) + len) % len
  // Root around C3, key shifts chromatically.
  return 48 + key + scale[idx] + (octave + oct) * 12
}

const LOOP_BARS = 32

interface Schedule {
  beat: number
  bar: number
}

/**
 * Synthesises a looping backing track for a Track entirely in the browser.
 * Each track becomes a 32-bar loop built from its key, mode, tempo and mood.
 */
async function renderLoop(track: Track): Promise<AudioBuffer | null> {
  const OAC: typeof OfflineAudioContext =
    (window as any).OfflineAudioContext || (window as any).webkitOfflineAudioContext
  if (!OAC) return null

  const sampleRate = 44100
  const beat = 60 / track.bpm
  const bar = beat * 4
  const total = bar * LOOP_BARS
  const ctx = new OAC(2, Math.ceil(sampleRate * total), sampleRate)

  const rng = mulberry32(track.seed)
  const energy = track.energy / 100
  const valence = track.valence / 100
  const dark = 1 - valence

  // ---- master chain: lowpass -> delay -> destination
  const master = ctx.createGain()
  master.gain.value = 0.82
  const lowpass = ctx.createBiquadFilter()
  lowpass.type = 'lowpass'
  lowpass.frequency.value = 900 + energy * 9000
  lowpass.Q.value = 0.6

  const delay = ctx.createDelay(1)
  delay.delayTime.value = beat * 0.75
  const fb = ctx.createGain()
  fb.gain.value = 0.22 + dark * 0.12
  const wet = ctx.createGain()
  wet.gain.value = 0.16 + dark * 0.16

  master.connect(lowpass)
  lowpass.connect(ctx.destination)
  lowpass.connect(delay)
  delay.connect(fb)
  fb.connect(delay)
  delay.connect(wet)
  wet.connect(ctx.destination)

  // ---- shared noise buffer for percussion
  const noiseLen = Math.ceil(sampleRate * 0.6)
  const noiseBuf = ctx.createBuffer(1, noiseLen, sampleRate)
  const nd = noiseBuf.getChannelData(0)
  for (let i = 0; i < noiseLen; i++) nd[i] = rng() * 2 - 1

  const noiseSource = () => {
    const s = ctx.createBufferSource()
    s.buffer = noiseBuf
    return s
  }

  // ---- voices ---------------------------------------------------------
  const oscTypes: OscillatorType[] = ['sine', 'triangle', 'sawtooth', 'square']
  const leadType = oscTypes.includes(track.waveform) ? (track.waveform as OscillatorType) : 'triangle'

  const padVoice = (freq: number, at: number, dur: number, gain: number) => {
    const osc = ctx.createOscillator()
    osc.type = dark > 0.55 ? 'sawtooth' : 'triangle'
    osc.frequency.value = freq
    const det = ctx.createOscillator()
    det.type = 'sine'
    det.frequency.value = freq * (1 + (rng() - 0.5) * 0.012)
    const g = ctx.createGain()
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = 700 + energy * 2600
    const attack = 0.6 + rng() * 0.8
    const release = 1.2 + rng() * 1.6
    g.gain.setValueAtTime(0, at)
    g.gain.linearRampToValueAtTime(gain, at + attack)
    g.gain.setValueAtTime(gain, at + Math.max(attack, dur - release))
    g.gain.linearRampToValueAtTime(0, at + dur)
    osc.connect(filter)
    det.connect(filter)
    filter.connect(g)
    g.connect(master)
    osc.start(at)
    det.start(at)
    osc.stop(at + dur + 0.1)
    det.stop(at + dur + 0.1)
  }

  const bassVoice = (freq: number, at: number, dur: number) => {
    const osc = ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.value = freq
    const sub = ctx.createOscillator()
    sub.type = 'triangle'
    sub.frequency.value = freq * 0.5
    const g = ctx.createGain()
    g.gain.setValueAtTime(0, at)
    g.gain.linearRampToValueAtTime(0.5, at + 0.02)
    g.gain.exponentialRampToValueAtTime(0.001, at + dur)
    osc.connect(g)
    sub.connect(g)
    g.connect(master)
    osc.start(at)
    sub.start(at)
    osc.stop(at + dur + 0.05)
    sub.stop(at + dur + 0.05)
  }

  const leadVoice = (freq: number, at: number, dur: number) => {
    const osc = ctx.createOscillator()
    osc.type = leadType
    osc.frequency.value = freq
    const g = ctx.createGain()
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.setValueAtTime(1800 + energy * 5000, at)
    filter.frequency.exponentialRampToValueAtTime(900 + energy * 2000, at + dur)
    g.gain.setValueAtTime(0, at)
    g.gain.linearRampToValueAtTime(0.22, at + 0.015)
    g.gain.exponentialRampToValueAtTime(0.001, at + dur)
    osc.connect(filter)
    filter.connect(g)
    g.connect(master)
    osc.start(at)
    osc.stop(at + dur + 0.05)
  }

  const kick = (at: number) => {
    const osc = ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(140, at)
    osc.frequency.exponentialRampToValueAtTime(46, at + 0.11)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.9, at)
    g.gain.exponentialRampToValueAtTime(0.001, at + 0.32)
    osc.connect(g)
    g.connect(master)
    osc.start(at)
    osc.stop(at + 0.35)
  }

  const snare = (at: number, level = 0.34) => {
    const s = noiseSource()
    const hp = ctx.createBiquadFilter()
    hp.type = 'highpass'
    hp.frequency.value = 1200
    const g = ctx.createGain()
    g.gain.setValueAtTime(level, at)
    g.gain.exponentialRampToValueAtTime(0.001, at + 0.2)
    s.connect(hp)
    hp.connect(g)
    g.connect(master)
    s.start(at)
    s.stop(at + 0.25)
  }

  const hat = (at: number, level = 0.13) => {
    const s = noiseSource()
    const hp = ctx.createBiquadFilter()
    hp.type = 'highpass'
    hp.frequency.value = 7000
    const g = ctx.createGain()
    g.gain.setValueAtTime(level, at)
    g.gain.exponentialRampToValueAtTime(0.001, at + 0.06)
    s.connect(hp)
    hp.connect(g)
    g.connect(master)
    s.start(at)
    s.stop(at + 0.08)
  }

  // ---- arrangement ----------------------------------------------------
  const progression = PROGRESSIONS[track.mode]
  const rootOctave = track.energy < 45 ? 0 : 1
  const leadOctave = track.energy < 45 ? 2 : 3
  const padGain = 0.1 + (1 - energy) * 0.14

  for (let b = 0; b < LOOP_BARS; b++) {
    const barStart = b * bar
    const chordDegree = progression[b % progression.length]

    // Pad: sustained triad across the bar
    if (track.energy < 90 || b % 2 === 0) {
      const notes = [0, 2, 4]
      for (const n of notes) {
        const midi = degreeToMidi(track.key, track.mode, chordDegree + n, rootOctave)
        padVoice(midiToFreq(midi), barStart, bar * 0.98, padGain / notes.length + 0.03)
      }
    }

    // Bass on beats 1 and 3 (+ syncopation for energetic tracks)
    const bassMidi = degreeToMidi(track.key, track.mode, chordDegree, rootOctave - 1)
    bassVoice(midiToFreq(bassMidi), barStart, beat * 0.9)
    bassVoice(midiToFreq(bassMidi), barStart + beat * 2, beat * 0.9)
    if (energy > 0.6 && rng() > 0.4) {
      bassVoice(midiToFreq(bassMidi), barStart + beat * 3.5, beat * 0.4)
    }

    // Melody: 8th-note grid, sparse when calm
    for (let step = 0; step < 8; step++) {
      const density = 0.28 + energy * 0.6
      if (rng() > density) continue
      const at = barStart + step * (beat / 2)
      const scale = MODE_INTERVALS[track.mode]
      const deg = chordDegree + Math.floor(rng() * (scale.length + 2))
      const midi = degreeToMidi(track.key, track.mode, deg, leadOctave)
      const dur = (beat / 2) * (rng() > 0.7 ? 2 : 1)
      leadVoice(midiToFreq(midi), at, dur * 0.92)
    }

    // Percussion
    if (track.energy > 34) {
      kick(barStart)
      kick(barStart + beat * 2)
      if (energy > 0.65) kick(barStart + beat * 3)
      snare(barStart + beat, 0.2 + energy * 0.3)
      snare(barStart + beat * 3, 0.2 + energy * 0.3)
    }
    if (track.energy > 48) {
      for (let h = 0; h < 4; h++) hat(barStart + h * beat, h % 2 === 1 ? 0.16 : 0.09)
    }
  }

  return await ctx.startRendering()
}

export interface EngineState {
  playing: boolean
  trackId: string | null
  volume: number
  muted: boolean
}

export class AudioEngine {
  private ctx: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private gain: GainNode | null = null
  private source: AudioBufferSourceNode | null = null
  private cache = new Map<string, AudioBuffer>()
  private loopDuration = 0
  private startedAt = 0
  private offset = 0
  private pausedAt = 0
  private playing = false
  private track: Track | null = null
  private endTimer: number | null = null
  private renderToken = 0

  onEnded: (() => void) | null = null
  onStateChange: ((s: EngineState) => void) | null = null

  private ensureCtx(): AudioContext | null {
    if (this.ctx) return this.ctx
    const AC: typeof AudioContext =
      (window as any).AudioContext || (window as any).webkitAudioContext
    if (!AC) return null
    this.ctx = new AC()
    this.gain = this.ctx.createGain()
    this.analyser = this.ctx.createAnalyser()
    this.analyser.fftSize = 256
    this.analyser.smoothingTimeConstant = 0.82
    this.gain.connect(this.analyser)
    this.analyser.connect(this.ctx.destination)
    return this.ctx
  }

  getAnalyser() {
    return this.analyser
  }

  get frequencyBinCount() {
    return this.analyser?.frequencyBinCount ?? 128
  }

  async resume() {
    const ctx = this.ensureCtx()
    if (ctx && ctx.state === 'suspended') await ctx.resume()
  }

  private emit() {
    this.onStateChange?.({
      playing: this.playing,
      trackId: this.track?.id ?? null,
      volume: this.gain?.gain.value ?? 1,
      muted: false,
    })
  }

  private async getBuffer(track: Track): Promise<AudioBuffer | null> {
    const cached = this.cache.get(track.id)
    if (cached) return cached
    const rendered = await renderLoop(track)
    if (rendered) {
      // keep a small cache to avoid unbounded memory growth
      if (this.cache.size > 6) {
        const firstKey = this.cache.keys().next().value
        if (firstKey) this.cache.delete(firstKey)
      }
      this.cache.set(track.id, rendered)
    }
    return rendered
  }

  private clearEndTimer() {
    if (this.endTimer !== null) {
      window.clearTimeout(this.endTimer)
      this.endTimer = null
    }
  }

  private scheduleEnd() {
    this.clearEndTimer()
    if (!this.track) return
    const remaining = this.track.duration - this.getPosition()
    if (remaining <= 0) return
    this.endTimer = window.setTimeout(() => {
      if (this.playing) this.onEnded?.()
    }, remaining * 1000 + 40)
  }

  private stopSource() {
    if (this.source) {
      try {
        this.source.onended = null
        this.source.stop()
      } catch {
        /* already stopped */
      }
      this.source.disconnect()
      this.source = null
    }
  }

  async load(track: Track, autoplay: boolean, startOffset = 0) {
    const ctx = this.ensureCtx()
    if (!ctx) return
    await this.resume()
    const token = ++this.renderToken
    this.track = track
    this.stopSource()
    this.clearEndTimer()
    this.playing = false

    const buffer = await this.getBuffer(track)
    if (token !== this.renderToken) return // superseded by a newer load
    if (!buffer) return
    this.loopDuration = buffer.duration
    this.offset = startOffset % buffer.duration
    this.pausedAt = startOffset
    if (autoplay) this.startSource()
    this.emit()
  }

  private startSource() {
    const ctx = this.ctx
    if (!ctx || !this.track) return
    this.stopSource()
    const buffer = this.cache.get(this.track.id)
    if (!buffer) return
    const src = ctx.createBufferSource()
    src.buffer = buffer
    src.loop = true
    src.loopStart = 0
    src.loopEnd = buffer.duration
    src.connect(this.gain!)
    src.start(0, this.offset % buffer.duration)
    this.source = src
    this.startedAt = ctx.currentTime
    this.pausedAt = this.offset
    this.playing = true
    this.scheduleEnd()
    this.emit()
  }

  play() {
    if (!this.track) return
    if (this.playing) return
    const ctx = this.ensureCtx()
    if (!ctx) return
    void this.resume()
    this.offset = this.pausedAt
    this.startSource()
  }

  pause() {
    if (!this.playing) return
    this.pausedAt = this.getPosition()
    this.playing = false
    this.clearEndTimer()
    this.stopSource()
    this.emit()
  }

  toggle() {
    if (this.playing) this.pause()
    else this.play()
  }

  seek(position: number) {
    if (!this.track) return
    const clamped = Math.max(0, Math.min(position, this.track.duration))
    this.pausedAt = clamped
    this.offset = clamped
    if (this.playing) this.startSource()
    else this.emit()
  }

  setVolume(v: number) {
    const ctx = this.ensureCtx()
    if (!ctx || !this.gain) return
    this.gain.gain.value = Math.max(0, Math.min(1, v))
    this.emit()
  }

  getPosition(): number {
    if (!this.track) return 0
    if (!this.playing || !this.ctx) return this.pausedAt
    const elapsed = this.ctx.currentTime - this.startedAt
    return (this.offset + elapsed) % this.track.duration
  }

  isPlaying() {
    return this.playing
  }

  currentTrackId() {
    return this.track?.id ?? null
  }

  /** Preview a short slice of a track without disturbing main playback. */
  async preview(track: Track, seconds = 6) {
    const ctx = this.ensureCtx()
    if (!ctx) return
    await this.resume()
    const buffer = await this.getBuffer(track)
    if (!buffer) return
    const src = ctx.createBufferSource()
    src.buffer = buffer
    src.loop = true
    src.loopEnd = Math.min(buffer.duration, seconds)
    const g = ctx.createGain()
    g.gain.value = this.gain?.gain.value ?? 1
    src.connect(g)
    g.connect(this.analyser!)
    src.start(0, 0)
    window.setTimeout(() => {
      try {
        src.stop()
      } catch {
        /* noop */
      }
      src.disconnect()
      g.disconnect()
    }, seconds * 1000)
  }
}

export const engine = new AudioEngine()
