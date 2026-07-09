import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AudioGraphBuilder,
  BASIC_SYNTH_AUDIO_GRAPH,
  DEFAULT_AUDIO_NODE_DESCRIPTORS
} from '@sequencer/audio-graph'
import { WebAudioExecutor } from '../src/output/WebAudioExecutor.ts'

test('creates oscillator nodes from the runtime graph oscillator node', async () => {
  const graph = new AudioGraphBuilder(DEFAULT_AUDIO_NODE_DESCRIPTORS).build(
    BASIC_SYNTH_AUDIO_GRAPH
  )
  const executor = new WebAudioExecutor()
  const context = new FakeAudioContext()

  await executor.initialise(graph)

  const oscillator = executor.createOscillatorNode(
    context as unknown as AudioContext,
    {
      waveform: 'sawtooth',
      pitch: 69,
      startTime: 1
    }
  ) as unknown as FakeOscillatorNode

  assert.equal(oscillator.type, 'sawtooth')
  assert.deepEqual(oscillator.frequency.events, [
    { type: 'set', value: 440, time: 1 }
  ])
})

test('applies oscillator glide in the executor', async () => {
  const graph = new AudioGraphBuilder(DEFAULT_AUDIO_NODE_DESCRIPTORS).build(
    BASIC_SYNTH_AUDIO_GRAPH
  )
  const executor = new WebAudioExecutor()
  const context = new FakeAudioContext()

  await executor.initialise(graph)

  const oscillator = executor.createOscillatorNode(
    context as unknown as AudioContext,
    {
      waveform: 'sine',
      pitch: 72,
      glide: {
        startPitch: 60,
        time: 0.25
      },
      startTime: 2
    }
  ) as unknown as FakeOscillatorNode

  assert.deepEqual(oscillator.frequency.events, [
    { type: 'set', value: 261.6255653005986, time: 2 },
    { type: 'exponentialRamp', value: 523.2511306011972, time: 2.25 }
  ])
})

test('rejects oscillator creation before an oscillator graph is initialised', () => {
  const executor = new WebAudioExecutor()

  assert.throws(
    () =>
      executor.createOscillatorNode(
        new FakeAudioContext() as unknown as AudioContext,
        {
          waveform: 'sine',
          pitch: 69,
          startTime: 0
        }
      ),
    /no oscillator node/
  )
})

test('creates filter nodes from the runtime graph filter node', async () => {
  const graph = new AudioGraphBuilder(DEFAULT_AUDIO_NODE_DESCRIPTORS).build(
    BASIC_SYNTH_AUDIO_GRAPH
  )
  const executor = new WebAudioExecutor()
  const context = new FakeAudioContext()

  await executor.initialise(graph)

  const filter = executor.createFilterNode(
    context as unknown as AudioContext,
    {
      cutoff: 1000,
      resonance: 0.75,
      keyTracking: 1,
      pitch: 72,
      time: 3,
      immediate: true
    }
  ) as unknown as FakeBiquadFilterNode

  assert.equal(filter.type, 'lowpass')
  assert.deepEqual(filter.frequency.events, [
    { type: 'set', value: 2000, time: 3 }
  ])
  assert.deepEqual(filter.Q.events, [
    { type: 'set', value: 0.75, time: 3 }
  ])
})

test('smooths filter updates when immediate is false', async () => {
  const graph = new AudioGraphBuilder(DEFAULT_AUDIO_NODE_DESCRIPTORS).build(
    BASIC_SYNTH_AUDIO_GRAPH
  )
  const executor = new WebAudioExecutor()
  const context = new FakeAudioContext()

  await executor.initialise(graph)

  const filter = executor.createFilterNode(
    context as unknown as AudioContext,
    {
      cutoff: 500,
      resonance: 1.5,
      keyTracking: 0,
      pitch: 60,
      time: 4
    }
  ) as unknown as FakeBiquadFilterNode

  assert.deepEqual(filter.frequency.events, [
    { type: 'target', value: 500, time: 4, constant: 0.01 }
  ])
  assert.deepEqual(filter.Q.events, [
    { type: 'target', value: 1.5, time: 4, constant: 0.01 }
  ])
})

test('creates envelope gain nodes from the runtime graph envelope node', async () => {
  const graph = new AudioGraphBuilder(DEFAULT_AUDIO_NODE_DESCRIPTORS).build(
    BASIC_SYNTH_AUDIO_GRAPH
  )
  const executor = new WebAudioExecutor()
  const context = new FakeAudioContext()

  await executor.initialise(graph)

  const gain = executor.createEnvelopeGainNode(
    context as unknown as AudioContext,
    {
      peakGain: 0.8,
      sustainGain: 0.4,
      startTime: 1,
      attackTime: 1.02,
      decayTime: 1.2
    }
  ) as unknown as FakeGainNode

  assert.deepEqual(gain.gain.events, [
    { type: 'cancel', time: 1 },
    { type: 'set', value: 0, time: 1 },
    { type: 'linearRamp', value: 0.8, time: 1.02 },
    { type: 'linearRamp', value: 0.4, time: 1.2 }
  ])

  gain.gain.value = 0.4
  executor.releaseEnvelopeGainNode(gain as unknown as GainNode, {
    startTime: 2,
    stopTime: 2.3
  })
  executor.clearEnvelopeGainNode(gain as unknown as GainNode, 3)

  assert.deepEqual(gain.gain.events.slice(4), [
    { type: 'cancel', time: 2 },
    { type: 'set', value: 0.4, time: 2 },
    { type: 'linearRamp', value: 0, time: 2.3 },
    { type: 'cancel', time: 3 },
    { type: 'set', value: 0, time: 3 }
  ])
})

test('creates gain, pan, mixer, and output nodes from the runtime graph', async () => {
  const graph = new AudioGraphBuilder(DEFAULT_AUDIO_NODE_DESCRIPTORS).build(
    BASIC_SYNTH_AUDIO_GRAPH
  )
  const executor = new WebAudioExecutor()
  const context = new FakeAudioContext()
  const output = new FakeConnectableNode()

  await executor.initialise(graph)

  const gain = executor.createGainNode(context as unknown as AudioContext, {
    gain: 0.5,
    time: 2,
    immediate: true
  }) as unknown as FakeGainNode
  const panner = executor.createPanNode(context as unknown as AudioContext, {
    pan: -0.25,
    time: 2.1,
    immediate: true
  }) as unknown as FakeStereoPannerNode
  const mixer = executor.createMixerNode(context as unknown as AudioContext, {
    gain: 0.75,
    time: 2.2
  }) as unknown as FakeGainNode

  executor.connectOutputNode(
    mixer as unknown as AudioNode,
    output as unknown as AudioNode
  )

  assert.deepEqual(gain.gain.events, [
    { type: 'set', value: 0.5, time: 2 }
  ])
  assert.deepEqual(panner.pan.events, [
    { type: 'set', value: -0.25, time: 2.1 }
  ])
  assert.deepEqual(mixer.gain.events, [
    { type: 'target', value: 0.75, time: 2.2, constant: 0.01 }
  ])
  assert.deepEqual(mixer.connections, [output])
})

class FakeAudioContext {
  createOscillator(): FakeOscillatorNode {
    return new FakeOscillatorNode()
  }

  createBiquadFilter(): FakeBiquadFilterNode {
    return new FakeBiquadFilterNode()
  }

  createGain(): FakeGainNode {
    return new FakeGainNode()
  }

  createStereoPanner(): FakeStereoPannerNode {
    return new FakeStereoPannerNode()
  }
}

class FakeConnectableNode {
  readonly connections: FakeConnectableNode[] = []

  connect(destination: FakeConnectableNode): void {
    this.connections.push(destination)
  }
}

class FakeOscillatorNode extends FakeConnectableNode {
  type: OscillatorType = 'sine'
  readonly frequency = new FakeAudioParam()
}

class FakeBiquadFilterNode extends FakeConnectableNode {
  type: BiquadFilterType = 'lowpass'
  readonly frequency = new FakeAudioParam()
  readonly Q = new FakeAudioParam()
}

class FakeGainNode extends FakeConnectableNode {
  readonly gain = new FakeAudioParam()
}

class FakeStereoPannerNode extends FakeConnectableNode {
  readonly pan = new FakeAudioParam()
}

class FakeAudioParam {
  value = 0

  readonly events: Array<{
    readonly type: 'cancel' | 'set' | 'linearRamp' | 'exponentialRamp' | 'target'
    readonly value?: number
    readonly time: number
    readonly constant?: number
  }> = []

  cancelScheduledValues(time: number): void {
    this.events.push({ type: 'cancel', time })
  }

  setValueAtTime(value: number, time: number): void {
    this.value = value
    this.events.push({ type: 'set', value, time })
  }

  linearRampToValueAtTime(value: number, time: number): void {
    this.value = value
    this.events.push({ type: 'linearRamp', value, time })
  }

  exponentialRampToValueAtTime(value: number, time: number): void {
    this.value = value
    this.events.push({ type: 'exponentialRamp', value, time })
  }

  setTargetAtTime(value: number, time: number, constant: number): void {
    this.value = value
    this.events.push({ type: 'target', value, time, constant })
  }
}
