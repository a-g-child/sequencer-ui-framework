import { Registry } from "./registry";
import type { SequencerDocument } from "./document";
import type { Pattern, Track } from "./project";
import type { Parameter, ParameterDefinition } from "./parameter";
import type { Timeline } from "./timeline";

interface SerializedDocument {
  id: SequencerDocument["id"];
  name: string;
  bpm: number;
  timeline: Timeline;
  tracks: Track[];
  patterns: Pattern[];
  parameterDefinitions: ParameterDefinition[];
  parameters: Parameter[];
}

export function serializeDocument(document: SequencerDocument): string {
  const serialized: SerializedDocument = {
    id: document.id,
    name: document.name,
    bpm: document.bpm,
    timeline: document.timeline,
    tracks: document.tracks.values(),
    patterns: document.patterns.values(),
    parameterDefinitions: document.parameterDefinitions.values(),
    parameters: document.parameters.values()
  };

  return JSON.stringify(serialized, null, 2);
}

export function deserializeDocument(json: string): SequencerDocument {
  const serialized = JSON.parse(json) as SerializedDocument;
  const tracks = new Registry<Track>();
  const patterns = new Registry<Pattern>();
  const parameterDefinitions = new Registry<ParameterDefinition>();
  const parameters = new Registry<Parameter>();

  for (const pattern of serialized.patterns) {
    patterns.add(pattern);
  }

  for (const track of serialized.tracks) {
    tracks.add(track);
  }

  for (const definition of serialized.parameterDefinitions ?? []) {
    parameterDefinitions.add(definition);
  }

  for (const parameter of serialized.parameters ?? []) {
    parameters.add(parameter);
  }

  return {
    id: serialized.id,
    name: serialized.name,
    bpm: serialized.bpm,
    timeline: serialized.timeline,
    tracks,
    patterns,
    parameterDefinitions,
    parameters
  };
}

export function serializeProject(project: SequencerDocument): string {
  return serializeDocument(project);
}

export function deserializeProject(json: string): SequencerDocument {
  return deserializeDocument(json);
}
