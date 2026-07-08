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
        pitch: 36
      },
      {
        type: 'note:on',
        pitch: 38
      },
      {
        type: 'note:on',
        pitch: 40
      },
      {
        type: 'note:off',
        pitch: 36
      }
    ]);

    assert.deepEqual(sampler.getDiagnostics(), {
      triggeredSamples: 1,
      missingSamples: 2,
      lastTriggeredSlot: undefined
    });
  });
});
