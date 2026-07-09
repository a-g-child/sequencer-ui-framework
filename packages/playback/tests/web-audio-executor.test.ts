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

class FakeAudioContext {
  createOscillator(): FakeOscillatorNode {
    return new FakeOscillatorNode()
  }

  createBiquadFilter(): FakeBiquadFilterNode {
    return new FakeBiquadFilterNode()
  }
}

class FakeOscillatorNode {
  type: OscillatorType = 'sine'
  readonly frequency = new FakeAudioParam()
}

class FakeBiquadFilterNode {
  type: BiquadFilterType = 'lowpass'
  readonly frequency = new FakeAudioParam()
  readonly Q = new FakeAudioParam()
}

class FakeAudioParam {
  readonly events: Array<{
    readonly type: 'set' | 'exponentialRamp' | 'target'
    readonly value: number
    readonly time: number
    readonly constant?: number
  }> = []

  setValueAtTime(value: number, time: number): void {
    this.events.push({ type: 'set', value, time })
  }

  exponentialRampToValueAtTime(value: number, time: number): void {
    this.events.push({ type: 'exponentialRamp', value, time })
  }

  setTargetAtTime(value: number, time: number, constant: number): void {
    this.events.push({ type: 'target', value, time, constant })
  }
}
