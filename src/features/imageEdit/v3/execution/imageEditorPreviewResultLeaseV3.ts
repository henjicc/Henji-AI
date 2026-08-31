import type {
  ImageEditMemoryLease,
  ImageEditResourceBudget,
} from '@/core/imageEdit/v3/resourceBudget'
import { acquireImageEditorResourceLeaseV3 } from './imageEditorResourcePressureV3'
import type { ImageEditorPreviewBlobEventV3 } from './previewProtocolV3'

export interface ImageEditorManagedPreviewThumbnailV3 {
  width: number
  height: number
  mediaType: 'image/png' | 'image/webp'
  bytes: ArrayBuffer
}

export type ImageEditorManagedPreviewResultV3 =
  | {
      kind: 'bitmap'
      bitmap: ImageBitmap
      width: number
      height: number
      diagnostics: string[]
      thumbnail?: ImageEditorManagedPreviewThumbnailV3
      release: () => void
    }
  | {
      kind: 'url'
      url: string
      width: number
      height: number
      diagnostics: string[]
      thumbnail?: ImageEditorManagedPreviewThumbnailV3
      release: () => void
    }

export interface ImageEditorPreviewUrlFactoryV3 {
  create(bytes: ArrayBuffer, mediaType: string): string
  revoke(url: string): void
}

const defaultUrlFactory: ImageEditorPreviewUrlFactoryV3 = {
  create: (bytes, mediaType) => URL.createObjectURL(new Blob([bytes], { type: mediaType })),
  revoke: (url) => URL.revokeObjectURL(url),
}

export class ImageEditorPreviewResultOwnerV3 {
  private readonly releases = new Set<() => void>()

  constructor(
    private readonly budget: ImageEditResourceBudget,
    private readonly urlFactory: ImageEditorPreviewUrlFactoryV3 = defaultUrlFactory,
  ) {}

  leaseBitmap(
    bitmap: ImageBitmap,
    width: number,
    height: number,
    diagnostics: string[],
    thumbnail: ImageEditorManagedPreviewThumbnailV3 | undefined,
    outputLease: ImageEditMemoryLease,
  ): ImageEditorManagedPreviewResultV3 {
    let thumbnailLease: ImageEditMemoryLease | null = null
    try {
      thumbnailLease = thumbnail
        ? acquireImageEditorResourceLeaseV3(
            this.budget,
            'managed-preview',
            'cpu-cache',
            thumbnail.bytes.byteLength,
            'lower-mip',
          )
        : null
      const release = this.createLease(() => {
        bitmap.close()
        thumbnailLease?.release()
        outputLease.release()
      })
      return { kind: 'bitmap', bitmap, width, height, diagnostics, thumbnail, release }
    } catch (error) {
      thumbnailLease?.release()
      bitmap.close()
      outputLease.release()
      throw error
    }
  }

  leaseBlob(
    event: ImageEditorPreviewBlobEventV3,
    outputLease: ImageEditMemoryLease,
  ): ImageEditorManagedPreviewResultV3 {
    let blobLease: ImageEditMemoryLease | null = null
    let thumbnailLease: ImageEditMemoryLease | null = null
    let url: string
    try {
      blobLease = acquireImageEditorResourceLeaseV3(
        this.budget,
        'managed-preview',
        'cpu-cache',
        event.bytes.byteLength,
        'lower-mip',
      )
      thumbnailLease = event.thumbnail
        ? acquireImageEditorResourceLeaseV3(
            this.budget,
            'managed-preview',
            'cpu-cache',
            event.thumbnail.bytes.byteLength,
            'lower-mip',
          )
        : null
      url = this.urlFactory.create(event.bytes, event.mediaType)
    } catch (error) {
      blobLease?.release()
      thumbnailLease?.release()
      outputLease.release()
      throw error
    }
    const release = this.createLease(() => {
      this.urlFactory.revoke(url)
      blobLease.release()
      thumbnailLease?.release()
      outputLease.release()
    })
    return {
      kind: 'url',
      url,
      width: event.width,
      height: event.height,
      diagnostics: event.diagnostics,
      thumbnail: event.thumbnail,
      release,
    }
  }

  dispose(): void {
    for (const release of [...this.releases]) release()
  }

  private createLease(dispose: () => void): () => void {
    let released = false
    const release = (): void => {
      if (released) return
      released = true
      this.releases.delete(release)
      dispose()
    }
    this.releases.add(release)
    return release
  }
}
