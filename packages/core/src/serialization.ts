import { Registry } from "./registry";
import type { Pattern, SequencerProject, Track } from "./project";
import type { Parameter, ParameterDefinition } from "./parameter";
import type { Timeline } from "./timeline";

interface SerializedProject {
  id: SequencerProject["id"];
  name: string;
  bpm: number;
  timeline: Timeline;
  tracks: Track[];
  patterns: Pattern[];
  parameterDefinitions: ParameterDefinition[];
  parameters: Parameter[];
}

export function serializeProject(project: SequencerProject): string {
  const serialized: SerializedProject = {
    id: project.id,
    name: project.name,
    bpm: project.bpm,
    timeline: project.timeline,
    tracks: project.tracks.values(),
    patterns: project.patterns.values(),
    parameterDefinitions: project.parameterDefinitions.values(),
    parameters: project.parameters.values()
  };

  return JSON.stringify(serialized, null, 2);
}

export function deserializeProject(json: string): SequencerProject {
  const serialized = JSON.parse(json) as SerializedProject;
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
