# Musical Computer Vision

Sequencer is built around creative intent rather than implementation. Tracks
describe music. Devices realise it. Outputs execute it. Whether a sound comes
from software, an attached hardware module, an external MIDI synthesizer, or a
future networked instrument is an implementation detail beneath the creative
model.

The product direction is a musical computer whose first hardware expression is
a groovebox: an instrument built around live clip launching, tracks, devices,
automation, and performance.

The goal is not to build "Ableton in a box." The goal is a creative framework
that can become a performance instrument, and whose first focused instrument is
a groovebox.

## Product Identity

The first product form is a performance instrument.

It should feel immediate:

- tracks are visible as columns
- clips are launched from a matrix
- scenes launch rows of clips together
- track controls are always close to the performance surface
- devices are assigned to tracks
- automation is part of the clip and performance language

The software should be flexible enough for studio arrangement work, but the
first hardware identity is live sequencing, clip launching, and hands-on sound
design.

Sequencer should be understood as a modular music workstation whose first
hardware is a groovebox.

## Clip Matrix Model

The main surface is a matrix.

```text
Track 1     Track 2     Track 3
Clip A      Clip A      Clip A
Clip B      Clip B      Clip B
Clip C      Clip C      Clip C
```

Tracks are columns.

Clips are cells.

Scenes are rows.

Launching a clip changes the live state of a track. Launching a scene requests
launches across multiple tracks on the same quantized boundary.

None selected is a valid live state. A track may be silent even if it owns clips.

## Track Types

A track should describe musical intent and routing, not a specific engine.

Initial track types:

- MIDI
- Audio
- Control

MIDI tracks may target:

- internal synths
- multichannel samplers
- external MIDI outputs
- future CV outputs
- hardware synth modules

Audio tracks may target:

- samples and loops
- internal audio devices
- hardware audio modules
- send and return chains

Control tracks may target:

- automation
- lighting
- robotics
- external systems
- module parameters

## Clip Types

Clips are track-owned musical or performance units.

Initial clip types:

- Pattern clip
- Sample clip
- Automation clip

Pattern clips contain note events and musical automation.

Sample clips contain audio playback intent.

Automation clips can modulate devices, mixer parameters, sends, modules, or
external outputs.

The scheduler should continue to consume playback models and emit playback
events. It should not need to know whether a clip ultimately drives a synth,
sampler, MIDI port, audio module, or robot.

## Device Model

A device is something a track can target or host. Devices are the centre of the
creative pipeline.

```text
Document
  -> Track
  -> Clip
  -> Device
  -> Playback
  -> Output
```

Examples:

- internal synth
- internal sampler
- external MIDI port
- hardware synth module
- spring reverb module
- compressor module
- delay module
- future CV interface

The entire creative pipeline should be device-centric. A device may be
implemented in software, external MIDI hardware, a physically attached module,
or a future networked instrument. Tracks compose musical intent. Devices
realise that intent. Outputs execute it.

```text
Track
  -> Device Assignment
  -> Device Parameters
  -> Automation
```

Devices expose parameters. Clips automate those parameters. Outputs execute the
resulting playback events.

Initially a track may point at one device. Later it can point at a device graph.

```text
Track
  -> Synth
  -> Delay
  -> Compressor
  -> Output
```

The graph is still a device-side concern. The scheduler should continue to emit
events and should not own synth voices, audio effects, buffers, or hardware
details.

## Hardware Module Bus

The physical module idea should be treated as a device-module bus, not just an
accessory connector.

The bus can eventually carry:

- 24V
- 5V
- ground
- I2S audio transmit and receive
- I2C control and discovery
- hot-plug detection
- wake
- GPIO
- identity data from an EEPROM or MCU

Each side of the groovebox could expose magnetic pogo connectors. A synth,
sampler, compressor, delay, reverb, or utility module could attach physically
and appear in software as a device.

The physical connector is a hardware detail. The software contract is the
important architectural boundary.

Each module should contain a small MCU that advertises its descriptor,
parameters, and capabilities. The DSP could be implemented by whatever hardware
fits the module:

- STM32H7
- RP2350
- ESP32-P4
- NXP i.MX RT
- FPGA

The groovebox should not care which chip is inside the module.

## Device Module Capabilities

A device module should advertise what it is and what it can do.

```text
Device Module
  id
  name
  audio inputs
  audio outputs
  control inputs
  parameters
  latency
  capabilities
```

Capabilities could include:

- synth voice
- sampler voice
- audio effect
- send/return effect
- MIDI target
- clock target
- automation target

Once discovered, a module becomes a device option. The track and clip system
should not need special cases for physical hardware.

This abstraction should not be limited to physical modules. A remote Raspberry
Pi, another computer, a networked instrument, or a future controller can appear
through the same registry if it advertises the same device contract.

If a device module is unplugged, the document should retain the missing device.
When the module reconnects, its assignments, parameters, and automation should
return. This should feel like reopening a project with a missing plugin and
then restoring it.

## Automation Model

Automation should be device-oriented.

The same automation system should be able to target:

- track volume
- pan
- mute
- synth cutoff
- sampler start
- delay feedback
- compressor threshold
- spring reverb send
- external MIDI CC
- hardware module parameters

Automation remains creative intent in clips and documents. Runtime layers turn
that intent into playback events, parameter changes, control messages, or audio
engine updates.

## Why This Is Different

Most grooveboxes are either self-contained hardware instruments or controllers
for a larger software environment.

This direction is different because it combines:

- a standalone groovebox workflow
- an Ableton-like clip matrix
- internal software devices
- external MIDI and future CV
- discoverable physical synth and audio modules
- a unified device and automation model

The distinctive idea is not that the groovebox has add-ons. It is that physical
modules become peers of software devices, MIDI devices, and audio outputs.

The closest hardware analogy is not a fixed groovebox with accessories. It is a
digital modular instrument: attach, discover, automate, play.

## Development Phases

### Phase 1: Matrix Foundation

- Stable clip matrix
- Track columns
- Clip launch and disarm
- Launch quantization
- None selected as a valid live state
- Scenes as row-level launch requests

### Phase 2: Device Assignment

- Track device assignment
- Internal synth device
- Sampler device stub
- External MIDI device stub
- Device parameter model
- Missing device state

### Phase 3: Device Automation

- Automation targets devices
- Track controls become device/mixer modules
- Playback events carry destination information
- Outputs route by destination
- Device graph sketch

### Phase 4: Audio and Sampling

- Audio track model
- Sample clip model
- Simple sampler output
- Send and return routing
- Mixer model

### Phase 5: Device Module Abstraction

- Device module entity or runtime descriptor
- Device registry
- Device capability model
- Mock hardware module
- Hot-plug simulation
- Missing and restored device flow

### Phase 6: Hardware Bus Prototype

- Pogo connector electrical prototype
- I2S audio path
- Module identification
- Control protocol
- Latency reporting

The software should be ready before the hardware arrives. Hardware modules
should plug into the same device and output architecture already used by
internal instruments and external MIDI.
