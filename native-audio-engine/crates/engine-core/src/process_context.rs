#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ProcessContext {
    pub block_start_sample: u64,
    pub frame_count: u32,
    pub sample_rate: f64,
    pub output_channels: u16,
}
