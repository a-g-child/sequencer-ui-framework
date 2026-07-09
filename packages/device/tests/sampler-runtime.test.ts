import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { SamplerRuntimeDevice } from '../src/factories/sampler.ts';
import type { SamplerDeviceInstance } from '../src/factories/sampler.ts';

const instance: SamplerDeviceInstance = {
  id: 'sampler-1',
  descriptorKey: 'sampler',
  name: 'Sampler',
  parameterValues: {},
  sampleSlots: [
    {
      id: 'kick',
      name: 'Kick',
      assetId: 'asset-kick',
      rootNote: 36,
      gain: 1,
      start: 0,
      loopStart: 0.01,
      loopEnd: 0.12,
      loop: false
    },
    {
      id: 'snare',
      name: 'Snare',
      rootNote: 38,
      gain: 1,
      start: 0,
      loop: false
    }
  ]
};

describe('SamplerRuntimeDevice', () => {
  it('resolves pitched notes to the nearest sample slot', () => {
    const sampler = new SamplerRuntimeDevice(instance);

    assert.equal(sampler.resolveSlotForNote(37)?.id, 'kick');
    assert.equal(sampler.resolveSlotForNote(39)?.id, 'snare');
  });

  it('requires exact sample slot matches in multi mode', () => {
    const sampler = new SamplerRuntimeDevice({
      ...instance,
      parameterValues: {
        mode: 'multi'
      }
    });

    assert.equal(sampler.resolveSlotForNote(36)?.id, 'kick');
    assert.equal(sampler.resolveSlotForNote(37), undefined);
  });

  it('records triggered and missing sample diagnostics from note events', () => {
    const sampler = new SamplerRuntimeDevice({
      ...instance,
      parameterValues: {
        mode: 'multi'
      }
    });

    sampler.processEvents([
      {
        type: 'note:on',
        noteId: 'note-1',
        destination: { trackId: 'track-1' },
        pitch: 36,
        velocity: 0.5,
        timeMs: 100
      },
      {
        type: 'note:on',
        noteId: 'note-2',
        destination: { trackId: 'track-1' },
        pitch: 38,
        velocity: 0.75,
        timeMs: 200
      },
      {
        type: 'note:on',
        noteId: 'note-3',
        destination: { trackId: 'track-1' },
        pitch: 40,
        velocity: 1,
        timeMs: 300
      },
      {
        type: 'note:off',
        noteId: 'note-1',
        pitch: 36,
        timeMs: 400
      }
    ]);

    assert.deepEqual(sampler.consumeSampleActions(), [
      {
        type: 'sample:start',
        voiceId: 'voice-1',
        trackId: 'track-1',
        noteId: 'note-1',
        assetId: 'asset-kick',
        pitch: 36,
        velocity: 0.5,
        playbackRate: 1,
        gain: 0.4,
        startSeconds: 0,
        endSeconds: undefined,
        loopEnabled: false,
        loopStartSeconds: 0.01,
        loopEndSeconds: 0.12,
        timeMs: 100
      },
      {
        type: 'sample:release',
        voiceId: 'voice-1',
        timeMs: 400
      }
    ]);
    assert.deepEqual(sampler.getDiagnostics(), {
      triggeredSamples: 1,
      missingSamples: 2,
      lastTriggeredSlot: undefined,
      graph: {
        presetId: 'preset.sampler',
        nodeCount: 4,
        connectionCount: 3,
        executionOrder: ['clip-notes', 'sample-player', 'track-gain', 'audio-out'],
        diagnostics: []
      }
    });
  });
});
