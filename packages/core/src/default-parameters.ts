import {
  createParameter,
  createParameterDefinition
} from "./parameter";
import type { SequencerProject, Track } from "./project";

export function addDefaultTrackParameters(
  project: SequencerProject,
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

  project.parameterDefinitions.add(volumeDef);
  project.parameterDefinitions.add(panDef);
  project.parameterDefinitions.add(muteDef);

  project.parameters.add(volume);
  project.parameters.add(pan);
  project.parameters.add(mute);

  track.parameters.push(volume.id, pan.id, mute.id);
}
