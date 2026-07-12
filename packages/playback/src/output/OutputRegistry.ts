import type { PlaybackOutput } from './PlaybackOutput.ts'

export class OutputRegistry {
  private readonly registeredOutputs = new Map<string, PlaybackOutput>()

  register<T extends PlaybackOutput>(output: T): T {
    if (this.registeredOutputs.has(output.id)) {
      throw new Error(`Output already registered: ${output.id}`)
    }

    this.registeredOutputs.set(output.id, output)
    return output
  }

  remove(outputId: string): PlaybackOutput | undefined {
    const output = this.registeredOutputs.get(outputId)

    this.registeredOutputs.delete(outputId)
    return output
  }

  get(outputId: string): PlaybackOutput | undefined {
    return this.registeredOutputs.get(outputId)
  }

  outputs(): PlaybackOutput[] {
    return [...this.registeredOutputs.values()]
  }
}
