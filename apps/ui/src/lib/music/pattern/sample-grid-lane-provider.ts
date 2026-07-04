export type SampleGridLaneDefinition = {
  pitch: number;
  label: string;
};

export type SampleGridPadDefinition = SampleGridLaneDefinition & {
  page: number;
  pad: number;
};

export type SampleGridPadSlot = {
  page: number;
  pad: number;
  lane?: SampleGridPadDefinition;
};

export type SampleGridPadPage = {
  page: number;
  columns: number;
  rows: number;
  pads: SampleGridPadSlot[];
};

export const SAMPLE_GRID_PAD_COLUMNS = 4;
export const SAMPLE_GRID_PAD_ROWS = 4;
export const SAMPLE_GRID_PADS_PER_PAGE =
  SAMPLE_GRID_PAD_COLUMNS * SAMPLE_GRID_PAD_ROWS;

const generalMidiDrumPads: readonly SampleGridPadDefinition[] = [
  { page: 0, pad: 0, pitch: 36, label: 'Kick' },
  { page: 0, pad: 1, pitch: 38, label: 'Snare' },
  { page: 0, pad: 2, pitch: 42, label: 'Closed Hat' },
  { page: 0, pad: 3, pitch: 46, label: 'Open Hat' },
  { page: 0, pad: 4, pitch: 49, label: 'Crash' },
  { page: 0, pad: 5, pitch: 51, label: 'Ride' }
];

export function getGeneralMidiDrumLanes(): readonly SampleGridLaneDefinition[] {
  return generalMidiDrumPads;
}

export function getGeneralMidiDrumPadPage(page = 0): SampleGridPadPage {
  const lanesByPad = new Map(
    generalMidiDrumPads
      .filter((lane) => lane.page === page)
      .map((lane) => [lane.pad, lane])
  );

  return {
    page,
    columns: SAMPLE_GRID_PAD_COLUMNS,
    rows: SAMPLE_GRID_PAD_ROWS,
    pads: Array.from({ length: SAMPLE_GRID_PADS_PER_PAGE }, (_, pad) => ({
      page,
      pad,
      lane: lanesByPad.get(pad)
    }))
  };
}

export function getGeneralMidiDrumLaneLabel(pitch: number): string | undefined {
  return generalMidiDrumPads.find((lane) => lane.pitch === pitch)?.label;
}
