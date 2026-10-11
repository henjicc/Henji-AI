import { createImageEditRenderHash, type ImageEditHashValue } from '@/core/imageEdit/v3/renderHash'
import { collectImageEditJsonResourceIdsV3 } from '@/core/imageEdit/v3/resourceReferences'
import type { ImageEditorRenderSnapshotV3 } from './imageEditorRenderSessionContractsV3'
import type { ImageEditorManagedViewportCompositeV3 } from './viewportCompositeTypesV3'

interface Entry {
  result: ImageEditorManagedViewportCompositeV3
  bytes: number
  users: number
  retained: boolean
}

/** 候选的清晰 CPU 成品复用原额度租约；32 MiB 是额外缓存预算，不限制图层或候选数量。 */
export class ImageEditorRenderSessionFrameCacheV3 {
  private readonly entries = new Map<string, Entry>()
  private bytes = 0
  constructor(private readonly maxBytes = 32 * 1024 * 1024) {}

  key(snapshot: ImageEditorRenderSnapshotV3, viewportKey: string): string {
    const { document } = snapshot
    const pixels = {geometry:document.geometry,color:document.color,layers:document.layers}
    const resources = new Set(collectImageEditJsonResourceIdsV3(pixels))
    // 原稿与候选 JSON 不参与合成；保存新候选不能使同一像素成品失效。
    // 扫描完整像素状态，包含组、蒙版和效果参数中的资源，保留其额度描述校验。
    const descriptors = snapshot.resourceDescriptors.filter(resource => resources.has(resource.resourceRef))
    return JSON.stringify([document.id, viewportKey, snapshot.geometryHash, descriptors,
      createImageEditRenderHash(pixels as unknown as ImageEditHashValue)])
  }

  store(key: string, result: ImageEditorManagedViewportCompositeV3): ImageEditorManagedViewportCompositeV3 {
    const bytes = result.tiles.reduce((sum, tile) => sum + tile.bitmap.width * tile.bitmap.height * 4, 0)
    if (bytes > this.maxBytes) return result
    const previous = this.entries.get(key)
    if (previous) this.remove(key, previous)
    while (this.bytes + bytes > this.maxBytes && this.entries.size) {
      const [oldKey, old] = this.entries.entries().next().value as [string, Entry]
      this.remove(oldKey, old)
    }
    const entry: Entry = {result, bytes, users:0, retained:true}
    this.entries.set(key, entry); this.bytes += bytes
    return this.borrow(entry, result)
  }

  read(key: string, snapshot: ImageEditorRenderSnapshotV3, cameraSequence: number): ImageEditorManagedViewportCompositeV3 | null {
    const entry = this.entries.get(key)
    if (!entry) return null
    this.entries.delete(key); this.entries.set(key, entry)
    return this.borrow(entry, {...entry.result, revision:snapshot.document.revision, renderGeneration:snapshot.renderGeneration, cameraSequence})
  }

  clear(): void {
    for (const [key, entry] of this.entries) this.remove(key, entry)
  }

  private remove(key: string, entry: Entry): void {
    this.entries.delete(key); this.bytes -= entry.bytes; entry.retained = false
    if (!entry.users) entry.result.release()
  }

  private borrow(entry: Entry, result: ImageEditorManagedViewportCompositeV3): ImageEditorManagedViewportCompositeV3 {
    entry.users++
    let released = false
    return {...result, release:() => {
      if (released) return
      released = true; entry.users--
      if (!entry.retained && !entry.users) entry.result.release()
    }}
  }
}
