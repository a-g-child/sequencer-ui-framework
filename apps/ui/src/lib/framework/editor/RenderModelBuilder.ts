import type { EditorSession } from './EditorSession.ts';
import type { RenderModel } from './RenderModel.ts';

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
