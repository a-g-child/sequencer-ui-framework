# Persistence

Persistence v1 saves and restores the creative document locally. It deliberately
does not save runtime execution state.

## Current Scope

The UI stores a serialized `SequencerDocument` in `localStorage` through
`LocalProjectStore`.

Storage key:

```text
sequencer.project.autosave.v1
```

Manual save/load is exposed from the main toolbar:

- `Save Project` serializes the current document and writes it to local storage.
- `Load Project` reads the saved document, deserializes it, replaces the active
  document, and rebuilds the playback/runtime view.

Autosave is intentionally not part of v1.

## Saved Document State

The serialized document includes:

- project id, name, BPM, and timeline
- tracks and matrix clip slots
- MIDI clips and patterns
- document parameter definitions and values
- device instances and parameter values
- sampler slot metadata
- asset references

This is enough to restore the musical shape of a project: tracks, devices,
clips, sampler assignments, and matrix placement.

## Runtime State

Persistence does not save:

- decoded `AudioBuffer` objects
- Web Audio nodes
- active voices
- scheduler queues
- pending clip launches
- output connection state
- browser MIDI permissions

Those are runtime concerns. Loading a project rebuilds them from the document.

## Asset Caveat

Sampler assets are saved as `AssetReference` metadata only. File-backed sample
bytes are not durable in local persistence v1, so loaded sample files may need
to be reselected after a browser reload.

The intended boundary is:

```text
AssetReference in document
  -> AssetLoader at runtime
  -> decoded AudioBuffer/native sample handle
```

Durable asset bytes should move to IndexedDB or a packaged project asset store
later. The document should continue to store references, not decoded buffers.

## Regression Coverage

The core serialization test round-trips:

- asset references
- sampler device instances
- sampler slot settings
- track device assignment
- matrix clip slot index

That test protects the save/load contract without depending on browser
`localStorage`.
