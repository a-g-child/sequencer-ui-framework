# Smoke Tests

These are small manual paths for validating end-to-end behavior before there is
an automated browser/runtime smoke harness.

## Playback Clock Path

Goal: confirm transport intent drives the clock, playback schedules from clock
state, and outputs receive playback events.

1. Start the UI.

   ```sh
   npm run dev
   ```

2. Create a few notes in the active pattern.

   Use different pitches and durations so `NoteOn` and `NoteOff` events are
   easy to distinguish in the console output.

3. Press Play.

   Confirm:

   - Editor Transport changes to `playing`
   - Clock changes to `running`
   - Clock Beat advances
   - Scheduler changes to `running`
   - Scheduler Beat advances
   - Queued count updates as notes enter the look-ahead window
   - Last Event shows note activity
   - console output includes `note:on` and `note:off`

4. Change BPM while playing.

   Confirm:

   - Clock BPM updates
   - Clock Beat continues from the current position
   - scheduler events continue from clock state

5. Press Stop.

   Confirm:

   - Editor Transport changes to `stopped`
   - Clock changes to `stopped`
   - Clock Beat resets to `0.00`
   - Scheduler changes to `stopped`
   - Scheduler Beat resets to `0.00`
   - queued event count resets

6. Seek, when a UI seek control exists.

   Confirm:

   - transport emits seek intent
   - clock emits `clock:seeked`
   - scheduler seeks to the same beat
   - already-emitted note events are not emitted twice after the seek

## Local Project Persistence

Goal: confirm the creative document can be saved to local storage and restored
without persisting runtime-only audio buffers.

1. Start the UI.

   ```sh
   npm run dev
   ```

2. Select a track and load an audio file into the sampler.

   Confirm:

   - a sampler device is assigned to the track
   - the loaded sample appears in a sampler slot
   - the sample grid lanes use sampler slot labels

3. Edit the sampler slot.

   Change root note, gain, start/end, and loop settings.

4. Click `Save Project`.

   Confirm:

   - the toolbar status changes to `Saved`
   - browser local storage contains `sequencer.project.autosave.v1`

5. Reload the page, then click `Load Project`.

   Confirm:

   - tracks, clips, devices, asset references, and sampler slot settings return
   - the project reports that sample files may need reloading
   - playback still works for loaded or fallback sample buffers

File-backed sample bytes are not part of persistence v1. `AssetReference`
metadata is saved in the document, while decoded `AudioBuffer` instances remain
runtime-only. Durable sample bytes should be handled later with IndexedDB or a
project asset package.
