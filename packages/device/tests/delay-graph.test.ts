import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DELAY_AUDIO_GRAPH } from '@sequencer/audio-graph';
import { DELAY_DESCRIPTOR } from '../src/descriptors/delay.ts';
import { DelayFactory } from '../src/factories/delay.ts';
import {
  getRuntimeParameter,
  getRuntimeParameterEffectiveValue,
  setRuntimeParameterValue
} from '../src/parameter-runtime.ts';

describe('Delay graph preset', () => {
  it('advertises the graph document on the descriptor', () => {
    assert.equal(DELAY_DESCRIPTOR.graphPreset, DELAY_AUDIO_GRAPH);
  });

  it('builds a post-instrument audio effect runtime graph', () => {
    const device = new DelayFactory().create({
      id: 'delay-1',
      descriptorKey: DELAY_DESCRIPTOR.key,
      name: 'Delay',
      parameterValues: {
        time: 0.5,
        timeMode: 'sync',
        syncDivision: '1/8.',
        feedback: 0.35,
        mix: 0.4
      }
    });

    assert.equal(device.runtimeGraph?.document.id, DELAY_AUDIO_GRAPH.id);
    assert.equal(device.runtimeGraph?.nodes.length, 3);
    assert.equal(device.runtimeGraph?.connections.length, 2);
    assert.deepEqual(device.runtimeGraph?.diagnostics, []);
    assert.deepEqual(device.runtimeGraph?.executionOrder, [
      'audio-in',
      'delay',
      'audio-out'
    ]);
    assert.equal(getRuntimeParameter(device.parameters, 'time')?.value, 0.5);
    assert.equal(getRuntimeParameter(device.parameters, 'timeMode')?.value, 'sync');
    assert.equal(getRuntimeParameter(device.parameters, 'syncDivision')?.value, '1/8.');
    assert.equal(getRuntimeParameter(device.parameters, 'feedback')?.value, 0.35);
    assert.equal(getRuntimeParameter(device.parameters, 'mix')?.value, 0.4);
    assert.deepEqual(device.getDiagnostics().graph?.nodeDiagnostics, [
      {
        nodeId: 'audio-in',
        descriptorId: 'sequencer.source.audio-input',
        executionIndex: 0,
        latencySamples: 0
      },
      {
        nodeId: 'delay',
        descriptorId: 'sequencer.processor.delay',
        executionIndex: 1,
        latencySamples: 0
      },
      {
        nodeId: 'audio-out',
        descriptorId: 'sequencer.output.audio-out',
        executionIndex: 2,
        latencySamples: 0
      }
    ]);
  });

  it('advances smoothed numeric parameters for live delay updates', () => {
    const device = new DelayFactory().create({
      id: 'delay-1',
      descriptorKey: DELAY_DESCRIPTOR.key,
      name: 'Delay',
      parameterValues: {
        feedback: 0.25,
        mix: 0.25
      }
    });
    const feedback = getRuntimeParameter(device.parameters, 'feedback');
    const mix = getRuntimeParameter(device.parameters, 'mix');

    assert.ok(feedback);
    assert.ok(mix);

    setRuntimeParameterValue(feedback, 0.6);
    setRuntimeParameterValue(mix, 0.8);

    assert.equal(getRuntimeParameterEffectiveValue(device.parameters, 'feedback'), 0.25);
    assert.equal(getRuntimeParameterEffectiveValue(device.parameters, 'mix'), 0.25);

    device.advance(20);

    assert.equal(getRuntimeParameterEffectiveValue(device.parameters, 'feedback'), 0.6);
    assert.equal(getRuntimeParameterEffectiveValue(device.parameters, 'mix'), 0.8);
  });
});
