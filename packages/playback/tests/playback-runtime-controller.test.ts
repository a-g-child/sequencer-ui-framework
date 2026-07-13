import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  PlaybackRuntimeController,
  type RuntimeBackend,
  type RuntimeCompilePlan,
  type RuntimeSnapshot,
  type PreparedRuntimeHandle
} from '../src/native/index.ts'
import type { EngineCommand } from '../src/native/schemas.ts'

describe('PlaybackRuntimeController', () => {
  it('sends transport commands and reconciles observed snapshots', async () => {
    const backend = new FakeRuntimeBackend()
    const controller = new PlaybackRuntimeController(backend, {
      autoPoll: false
    })

    await controller.start()
    assert.equal(controller.status.snapshot?.transport.playing, false)

    controller.sendCommands([
      {
        id: 'schedule-note',
        type: 'event:schedule-beat',
        timeMs: 0,
        atSample: 0,
        clipId: 'clip-1',
        generation: 1,
        event: {
          kind: 'note-on',
          targetNode: 5,
          note: 60,
          velocity: 0.5,
          atBeat: 0
        }
      }
    ])
    assert.equal(backend.commands.at(-1)?.type, 'event:schedule-beat')

    await controller.play()
    assert.equal(backend.commands.at(-1)?.type, 'transport:start')
    assert.equal(controller.status.requestedTransportPlaying, true)
    assert.equal(controller.status.snapshot?.transport.playing, true)
    assert.equal(controller.status.commandPending, false)

    await controller.stop()
    assert.equal(backend.commands.at(-1)?.type, 'transport:stop')
    assert.equal(controller.status.snapshot?.transport.playing, false)

    await controller.dispose()
    assert.equal(backend.disposed, true)
  })

  it('waits for an in-flight runtime start before compiling a plan', async () => {
    const backend = new SlowStartRuntimeBackend()
    const controller = new PlaybackRuntimeController(backend, {
      autoPoll: false
    })
    const starting = controller.start()
    const activation = controller.compileAndActivate(createPlan())

    assert.equal(backend.compileBeforeStart, false)
    backend.resolveStart()

    await starting
    const snapshot = await activation

    assert.equal(backend.compileCalls, 1)
    assert.equal(snapshot.plan.activeRevision, 2)
  })

  it('waits for block-boundary activation before confirming the active plan', async () => {
    const backend = new DelayedActivationRuntimeBackend()
    const controller = new PlaybackRuntimeController(backend, {
      autoPoll: false,
      pollIntervalMs: 1,
      activationConfirmTimeoutMs: 200
    })

    const snapshot = await controller.compileAndActivate(createPlan())

    assert.equal(backend.snapshotReads, 4)
    assert.equal(snapshot.plan.activePlanId, 7)
    assert.equal(snapshot.plan.activeRevision, 2)
    assert.equal(controller.status.failure, undefined)
  })

  it('waits for activation even before pending transfers are observable', async () => {
    const backend = new SnapshotLagActivationRuntimeBackend()
    const controller = new PlaybackRuntimeController(backend, {
      autoPoll: false,
      pollIntervalMs: 1,
      activationConfirmTimeoutMs: 200
    })

    const snapshot = await controller.compileAndActivate(createPlan())

    assert.equal(backend.snapshotReads, 4)
    assert.equal(snapshot.plan.activePlanId, 7)
    assert.equal(snapshot.plan.activeRevision, 2)
  })

  it('includes activation snapshot trace when confirmation fails', async () => {
    const backend = new NeverActivatedRuntimeBackend()
    const controller = new PlaybackRuntimeController(backend, {
      autoPoll: false,
      pollIntervalMs: 1,
      activationConfirmTimeoutMs: 2
    })

    await assert.rejects(
      () => controller.compileAndActivate(createPlan()),
      (error) => {
        assert.ok(error instanceof Error)
        assert.match(
          error.message,
          /runtime activation did not confirm plan 7; observed null/
        )
        assert.match(error.message, /handle=native planId=7 revision=2 transferId=1/)
        assert.match(error.message, /snapshots=\[/)
        assert.match(error.message, /plan=null\/null/)
        assert.match(error.message, /callbacks=/)
        return true
      }
    )
  })

  it('serializes overlapping plan activations', async () => {
    const backend = new ManuallyActivatedRuntimeBackend()
    const controller = new PlaybackRuntimeController(backend, {
      autoPoll: false
    })

    const first = controller.compileAndActivate(createPlan('native-plan:first', 2))
    await backend.waitForPendingActivation()
    const second = controller.compileAndActivate(createPlan('native-plan:second', 3))
    await Promise.resolve()

    assert.equal(backend.compileCalls, 1)

    backend.confirmNextActivation()
    const firstSnapshot = await first

    assert.equal(firstSnapshot.plan.activeRevision, 2)
    await backend.waitForPendingActivation()
    assert.equal(backend.compileCalls, 2)

    backend.confirmNextActivation()
    const secondSnapshot = await second

    assert.equal(secondSnapshot.plan.activeRevision, 3)
    assert.equal(backend.maxConcurrentActivations, 1)
  })

  it('allows stop to clean up controller intent after failure', async () => {
    const backend = new FakeRuntimeBackend()
    const controller = new PlaybackRuntimeController(backend, {
      autoPoll: false
    })

    controller.fail(new Error('activation failed'))
    await controller.stop()

    assert.equal(controller.status.state, 'failed')
    assert.equal(controller.status.requestedTransportPlaying, false)
    assert.equal(controller.status.commandPending, false)
  })

  it('waits for transport start confirmation before settling command pending', async () => {
    const backend = new DelayedTransportRuntimeBackend()
    const controller = new PlaybackRuntimeController(backend, {
      autoPoll: false,
      pollIntervalMs: 1,
      transportConfirmTimeoutMs: 50
    })

    await controller.start()
    await controller.play()

    assert.equal(backend.snapshotReads, 4)
    assert.equal(controller.status.snapshot?.transport.playing, true)
    assert.equal(controller.status.commandPending, false)
  })

  it('uses a fresh snapshot sample for transport commands', async () => {
    const backend = new FakeRuntimeBackend()
    const controller = new PlaybackRuntimeController(backend, {
      autoPoll: false
    })

    await controller.start()
    const cachedSample = controller.status.snapshot?.transport.samplePosition ?? 0

    await controller.play()

    const command = backend.commands.find(
      (candidate) => candidate.type === 'transport:start'
    )

    assert.equal(command?.type, 'transport:start')
    assert.ok(command.atSample > cachedSample)
  })

  it('fails visibly when transport start is not observed', async () => {
    const backend = new UnconfirmedTransportRuntimeBackend()
    const controller = new PlaybackRuntimeController(backend, {
      autoPoll: false,
      pollIntervalMs: 1,
      transportConfirmTimeoutMs: 5
    })

    await controller.start()

    await assert.rejects(
      () => controller.play(),
      (error) => {
        assert.ok(error instanceof Error)
        assert.match(
          error.message,
          /runtime transport did not confirm start; observed stopped/
        )
        assert.match(error.message, /snapshots=\[/)
        assert.match(error.message, /playing=false/)
        return true
      }
    )
    assert.equal(controller.status.state, 'failed')
    assert.match(
      controller.status.failure ?? '',
      /runtime transport did not confirm start; observed stopped/
    )
  })
})

function createPlan(id = 'native-plan:test', revision = 2): RuntimeCompilePlan {
  return {
    id,
    graphId: 'test',
    revision,
    nodes: [],
    buffers: [],
    parameters: [],
    eventRoutes: [],
    executionGroups: [],
    latencySamples: 0
  }
}

class ManuallyActivatedRuntimeBackend implements RuntimeBackend {
  compileCalls = 0
  maxConcurrentActivations = 0
  private started = false
  private activeActivations = 0
  private activePlanId: number | null = null
  private activeRevision: number | null = null
  private pendingActivation:
    | {
        readonly planId: number
        readonly revision: number
        readonly resolve: () => void
      }
    | undefined
  private pendingActivationWaiters: Array<() => void> = []

  async start(): Promise<void> {
    this.started = true
  }

  async stop(): Promise<void> {
    this.started = false
  }

  async compile(plan: RuntimeCompilePlan): Promise<PreparedRuntimeHandle> {
    this.compileCalls += 1

    return {
      id: `native:${this.compileCalls}`,
      planId: String(this.compileCalls + 6),
      backend: 'native',
      transferId: this.compileCalls,
      revision: 'revision' in plan && typeof plan.revision === 'number'
        ? plan.revision
        : this.compileCalls,
      ownerId: 'manual'
    }
  }

  async activate(handle: PreparedRuntimeHandle): Promise<void> {
    this.activeActivations += 1
    this.maxConcurrentActivations = Math.max(
      this.maxConcurrentActivations,
      this.activeActivations
    )

    await new Promise<void>((resolve) => {
      this.pendingActivation = {
        planId: Number(handle.planId),
        revision: handle.backend === 'native' ? handle.revision : 0,
        resolve
      }
      for (const waiter of this.pendingActivationWaiters.splice(0)) {
        waiter()
      }
    })

    this.activeActivations -= 1
  }

  confirmNextActivation(): void {
    const pending = this.pendingActivation

    if (!pending) return

    this.pendingActivation = undefined
    this.activePlanId = pending.planId
    this.activeRevision = pending.revision
    pending.resolve()
  }

  async waitForPendingActivation(): Promise<void> {
    if (this.pendingActivation) return

    await new Promise<void>((resolve) => {
      this.pendingActivationWaiters.push(resolve)
    })
  }

  sendCommands(_commands: readonly EngineCommand[]): void {}

  async getSnapshot(): Promise<RuntimeSnapshot> {
    return {
      backend: 'native',
      transport: {
        playing: false,
        samplePosition: 128,
        beatPosition: 0,
        loopIteration: 0
      },
      stream: {
        sampleRate: 48_000,
        callbackCount: 1
      },
      plan: {
        activePlanId: this.activePlanId,
        activeRevision: this.activeRevision,
        pendingTransfers: this.pendingActivation ? 1 : 0
      },
      diagnostics: {
        xruns: 0,
        queueOverflows: 0
      },
      samplePosition: 128,
      sampleRate: 48_000,
      running: this.started
    }
  }

  async dispose(): Promise<void> {
    this.started = false
  }
}

class FakeRuntimeBackend implements RuntimeBackend {
  commands: EngineCommand[] = []
  disposed = false
  private started = false
  private playing = false
  private samplePosition = 0

  async start(): Promise<void> {
    this.started = true
  }

  async stop(): Promise<void> {
    this.started = false
    this.playing = false
  }

  async compile(_plan: RuntimeCompilePlan): Promise<PreparedRuntimeHandle> {
    throw new Error('not needed')
  }

  async activate(_handle: PreparedRuntimeHandle): Promise<void> {}

  sendCommands(commands: readonly EngineCommand[]): void {
    for (const command of commands) {
      this.commands.push(command)

      if (command.type === 'transport:start') {
        this.playing = true
      } else if (command.type === 'transport:stop' || command.type === 'panic') {
        this.playing = false
      }
    }
  }

  async getSnapshot(): Promise<RuntimeSnapshot> {
    this.samplePosition += this.started ? 128 : 0

    return {
      backend: 'native',
      transport: {
        playing: this.playing,
        samplePosition: this.samplePosition,
        beatPosition: this.samplePosition / 24_000,
        loopIteration: 0
      },
      stream: {
        sampleRate: 48_000,
        callbackCount: Math.floor(this.samplePosition / 128)
      },
      plan: {
        activePlanId: null,
        activeRevision: null,
        pendingTransfers: 0
      },
      diagnostics: {
        xruns: 0,
        queueOverflows: 0
      },
      samplePosition: this.samplePosition,
      sampleRate: 48_000,
      running: this.started
    }
  }

  async dispose(): Promise<void> {
    this.disposed = true
    this.started = false
    this.playing = false
  }
}

class SlowStartRuntimeBackend implements RuntimeBackend {
  compileCalls = 0
  compileBeforeStart = false
  private started = false
  private startResolver: (() => void) | undefined
  private snapshot: RuntimeSnapshot = {
    backend: 'native',
    transport: {
      playing: false,
      samplePosition: 0,
      beatPosition: 0,
      loopIteration: 0
    },
    stream: {
      sampleRate: 48_000,
      callbackCount: 0
    },
    plan: {
      activePlanId: null,
      activeRevision: null,
      pendingTransfers: 0
    },
    diagnostics: {
      xruns: 0,
      queueOverflows: 0
    },
    samplePosition: 0,
    sampleRate: 48_000,
    running: false
  }

  async start(): Promise<void> {
    await new Promise<void>((resolve) => {
      this.startResolver = resolve
    })
    this.started = true
  }

  resolveStart(): void {
    this.startResolver?.()
  }

  async stop(): Promise<void> {
    this.started = false
  }

  async compile(_plan: RuntimeCompilePlan): Promise<PreparedRuntimeHandle> {
    this.compileBeforeStart = !this.started
    this.compileCalls += 1

    return {
      id: 'native:1',
      planId: '7',
      backend: 'native',
      transferId: 1,
      revision: 2,
      ownerId: 'slow'
    }
  }

  async activate(_handle: PreparedRuntimeHandle): Promise<void> {
    this.snapshot = {
      ...this.snapshot,
      plan: {
        activePlanId: 7,
        activeRevision: 2,
        pendingTransfers: 0
      }
    }
  }

  sendCommands(_commands: readonly EngineCommand[]): void {}

  async getSnapshot(): Promise<RuntimeSnapshot> {
    return {
      ...this.snapshot,
      running: this.started
    }
  }

  async dispose(): Promise<void> {
    this.started = false
  }
}

class DelayedActivationRuntimeBackend implements RuntimeBackend {
  snapshotReads = 0
  private started = false

  async start(): Promise<void> {
    this.started = true
  }

  async stop(): Promise<void> {
    this.started = false
  }

  async compile(_plan: RuntimeCompilePlan): Promise<PreparedRuntimeHandle> {
    return {
      id: 'native:1',
      planId: '7',
      backend: 'native',
      transferId: 1,
      revision: 2,
      ownerId: 'delayed'
    }
  }

  async activate(_handle: PreparedRuntimeHandle): Promise<void> {}

  sendCommands(_commands: readonly EngineCommand[]): void {}

  async getSnapshot(): Promise<RuntimeSnapshot> {
    this.snapshotReads += 1

    const activated = this.snapshotReads >= 4

    return {
      backend: 'native',
      transport: {
        playing: false,
        samplePosition: this.snapshotReads * 128,
        beatPosition: 0,
        loopIteration: 0
      },
      stream: {
        sampleRate: 48_000,
        callbackCount: this.snapshotReads
      },
      plan: {
        activePlanId: activated ? 7 : 6,
        activeRevision: activated ? 2 : 1,
        pendingTransfers: activated ? 0 : 1
      },
      diagnostics: {
        xruns: 0,
        queueOverflows: 0
      },
      samplePosition: this.snapshotReads * 128,
      sampleRate: 48_000,
      running: this.started
    }
  }

  async dispose(): Promise<void> {
    this.started = false
  }
}

class SnapshotLagActivationRuntimeBackend implements RuntimeBackend {
  snapshotReads = 0
  private started = false
  private activationRequested = false

  async start(): Promise<void> {
    this.started = true
  }

  async stop(): Promise<void> {
    this.started = false
  }

  async compile(_plan: RuntimeCompilePlan): Promise<PreparedRuntimeHandle> {
    return {
      id: 'native:1',
      planId: '7',
      backend: 'native',
      transferId: 1,
      revision: 2,
      ownerId: 'lag'
    }
  }

  async activate(_handle: PreparedRuntimeHandle): Promise<void> {
    this.activationRequested = true
  }

  sendCommands(_commands: readonly EngineCommand[]): void {}

  async getSnapshot(): Promise<RuntimeSnapshot> {
    this.snapshotReads += 1
    const activated = this.activationRequested && this.snapshotReads >= 4

    return {
      backend: 'native',
      transport: {
        playing: false,
        samplePosition: this.snapshotReads * 128,
        beatPosition: 0,
        loopIteration: 0
      },
      stream: {
        sampleRate: 48_000,
        callbackCount: this.snapshotReads
      },
      plan: {
        activePlanId: activated ? 7 : null,
        activeRevision: activated ? 2 : null,
        pendingTransfers: 0
      },
      diagnostics: {
        xruns: 0,
        queueOverflows: 0
      },
      samplePosition: this.snapshotReads * 128,
      sampleRate: 48_000,
      running: this.started
    }
  }

  async dispose(): Promise<void> {
    this.started = false
  }
}

class NeverActivatedRuntimeBackend implements RuntimeBackend {
  private started = false
  private snapshotReads = 0

  async start(): Promise<void> {
    this.started = true
  }

  async stop(): Promise<void> {
    this.started = false
  }

  async compile(_plan: RuntimeCompilePlan): Promise<PreparedRuntimeHandle> {
    return {
      id: 'native:1',
      planId: '7',
      backend: 'native',
      transferId: 1,
      revision: 2,
      ownerId: 'never'
    }
  }

  async activate(_handle: PreparedRuntimeHandle): Promise<void> {}

  sendCommands(_commands: readonly EngineCommand[]): void {}

  async getSnapshot(): Promise<RuntimeSnapshot> {
    this.snapshotReads += 1

    return {
      backend: 'native',
      transport: {
        playing: false,
        samplePosition: this.snapshotReads * 128,
        beatPosition: 0,
        loopIteration: 0
      },
      stream: {
        sampleRate: 48_000,
        callbackCount: this.snapshotReads
      },
      plan: {
        activePlanId: null,
        activeRevision: null,
        pendingTransfers: 0
      },
      diagnostics: {
        xruns: 0,
        queueOverflows: 0
      },
      samplePosition: this.snapshotReads * 128,
      sampleRate: 48_000,
      running: this.started
    }
  }

  async dispose(): Promise<void> {
    this.started = false
  }
}

class DelayedTransportRuntimeBackend extends FakeRuntimeBackend {
  snapshotReads = 0
  private startRequested = false

  sendCommands(commands: readonly EngineCommand[]): void {
    super.sendCommands(commands)

    if (commands.some((command) => command.type === 'transport:start')) {
      this.startRequested = true
    }
  }

  async getSnapshot(): Promise<RuntimeSnapshot> {
    this.snapshotReads += 1
    const snapshot = await super.getSnapshot()
    const confirmed = !this.startRequested || this.snapshotReads >= 4

    return {
      ...snapshot,
      transport: {
        ...snapshot.transport,
        playing: confirmed ? snapshot.transport.playing : false
      }
    }
  }
}

class UnconfirmedTransportRuntimeBackend extends FakeRuntimeBackend {
  async getSnapshot(): Promise<RuntimeSnapshot> {
    const snapshot = await super.getSnapshot()

    return {
      ...snapshot,
      transport: {
        ...snapshot.transport,
        playing: false
      }
    }
  }
}
