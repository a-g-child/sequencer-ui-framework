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

## Matrix Scene Launch

Goal: confirm the clip matrix behaves like a groovebox scene launcher.

1. Start the UI.

   ```sh
   npm run dev
   ```

2. Create at least three tracks.

   Use different devices if available: Basic Synth, Sampler, and External MIDI.

3. Add clips into the same scene row.

   Use the empty matrix slots so each track has a clip in `Scene 1`. Add a
   second row for at least one track so track-level switching can be checked.

4. Set launch quantize to `bar`.

5. Click the scene launch button for `Scene 1`.

   Confirm:

   - every non-empty clip in that row changes to `queued`
   - queued clips show the same launch beat
   - all queued clips become `playing` together at the quantized boundary
   - synth, sampler, and MIDI tracks receive playback from their own clips

6. Click a different clip on one track.

   Confirm:

   - only that track queues the new clip
   - the other scene clips continue playing

7. Click the scene stop button.

   Confirm:

   - clips in that row stop or clear their queued state
   - clips outside the row are not stopped unless they belong to the same
     track and are replaced by the track stop behavior

8. Click `Stop All`.

   Confirm:

   - all matrix tracks show stopped or empty state
   - runtime voices are cleared
   - no stuck notes remain in Web Audio or MIDI

## Mixer Mute / Solo

Goal: confirm mixer intent controls audible Web Audio output across device
types.

1. Start the UI.

   ```sh
   npm run dev
   ```

2. Create two Web Audio tracks.

   Use Basic Synth on one track and Sampler on another. Load or use a fallback
   sampler slot so both tracks can make sound.

3. Add clips to both tracks in the same scene row.

4. Launch the scene.

   Confirm both tracks are audible.

5. Select the synth track and lower `Volume`.

   Confirm:

   - the synth track gets quieter
   - the sampler track is unchanged
   - existing sustained notes respond without restarting playback

6. Move `Pan` left and right.

   Confirm:

   - the selected track moves in the stereo field
   - the other track remains centered unless its pan is changed

7. Toggle `Mute` on the synth track.

   Confirm:

   - the synth track is silent
   - the sampler track remains audible

8. Toggle `Solo` on the sampler track.

   Confirm:

   - only the sampler track is audible
   - unmuting the synth track does not make it audible while the sampler is
     soloed

9. Toggle `Solo` off.

   Confirm:

   - non-muted tracks are audible again
   - muted tracks stay silent

## Matrix + Mixer Persistence

Goal: confirm matrix placement and mixer intent survive local project save/load.

1. Create two tracks with clips in different matrix scene rows.

2. Set mixer values on each track.

   Use distinct values such as:

   - Track 1: volume `0.50`, pan `-0.50`, mute `false`, solo `true`
   - Track 2: volume `0.75`, pan `0.50`, mute `true`, solo `false`

3. Click `Save Project`.

4. Reload the page and click `Load Project`.

   Confirm:

   - clips return to the same matrix scene rows
   - track volume, pan, mute, and solo values return
   - scene launch still queues the restored clips
   - mixer controls still affect Web Audio output after load
