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

export class WebAudioExecutor extends BaseExecutionExecutor {
  private oscillatorNodeId?: string
  private filterNodeId?: string

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

  override process(
    context: ExecutionProcessContext
  ): ExecutionProcessResult | void {
    return super.process(context)
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
