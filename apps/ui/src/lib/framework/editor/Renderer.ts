import type { RenderModel } from './RenderModel';

export interface Renderer<TModel extends RenderModel = RenderModel> {
  readonly id: string;

  render(model: TModel): void;
}
