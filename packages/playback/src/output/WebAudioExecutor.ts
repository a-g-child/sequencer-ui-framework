import {
  BaseExecutionExecutor,
  type ExecutionProcessContext,
  type ExecutionProcessResult,
  type RuntimeAudioGraph
} from '@sequencer/audio-graph'

export interface WebAudioOscillatorStartOptions {
  readonly waveform: OscillatorType
  readonly pitch: number
  readonly glide?: {
    readonly startPitch: number
    readonly time: number
  }
  readonly startTime: number
}

export interface WebAudioFilterNodeOptions {
  readonly cutoff: number
  readonly resonance: number
  readonly keyTracking: number
  readonly pitch: number
  readonly time: number
  readonly immediate?: boolean
}

export interface WebAudioSamplePlayerNodeOptions {
  readonly buffer: AudioBuffer
  readonly playbackRate: number
  readonly loopEnabled: boolean
  readonly loopStartSeconds?: number
  readonly loopEndSeconds?: number
  readonly startTime: number
}

export interface WebAudioSampleStartOptions {
  readonly startTime: number
  readonly offset: number
  readonly duration?: number
}

export interface WebAudioSampleStopOptions {
  readonly stopTime: number
}

export interface WebAudioEnvelopeGainNodeOptions {
  readonly peakGain: number
  readonly sustainGain: number
  readonly startTime: number
  readonly attackTime: number
  readonly decayTime: number
}

export interface WebAudioEnvelopeReleaseOptions {
  readonly startTime: number
  readonly stopTime: number
}

export interface WebAudioGainNodeOptions {
  readonly gain: number
  readonly time: number
  readonly immediate?: boolean
}

export interface WebAudioPanNodeOptions {
  readonly pan: number
  readonly time: number
  readonly immediate?: boolean
}

export interface WebAudioDelayNodeOptions {
  readonly delayTime: number
  readonly feedback: number
  readonly mix: number
  readonly time: number
  readonly immediate?: boolean
}

export interface WebAudioDelayNodeChain {
  readonly input: GainNode
  readonly delay: DelayNode
  readonly feedback: GainNode
  readonly dry: GainNode
  readonly wet: GainNode
  readonly output: GainNode
}

export class WebAudioExecutor extends BaseExecutionExecutor {
  private oscillatorNodeId?: string
  private samplePlayerNodeId?: string
  private filterNodeId?: string
  private envelopeGainNodeId?: string
  private gainNodeId?: string
  private panNodeId?: string
  private mixerNodeId?: string
  private delayNodeId?: string
  private outputNodeId?: string

  constructor() {
    super('web-audio-executor', 'WebAudio Executor')
  }

  override async initialise(graph: RuntimeAudioGraph): Promise<void> {
    await super.initialise(graph)
    this.oscillatorNodeId = graph.nodes.find(
      (node) => node.descriptorId === 'sequencer.source.oscillator'
    )?.id
    this.samplePlayerNodeId = graph.nodes.find(
      (node) => node.descriptorId === 'sequencer.source.sample-player'
    )?.id
    this.filterNodeId = graph.nodes.find(
      (node) => node.descriptorId === 'sequencer.processor.filter'
    )?.id
    this.envelopeGainNodeId = graph.nodes.find(
      (node) => node.descriptorId === 'sequencer.processor.adsr-gain'
    )?.id
    this.gainNodeId = graph.nodes.find(
      (node) => node.descriptorId === 'sequencer.processor.gain'
    )?.id
    this.panNodeId = graph.nodes.find(
      (node) => node.descriptorId === 'sequencer.processor.pan'
    )?.id
    this.mixerNodeId = graph.nodes.find(
      (node) => node.descriptorId === 'sequencer.processor.mixer'
    )?.id
    this.delayNodeId = graph.nodes.find(
      (node) => node.descriptorId === 'sequencer.processor.delay'
    )?.id
    this.outputNodeId = graph.nodes.find(
      (node) => node.descriptorId === 'sequencer.output.audio-out'
    )?.id
  }

  materialiseOscillatorNode(
    context: AudioContext,
    options: WebAudioOscillatorStartOptions
  ): OscillatorNode {
    if (!this.oscillatorNodeId) {
      throw new Error('WebAudioExecutor has no oscillator node in its graph')
    }

    const oscillator = context.createOscillator()

    oscillator.type = options.waveform
    configureOscillatorFrequency(oscillator, options)

    return oscillator
  }

  materialiseFilterNode(
    context: AudioContext,
    options: WebAudioFilterNodeOptions
  ): BiquadFilterNode {
    if (!this.filterNodeId) {
      throw new Error('WebAudioExecutor has no filter node in its graph')
    }

    const filter = context.createBiquadFilter()

    configureFilter(filter, options)

    return filter
  }

  materialiseSamplePlayerNode(
    context: AudioContext,
    options: WebAudioSamplePlayerNodeOptions
  ): AudioBufferSourceNode {
    if (!this.samplePlayerNodeId) {
      throw new Error('WebAudioExecutor has no sample-player node in its graph')
    }

    const source = context.createBufferSource()

    source.buffer = options.buffer
    source.playbackRate.setValueAtTime(
      Math.max(0.001, options.playbackRate),
      options.startTime
    )
    source.loop = options.loopEnabled
    if (options.loopStartSeconds !== undefined) {
      source.loopStart = Math.max(0, options.loopStartSeconds)
    }
    if (options.loopEndSeconds !== undefined) {
      source.loopEnd = options.loopEndSeconds
    }

    return source
  }

  triggerSamplePlayerNode(
    source: AudioBufferSourceNode,
    options: WebAudioSampleStartOptions
  ): void {
    if (!this.samplePlayerNodeId) {
      throw new Error('WebAudioExecutor has no sample-player node in its graph')
    }

    if (options.duration === undefined) {
      source.start(options.startTime, options.offset)
      return
    }

    source.start(options.startTime, options.offset, options.duration)
  }

  stopSamplePlayerNode(
    source: AudioBufferSourceNode,
    options: WebAudioSampleStopOptions
  ): void {
    if (!this.samplePlayerNodeId) {
      throw new Error('WebAudioExecutor has no sample-player node in its graph')
    }

    source.stop(options.stopTime)
  }

  materialiseAdsrGainNode(
    context: AudioContext,
    options: WebAudioEnvelopeGainNodeOptions
  ): GainNode {
    if (!this.envelopeGainNodeId) {
      throw new Error('WebAudioExecutor has no envelope gain node in its graph')
    }

    const gain = context.createGain()

    gain.gain.cancelScheduledValues(options.startTime)
    gain.gain.setValueAtTime(0, options.startTime)
    gain.gain.linearRampToValueAtTime(options.peakGain, options.attackTime)
    gain.gain.linearRampToValueAtTime(options.sustainGain, options.decayTime)

    return gain
  }

  releaseAdsrGainNode(
    gain: GainNode,
    options: WebAudioEnvelopeReleaseOptions
  ): void {
    this.requireEnvelopeGainNode()

    gain.gain.cancelScheduledValues(options.startTime)
    gain.gain.setValueAtTime(gain.gain.value, options.startTime)
    gain.gain.linearRampToValueAtTime(0, options.stopTime)
  }

  clearAdsrGainNode(gain: GainNode, time: number): void {
    this.requireEnvelopeGainNode()

    gain.gain.cancelScheduledValues(time)
    gain.gain.setValueAtTime(0, time)
  }

  materialiseGainNode(
    context: AudioContext,
    options: WebAudioGainNodeOptions
  ): GainNode {
    if (!this.gainNodeId) {
      throw new Error('WebAudioExecutor has no gain node in its graph')
    }

    const gain = context.createGain()

    configureParam(gain.gain, options.gain, options.time, options.immediate)

    return gain
  }

  materialisePanNode(
    context: AudioContext,
    options: WebAudioPanNodeOptions
  ): StereoPannerNode {
    if (!this.panNodeId) {
      throw new Error('WebAudioExecutor has no pan node in its graph')
    }

    const panner = context.createStereoPanner()

    configureParam(panner.pan, options.pan, options.time, options.immediate)

    return panner
  }

  materialiseMixerNode(
    context: AudioContext,
    options: WebAudioGainNodeOptions
  ): GainNode {
    if (!this.mixerNodeId) {
      throw new Error('WebAudioExecutor has no mixer node in its graph')
    }

    const mixer = context.createGain()

    configureParam(mixer.gain, options.gain, options.time, options.immediate)

    return mixer
  }

  materialiseDelayNode(
    context: AudioContext,
    options: WebAudioDelayNodeOptions
  ): WebAudioDelayNodeChain {
    if (!this.delayNodeId) {
      throw new Error('WebAudioExecutor has no delay node in its graph')
    }

    const input = context.createGain()
    const delay = context.createDelay(2)
    const feedback = context.createGain()
    const dry = context.createGain()
    const wet = context.createGain()
    const output = context.createGain()

    configureDelayChain({ input, delay, feedback, dry, wet, output }, options)
    input.connect(dry)
    input.connect(delay)
    delay.connect(feedback)
    feedback.connect(delay)
    delay.connect(wet)
    dry.connect(output)
    wet.connect(output)

    return { input, delay, feedback, dry, wet, output }
  }

  updateDelayNode(
    chain: WebAudioDelayNodeChain,
    options: WebAudioDelayNodeOptions
  ): void {
    if (!this.delayNodeId) {
      throw new Error('WebAudioExecutor has no delay node in its graph')
    }

    configureDelayChain(chain, options)
  }

  connectAudioOutputNode(source: AudioNode, destination: AudioNode): void {
    if (!this.outputNodeId) {
      throw new Error('WebAudioExecutor has no output node in its graph')
    }

    source.connect(destination)
  }

  override process(
    context: ExecutionProcessContext
  ): ExecutionProcessResult | void {
    return super.process(context)
  }

  private requireEnvelopeGainNode(): void {
    if (!this.envelopeGainNodeId) {
      throw new Error('WebAudioExecutor has no envelope gain node in its graph')
    }
  }
}

function configureOscillatorFrequency(
  oscillator: OscillatorNode,
  options: WebAudioOscillatorStartOptions
): void {
  const targetFrequency = midiNoteToFrequency(options.pitch)
  const glideTime = Math.max(0, options.glide?.time ?? 0)

  if (!options.glide || glideTime <= 0) {
    oscillator.frequency.setValueAtTime(targetFrequency, options.startTime)
    return
  }

  const startFrequency = midiNoteToFrequency(options.glide.startPitch)

  oscillator.frequency.setValueAtTime(startFrequency, options.startTime)
  oscillator.frequency.exponentialRampToValueAtTime(
    targetFrequency,
    options.startTime + glideTime
  )
}

function midiNoteToFrequency(note: number): number {
  return 440 * 2 ** ((note - 69) / 12)
}

function configureFilter(
  filter: BiquadFilterNode,
  options: WebAudioFilterNodeOptions
): void {
  filter.type = 'lowpass'
  const cutoff = effectiveCutoff(options)

  if (options.immediate) {
    filter.frequency.setValueAtTime(cutoff, options.time)
    filter.Q.setValueAtTime(options.resonance, options.time)
    return
  }

  filter.frequency.setTargetAtTime(cutoff, options.time, 0.01)
  filter.Q.setTargetAtTime(options.resonance, options.time, 0.01)
}

function effectiveCutoff(options: WebAudioFilterNodeOptions): number {
  const trackingRatio = 2 ** (((options.pitch - 60) / 12) * options.keyTracking)

  return clampFrequency(options.cutoff * trackingRatio)
}

function clampFrequency(value: number): number {
  if (!Number.isFinite(value)) return 20000

  return Math.min(20000, Math.max(20, value))
}

function configureParam(
  param: AudioParam,
  value: number,
  time: number,
  immediate = false
): void {
  if (immediate) {
    param.setValueAtTime(value, time)
    return
  }

  param.setTargetAtTime(value, time, 0.01)
}

function configureDelayChain(
  chain: WebAudioDelayNodeChain,
  options: WebAudioDelayNodeOptions
): void {
  const mix = clampUnit(options.mix)

  configureParam(
    chain.delay.delayTime,
    Math.min(2, Math.max(0, options.delayTime)),
    options.time,
    options.immediate
  )
  configureParam(
    chain.feedback.gain,
    Math.min(0.95, Math.max(0, options.feedback)),
    options.time,
    options.immediate
  )
  configureParam(chain.dry.gain, 1 - mix, options.time, options.immediate)
  configureParam(chain.wet.gain, mix, options.time, options.immediate)
  configureParam(chain.output.gain, 1, options.time, options.immediate)
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0

  return Math.min(1, Math.max(0, value))
}
