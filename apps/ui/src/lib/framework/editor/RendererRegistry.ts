import type { RenderModel } from './RenderModel.ts';
import type { Renderer } from './Renderer.ts';

export type RegisteredRenderer = {
  readonly id: string;
};

export class RendererRegistry<
  TRenderer extends RegisteredRenderer = Renderer<RenderModel>
> {
  private readonly renderers = new Map<string, TRenderer>();

  register(renderer: TRenderer): void {
    this.renderers.set(renderer.id, renderer);
  }

  get(id: string): TRenderer | undefined {
    return this.renderers.get(id);
  }
}
