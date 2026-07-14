# Deterministic Native Clip Playback Stabilisation

## Phase 0: Freeze Unrelated Work
- [x] Keep unrelated UI work out of playback/native commits.
- [ ] Maintain one minimal reproduction project: one track, one instrument, four-beat loop, sixteenth notes, final-sixteenth note, no MIDI effects.
- [ ] Avoid adding DSP nodes, native project support, or UI layout changes during this programme.

## Phase 1: End-To-End Event Trace
- [x] Add a trace identity to every compiled clip note event.
- [x] Carry trace identity through TypeScript native schedule compilation and socket JSON.
- [x] Carry trace identity through host decoding into Rust engine commands.
- [x] Record scheduler trace fields: received beat, resolved sample, loop iteration, visited sample, dispatched sample, drop reason.
- [ ] Add tempo revision to scheduler trace records once tempo revisions exist.
- [x] Record instrument trace fields: note-on/off received sample, voice allocation/release, active voice count.
- [x] Expose a bounded recent-event trace in runtime snapshots.
- [x] Add explicit scheduled-event drop reasons.

## Phase 2: Prove The Production Startup Batch
- [x] Add an integration test for an already-running audio stream with stopped transport and armed clip.
- [x] Assert startup commands share one activation sample and activation beat.
- [x] Assert exactly one schedule generation is submitted.
- [x] Assert serialized host-decoded batch contains beat-zero and final-sixteenth note-on/off events.
- [x] Assert owner and generation match the activation command.

## Phase 3: Atomic Transport Start Transaction
- [x] Add a prepared transport-start request on the control side.
- [x] Transfer one compact activate-transport-start command to the audio thread.
- [x] Apply tempo, transport anchor, loop, owner generations, schedules, and playing state atomically.
- [x] Dispatch events due exactly at the activation sample after transaction activation.

## Phase 4: Separate Device Time From Transport Time
- [x] Formalise device clock and transport timeline structures.
- [x] Freeze transport beat while stopped.
- [x] Anchor transport beat explicitly on start.
- [x] Audit raw sample-to-beat conversions against the transport timeline.
- [x] Ensure runtime snapshots report transport timeline beat.

## Phase 5: Atomic Clip Schedule Activation
- [ ] Prepare complete scheduled event sets off the audio thread.
- [ ] Activate schedule ownership and event set atomically.
- [ ] Retire old generations and reclaim scheduler capacity safely.
- [ ] Coalesce pending schedule replacements.

## Phase 6: Paired Loop Occurrence Generation
- [ ] Represent looped notes as definitions with start and duration.
- [ ] Generate note-off from each repeated note-on occurrence.
- [ ] Allow completion note-offs at or beyond loop end without independent wrapping.
- [ ] Preserve note-off before note-on ordering at identical samples.

## Phase 7: Note-Instance Identity
- [ ] Add note instance identity to note-on and note-off events.
- [ ] Store instance identity on instrument voices.
- [ ] Release voices by instance identity, not pitch alone.
- [ ] Define identity propagation for transpose, scale, velocity, chord, arpeggiator, and delay nodes.

## Phase 8: Future-Only Live Replacement
- [ ] Calculate schedule replacement activation beat/sample.
- [ ] Submit only future occurrences after the activation boundary.
- [ ] Preserve completion note-offs for currently active notes.
- [ ] Avoid replaying historical note-ons during live edits.

## Phase 9: Stabilise BPM Changes
- [ ] Add tempo revision ownership to beat events.
- [ ] Retain committed event sample positions inside the scheduling horizon.
- [ ] Retiming only uncommitted events on tempo changes.
- [ ] Coalesce UI tempo updates to a bounded rate.

## Phase 10: Transactional Swing Scheduling
- [ ] Keep source beat and effective beat separate.
- [ ] Apply swing as schedule timing only.
- [ ] Apply new swing at a safe future boundary.
- [ ] Coalesce repeated swing edits.
- [ ] Choose and test note duration policy under swing.

## Phase 11: Rendered-Audio Regressions
- [ ] Add offline rendered-audio test for fresh armed start.
- [ ] Add rendered test for final-sixteenth release across loops.
- [ ] Add rendered test for live future note writing.
- [ ] Add rendered BPM stress test.
- [ ] Add rendered swing stress test.
- [ ] Compare output across varied callback groupings.

## Phase 12: Stabilise Host Snapshot Tests
- [ ] Replace exact callback-count assumptions with bounded polling.
- [ ] Assert sample-position monotonicity instead of exact wall-clock-derived values.
- [ ] Keep deterministic null-driver coverage unconditional.

## Exit Criteria
- [ ] Pre-armed clip is audible on the first loop.
- [ ] Final-sixteenth notes release at the loop boundary.
- [ ] Stop/re-cue never stretches the first interval.
- [ ] Live note writing never replays historical notes.
- [ ] Same-pitch overlapping notes release independently.
- [ ] BPM changes do not alter plan revision or schedule generation.
- [ ] Swing changes replace only future clip intent.
- [ ] No stuck notes after stop, panic, re-cue, BPM, or swing changes.
- [ ] Rendered output is deterministic across callback sizes.
- [ ] WebAudio and native emit equivalent note lifecycle traces.
