import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { VoiceManager } from '../src/voice-manager.ts';

describe('VoiceManager', () => {
  it('allocates active voices', () => {
    const voices = new VoiceManager(2);

    const voice = voices.startVoice({
      noteId: 'note-1',
      trackId: 'track-1',
      pitch: 60,
      velocity: 0.75,
      nowMs: 10
    });

    assert.equal(voice.id, 'voice-1');
    assert.equal(voice.state, 'active');
    assert.equal(voices.stats().activeVoices, 1);
    assert.equal(voices.stats().totalStarted, 1);
  });

  it('releases voices by note id', () => {
    const voices = new VoiceManager(2);

    voices.startVoice({
      noteId: 'note-1',
      pitch: 60,
      velocity: 1,
      nowMs: 10
    });

    const released = voices.releaseVoiceByNote('note-1', 40);

    assert.equal(released.length, 1);
    assert.equal(released[0].state, 'released');
    assert.equal(released[0].releasedAtMs, 40);
    assert.equal(voices.stats().activeVoices, 0);
    assert.equal(voices.stats().releasedVoices, 1);
    assert.equal(voices.stats().totalReleased, 1);
  });

  it('steals the oldest active voice when max polyphony is reached', () => {
    const voices = new VoiceManager(2);

    const first = voices.startVoice({
      noteId: 'note-1',
      pitch: 60,
      velocity: 1,
      nowMs: 10
    });
    const second = voices.startVoice({
      noteId: 'note-2',
      pitch: 64,
      velocity: 1,
      nowMs: 20
    });
    const result = voices.startVoiceWithStealing({
      noteId: 'note-3',
      pitch: 67,
      velocity: 1,
      nowMs: 30
    });

    assert.equal(result.stolenVoice?.id, first.id);
    assert.equal(first.state, 'stolen');
    assert.equal(second.state, 'active');
    assert.equal(result.voice.state, 'active');
    assert.equal(voices.stats().activeVoices, 2);
    assert.equal(voices.stats().stolenVoices, 1);
    assert.equal(voices.stats().totalStolen, 1);
  });
});
