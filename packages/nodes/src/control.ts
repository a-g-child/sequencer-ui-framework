import type { NodeDescriptor } from './types.ts';

export const AUTOMATION_INPUT_NODE: NodeDescriptor = {
  id: 'sequencer.control.automation-input',
  type: 'automation-input',
  name: 'Automation Input',
  category: 'control',
  capabilities: ['control-source'],
  ports: [{ id: 'control-out', name: 'Control Out', kind: 'control', direction: 'output' }]
};

export const LFO_NODE: NodeDescriptor = {
  id: 'sequencer.control.lfo',
  type: 'lfo',
  name: 'LFO',
  category: 'control',
  capabilities: ['control-source', 'modulation'],
  ports: [{ id: 'control-out', name: 'Control Out', kind: 'control', direction: 'output' }],
  parameters: [
    { id: 'rate', name: 'Rate', kind: 'number', defaultValue: 0, min: 0, max: 20, unit: 'Hz' },
    { id: 'depth', name: 'Depth', kind: 'number', defaultValue: 0, min: 0, max: 1 }
  ]
};

export const ENVELOPE_NODE: NodeDescriptor = {
  id: 'sequencer.control.envelope',
  type: 'envelope',
  name: 'Envelope',
  category: 'control',
  capabilities: ['control-source', 'modulation'],
  ports: [
    { id: 'gate-in', name: 'Gate In', kind: 'gate', direction: 'input' },
    { id: 'control-out', name: 'Control Out', kind: 'control', direction: 'output' }
  ],
  parameters: [
    { id: 'attack', name: 'Attack', kind: 'number', defaultValue: 10, min: 0, max: 3000, unit: 'ms' },
    { id: 'decay', name: 'Decay', kind: 'number', defaultValue: 150, min: 0, max: 3000, unit: 'ms' },
    { id: 'sustain', name: 'Sustain', kind: 'number', defaultValue: 0.7, min: 0, max: 1 },
    { id: 'release', name: 'Release', kind: 'number', defaultValue: 200, min: 0, max: 3000, unit: 'ms' }
  ]
};

export const ENVELOPE_FOLLOWER_NODE: NodeDescriptor = {
  id: 'sequencer.control.envelope-follower',
  type: 'envelope-follower',
  name: 'Envelope Follower',
  category: 'control',
  capabilities: ['control-source'],
  ports: [
    { id: 'audio-in', name: 'Audio In', kind: 'audio', direction: 'input' },
    { id: 'control-out', name: 'Control Out', kind: 'control', direction: 'output' }
  ]
};

export const MACRO_KNOB_NODE: NodeDescriptor = {
  id: 'sequencer.control.macro-knob',
  type: 'macro-knob',
  name: 'Macro Knob',
  category: 'control',
  capabilities: ['control-source', 'modulation'],
  ports: [{ id: 'control-out', name: 'Control Out', kind: 'control', direction: 'output' }],
  parameters: [{ id: 'value', name: 'Value', kind: 'number', defaultValue: 0, min: 0, max: 1 }]
};

export const MATH_NODE: NodeDescriptor = {
  id: 'sequencer.control.math',
  type: 'math',
  name: 'Math',
  category: 'control',
  capabilities: ['control-processor'],
  ports: [
    { id: 'a', name: 'A', kind: 'control', direction: 'input' },
    { id: 'b', name: 'B', kind: 'control', direction: 'input' },
    { id: 'control-out', name: 'Control Out', kind: 'control', direction: 'output' }
  ],
  parameters: [
    {
      id: 'operator',
      name: 'Operator',
      kind: 'choice',
      defaultValue: 'add',
      options: [
        { label: 'Add', value: 'add' },
        { label: 'Subtract', value: 'subtract' },
        { label: 'Multiply', value: 'multiply' },
        { label: 'Divide', value: 'divide' }
      ]
    }
  ]
};

export const RANDOM_SAMPLE_HOLD_NODE: NodeDescriptor = {
  id: 'sequencer.control.random-sample-hold',
  type: 'random-sample-hold',
  name: 'Random Sample & Hold',
  category: 'control',
  capabilities: ['control-source', 'modulation'],
  ports: [
    { id: 'trigger', name: 'Trigger', kind: 'trigger', direction: 'input' },
    { id: 'control-out', name: 'Control Out', kind: 'control', direction: 'output' }
  ]
};

export const CONTROL_SEQUENCER_NODE: NodeDescriptor = {
  id: 'sequencer.control.sequencer',
  type: 'control-sequencer',
  name: 'Control Sequencer',
  category: 'control',
  capabilities: ['control-source', 'timing'],
  ports: [
    { id: 'clock-in', name: 'Clock In', kind: 'trigger', direction: 'input' },
    { id: 'control-out', name: 'Control Out', kind: 'control', direction: 'output' }
  ]
};

export const CONTROL_NODE_DESCRIPTORS: readonly NodeDescriptor[] = [
  AUTOMATION_INPUT_NODE,
  LFO_NODE,
  ENVELOPE_NODE,
  ENVELOPE_FOLLOWER_NODE,
  MACRO_KNOB_NODE,
  MATH_NODE,
  RANDOM_SAMPLE_HOLD_NODE,
  CONTROL_SEQUENCER_NODE
];
