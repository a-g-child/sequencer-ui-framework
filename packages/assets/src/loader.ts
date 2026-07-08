import type { AssetReference } from './asset';

export interface AssetLoader<TAsset = unknown> {
  canLoad(asset: AssetReference): boolean;
  load(asset: AssetReference): Promise<TAsset>;
}
