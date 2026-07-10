import assert from 'node:assert/strict'
import test from 'node:test'
import { ArpeggiatorFactory } from '../../device/src/factories/arpeggiator.ts'
import { BasicSynthFactory } from '../../device/src/factories/basic-synth.ts'
import { PlaybackDeviceManager } from '../src/device.ts'
import type { PlaybackEvent } from '../src/events.ts'

test('routes track events through a MIDI effect before an instrument', () => {
  const manager = new PlaybackDeviceManager()
  const arpeggiatorFactory = manager.register(new ArpeggiatorFactory<PlaybackEvent>())
  const synthFactory = manager.register(new BasicSynthFactory<PlaybackEvent>())
  const arpeggiator = {
    id: 'arp-1',
    descriptorKey: arpeggiatorFactory.descriptor.key,
    name: 'Arpeggiator',
    parameterValues: {
      octaveRange: 1
    }
  }
  const synth = {
    id: 'synth-1',
    descriptorKey: synthFactory.descriptor.key,
    name: 'Basic Synth',
    parameterValues: Object.fromEntries(
      synthFactory.descriptor.parameters.map((parameter) => [
        parameter.key,
        parameter.defaultValue
      ])
    )
  }

  manager.buildFromInstances([arpeggiator, synth])
  manager.configureTrackDeviceChains([
    {
      id: 'track-1',
      name: 'Track 1',
      channel: 0,
      mixer: {
        volume: 0.8,
        pan: 0,
        mute: false,
        solo: false
      },
      deviceInstanceIds: ['arp-1', 'synth-1'],
      deviceInstanceId: 'arp-1'
    }
  ])

  const result = manager.processEvents([
    {
      id: 'note-1:on',
      type: 'note:on',
      noteId: 'note-1',
      trackId: 'track-1',
      destination: {
        trackId: 'track-1',
        deviceInstanceId: 'arp-1'
      },
      pitch: 60,
      velocity: 0.75,
      beat: 0,
      timeMs: 100,
      duration: 1,
      durationMs: 1000
    },
    {
      id: 'note-2:on',
      type: 'note:on',
      noteId: 'note-2',
      trackId: 'track-1',
      destination: {
        trackId: 'track-1',
        deviceInstanceId: 'arp-1'
      },
      pitch: 64,
      velocity: 0.75,
      beat: 0,
      timeMs: 100,
      duration: 1,
      durationMs: 1000
    }
  ])

  assert.deepEqual(
    result.voiceActions.map((action) => ({
      type: action.type,
      noteId: action.type === 'voice:start' ? action.noteId : undefined,
      pitch: action.type === 'voice:start' ? action.pitch : undefined
    })),
    [
      { type: 'voice:start', noteId: 'note-1:arp-0', pitch: 60 },
      { type: 'voice:release', noteId: undefined, pitch: undefined },
      { type: 'voice:start', noteId: 'note-1:arp-1', pitch: 64 },
      { type: 'voice:release', noteId: undefined, pitch: undefined },
      { type: 'voice:start', noteId: 'note-1:arp-2', pitch: 60 },
      { type: 'voice:release', noteId: undefined, pitch: undefined },
      { type: 'voice:start', noteId: 'note-1:arp-3', pitch: 64 },
      { type: 'voice:release', noteId: undefined, pitch: undefined }
    ]
  )
  assert.equal(result.sampleActions.length, 0)
  assert.equal(result.deviceCommands.length, 8)
  assert.ok(result.deviceCommands.every((command) => command.deviceInstanceId === 'synth-1'))
})
