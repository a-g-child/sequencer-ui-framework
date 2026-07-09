import type {
  ExecutionExecutor,
  ExecutionExecutorStatus,
  ExecutionParameterUpdate,
  ExecutionProcessContext,
  ExecutionProcessResult,
  RuntimeAudioGraph
} from './types.ts';

export abstract class BaseExecutionExecutor implements ExecutionExecutor {
  private executorStatus: ExecutionExecutorStatus = 'idle';
  protected graph?: RuntimeAudioGraph;

  constructor(
    readonly id: string,
    readonly name: string
  ) {}

  get status(): ExecutionExecutorStatus {
    return this.executorStatus;
  }

  async initialise(graph: RuntimeAudioGraph): Promise<void> {
    this.graph = graph;
    this.executorStatus = 'initialised';
  }

  updateParameters(_updates: readonly ExecutionParameterUpdate[]): void {}

  process(_context: ExecutionProcessContext): ExecutionProcessResult | void {
    if (this.executorStatus === 'initialised') {
      this.executorStatus = 'running';
    }
  }

  shutdown(): void {
    this.graph = undefined;
    this.executorStatus = 'shutdown';
  }
}

export class NoopExecutionExecutor extends BaseExecutionExecutor {
  constructor() {
    super('noop-executor', 'No-op Execution Executor');
  }

  override process(
    context: ExecutionProcessContext
  ): ExecutionProcessResult | void {
    super.process(context);

    return {
      nodeDiagnostics: this.graph?.nodeDiagnostics
    };
  }
}
