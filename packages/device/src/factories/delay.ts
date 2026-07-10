import {
  AudioGraphBuilder,
  DEFAULT_AUDIO_NODE_DESCRIPTORS,
  DELAY_AUDIO_GRAPH,
  type RuntimeAudioGraph
} from '@sequencer/audio-graph';
import { DELAY_DESCRIPTOR } from '../descriptors/delay.ts';
import type { DeviceFactory } from '../factory.ts';
import type { DeviceInstance } from '../instance.ts';
import {
  advanceRuntimeParameters,
  createRuntimeParameters
} from '../parameter-runtime.ts';
import { BaseRuntimeDevice } from '../runtime.ts';

const delayGraphBuilder = new AudioGraphBuilder(DEFAULT_AUDIO_NODE_DESCRIPTORS);

export interface DelayGraphDiagnostics {
  readonly presetId: string;
  readonly nodeCount: number;
  readonly connectionCount: number;
  readonly latencySamples: number;
  readonly executionOrder: readonly string[];
  readonly diagnostics: RuntimeAudioGraph['diagnostics'];
  readonly nodeDiagnostics: RuntimeAudioGraph['nodeDiagnostics'];
}

export interface DelayDiagnostics {
  readonly graph?: DelayGraphDiagnostics;
}

export class DelayRuntimeDevice<
  TEvent = unknown
> extends BaseRuntimeDevice<TEvent> {
  advance(deltaMs: number): void {
    advanceRuntimeParameters(this.parameters, deltaMs);
  }

  getDiagnostics(): DelayDiagnostics {
    return {
      graph: this.runtimeGraph
        ? {
            presetId: this.runtimeGraph.document.id,
            nodeCount: this.runtimeGraph.nodes.length,
            connectionCount: this.runtimeGraph.connections.length,
            latencySamples: this.runtimeGraph.latencySamples,
            executionOrder: this.runtimeGraph.executionOrder,
            diagnostics: this.runtimeGraph.diagnostics,
            nodeDiagnostics: this.runtimeGraph.nodeDiagnostics
          }
        : undefined
    };
  }
}

export class DelayFactory<TEvent = unknown> implements DeviceFactory<TEvent> {
  readonly descriptor = DELAY_DESCRIPTOR;

  create(instance: DeviceInstance): DelayRuntimeDevice<TEvent> {
    return new DelayRuntimeDevice(
      instance,
      createRuntimeParameters(this.descriptor, instance),
      delayGraphBuilder.build(DELAY_AUDIO_GRAPH)
    );
  }
}
