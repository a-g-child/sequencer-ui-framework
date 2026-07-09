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

export class WebAudioExecutor extends BaseExecutionExecutor {
  private oscillatorNodeId?: string

  constructor() {
    super('web-audio-executor', 'WebAudio Executor')
  }

  override async initialise(graph: RuntimeAudioGraph): Promise<void> {
    await super.initialise(graph)
    this.oscillatorNodeId = graph.nodes.find(
      (node) => node.descriptorId === 'sequencer.source.oscillator'
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
