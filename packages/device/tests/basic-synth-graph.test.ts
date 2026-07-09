import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  BASIC_SYNTH_AUDIO_GRAPH,
  DEFAULT_AUDIO_NODE_DESCRIPTORS
} from '@sequencer/audio-graph';
import { BASIC_SYNTH_DESCRIPTOR } from '../src/descriptors/basic-synth.ts';
import { BasicSynthFactory } from '../src/factories/basic-synth.ts';
import { getRuntimeParameter } from '../src/parameter-runtime.ts';

describe('Basic Synth graph preset', () => {
  it('advertises the graph document on the descriptor', () => {
    assert.equal(BASIC_SYNTH_DESCRIPTOR.graphPreset, BASIC_SYNTH_AUDIO_GRAPH);
  });

  it('builds a runtime graph while keeping runtime parameters intact', () => {
    const device = new BasicSynthFactory().create({
      id: 'basic-synth-1',
      descriptorKey: BASIC_SYNTH_DESCRIPTOR.key,
      name: 'Basic Synth',
      parameterValues: {
        waveform: 'square',
        volume: 0.5
      }
    });

    assert.equal(device.runtimeGraph?.document.id, BASIC_SYNTH_AUDIO_GRAPH.id);
    assert.equal(device.runtimeGraph?.nodes.length, 9);
    assert.equal(device.runtimeGraph?.connections.length, 9);
    assert.deepEqual(device.runtimeGraph?.diagnostics, []);
    assert.deepEqual(
      device.runtimeGraph?.nodes.map((node) => node.descriptor.id),
      [
        'sequencer.source.clip-notes',
        'sequencer.source.oscillator',
        'sequencer.processor.filter',
        'sequencer.processor.adsr-gain',
        'sequencer.processor.gain',
        'sequencer.processor.pan',
        'sequencer.processor.mixer',
        'sequencer.output.audio-out',
        'sequencer.control.lfo'
      ]
    );
    assert.equal(
      DEFAULT_AUDIO_NODE_DESCRIPTORS.some(
        (descriptor) => descriptor.id === 'sequencer.source.oscillator'
      ),
      true
    );
    assert.equal(getRuntimeParameter(device.parameters, 'waveform')?.value, 'square');
    assert.equal(getRuntimeParameter(device.parameters, 'volume')?.value, 0.5);
  });
});
