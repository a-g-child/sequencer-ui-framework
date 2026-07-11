#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SmoothedParameter {
    current: f32,
    target: f32,
    increment: f32,
    remaining_samples: u32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SmoothedParameterState {
    pub current: f32,
    pub target: f32,
    pub increment: f32,
    pub remaining_samples: u32,
}

impl SmoothedParameter {
    pub fn new(value: f32) -> Self {
        Self {
            current: value,
            target: value,
            increment: 0.0,
            remaining_samples: 0,
        }
    }

    pub fn current(&self) -> f32 {
        self.current
    }

    pub fn set_target(&mut self, target: f32, ramp_samples: u32) {
        if ramp_samples == 0 {
            self.current = target;
            self.target = target;
            self.increment = 0.0;
            self.remaining_samples = 0;
            return;
        }

        self.target = target;
        self.increment = (target - self.current) / ramp_samples as f32;
        self.remaining_samples = ramp_samples;
    }

    pub fn next_value(&mut self) -> f32 {
        if self.remaining_samples > 0 {
            self.current += self.increment;
            self.remaining_samples -= 1;

            if self.remaining_samples == 0 {
                self.current = self.target;
            }
        }

        self.current
    }

    pub fn state(&self) -> SmoothedParameterState {
        SmoothedParameterState {
            current: self.current,
            target: self.target,
            increment: self.increment,
            remaining_samples: self.remaining_samples,
        }
    }

    pub fn restore_state(&mut self, state: SmoothedParameterState) {
        self.current = state.current;
        self.target = state.target;
        self.increment = state.increment;
        self.remaining_samples = state.remaining_samples;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn jumps_immediately_when_ramp_is_zero() {
        let mut parameter = SmoothedParameter::new(0.0);

        parameter.set_target(1.0, 0);

        assert_eq!(parameter.current(), 1.0);
        assert_eq!(parameter.next_value(), 1.0);
    }

    #[test]
    fn ramps_linearly_and_clamps_to_target() {
        let mut parameter = SmoothedParameter::new(0.0);

        parameter.set_target(1.0, 4);

        assert_eq!(parameter.next_value(), 0.25);
        assert_eq!(parameter.next_value(), 0.5);
        assert_eq!(parameter.next_value(), 0.75);
        assert_eq!(parameter.next_value(), 1.0);
        assert_eq!(parameter.current(), 1.0);
    }
}
