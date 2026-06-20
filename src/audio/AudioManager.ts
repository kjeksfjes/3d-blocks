/**
 * Module-level audio engine — lives outside React; components/frame loops push
 * events in. Glitch-proofing principles (see blk-246.7.1):
 *   - One shared master chain ending in a limiter, so no number of summed voices
 *     can hard-clip the output.
 *   - A hard voice cap on one-shot transients, so a burst of impacts can never
 *     starve the audio thread by scheduling hundreds of nodes at once.
 *   - Lazy start: the AudioContext is created/resumed only after a user gesture
 *     (browser autoplay policy).
 *
 * This slice implements the TRANSIENT layer (discrete impact clacks). The
 * aggregate "bed" rumble layer comes later.
 */

const MAX_VOICES = 24 // concurrent one-shot transients; excess impacts are dropped
const NOISE_SECONDS = 0.3 // length of the cached white-noise source buffer
const BED_SECONDS = 2 // length of the looping bed-noise buffer
const BED_MAX_GAIN = 0.5 // loudness of the rumble bed at full energy
const BED_ATTACK = 0.45 // per-frame rise toward target (fast swell)
const BED_RELEASE = 0.05 // per-frame fall toward target (slow tail-off)

export type Material = 'brick' | 'metal'

// Sample slots loaded from /sounds at first start. Drop files named like
// `brick-1.ogg` (or .wav/.mp3) into public/sounds — each slot tries those
// extensions in order. More variants = less repetition. Missing slots are
// skipped; if none load we fall back to the procedural synth.
const BRICK_SLOTS = ['brick-alt-1', 'brick-alt-2', 'brick-alt-3', 'brick-alt-4', 'brick-alt-5', 'brick-alt-6', 'brick-alt-7']
const METAL_SLOTS = ['ball-1', 'ball-2', 'ball-3', 'ball-4']
const SAMPLE_EXTS = ['ogg', 'wav', 'mp3']

class AudioManager {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null // user volume
  private noise: AudioBuffer | null = null // cached white noise, reused per clack
  private bedGain: GainNode | null = null // gain of the continuous rumble bed
  private bedLevel = 0 // JS-smoothed bed amplitude (0..1)
  private brickBuffers: AudioBuffer[] = [] // decoded impact samples (empty -> synth)
  private metalBuffers: AudioBuffer[] = []
  private samplesRequested = false
  private voices = 0 // live transient count, for the cap
  private volume = 0.7
  private muted = false
  // Rigid-body handles that should sound metallic (the steel balls); everything
  // else the sampler treats as brick.
  private readonly projectiles = new Set<number>()

  /** Create the context + master chain on first call; resume it if suspended.
   *  Safe to call on every gesture — it no-ops once running. */
  start() {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      if (!Ctor) return
      const ctx = new Ctor()

      // master gain -> limiter -> destination. The limiter is a compressor tuned
      // hard (high ratio, low threshold, fast attack) so peaks are caught rather
      // than clipped when many voices sum on a big collapse.
      const master = ctx.createGain()
      const limiter = ctx.createDynamicsCompressor()
      limiter.threshold.value = -6
      limiter.knee.value = 0
      limiter.ratio.value = 20
      limiter.attack.value = 0.002
      limiter.release.value = 0.12
      master.connect(limiter).connect(ctx.destination)

      // One white-noise buffer, reused by every clack (cheap; only the per-voice
      // filter/envelope nodes are created per impact).
      const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * NOISE_SECONDS), ctx.sampleRate)
      const data = buf.getChannelData(0)
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1

      // Bed layer: ONE looping voice of low-passed brown-ish noise whose gain
      // tracks aggregate collision energy. A collapse swells this into a rumble —
      // one voice, so no number of simultaneous impacts can clip or starve it.
      const bedBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * BED_SECONDS), ctx.sampleRate)
      const bedData = bedBuf.getChannelData(0)
      let brown = 0
      for (let i = 0; i < bedData.length; i++) {
        brown = (brown + (Math.random() * 2 - 1) * 0.05) / 1.02 // integrate -> low-frequency rumble
        bedData[i] = brown * 3.2
      }
      const bedSrc = ctx.createBufferSource()
      bedSrc.buffer = bedBuf
      bedSrc.loop = true
      const bedFilter = ctx.createBiquadFilter()
      bedFilter.type = 'lowpass'
      bedFilter.frequency.value = 650
      const bedGain = ctx.createGain()
      bedGain.gain.value = 0
      bedSrc.connect(bedFilter).connect(bedGain).connect(master)
      bedSrc.start()

      this.ctx = ctx
      this.master = master
      this.noise = buf
      this.bedGain = bedGain
      this.applyGain()
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume()
    void this.loadSamples()
  }

  /** Fetch + decode the impact samples once. Each slot tries the supported
   *  extensions in order; missing files are skipped. If nothing loads, impact()
   *  stays on the procedural synth. */
  private async loadSamples() {
    if (this.samplesRequested || !this.ctx) return
    this.samplesRequested = true
    const ctx = this.ctx

    const loadSlot = async (slot: string): Promise<AudioBuffer | null> => {
      for (const ext of SAMPLE_EXTS) {
        let res: Response
        try {
          res = await fetch(`sounds/${slot}.${ext}`)
        } catch (e) {
          console.warn(`[audio] fetch failed for ${slot}.${ext}`, e)
          continue
        }
        if (!res.ok) continue // slot/extension not present
        // A missing asset under Vite's dev server returns index.html (200, text/html)
        // via the SPA fallback rather than a 404, so confirm we actually got audio
        // before decoding — otherwise an absent slot looks like a decode failure.
        const type = res.headers.get('content-type') ?? ''
        if (!/audio|ogg|mpeg|wav/i.test(type)) continue
        // Real audio file — a decode failure here is a genuine problem (e.g. the
        // browser can't decode this codec), so surface it rather than swallow it.
        try {
          return await ctx.decodeAudioData(await res.arrayBuffer())
        } catch (e) {
          console.error(`[audio] decode failed for ${slot}.${ext} (codec unsupported?)`, e)
          return null
        }
      }
      return null
    }
    const loadAll = async (slots: string[]) =>
      (await Promise.all(slots.map(loadSlot))).filter((b): b is AudioBuffer => b !== null)

    this.brickBuffers = await loadAll(BRICK_SLOTS)
    this.metalBuffers = await loadAll(METAL_SLOTS)
    console.info(`[audio] samples loaded — ${this.brickBuffers.length} brick, ${this.metalBuffers.length} metal`)
    if (!this.brickBuffers.length) {
      console.warn('[audio] no brick samples decoded from /sounds — using procedural fallback')
    }
  }

  /** Whether sound can currently be heard. The sampler checks this to skip its
   *  per-frame body scan entirely when muted/silent — that scan is the expensive
   *  part, so muting genuinely costs nothing. */
  isAudible() {
    return !!this.ctx && !this.muted && this.volume > 0
  }

  /** Register/forget a rigid-body handle as a metal projectile. */
  addProjectile(handle: number) {
    this.projectiles.add(handle)
  }
  removeProjectile(handle: number) {
    this.projectiles.delete(handle)
  }
  isProjectile(handle: number) {
    return this.projectiles.has(handle)
  }

  setVolume(v: number) {
    this.volume = v
    this.applyGain()
  }

  setMuted(m: boolean) {
    this.muted = m
    this.applyGain()
  }

  private applyGain() {
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume, this.ctx.currentTime, 0.01)
    }
  }

  /**
   * Play one impact, choosing a timbre by material:
   *   - 'brick' — a dry, dead, stony knock (damped noise, no ring). The default,
   *     used for the blocks themselves.
   *   - 'metal' — a ringing inharmonic clank, used for the steel ball.
   * `intensity` is 0..1 (soft tap -> hard slam).
   */
  impact(intensity: number, material: Material = 'brick', variant = Math.random()) {
    const ctx = this.ctx
    if (!ctx || !this.master || this.muted) return
    if (this.voices >= MAX_VOICES) return // cap: drop rather than starve the thread

    const i = Math.max(0, Math.min(1, intensity))
    const v = Math.max(0, Math.min(1, variant))
    const now = ctx.currentTime

    const buffers = material === 'metal' ? this.metalBuffers : this.brickBuffers
    if (buffers.length) {
      // Bricks get a wider random pitch spread so repeats don't sound alike; the
      // ball is left tighter (it already sounds right).
      this.playSample(ctx, buffers, i, now, material === 'metal' ? 0.09 : 0.18)
      return
    }
    // Procedural fallback (used until samples load, or if none are present).
    if (!this.noise) return
    if (material === 'metal') this.metal(ctx, i, now, v)
    else this.brick(ctx, i, now, v)
  }

  /** Play a recorded impact: a RANDOM sample each hit so repeats don't sound
   *  identical, with a random pitch nudge of ±`spread` (and a touch lower for
   *  harder hits). Intensity sets loudness. */
  private playSample(ctx: AudioContext, buffers: AudioBuffer[], i: number, now: number, spread: number) {
    const buf = buffers[Math.floor(Math.random() * buffers.length)]
    const src = ctx.createBufferSource()
    src.buffer = buf
    // Random pitch ONLY downward (deeper, never lighter): playbackRate in
    // [1 - spread, 1], plus a touch lower for harder hits.
    src.playbackRate.value = (1 - Math.random() * spread) * (1 - i * 0.06)
    const g = ctx.createGain()
    // Wide dynamic range: a soft tip-over (low i) stays quiet, a hard slam is loud.
    g.gain.value = 0.03 + Math.pow(i, 0.85) * 0.95

    src.connect(g).connect(this.master!)
    this.voices++
    src.onended = () => {
      this.voices--
      src.disconnect()
      g.disconnect()
    }
    src.start(now)
  }

  /**
   * Dry stone/concrete knock — no ring. Three layers from one noise burst:
   *   - a low THUD (~90-160 Hz) that gives concrete its weight (the part that was
   *     missing, making it sound like a light plastic chip);
   *   - a resonant mid KNOCK whose pitch is set by `variant` so each block has its
   *     own voice — a wide spread across a pile instead of one homogenous tick;
   *   - a faint, very short GRIT for the surface contact.
   * `variant` (0..1) is stable per block (hashed from its handle), so a given block
   * always sounds like the same object; per-hit jitter adds the rest.
   */
  private brick(ctx: AudioContext, i: number, now: number, variant: number) {
    const loud = Math.sqrt(i)
    const jit = (spread: number) => 1 + (Math.random() - 0.5) * spread
    const master = this.master!
    // Smaller blocks (high variant) ring shorter; bigger hits last a touch longer.
    const decay = 0.06 + (1 - variant) * 0.07 + i * 0.05

    const src = ctx.createBufferSource()
    src.buffer = this.noise!
    src.playbackRate.value = 0.5 + Math.random() * 0.7

    const layer = (
      filter: BiquadFilterNode,
      peak: number,
      d: number,
    ): [BiquadFilterNode, GainNode] => {
      const env = ctx.createGain()
      env.gain.setValueAtTime(0.0001, now)
      env.gain.exponentialRampToValueAtTime(peak, now + 0.001)
      env.gain.exponentialRampToValueAtTime(0.0001, now + 0.001 + d)
      src.connect(filter).connect(env).connect(master)
      return [filter, env]
    }

    // Low thud — the concrete weight. Lower for bigger blocks (low variant).
    const thud = ctx.createBiquadFilter()
    thud.type = 'lowpass'
    thud.frequency.value = (90 + variant * 70) * jit(0.12)
    // Resonant mid knock — the per-block "tock"; WIDE pitch spread by variant.
    const knock = ctx.createBiquadFilter()
    knock.type = 'bandpass'
    knock.frequency.value = (150 + variant * 430) * jit(0.18)
    knock.Q.value = 3 + variant * 3
    // Surface grit — faint, brief, broadband.
    const grit = ctx.createBiquadFilter()
    grit.type = 'bandpass'
    grit.frequency.value = (800 + variant * 1000) * jit(0.25)
    grit.Q.value = 0.8

    const parts = [
      layer(thud, 0.16 + loud * 0.55, decay),
      layer(knock, 0.09 + loud * 0.38, decay * 0.8),
      layer(grit, 0.04 + loud * 0.12, 0.015 + i * 0.02),
    ]
    const nodes: AudioNode[] = [src, ...parts.flat()]

    this.voices++
    let released = false
    src.onended = () => {
      if (released) return
      released = true
      this.voices--
      for (const n of nodes) n.disconnect()
    }
    src.start(now)
    src.stop(now + 0.001 + decay + 0.02)
  }

  /**
   * Metallic "clank" via modal synthesis: a bank of INHARMONIC sine partials
   * (what makes metal read as metal rather than a pitched wooden tone) ringing
   * over a short, bright noise "chink" of contact. Jittered per hit.
   */
  private metal(ctx: AudioContext, i: number, now: number, variant: number) {
    const loud = Math.sqrt(i) // sqrt keeps soft hits audible, hard ones in check
    const rnd = (spread: number) => 1 + (Math.random() - 0.5) * spread

    // Inharmonic ratios (not integer multiples) — the signature of struck metal.
    // Higher partials are quieter and die faster, like a real ringing object.
    const RATIOS = [1, 1.48, 2.1, 2.74, 3.79]
    // variant spreads the pitch across hits; harder hits ring a touch lower/heavier.
    const f0 = (620 + variant * 320 - i * 130) * rnd(0.08)
    const ring = 0.16 + i * 0.5 // metal sustains; bigger hits ring longer

    const nodes: AudioNode[] = []
    const oscs: OscillatorNode[] = []
    RATIOS.forEach((r, k) => {
      const f = f0 * r * rnd(0.02)
      const decay = ring * Math.pow(0.62, k) // upper partials decay sooner
      const peak = (0.42 / (k + 1.4)) * (0.25 + loud) // and start quieter
      const osc = ctx.createOscillator()
      osc.type = 'sine'
      osc.frequency.value = f
      const env = ctx.createGain()
      env.gain.setValueAtTime(0.0001, now)
      env.gain.exponentialRampToValueAtTime(peak, now + 0.001)
      env.gain.exponentialRampToValueAtTime(0.0001, now + 0.001 + decay)
      osc.connect(env).connect(this.master!)
      const end = now + 0.001 + decay + 0.02
      osc.start(now)
      osc.stop(end)
      oscs.push(osc)
      nodes.push(osc, env)
    })

    // Bright, very short noise "chink" — the metallic contact transient.
    const src = ctx.createBufferSource()
    src.buffer = this.noise
    src.playbackRate.value = 0.9 + Math.random() * 0.4
    const hp = ctx.createBiquadFilter()
    hp.type = 'highpass'
    hp.frequency.value = 2500 // keep only the bright contact crack
    const chinkEnv = ctx.createGain()
    const chinkDecay = 0.02 + i * 0.03
    chinkEnv.gain.setValueAtTime(0.0001, now)
    chinkEnv.gain.exponentialRampToValueAtTime(0.1 + loud * 0.3, now + 0.0008)
    chinkEnv.gain.exponentialRampToValueAtTime(0.0001, now + 0.0008 + chinkDecay)
    src.connect(hp).connect(chinkEnv).connect(this.master!)
    nodes.push(src, hp, chinkEnv)

    // One voice slot per impact, freed when the longest-ringing partial ends.
    this.voices++
    let released = false
    const release = () => {
      if (released) return
      released = true
      this.voices--
      for (const n of nodes) n.disconnect()
    }
    oscs[0].onended = release // the fundamental rings longest
    src.start(now)
    src.stop(now + 0.0008 + chinkDecay + 0.02)
  }

  /** Drive the rumble bed from aggregate collision energy this frame (0..1).
   *  Smoothed JS-side with a fast attack / slow release so it swells on a
   *  collapse and tails off naturally. Call every frame. */
  bed(energy: number) {
    if (!this.bedGain || !this.ctx) return
    const target = Math.max(0, Math.min(1, energy))
    const coef = target > this.bedLevel ? BED_ATTACK : BED_RELEASE
    this.bedLevel += (target - this.bedLevel) * coef
    // Curve up the level so the bed stays subtle for light activity and only
    // really blooms when a lot is happening at once.
    const g = this.bedLevel * this.bedLevel * BED_MAX_GAIN
    this.bedGain.gain.setTargetAtTime(g, this.ctx.currentTime, 0.02)
  }
}

export const audioManager = new AudioManager()
