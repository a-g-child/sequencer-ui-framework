# Persistence

Persistence v1 saves and restores the creative document locally. It also keeps
browser-imported sampler files in local browser storage so projects can be
reopened without manually reloading every sample.

## Current Scope

The UI stores a serialized `SequencerDocument` in `localStorage` through
`LocalProjectStore`. Imported sample files are stored separately in IndexedDB
through `BrowserAssetStore`.

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
- track mixer state
- MIDI clips and patterns
- document parameter definitions and values
- device instances and parameter values
- sampler slot metadata
- asset references

This is enough to restore the musical shape of a project: tracks, devices,
clips, sampler assignments, and matrix placement.

Sampler `AssetReference.uri` values use a durable local URI shape:

```text
indexeddb://sequencer.assets/<asset-id>
```

On load, the UI resolves those references from IndexedDB, creates temporary
runtime object URLs, and asks Web Audio to decode them back into its sample
buffer cache.

## Runtime State

Persistence does not save:

- decoded `AudioBuffer` objects
- temporary object URLs
- Web Audio nodes
- active voices
- scheduler queues
- pending clip launches
- output connection state
- browser MIDI permissions

Those are runtime concerns. Loading a project rebuilds them from the document.

## Asset Storage

Sampler asset metadata is saved in the document. Imported sample bytes are saved
in IndexedDB, keyed by asset id.

The boundary remains:

```text
AssetReference in document
  -> BrowserAssetStore at project load
  -> temporary runtime URI
  -> decoded AudioBuffer/native sample handle
```

If IndexedDB data is cleared by the browser, the document still loads, but those
sample buffers will be missing until files are imported again.

## Regression Coverage

The core serialization test round-trips:

- asset references
- sampler device instances
- sampler slot settings
- track device assignment
- matrix clip slot index
- track mixer state

That test protects the save/load contract without depending on browser
`localStorage` or IndexedDB.
