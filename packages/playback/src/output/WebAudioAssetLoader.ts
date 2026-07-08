import type { AssetLoader, AssetReference } from '@sequencer/assets'

export class WebAudioAssetLoader implements AssetLoader<AudioBuffer> {
  constructor(private readonly context: AudioContext) {}

  canLoad(asset: AssetReference): boolean {
    return asset.kind === 'audio-sample' && Boolean(asset.uri)
  }

  async load(asset: AssetReference): Promise<AudioBuffer> {
    if (!this.canLoad(asset) || !asset.uri) {
      throw new Error(`Cannot load audio asset: ${asset.id}`)
    }

    const response = await fetch(asset.uri)

    if (!response.ok) {
      throw new Error(`Failed to load audio asset: ${asset.name}`)
    }

    const data = await response.arrayBuffer()

    return this.context.decodeAudioData(data.slice(0))
  }
}
