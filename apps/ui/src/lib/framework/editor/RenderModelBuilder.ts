import type { EditorSession } from './EditorSession';
import type { RenderModel } from './RenderModel';

export type RenderModelBuilderInput<
  TDocument,
  TSession extends EditorSession
> = {
  document: TDocument;
  session: TSession;
};

export interface RenderModelBuilder<
  TDocument = unknown,
  TSession extends EditorSession = EditorSession,
  TModel extends RenderModel = RenderModel
> {
  build(input: RenderModelBuilderInput<TDocument, TSession>): TModel;
}
