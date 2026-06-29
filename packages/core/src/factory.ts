import type {
  Pattern,
  PatternPlacement,
  SequencerProject,
  Track
} from "./project";
import type { BeatTime } from "./events";
import type { Timeline } from "./timeline";
import { createId } from "./entity";
import { Registry } from "./registry";
import type { Parameter, ParameterDefinition } from "./parameter";

export function createPattern(name = "Pattern A", length = 4): Pattern {
  return {
    id: createId("pattern"),
    name,
    length,
    events: []
  };
}

export function createTrack(name = "Track 1", target?: string): Track {
  return {
    id: createId("track"),
    name,
    placements: [],
    target
  };
}

export function createPatternPlacement(
  source: Track["id"],
  target: Pattern["id"],
  start: BeatTime,
  length?: BeatTime,
  loopCount?: number
): PatternPlacement {
  return {
    id: createId("placement"),
    name: "Pattern Placement",
    source,
    target,
    start,
    length,
    loopCount
  };
}

export function createTimeline(length = 16): Timeline {
  return {
    length,
    markers: []
  };
}

export function createProject(name = "Sequencer"): SequencerProject {
  const pattern = createPattern();
  const track = createTrack("Track 1");
  const patterns = new Registry<Pattern>();
  const tracks = new Registry<Track>();
  const timeline = createTimeline();

  track.placements.push(
    createPatternPlacement(track.id, pattern.id, 0, pattern.length, 1)
  );
  patterns.add(pattern);
  tracks.add(track);

  return {
    id: createId("project"),
    name,
    bpm: 120,
    timeline,
    tracks,
    patterns,
    parameterDefinitions: new Registry<ParameterDefinition>(),
    parameters: new Registry<Parameter>()
  };
}
