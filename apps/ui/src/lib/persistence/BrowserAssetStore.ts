import type { AssetId, AssetReference } from '@sequencer/assets'

type StoredAssetRecord = {
  id: AssetId
  blob: Blob
  name: string
  mimeType?: string
  updatedAt: number
}

const DATABASE_NAME = 'sequencer.assets.v1'
const STORE_NAME = 'assets'
const DATABASE_VERSION = 1

export class BrowserAssetStore {
  constructor(private readonly uriPrefix = 'indexeddb://sequencer.assets/') {}

  uriFor(assetId: AssetId): string {
    return `${this.uriPrefix}${assetId}`
  }

  isStoredAsset(asset: AssetReference): boolean {
    return Boolean(asset.uri?.startsWith(this.uriPrefix))
  }

  async saveFile(assetId: AssetId, file: File): Promise<void> {
    const database = await openDatabase()

    await runRequest(
      database
        .transaction(STORE_NAME, 'readwrite')
        .objectStore(STORE_NAME)
        .put({
          id: assetId,
          blob: file,
          name: file.name,
          mimeType: file.type || undefined,
          updatedAt: Date.now()
        } satisfies StoredAssetRecord)
    )
    database.close()
  }

  async loadBlob(assetId: AssetId): Promise<Blob | undefined> {
    const database = await openDatabase()
    const record = await runRequest<StoredAssetRecord | undefined>(
      database
        .transaction(STORE_NAME, 'readonly')
        .objectStore(STORE_NAME)
        .get(assetId)
    )

    database.close()
    return record?.blob
  }

  async createRuntimeAsset(
    asset: AssetReference
  ): Promise<{ asset: AssetReference; revoke: () => void } | undefined> {
    const blob = await this.loadBlob(asset.id)

    if (!blob) return undefined

    const uri = URL.createObjectURL(blob)

    return {
      asset: {
        ...asset,
        uri,
        mimeType: asset.mimeType ?? (blob.type || undefined),
        sizeBytes: asset.sizeBytes ?? blob.size
      },
      revoke: () => URL.revokeObjectURL(uri)
    }
  }
}

async function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)

    request.onupgradeneeded = () => {
      const database = request.result

      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'id' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function runRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}
