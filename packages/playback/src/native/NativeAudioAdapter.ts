import type { DeviceCommand, NativeAudioCommandAck } from './schemas.ts'

export interface NativeAudioAdapterStatus {
  readonly receivedCommandCount: number
  readonly lastCommand?: DeviceCommand
  readonly lastAck?: NativeAudioCommandAck
}

export class NativeAudioAdapter {
  private receivedCommandCount = 0
  private lastCommand?: DeviceCommand
  private lastAck?: NativeAudioCommandAck
  private readonly acknowledgedCommands: NativeAudioCommandAck[] = []

  get status(): NativeAudioAdapterStatus {
    return {
      receivedCommandCount: this.receivedCommandCount,
      lastCommand: this.lastCommand,
      lastAck: this.lastAck
    }
  }

  handleCommands(commands: readonly DeviceCommand[]): readonly NativeAudioCommandAck[] {
    const acknowledgements = commands.map((command) => this.acknowledge(command))

    this.acknowledgedCommands.push(...acknowledgements)
    return acknowledgements
  }

  acks(): readonly NativeAudioCommandAck[] {
    return this.acknowledgedCommands
  }

  clear(): void {
    this.receivedCommandCount = 0
    this.lastCommand = undefined
    this.lastAck = undefined
    this.acknowledgedCommands.length = 0
  }

  private acknowledge(command: DeviceCommand): NativeAudioCommandAck {
    const ack = {
      commandId: command.id,
      type: command.type,
      accepted: true
    }

    this.receivedCommandCount += 1
    this.lastCommand = command
    this.lastAck = ack

    return ack
  }
}
