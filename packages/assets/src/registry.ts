import type { AssetId, AssetReference } from './asset';

export class AssetRegistry {
  private readonly assets = new Map<AssetId, AssetReference>();

  add(asset: AssetReference): void {
    this.assets.set(asset.id, asset);
  }

  get(id: AssetId): AssetReference {
    const asset = this.assets.get(id);

    if (!asset) {
      throw new Error(`Missing asset: ${id}`);
    }

    return asset;
  }

  find(id: AssetId): AssetReference | undefined {
    return this.assets.get(id);
  }

  values(): AssetReference[] {
    return [...this.assets.values()];
  }

  clear(): void {
    this.assets.clear();
  }
}
