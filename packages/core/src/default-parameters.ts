import {
  createParameter,
  createParameterDefinition
} from "./parameter";
import type { SequencerDocument } from "./document";
import type { Track } from "./project";

export function addDefaultTrackParameters(
  document: SequencerDocument,
  track: Track
): void {
  const volumeDef = createParameterDefinition("Volume", "number", 0.8, {
    min: 0,
    max: 1,
    step: 0.01,
    unit: ""
  });

  const panDef = createParameterDefinition("Pan", "number", 0, {
    min: -1,
    max: 1,
    step: 0.01
  });

  const muteDef = createParameterDefinition("Mute", "boolean", false);

  const volume = createParameter("Volume", volumeDef.id, volumeDef.defaultValue);
  const pan = createParameter("Pan", panDef.id, panDef.defaultValue);
  const mute = createParameter("Mute", muteDef.id, muteDef.defaultValue);

  document.parameterDefinitions.add(volumeDef);
  document.parameterDefinitions.add(panDef);
  document.parameterDefinitions.add(muteDef);

  document.parameters.add(volume);
  document.parameters.add(pan);
  document.parameters.add(mute);

  track.parameters.push(volume.id, pan.id, mute.id);
}
