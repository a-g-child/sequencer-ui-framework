export type EditorKind =
  | 'piano-roll'
  | 'drum-rack'
  | 'pattern-grid'
  | 'audio-graph';

export interface EditorDefinition {
  id: EditorKind;
  name: string;
  description: string;
}