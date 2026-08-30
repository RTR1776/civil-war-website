/**
 * The sound of the field, synthesized. No audio files ship with this site —
 * every layer here is generated from noise and oscillators at run time, the
 * same way the map and the terrain are drawn rather than photographed.
 *
 * Three layers, all driven by the battle clock:
 *   wind      a bed of filtered noise, colder and thinner after dark
 *   musketry  a continuous roll plus individual cracks fired at a Poisson
 *             rate set by the intensity curve
 *   artillery low sweeps with a long tail off the hills
 */

export interface AudioInputs {
  /** 0..1 volume of fire, from the casualty-rate curve. */
  intensity: number;
  /** 0..1 darkness. */
  night: number;
}

/** Scheduler cadence: wake often, queue a little ahead of the clock. */
const TICK_MS = 120;
const SCHEDULE_AHEAD_S = 0.28;

/** Cracks per second at full intensity. */
const MAX_MUSKET_RATE = 30;
/** Guns per second at full intensity. */
const MAX_GUN_RATE = 0.9;

const POP_VARIANTS = 7;
const BOOM_VARIANTS = 4;

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * One musket, at a few hundred yards: a hard transient, a short band-limited
 * crack, and almost no tail. Shaped with one-pole filters in the sample loop
 * so no filter nodes are needed per shot.
 */
export function renderMusketPop(context: BaseAudioContext, random: () => number): AudioBuffer {
  const duration = 0.11;
  const length = Math.floor(context.sampleRate * duration);
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const data = buffer.getChannelData(0);

  // Vary the voice of each shot a little so a volley is not one sound repeated.
  const decay = 42 + random() * 34;
  const lowCut = 0.55 + random() * 0.2;
  const highCut = 0.24 + random() * 0.16;

  let lowState = 0;
  let highState = 0;

  for (let index = 0; index < length; index += 1) {
    const t = index / context.sampleRate;
    const white = random() * 2 - 1;

    lowState += highCut * (white - lowState);
    highState += lowCut * (lowState - highState);
    const band = lowState - highState;

    // A very short click rides on the front of the crack.
    const transient = t < 0.0016 ? (1 - t / 0.0016) * 0.9 : 0;
    data[index] = (band * 2.4 + transient) * Math.exp(-t * decay);
  }

  return buffer;
}

/**
 * A gun: a falling sine from the muzzle blast, a lowpassed noise body, and a
 * long soft tail standing in for the roll back off the Harpeth hills.
 */
export function renderCannonBoom(context: BaseAudioContext, random: () => number): AudioBuffer {
  const duration = 2.4;
  const length = Math.floor(context.sampleRate * duration);
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const data = buffer.getChannelData(0);

  const startHz = 78 + random() * 26;
  const endHz = 24 + random() * 10;
  const bodyDecay = 5.5 + random() * 2.4;
  const tailDecay = 1.5 + random() * 0.9;

  let phase = 0;
  let lowState = 0;

  for (let index = 0; index < length; index += 1) {
    const t = index / context.sampleRate;
    const sweep = Math.min(1, t / 0.5);
    const hz = startHz + (endHz - startHz) * sweep;
    phase += (2 * Math.PI * hz) / context.sampleRate;

    const white = random() * 2 - 1;
    lowState += 0.045 * (white - lowState);

    const body = Math.sin(phase) * Math.exp(-t * bodyDecay);
    const rumble = lowState * 5.5 * Math.exp(-t * tailDecay);
    const crack = t < 0.02 ? white * (1 - t / 0.02) * 0.5 : 0;

    data[index] = (body * 0.85 + rumble + crack) * 0.7;
  }

  return buffer;
}

/** Two seconds of noise, looped as the bed for wind and the musketry roll. */
export function renderNoiseBed(context: BaseAudioContext, random: () => number): AudioBuffer {
  const length = Math.floor(context.sampleRate * 2);
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const data = buffer.getChannelData(0);

  let brown = 0;
  for (let index = 0; index < length; index += 1) {
    const white = random() * 2 - 1;
    brown = (brown + white * 0.02) / 1.02;
    data[index] = brown * 3.2;
  }

  // Cross-fade the seam so the loop does not tick.
  const fade = Math.floor(context.sampleRate * 0.05);
  for (let index = 0; index < fade; index += 1) {
    const blend = index / fade;
    data[index] = data[index] * blend + data[length - fade + index] * (1 - blend);
  }

  return buffer;
}

export class BattlefieldAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private windGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private rollGain: GainNode | null = null;
  private rollFilter: BiquadFilterNode | null = null;
  private fieldSend: GainNode | null = null;
  private sources: AudioBufferSourceNode[] = [];

  private popBuffers: AudioBuffer[] = [];
  private boomBuffers: AudioBuffer[] = [];

  private timer: ReturnType<typeof setInterval> | null = null;
  private nextPopAt = 0;
  private nextBoomAt = 0;
  private random = mulberry32(0x5f375a86);

  private inputs: AudioInputs = { intensity: 0, night: 0 };
  private volume = 0.7;

  get running(): boolean {
    return this.context !== null;
  }

  /**
   * Must be called from a user gesture — browsers will not let an audio
   * context start otherwise.
   */
  async start(): Promise<void> {
    if (this.context) {
      await this.context.resume();
      return;
    }

    const Ctor =
      window.AudioContext
      ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) {
      throw new Error("Web Audio is not available in this browser.");
    }

    const context = new Ctor();
    this.context = context;

    const master = context.createGain();
    master.gain.value = 0;
    master.connect(context.destination);
    this.master = master;

    // A pair of delays standing in for the sound coming back off the valley
    // walls. Cheap, and it pushes everything into the middle distance.
    const send = context.createGain();
    send.gain.value = 0.32;
    this.fieldSend = send;

    for (const [delayTime, feedbackAmount] of [[0.089, 0.32], [0.147, 0.26]] as const) {
      const delay = context.createDelay(0.5);
      delay.delayTime.value = delayTime;
      const feedback = context.createGain();
      feedback.gain.value = feedbackAmount;
      const damping = context.createBiquadFilter();
      damping.type = "lowpass";
      damping.frequency.value = 1400;

      send.connect(delay);
      delay.connect(damping);
      damping.connect(feedback);
      feedback.connect(delay);
      damping.connect(master);
    }

    this.popBuffers = Array.from({ length: POP_VARIANTS }, () =>
      renderMusketPop(context, this.random),
    );
    this.boomBuffers = Array.from({ length: BOOM_VARIANTS }, () =>
      renderCannonBoom(context, this.random),
    );

    const noise = renderNoiseBed(context, this.random);

    // Wind bed.
    const windFilter = context.createBiquadFilter();
    windFilter.type = "bandpass";
    windFilter.frequency.value = 420;
    windFilter.Q.value = 0.65;
    const windGain = context.createGain();
    windGain.gain.value = 0.1;
    windFilter.connect(windGain);
    windGain.connect(master);
    this.windFilter = windFilter;
    this.windGain = windGain;
    this.playLoop(noise, windFilter, 0.8);

    // Slow gusting, so the bed never sits still.
    const gust = context.createOscillator();
    gust.frequency.value = 0.06;
    const gustDepth = context.createGain();
    gustDepth.gain.value = 0.045;
    gust.connect(gustDepth);
    gustDepth.connect(windGain.gain);
    gust.start();

    // The roll: the continuous crackle of massed small arms under the
    // individual cracks.
    const rollFilter = context.createBiquadFilter();
    rollFilter.type = "bandpass";
    rollFilter.frequency.value = 1500;
    rollFilter.Q.value = 0.8;
    const rollGain = context.createGain();
    rollGain.gain.value = 0;
    rollFilter.connect(rollGain);
    rollGain.connect(master);
    rollGain.connect(send);
    this.rollFilter = rollFilter;
    this.rollGain = rollGain;
    this.playLoop(noise, rollFilter, 1.13);

    this.nextPopAt = context.currentTime;
    this.nextBoomAt = context.currentTime + 1.2;

    await context.resume();
    master.gain.setTargetAtTime(this.volume, context.currentTime, 0.6);

    this.timer = setInterval(() => this.schedule(), TICK_MS);
  }

  private playLoop(buffer: AudioBuffer, destination: AudioNode, rate: number) {
    const context = this.context;
    if (!context) {
      return;
    }

    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.playbackRate.value = rate;
    source.connect(destination);
    source.start();
    this.sources.push(source);
  }

  setVolume(value: number) {
    this.volume = Math.max(0, Math.min(1, value));
    if (this.context && this.master) {
      this.master.gain.setTargetAtTime(this.volume, this.context.currentTime, 0.12);
    }
  }

  /** Called a few times a second with the current state of the field. */
  update(inputs: AudioInputs) {
    this.inputs = inputs;

    const context = this.context;
    if (!context) {
      return;
    }

    const now = context.currentTime;
    const { intensity, night } = inputs;

    // The wind thins and rises in pitch as the temperature drops after dark.
    if (this.windGain && this.windFilter) {
      this.windGain.gain.setTargetAtTime(0.075 + night * 0.05, now, 0.9);
      this.windFilter.frequency.setTargetAtTime(400 + night * 260, now, 1.4);
    }

    // The roll only becomes a roll once a lot of muskets are going at once.
    if (this.rollGain && this.rollFilter) {
      const roll = intensity ** 1.7 * 0.3;
      this.rollGain.gain.setTargetAtTime(roll, now, 0.35);
      this.rollFilter.frequency.setTargetAtTime(1250 + intensity * 700, now, 0.6);
    }
  }

  /** Queue the discrete shots that fall inside the lookahead window. */
  private schedule() {
    const context = this.context;
    if (!context || context.state !== "running") {
      return;
    }

    const horizon = context.currentTime + SCHEDULE_AHEAD_S;
    const { intensity } = this.inputs;

    const musketRate = MAX_MUSKET_RATE * intensity ** 1.35;
    if (musketRate > 0.05) {
      this.nextPopAt = Math.max(this.nextPopAt, context.currentTime);
      while (this.nextPopAt < horizon) {
        this.fire(this.popBuffers, this.nextPopAt, 0.20 + this.random() * 0.3, 0.9);
        // Poisson arrivals: exponential gaps give a natural, uneven crackle.
        this.nextPopAt += -Math.log(1 - this.random()) / musketRate;
      }
    } else {
      this.nextPopAt = context.currentTime;
    }

    const gunRate = MAX_GUN_RATE * intensity;
    if (gunRate > 0.02) {
      this.nextBoomAt = Math.max(this.nextBoomAt, context.currentTime);
      while (this.nextBoomAt < horizon) {
        this.fire(this.boomBuffers, this.nextBoomAt, 0.5 + this.random() * 0.35, 0.55);
        this.nextBoomAt += -Math.log(1 - this.random()) / gunRate;
      }
    } else {
      this.nextBoomAt = context.currentTime;
    }
  }

  private fire(buffers: AudioBuffer[], when: number, gainValue: number, spread: number) {
    const context = this.context;
    const master = this.master;
    const send = this.fieldSend;
    if (!context || !master || buffers.length === 0) {
      return;
    }

    const source = context.createBufferSource();
    source.buffer = buffers[Math.floor(this.random() * buffers.length)];
    // Detune by resampling; the line was a mile wide and no two shots matched.
    source.playbackRate.value = 0.86 + this.random() * 0.3;

    const gain = context.createGain();
    gain.gain.value = gainValue;

    const pan = context.createStereoPanner();
    pan.pan.value = (this.random() * 2 - 1) * spread;

    source.connect(gain);
    gain.connect(pan);
    pan.connect(master);
    if (send) {
      pan.connect(send);
    }

    source.start(when);
    source.onended = () => {
      source.disconnect();
      gain.disconnect();
      pan.disconnect();
    };
  }

  /** Fade out and tear the graph down. */
  stop() {
    const context = this.context;
    if (!context) {
      return;
    }

    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    if (this.master) {
      this.master.gain.setTargetAtTime(0, context.currentTime, 0.15);
    }

    for (const source of this.sources) {
      try {
        source.stop(context.currentTime + 0.6);
      } catch {
        // Already stopped.
      }
    }
    this.sources = [];

    const closing = context;
    this.context = null;
    this.master = null;
    this.windGain = null;
    this.windFilter = null;
    this.rollGain = null;
    this.rollFilter = null;
    this.fieldSend = null;
    this.popBuffers = [];
    this.boomBuffers = [];

    setTimeout(() => {
      void closing.close().catch(() => undefined);
    }, 700);
  }
}
