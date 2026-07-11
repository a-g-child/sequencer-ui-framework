use crate::{DiagnosticOscillator, DiagnosticOscillatorState};

pub fn midi_note_frequency(note: u8) -> f32 {
    440.0 * 2.0_f32.powf((note as f32 - 69.0) / 12.0)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EnvelopeStage {
    Idle,
    Attack,
    Decay,
    Sustain,
    Release,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct AdsrEnvelope {
    stage: EnvelopeStage,
    level: f32,
    attack_seconds: f32,
    decay_seconds: f32,
    sustain_level: f32,
    release_seconds: f32,
    stage_start_level: f32,
    stage_elapsed_samples: u32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct AdsrEnvelopeState {
    pub stage: EnvelopeStage,
    pub level: f32,
    pub stage_start_level: f32,
    pub stage_elapsed_samples: u32,
}

impl AdsrEnvelope {
    pub fn new(
        attack_seconds: f32,
        decay_seconds: f32,
        sustain_level: f32,
        release_seconds: f32,
    ) -> Self {
        Self {
            stage: EnvelopeStage::Idle,
            level: 0.0,
            attack_seconds: attack_seconds.max(0.0),
            decay_seconds: decay_seconds.max(0.0),
            sustain_level: sustain_level.clamp(0.0, 1.0),
            release_seconds: release_seconds.max(0.0),
            stage_start_level: 0.0,
            stage_elapsed_samples: 0,
        }
    }

    pub fn stage(&self) -> EnvelopeStage {
        self.stage
    }

    pub fn level(&self) -> f32 {
        self.level
    }

    pub fn gate_on(&mut self) {
        self.stage = EnvelopeStage::Attack;
        self.stage_start_level = self.level;
        self.stage_elapsed_samples = 0;
    }

    pub fn gate_off(&mut self) {
        if self.stage == EnvelopeStage::Idle {
            return;
        }

        self.stage = EnvelopeStage::Release;
        self.stage_start_level = self.level;
        self.stage_elapsed_samples = 0;
    }

    pub fn panic(&mut self) {
        self.stage = EnvelopeStage::Idle;
        self.level = 0.0;
        self.stage_start_level = 0.0;
        self.stage_elapsed_samples = 0;
    }

    pub fn next_value(&mut self, sample_rate: f64) -> f32 {
        match self.stage {
            EnvelopeStage::Idle => {
                self.level = 0.0;
            }
            EnvelopeStage::Attack => {
                let samples = seconds_to_samples(self.attack_seconds, sample_rate);

                if samples == 0 {
                    self.level = 1.0;
                    self.enter_decay_or_sustain(sample_rate);
                } else {
                    self.stage_elapsed_samples = self.stage_elapsed_samples.saturating_add(1);
                    let t = (self.stage_elapsed_samples as f32 / samples as f32).min(1.0);

                    self.level = self.stage_start_level + (1.0 - self.stage_start_level) * t;

                    if self.stage_elapsed_samples >= samples {
                        self.enter_decay_or_sustain(sample_rate);
                    }
                }
            }
            EnvelopeStage::Decay => {
                let samples = seconds_to_samples(self.decay_seconds, sample_rate);

                if samples == 0 {
                    self.level = self.sustain_level;
                    self.stage = EnvelopeStage::Sustain;
                } else {
                    self.stage_elapsed_samples = self.stage_elapsed_samples.saturating_add(1);
                    let t = (self.stage_elapsed_samples as f32 / samples as f32).min(1.0);

                    self.level =
                        self.stage_start_level + (self.sustain_level - self.stage_start_level) * t;

                    if self.stage_elapsed_samples >= samples {
                        self.level = self.sustain_level;
                        self.stage = EnvelopeStage::Sustain;
                    }
                }
            }
            EnvelopeStage::Sustain => {
                self.level = self.sustain_level;
            }
            EnvelopeStage::Release => {
                let samples = seconds_to_samples(self.release_seconds, sample_rate);

                if samples == 0 {
                    self.panic();
                } else {
                    self.stage_elapsed_samples = self.stage_elapsed_samples.saturating_add(1);
                    let t = (self.stage_elapsed_samples as f32 / samples as f32).min(1.0);

                    self.level = self.stage_start_level * (1.0 - t);

                    if self.stage_elapsed_samples >= samples {
                        self.panic();
                    }
                }
            }
        }

        self.level
    }

    pub fn state(&self) -> AdsrEnvelopeState {
        AdsrEnvelopeState {
            stage: self.stage,
            level: self.level,
            stage_start_level: self.stage_start_level,
            stage_elapsed_samples: self.stage_elapsed_samples,
        }
    }

    pub fn restore_state(&mut self, state: AdsrEnvelopeState) {
        self.stage = state.stage;
        self.level = state.level;
        self.stage_start_level = state.stage_start_level;
        self.stage_elapsed_samples = state.stage_elapsed_samples;
    }

    fn enter_decay_or_sustain(&mut self, sample_rate: f64) {
        if seconds_to_samples(self.decay_seconds, sample_rate) == 0 {
            self.level = self.sustain_level;
            self.stage = EnvelopeStage::Sustain;
            return;
        }

        self.level = 1.0;
        self.stage = EnvelopeStage::Decay;
        self.stage_start_level = 1.0;
        self.stage_elapsed_samples = 0;
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct MonophonicVoice {
    oscillator: DiagnosticOscillator,
    envelope: AdsrEnvelope,
    velocity: f32,
    active_note: Option<u8>,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct MonophonicVoiceState {
    pub oscillator: DiagnosticOscillatorState,
    pub envelope: AdsrEnvelopeState,
    pub velocity: f32,
    pub active_note: Option<u8>,
}

impl MonophonicVoice {
    pub fn new(
        attack_seconds: f32,
        decay_seconds: f32,
        sustain_level: f32,
        release_seconds: f32,
    ) -> Self {
        Self {
            oscillator: DiagnosticOscillator::new(440.0, 1.0),
            envelope: AdsrEnvelope::new(
                attack_seconds,
                decay_seconds,
                sustain_level,
                release_seconds,
            ),
            velocity: 0.0,
            active_note: None,
        }
    }

    pub fn active_note(&self) -> Option<u8> {
        self.active_note
    }

    pub fn envelope_stage(&self) -> EnvelopeStage {
        self.envelope.stage()
    }

    pub fn envelope_level(&self) -> f32 {
        self.envelope.level()
    }

    pub fn note_on(&mut self, note: u8, velocity: f32) {
        self.active_note = Some(note);
        self.velocity = velocity.clamp(0.0, 1.0);
        self.oscillator.set_frequency(midi_note_frequency(note));
        self.oscillator.set_gain_target(1.0, 0);
        self.envelope.gate_on();
    }

    pub fn note_off(&mut self, note: u8) {
        if self.active_note != Some(note) {
            return;
        }

        self.envelope.gate_off();
    }

    pub fn panic(&mut self) {
        self.active_note = None;
        self.velocity = 0.0;
        self.envelope.panic();
        self.oscillator.reset();
    }

    pub fn next_sample(&mut self, sample_rate: f64) -> f32 {
        let envelope = self.envelope.next_value(sample_rate);
        let sample = self.oscillator.next_sample(sample_rate) * envelope * self.velocity;

        if self.envelope.stage() == EnvelopeStage::Idle {
            self.active_note = None;
        }

        sample
    }

    pub fn state(&self) -> MonophonicVoiceState {
        MonophonicVoiceState {
            oscillator: self.oscillator.state(),
            envelope: self.envelope.state(),
            velocity: self.velocity,
            active_note: self.active_note,
        }
    }

    pub fn restore_state(&mut self, state: MonophonicVoiceState) {
        self.oscillator.restore_state(state.oscillator);
        self.envelope.restore_state(state.envelope);
        self.velocity = state.velocity;
        self.active_note = state.active_note;
    }
}

fn seconds_to_samples(seconds: f32, sample_rate: f64) -> u32 {
    (seconds.max(0.0) as f64 * sample_rate.max(1.0)).round() as u32
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_midi_note_to_frequency() {
        assert_eq!(midi_note_frequency(69), 440.0);
        assert!((midi_note_frequency(81) - 880.0).abs() < 0.001);
    }

    #[test]
    fn envelope_reaches_stages_at_configured_sample_counts() {
        let mut envelope = AdsrEnvelope::new(2.0 / 48_000.0, 2.0 / 48_000.0, 0.5, 2.0 / 48_000.0);

        envelope.gate_on();
        assert_eq!(envelope.next_value(48_000.0), 0.5);
        assert_eq!(envelope.stage(), EnvelopeStage::Attack);
        assert_eq!(envelope.next_value(48_000.0), 1.0);
        assert_eq!(envelope.stage(), EnvelopeStage::Decay);
        assert_eq!(envelope.next_value(48_000.0), 0.75);
        assert_eq!(envelope.next_value(48_000.0), 0.5);
        assert_eq!(envelope.stage(), EnvelopeStage::Sustain);

        envelope.gate_off();
        assert_eq!(envelope.next_value(48_000.0), 0.25);
        assert_eq!(envelope.next_value(48_000.0), 0.0);
        assert_eq!(envelope.stage(), EnvelopeStage::Idle);
    }

    #[test]
    fn retrigger_starts_attack_from_current_level() {
        let mut voice = MonophonicVoice::new(4.0 / 48_000.0, 0.0, 1.0, 0.0);

        voice.note_on(69, 1.0);
        voice.next_sample(48_000.0);
        let level_before_retrigger = voice.envelope_level();

        voice.note_on(72, 1.0);
        voice.next_sample(48_000.0);

        assert!(voice.envelope_level() > level_before_retrigger);
        assert!(voice.envelope_level() < 1.0);
    }

    #[test]
    fn non_active_note_off_is_ignored() {
        let mut voice = MonophonicVoice::new(0.0, 0.0, 1.0, 2.0 / 48_000.0);

        voice.note_on(69, 1.0);
        voice.next_sample(48_000.0);
        voice.note_off(70);

        assert_eq!(voice.envelope_stage(), EnvelopeStage::Sustain);
        assert_eq!(voice.active_note(), Some(69));
    }
}
