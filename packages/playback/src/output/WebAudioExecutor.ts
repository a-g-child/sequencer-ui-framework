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

export class WebAudioExecutor extends BaseExecutionExecutor {
  private oscillatorNodeId?: string
  private filterNodeId?: string
  private envelopeGainNodeId?: string
  private gainNodeId?: string
  private panNodeId?: string
  private mixerNodeId?: string
  private outputNodeId?: string

  constructor() {
    super('web-audio-executor', 'WebAudio Executor')
  }

  override async initialise(graph: RuntimeAudioGraph): Promise<void> {
    await super.initialise(graph)
    this.oscillatorNodeId = graph.nodes.find(
      (node) => node.descriptorId === 'sequencer.source.oscillator'
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
    this.outputNodeId = graph.nodes.find(
      (node) => node.descriptorId === 'sequencer.output.audio-out'
    )?.id
  }

  createOscillatorNode(
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

  createFilterNode(
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

  createEnvelopeGainNode(
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

  releaseEnvelopeGainNode(
    gain: GainNode,
    options: WebAudioEnvelopeReleaseOptions
  ): void {
    this.requireEnvelopeGainNode()

    gain.gain.cancelScheduledValues(options.startTime)
    gain.gain.setValueAtTime(gain.gain.value, options.startTime)
    gain.gain.linearRampToValueAtTime(0, options.stopTime)
  }

  clearEnvelopeGainNode(gain: GainNode, time: number): void {
    this.requireEnvelopeGainNode()

    gain.gain.cancelScheduledValues(time)
    gain.gain.setValueAtTime(0, time)
  }

  createGainNode(
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

  createPanNode(
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

  createMixerNode(
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

  connectOutputNode(source: AudioNode, destination: AudioNode): void {
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
