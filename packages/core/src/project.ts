import type { Entity } from "./entity.ts";
import type { Relationship } from "./relationship.ts";
import type { BeatTime, TimelineEvent } from "./events.ts";
import type { ParameterOwner } from "./parameter-owner.ts";
import type { SequencerDocument } from "./document.ts";
import type { EntityRef } from "./reference.ts";
import type { DeviceInstance } from "@sequencer/device";

export interface Pattern extends Entity {
  length: BeatTime;
  events: TimelineEvent[];
}

export interface MidiClip extends Entity {
  pattern: EntityRef<Pattern>;
  length: BeatTime;
  loopEnabled: boolean;
  loopStart: BeatTime;
  loopLength: BeatTime;
}

export interface Track extends Entity, ParameterOwner {
  clips: TrackClipSlot[];
  placements: PatternPlacement[];
  mixer: TrackMixerState;
  deviceIds?: EntityRef<DeviceInstance>[];
  deviceId?: EntityRef<DeviceInstance>;
  target?: string;
}

export interface TrackMixerState {
  volume: number;
  pan: number;
  mute: boolean;
  solo: boolean;
}

export function createDefaultTrackMixerState(): TrackMixerState {
  return {
    volume: 0.8,
    pan: 0,
    mute: false,
    solo: false
  };
}

export interface TrackClipSlot extends Relationship<Track, MidiClip> {
  slotIndex: number;
}

export interface PatternPlacement extends Relationship<Track, Pattern> {
  start: BeatTime;
  length?: BeatTime;
  loop?: boolean;
  loopStart?: BeatTime;
  loopLength?: BeatTime;
  loopCount?: number;
}

export type SequencerProject = SequencerDocument;
