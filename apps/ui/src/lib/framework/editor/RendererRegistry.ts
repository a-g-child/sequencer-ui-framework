import type { RenderModel } from './RenderModel';
import type { Renderer } from './Renderer';

export class RendererRegistry {
  private readonly renderers = new Map<string, Renderer>();

  register<TModel extends RenderModel>(
    id: string,
    renderer: Renderer<TModel>
  ): void {
    this.renderers.set(id, renderer as Renderer);
  }

  get<TModel extends RenderModel>(id: string): Renderer<TModel> | undefined {
    return this.renderers.get(id) as Renderer<TModel> | undefined;
  }
}
