import { Registry } from "./registry";
import type { Pattern, SequencerProject, Track } from "./project";
import type { Timeline } from "./timeline";

interface SerializedProject {
  id: SequencerProject["id"];
  name: string;
  bpm: number;
  timeline: Timeline;
  tracks: Track[];
  patterns: Pattern[];
}

export function serializeProject(project: SequencerProject): string {
  const serialized: SerializedProject = {
    id: project.id,
    name: project.name,
    bpm: project.bpm,
    timeline: project.timeline,
    tracks: project.tracks.values(),
    patterns: project.patterns.values()
  };

  return JSON.stringify(serialized, null, 2);
}

export function deserializeProject(json: string): SequencerProject {
  const serialized = JSON.parse(json) as SerializedProject;
  const tracks = new Registry<Track>();
  const patterns = new Registry<Pattern>();

  for (const pattern of serialized.patterns) {
    patterns.add(pattern);
  }

  for (const track of serialized.tracks) {
    tracks.add(track);
  }

  return {
    id: serialized.id,
    name: serialized.name,
    bpm: serialized.bpm,
    timeline: serialized.timeline,
    tracks,
    patterns
  };
}
