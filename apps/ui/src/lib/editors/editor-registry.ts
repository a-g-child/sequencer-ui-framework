import type { EditorDefinition } from './editor-types';

export const EDITORS: EditorDefinition[] = [
  {
    id: 'piano-roll',
    name: 'Piano Roll',
    description: 'Free melodic and polyphonic note editing'
  },
  {
    id: 'drum-rack',
    name: 'Drum Rack',
    description: 'Fixed-lane percussion sequencing'
  },
  {
    id: 'pattern-grid',
    name: 'Pattern Grid',
    description: 'Mono step sequencing with per-slot pitch control'
  },
  {
    id: 'audio-graph',
    name: 'Audio Graph',
    description: 'Node-based audio, modulation and routing'
  }
];