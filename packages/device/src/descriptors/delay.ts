import { DELAY_AUDIO_GRAPH } from '@sequencer/audio-graph';
import type { DeviceDescriptor } from '../device.ts';

export const DELAY_DESCRIPTOR: DeviceDescriptor = {
  id: 'device.delay',
  key: 'delay',
  name: 'Delay',
  manufacturer: 'Sequencer',
  capabilities: ['audio-effect', 'automation-target'],
  graphPreset: DELAY_AUDIO_GRAPH,
  ports: [
    { id: 'audio-in', name: 'Audio In', kind: 'audio-in', channels: 2 },
    { id: 'audio-out', name: 'Audio Out', kind: 'audio-out', channels: 2 }
  ],
  parameters: [
    {
      id: 'time',
      key: 'time',
      name: 'Time',
      kind: 'number',
      defaultValue: 0.25,
      min: 0,
      max: 2,
      step: 0.01,
      unit: 's'
    },
    {
      id: 'time-mode',
      key: 'timeMode',
      name: 'Mode',
      kind: 'choice',
      defaultValue: 'free',
      options: [
        { label: 'Free', value: 'free' },
        { label: 'Sync', value: 'sync' }
      ]
    },
    {
      id: 'sync-division',
      key: 'syncDivision',
      name: 'Division',
      kind: 'choice',
      defaultValue: '1/8',
      options: [
        { label: '1/4', value: '1/4' },
        { label: '1/4.', value: '1/4.' },
        { label: '1/4T', value: '1/4T' },
        { label: '1/8', value: '1/8' },
        { label: '1/8.', value: '1/8.' },
        { label: '1/8T', value: '1/8T' },
        { label: '1/16', value: '1/16' },
        { label: '1/16.', value: '1/16.' },
        { label: '1/16T', value: '1/16T' }
      ]
    },
    {
      id: 'feedback',
      key: 'feedback',
      name: 'Feedback',
      kind: 'number',
      defaultValue: 0.25,
      min: 0,
      max: 0.95,
      step: 0.01
    },
    {
      id: 'mix',
      key: 'mix',
      name: 'Mix',
      kind: 'number',
      defaultValue: 0.25,
      min: 0,
      max: 1,
      step: 0.01
    }
  ]
};
