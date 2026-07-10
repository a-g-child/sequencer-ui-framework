use std::f64::consts::TAU;

use crate::SmoothedParameter;

pub const PARAM_DIAGNOSTIC_FREQUENCY: u32 = 1;
pub const PARAM_DIAGNOSTIC_GAIN: u32 = 2;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct DiagnosticOscillator {
    phase: f64,
    frequency_hz: f32,
    gain: SmoothedParameter,
}

impl Default for DiagnosticOscillator {
    fn default() -> Self {
        Self::new(440.0, 0.05)
    }
}

impl DiagnosticOscillator {
    pub fn new(frequency_hz: f32, gain: f32) -> Self {
        Self {
            phase: 0.0,
            frequency_hz,
            gain: SmoothedParameter::new(gain),
        }
    }

    pub fn phase(&self) -> f64 {
        self.phase
    }

    pub fn frequency_hz(&self) -> f32 {
        self.frequency_hz
    }

    pub fn gain(&self) -> f32 {
        self.gain.current()
    }

    pub fn set_frequency(&mut self, frequency_hz: f32) {
        self.frequency_hz = frequency_hz.max(0.0);
    }

    pub fn set_gain_target(&mut self, gain: f32, ramp_samples: u32) {
        self.gain.set_target(gain.max(0.0), ramp_samples);
    }

    pub fn reset(&mut self) {
        self.phase = 0.0;
        self.frequency_hz = 440.0;
        self.gain = SmoothedParameter::new(0.0);
    }

    pub fn next_sample(&mut self, sample_rate: f64) -> f32 {
        let gain = self.gain.next_value();
        let sample = (self.phase * TAU).sin() as f32 * gain;
        let phase_increment = self.frequency_hz as f64 / sample_rate.max(1.0);

        self.phase += phase_increment;
        self.phase -= self.phase.floor();

        sample
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wraps_phase() {
        let mut oscillator = DiagnosticOscillator::new(48_000.0, 1.0);

        oscillator.next_sample(48_000.0);
        oscillator.next_sample(48_000.0);

        assert!(oscillator.phase() >= 0.0);
        assert!(oscillator.phase() < 1.0);
    }
}
