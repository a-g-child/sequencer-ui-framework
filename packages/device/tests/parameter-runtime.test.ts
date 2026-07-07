import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { DeviceDescriptor } from '../src/descriptor.ts';
import type { DeviceInstance } from '../src/instance.ts';
import {
  advanceRuntimeParameters,
  createRuntimeParameters,
  getRuntimeParameter,
  setRuntimeParameterValue
} from '../src/parameter-runtime.ts';
import { BASIC_SYNTH_DESCRIPTOR } from '../src/descriptors/basic-synth.ts';

const descriptor: DeviceDescriptor = {
  id: 'device.test',
  key: 'test',
  name: 'Test Device',
  capabilities: [],
  ports: [],
  parameters: [
    {
      id: 'volume',
      key: 'volume',
      name: 'Volume',
      kind: 'number',
      defaultValue: 0.25
    },
    {
      id: 'enabled',
      key: 'enabled',
      name: 'Enabled',
      kind: 'boolean',
      defaultValue: false
    },
    {
      id: 'waveform',
      key: 'waveform',
      name: 'Waveform',
      kind: 'choice',
      defaultValue: 'sine',
      options: [
        { label: 'Sine', value: 'sine' },
        { label: 'Square', value: 'square' }
      ]
    }
  ]
};

const instance: DeviceInstance = {
  id: 'device-1',
  descriptorKey: 'test',
  name: 'Test Device',
  parameterValues: {
    volume: 0.5,
    waveform: 'square'
  }
};

describe('runtime parameters', () => {
  it('creates runtime parameters from descriptor defaults and instance overrides', () => {
    const parameters = createRuntimeParameters(descriptor, instance);

    assert.equal(getRuntimeParameter(parameters, 'volume')?.value, 0.5);
    assert.equal(getRuntimeParameter(parameters, 'volume')?.targetValue, 0.5);
    assert.equal(getRuntimeParameter(parameters, 'volume')?.defaultValue, 0.25);
    assert.equal(getRuntimeParameter(parameters, 'volume')?.smoothedValue, 0.5);
    assert.equal(getRuntimeParameter(parameters, 'volume')?.smoothingMs, 20);
    assert.equal(getRuntimeParameter(parameters, 'enabled')?.value, false);
    assert.equal(getRuntimeParameter(parameters, 'waveform')?.value, 'square');
  });

  it('creates Basic Synth ADSR runtime parameters from descriptor defaults', () => {
    const parameters = createRuntimeParameters(BASIC_SYNTH_DESCRIPTOR, {
      id: 'basic-synth-1',
      descriptorKey: BASIC_SYNTH_DESCRIPTOR.key,
      name: 'Basic Synth',
      parameterValues: {}
    });

    assert.equal(getRuntimeParameter(parameters, 'attack')?.value, 0.01);
    assert.equal(getRuntimeParameter(parameters, 'decay')?.value, 0.15);
    assert.equal(getRuntimeParameter(parameters, 'sustain')?.value, 0.7);
    assert.equal(getRuntimeParameter(parameters, 'release')?.value, 0.2);
  });

  it('smooths numeric parameters toward target values', () => {
    const parameters = createRuntimeParameters(descriptor, instance);
    const volume = getRuntimeParameter(parameters, 'volume');

    assert.ok(volume);

    setRuntimeParameterValue(volume, 1);
    assert.equal(volume.value, 0.5);
    assert.equal(volume.targetValue, 1);

    advanceRuntimeParameters(parameters, 10);
    assert.equal(volume.value, 0.75);
    assert.equal(volume.smoothedValue, 0.75);

    advanceRuntimeParameters(parameters, 20);
    assert.equal(volume.value, 1);
    assert.equal(volume.smoothedValue, 1);
  });

  it('snaps non-numeric parameters immediately', () => {
    const parameters = createRuntimeParameters(descriptor, instance);
    const enabled = getRuntimeParameter(parameters, 'enabled');
    const waveform = getRuntimeParameter(parameters, 'waveform');

    assert.ok(enabled);
    assert.ok(waveform);

    setRuntimeParameterValue(enabled, true);
    setRuntimeParameterValue(waveform, 'sine');

    assert.equal(enabled.value, true);
    assert.equal(enabled.targetValue, true);
    assert.equal(waveform.value, 'sine');
    assert.equal(waveform.targetValue, 'sine');

    advanceRuntimeParameters(parameters, 10);

    assert.equal(enabled.value, true);
    assert.equal(waveform.value, 'sine');
  });
});
