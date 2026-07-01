import type { EditorSession } from './EditorSession';
import type { RenderModel } from './RenderModel';

export type RenderModelBuilderInput<
  TDocument = unknown,
  TSession extends EditorSession = EditorSession
> = {
  document: TDocument;
  session: TSession;
};

export interface RenderModelBuilder<
  TInput extends RenderModelBuilderInput = RenderModelBuilderInput,
  TModel extends RenderModel = RenderModel
> {
  build(input: TInput): TModel;
}
