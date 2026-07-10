use crate::AudioDriverErrorCode;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AudioDriverError {
    pub code: AudioDriverErrorCode,
    pub message: String,
}

impl AudioDriverError {
    pub fn new(code: AudioDriverErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}
