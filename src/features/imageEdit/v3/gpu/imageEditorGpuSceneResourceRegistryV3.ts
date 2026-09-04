import {
  ImageEditResourceBudget,
  type ImageEditMemoryLease,
} from '@/core/imageEdit/v3/resourceBudget'
import {
  IMAGE_EDITOR_GPU_SCENE_DEFAULT_BUDGET_BYTES_V3,
  imageEditorGpuSceneTileKeyV3,
  type ImageEditorGpuSceneResourceProtectionV3,
  type ImageEditorGpuSceneTileKeyV3,
} from './imageEditorGpuSceneProtocolV3'

interface ImageEditorGpuSceneResourceEntryV3<T> {
  key: ImageEditorGpuSceneTileKeyV3
  payload: T
  lease: ImageEditMemoryLease
  protections: Set<ImageEditorGpuSceneResourceProtectionV3>
  lastUsed: number
}

export interface ImageEditorGpuSceneResourceRegistryOptionsV3<T> {
  memoryBudgetBytes?: number
  disposePayload?: (payload: T) => void
}

export interface ImageEditorGpuSceneResourceRegistrationV3 {
  admitted: boolean
  reused: boolean
  evicted: readonly ImageEditorGpuSceneTileKeyV3[]
}

export interface ImageEditorGpuSceneResourceRegistrySnapshotV3 {
  entries: number
  bytes: number
  budgetBytes: number
  protectedEntries: number
}

/**
 * GPU Scene 的会话内资源索引。1.2 只建立身份、预算和 LRU 语义；2.1 会把 payload
 * 从上传数据替换为常驻纹理，账本与淘汰规则无需重写。
 */
export class ImageEditorGpuSceneResourceRegistryV3<T> {
  private readonly entries = new Map<string, ImageEditorGpuSceneResourceEntryV3<T>>()
  private readonly budget: ImageEditResourceBudget
  private readonly budgetBytes: number
  private readonly disposePayload: (payload: T) => void
  private clock = 0
  private disposed = false

  constructor(options: ImageEditorGpuSceneResourceRegistryOptionsV3<T> = {}) {
    this.budgetBytes = normalizeBudget(options.memoryBudgetBytes)
    this.budget = new ImageEditResourceBudget({
      totalBytes: this.budgetBytes,
      cpuCacheTargetBytes: 0,
      gpuTargetBytes: this.budgetBytes,
    })
    this.disposePayload = options.disposePayload ?? (() => undefined)
  }

  register(
    key: ImageEditorGpuSceneTileKeyV3,
    payload: T,
    bytes: number,
    protections: readonly ImageEditorGpuSceneResourceProtectionV3[] = [],
  ): ImageEditorGpuSceneResourceRegistrationV3 {
    this.assertUsable()
    const id = imageEditorGpuSceneTileKeyV3(key)
    const existing = this.entries.get(id)
    if (existing) {
      existing.lastUsed = ++this.clock
      for (const protection of protections) existing.protections.add(protection)
      this.disposePayload(payload)
      return { admitted: true, reused: true, evicted: [] }
    }
    const normalizedBytes = normalizeBytes(bytes)
    const evicted: ImageEditorGpuSceneTileKeyV3[] = []
    while (!this.budget.admission('gpu', normalizedBytes).admitted) {
      const victim = this.oldestEvictable()
      if (!victim) {
        this.disposePayload(payload)
        return { admitted: false, reused: false, evicted }
      }
      evicted.push(victim.key)
      this.remove(victim)
    }
    const lease = this.budget.acquire('gpu', normalizedBytes)
    if (!lease) {
      this.disposePayload(payload)
      return { admitted: false, reused: false, evicted }
    }
    this.entries.set(id, {
      key: { ...key },
      payload,
      lease,
      protections: new Set(protections),
      lastUsed: ++this.clock,
    })
    return { admitted: true, reused: false, evicted }
  }

  get(key: ImageEditorGpuSceneTileKeyV3): T | null {
    this.assertUsable()
    const entry = this.entries.get(imageEditorGpuSceneTileKeyV3(key))
    if (!entry) return null
    entry.lastUsed = ++this.clock
    return entry.payload
  }

  protect(
    key: ImageEditorGpuSceneTileKeyV3,
    protection: ImageEditorGpuSceneResourceProtectionV3,
  ): boolean {
    this.assertUsable()
    const entry = this.entries.get(imageEditorGpuSceneTileKeyV3(key))
    if (!entry) return false
    entry.protections.add(protection)
    entry.lastUsed = ++this.clock
    return true
  }

  releaseProtection(protection: ImageEditorGpuSceneResourceProtectionV3): void {
    this.assertUsable()
    for (const entry of this.entries.values()) entry.protections.delete(protection)
  }

  clear(): ImageEditorGpuSceneTileKeyV3[] {
    this.assertUsable()
    const keys = [...this.entries.values()].map((entry) => entry.key)
    for (const entry of [...this.entries.values()]) this.remove(entry)
    this.budget.advanceDeviceGeneration()
    return keys
  }

  snapshot(): ImageEditorGpuSceneResourceRegistrySnapshotV3 {
    const memory = this.budget.snapshot()
    return {
      entries: this.entries.size,
      bytes: memory.byCategory.gpu,
      budgetBytes: this.budgetBytes,
      protectedEntries: [...this.entries.values()].filter((entry) => entry.protections.size > 0).length,
    }
  }

  dispose(): void {
    if (this.disposed) return
    for (const entry of [...this.entries.values()]) this.remove(entry)
    this.disposed = true
  }

  private oldestEvictable(): ImageEditorGpuSceneResourceEntryV3<T> | null {
    let oldest: ImageEditorGpuSceneResourceEntryV3<T> | null = null
    for (const entry of this.entries.values()) {
      if (entry.protections.size > 0) continue
      if (!oldest || entry.lastUsed < oldest.lastUsed) oldest = entry
    }
    return oldest
  }

  private remove(entry: ImageEditorGpuSceneResourceEntryV3<T>): void {
    this.entries.delete(imageEditorGpuSceneTileKeyV3(entry.key))
    entry.lease.release()
    this.disposePayload(entry.payload)
  }

  private assertUsable(): void {
    if (this.disposed) throw new Error('GPU Scene 资源注册表已销毁')
  }
}

function normalizeBudget(value: number | undefined): number {
  const budget = value ?? IMAGE_EDITOR_GPU_SCENE_DEFAULT_BUDGET_BYTES_V3
  if (!Number.isSafeInteger(budget) || budget <= 0) throw new Error('GPU Scene 显存预算必须是正整数')
  return budget
}

function normalizeBytes(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('GPU Scene 资源字节数必须是非负整数')
  return value
}
