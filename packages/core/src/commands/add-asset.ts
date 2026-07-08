import type { AssetReference } from "@sequencer/assets";
import type { Command } from "../command";
import type { SequencerDocument } from "../document";

export class AddAssetCommand implements Command {
  readonly name = "Add Asset";

  private replacedAsset?: AssetReference;

  constructor(readonly asset: AssetReference) {}

  execute(document: SequencerDocument): void {
    this.replacedAsset = document.assets.find(this.asset.id);
    document.assets.add(this.asset);
  }

  undo(document: SequencerDocument): void {
    if (this.replacedAsset) {
      document.assets.add(this.replacedAsset);
      return;
    }

    document.assets.remove(this.asset.id);
  }
}

export { AddAssetCommand as AddAssetOperation };
