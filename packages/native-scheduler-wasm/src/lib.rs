pub fn set_model_json(model_json: &str) -> Result<(), &'static str> {
    if model_json.trim().is_empty() {
        return Err("PlaybackModel JSON is empty");
    }

    Ok(())
}

pub fn tick_json(clock_state_json: &str) -> Result<&'static str, &'static str> {
    if clock_state_json.trim().is_empty() {
        return Err("ClockState JSON is empty");
    }

    Ok("[]")
}

pub fn schedule_lookahead_json(_window: f64) -> &'static str {
    "[]"
}

pub fn status_json() -> &'static str {
    r#"{"running":false,"queuedEventCount":0,"currentBeat":0,"lookaheadDepthBeats":0,"maxLookaheadDepthBeats":0,"lookaheadDepthMs":0,"maxLookaheadDepthMs":0,"largestEventBatch":0}"#
}
