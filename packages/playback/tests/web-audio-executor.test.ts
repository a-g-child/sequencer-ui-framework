import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AudioGraphBuilder,
  BASIC_SYNTH_AUDIO_GRAPH,
  DEFAULT_AUDIO_NODE_DESCRIPTORS,
  DELAY_AUDIO_GRAPH,
  SAMPLER_AUDIO_GRAPH
} from '@sequencer/audio-graph'
import { WebAudioExecutor } from '../src/output/WebAudioExecutor.ts'

test('smoke: materialises the Basic Synth signal chain from its runtime graph', async () => {
  const graph = new AudioGraphBuilder(DEFAULT_AUDIO_NODE_DESCRIPTORS).build(
    BASIC_SYNTH_AUDIO_GRAPH
  )
  const executor = new WebAudioExecutor()
  const context = new FakeAudioContext()
  const output = new FakeConnectableNode()

  await executor.initialise(graph)

  const oscillator = executor.materialiseOscillatorNode(
    context as unknown as AudioContext,
    {
      waveform: 'sine',
      pitch: 60,
      startTime: 1
    }
  ) as unknown as FakeOscillatorNode
  const filter = executor.materialiseFilterNode(
    context as unknown as AudioContext,
    {
      cutoff: 1200,
      resonance: 0.5,
      keyTracking: 0,
      pitch: 60,
      time: 1,
      immediate: true
    }
  ) as unknown as FakeBiquadFilterNode
  const adsr = executor.materialiseAdsrGainNode(
    context as unknown as AudioContext,
    {
      peakGain: 0.7,
      sustainGain: 0.5,
      startTime: 1,
      attackTime: 1.01,
      decayTime: 1.08
    }
  ) as unknown as FakeGainNode
  const gain = executor.materialiseGainNode(context as unknown as AudioContext, {
    gain: 0.8,
    time: 1,
    immediate: true
  }) as unknown as FakeGainNode
  const pan = executor.materialisePanNode(context as unknown as AudioContext, {
    pan: 0.25,
    time: 1,
    immediate: true
  }) as unknown as FakeStereoPannerNode
  const mixer = executor.materialiseMixerNode(context as unknown as AudioContext, {
    gain: 0.9,
    time: 1,
    immediate: true
  }) as unknown as FakeGainNode

  oscillator.connect(filter)
  filter.connect(adsr)
  adsr.connect(gain)
  gain.connect(pan)
  pan.connect(mixer)
  executor.connectAudioOutputNode(
    mixer as unknown as AudioNode,
    output as unknown as AudioNode
  )
  oscillator.start(1)

  assert.deepEqual(oscillator.connections, [filter])
  assert.deepEqual(filter.connections, [adsr])
  assert.deepEqual(adsr.connections, [gain])
  assert.deepEqual(gain.connections, [pan])
  assert.deepEqual(pan.connections, [mixer])
  assert.deepEqual(mixer.connections, [output])
  assert.deepEqual(oscillator.starts, [{ time: 1 }])
})

test('smoke: materialises the Sampler signal chain from its runtime graph', async () => {
  const graph = new AudioGraphBuilder(DEFAULT_AUDIO_NODE_DESCRIPTORS).build(
    SAMPLER_AUDIO_GRAPH
  )
  const executor = new WebAudioExecutor()
  const context = new FakeAudioContext()
  const buffer = {} as AudioBuffer
  const output = new FakeConnectableNode()

  await executor.initialise(graph)

  const source = executor.materialiseSamplePlayerNode(
    context as unknown as AudioContext,
    {
      buffer,
      playbackRate: 1,
      loopEnabled: false,
      startTime: 2
    }
  ) as unknown as FakeAudioBufferSourceNode
  const adsr = executor.materialiseAdsrGainNode(
    context as unknown as AudioContext,
    {
      peakGain: 0.6,
      sustainGain: 0.6,
      startTime: 2,
      attackTime: 2,
      decayTime: 2
    }
  ) as unknown as FakeGainNode
  const gain = executor.materialiseGainNode(context as unknown as AudioContext, {
    gain: 1,
    time: 2,
    immediate: true
  }) as unknown as FakeGainNode
  const pan = executor.materialisePanNode(context as unknown as AudioContext, {
    pan: 0,
    time: 2,
    immediate: true
  }) as unknown as FakeStereoPannerNode
  const mixer = executor.materialiseMixerNode(context as unknown as AudioContext, {
    gain: 0.8,
    time: 2,
    immediate: true
  }) as unknown as FakeGainNode

  source.connect(adsr)
  adsr.connect(gain)
  gain.connect(pan)
  pan.connect(mixer)
  executor.connectAudioOutputNode(
    mixer as unknown as AudioNode,
    output as unknown as AudioNode
  )
  executor.triggerSamplePlayerNode(source as unknown as AudioBufferSourceNode, {
    startTime: 2,
    offset: 0.1
  })

  assert.deepEqual(source.connections, [adsr])
  assert.deepEqual(adsr.connections, [gain])
  assert.deepEqual(gain.connections, [pan])
  assert.deepEqual(pan.connections, [mixer])
  assert.deepEqual(mixer.connections, [output])
  assert.deepEqual(source.starts, [{ time: 2, offset: 0.1, duration: undefined }])
})

test('creates oscillator nodes from the runtime graph oscillator node', async () => {
  const graph = new AudioGraphBuilder(DEFAULT_AUDIO_NODE_DESCRIPTORS).build(
    BASIC_SYNTH_AUDIO_GRAPH
  )
  const executor = new WebAudioExecutor()
  const context = new FakeAudioContext()

  await executor.initialise(graph)

  const oscillator = executor.materialiseOscillatorNode(
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

  const oscillator = executor.materialiseOscillatorNode(
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
      executor.materialiseOscillatorNode(
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

  const filter = executor.materialiseFilterNode(
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

test('creates sample-player nodes from the runtime graph sample-player node', async () => {
  const graph = new AudioGraphBuilder(DEFAULT_AUDIO_NODE_DESCRIPTORS).build(
    SAMPLER_AUDIO_GRAPH
  )
  const executor = new WebAudioExecutor()
  const context = new FakeAudioContext()
  const buffer = {} as AudioBuffer

  await executor.initialise(graph)

  const source = executor.materialiseSamplePlayerNode(
    context as unknown as AudioContext,
    {
      buffer,
      playbackRate: 0.5,
      loopEnabled: true,
      loopStartSeconds: 0.1,
      loopEndSeconds: 0.8,
      startTime: 1
    }
  ) as unknown as FakeAudioBufferSourceNode

  executor.triggerSamplePlayerNode(source as unknown as AudioBufferSourceNode, {
    startTime: 1,
    offset: 0.2,
    duration: 0.4
  })
  executor.stopSamplePlayerNode(source as unknown as AudioBufferSourceNode, {
    stopTime: 1.5
  })

  assert.equal(source.buffer, buffer)
  assert.equal(source.loop, true)
  assert.equal(source.loopStart, 0.1)
  assert.equal(source.loopEnd, 0.8)
  assert.deepEqual(source.playbackRate.events, [
    { type: 'set', value: 0.5, time: 1 }
  ])
  assert.deepEqual(source.starts, [
    { time: 1, offset: 0.2, duration: 0.4 }
  ])
  assert.deepEqual(source.stops, [{ time: 1.5 }])
})

test('smooths filter updates when immediate is false', async () => {
  const graph = new AudioGraphBuilder(DEFAULT_AUDIO_NODE_DESCRIPTORS).build(
    BASIC_SYNTH_AUDIO_GRAPH
  )
  const executor = new WebAudioExecutor()
  const context = new FakeAudioContext()

  await executor.initialise(graph)

  const filter = executor.materialiseFilterNode(
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

  const gain = executor.materialiseAdsrGainNode(
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
  executor.releaseAdsrGainNode(gain as unknown as GainNode, {
    startTime: 2,
    stopTime: 2.3
  })
  executor.clearAdsrGainNode(gain as unknown as GainNode, 3)

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

  const gain = executor.materialiseGainNode(context as unknown as AudioContext, {
    gain: 0.5,
    time: 2,
    immediate: true
  }) as unknown as FakeGainNode
  const panner = executor.materialisePanNode(context as unknown as AudioContext, {
    pan: -0.25,
    time: 2.1,
    immediate: true
  }) as unknown as FakeStereoPannerNode
  const mixer = executor.materialiseMixerNode(context as unknown as AudioContext, {
    gain: 0.75,
    time: 2.2
  }) as unknown as FakeGainNode

  executor.connectAudioOutputNode(
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

test('creates delay effect nodes from the runtime graph delay node', async () => {
  const graph = new AudioGraphBuilder(DEFAULT_AUDIO_NODE_DESCRIPTORS).build(
    DELAY_AUDIO_GRAPH
  )
  const executor = new WebAudioExecutor()
  const context = new FakeAudioContext()

  await executor.initialise(graph)

  const chain = executor.materialiseDelayNode(context as unknown as AudioContext, {
    delayTime: 0.5,
    feedback: 0.3,
    mix: 0.25,
    time: 1,
    immediate: true
  }) as unknown as {
    input: FakeGainNode
    delay: FakeDelayNode
    feedback: FakeGainNode
    dry: FakeGainNode
    wet: FakeGainNode
    output: FakeGainNode
  }

  assert.deepEqual(chain.delay.delayTime.events, [
    { type: 'set', value: 0.5, time: 1 }
  ])
  assert.deepEqual(chain.feedback.gain.events, [
    { type: 'set', value: 0.3, time: 1 }
  ])
  assert.deepEqual(chain.dry.gain.events, [
    { type: 'set', value: 0.75, time: 1 }
  ])
  assert.deepEqual(chain.wet.gain.events, [
    { type: 'set', value: 0.25, time: 1 }
  ])
  assert.deepEqual(chain.input.connections, [chain.dry, chain.delay])
  assert.deepEqual(chain.delay.connections, [chain.feedback, chain.wet])
  assert.deepEqual(chain.feedback.connections, [chain.delay])
  assert.deepEqual(chain.dry.connections, [chain.output])
  assert.deepEqual(chain.wet.connections, [chain.output])
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

  createBufferSource(): FakeAudioBufferSourceNode {
    return new FakeAudioBufferSourceNode()
  }

  createDelay(): FakeDelayNode {
    return new FakeDelayNode()
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
  readonly starts: Array<{ readonly time: number }> = []

  start(time: number): void {
    this.starts.push({ time })
  }
}

class FakeBiquadFilterNode extends FakeConnectableNode {
  type: BiquadFilterType = 'lowpass'
  readonly frequency = new FakeAudioParam()
  readonly Q = new FakeAudioParam()
}

class FakeGainNode extends FakeConnectableNode {
  readonly gain = new FakeAudioParam()
}

class FakeDelayNode extends FakeConnectableNode {
  readonly delayTime = new FakeAudioParam()
}

class FakeStereoPannerNode extends FakeConnectableNode {
  readonly pan = new FakeAudioParam()
}

class FakeAudioBufferSourceNode extends FakeConnectableNode {
  buffer: AudioBuffer | null = null
  loop = false
  loopStart = 0
  loopEnd = 0
  readonly playbackRate = new FakeAudioParam()
  readonly starts: Array<{
    readonly time: number
    readonly offset: number
    readonly duration?: number
  }> = []
  readonly stops: Array<{ readonly time: number }> = []

  start(time: number, offset: number, duration?: number): void {
    this.starts.push({ time, offset, duration })
  }

  stop(time: number): void {
    this.stops.push({ time })
  }
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
