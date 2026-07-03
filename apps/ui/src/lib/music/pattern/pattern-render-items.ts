export type RenderLane = {
  id: string;
  label: string;
  y: number;
  height: number;
  source?: unknown;
};

export type RenderItem<TSource = unknown> = {
  id: string;
  laneId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  visualPitch?: number;
  selected: boolean;
  hovered: boolean;
  source: TSource;
};
