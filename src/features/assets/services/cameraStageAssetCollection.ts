import { listAssetLibraries } from '@/commands/assetLibrary'
import { createLogger } from '@/core/logging'
import type { AssetLibraryRecord, AssetMediaType, AssetRecord } from '@/platform/contracts/assetLibrary'
import { addMediaReferenceToLibrary } from './assetCollectionService'

const logger = createLogger('features.assets.cameraStage')
const STORAGE_KEY = 'henji-camera-stage-asset-target'

export interface CameraStageAssetTarget {
  enabled: boolean
  libraryId: string | null
}

export interface CameraStageAssetCollectionInput {
  filePath: string
  mediaType: AssetMediaType
  displayName: string
  target: CameraStageAssetTarget
  requestId?: string
}

export function readCameraStageAssetTarget(): CameraStageAssetTarget {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return { enabled: false, libraryId: null }
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return { enabled: false, libraryId: null }
    const record = parsed as Record<string, unknown>
    return {
      enabled: record.enabled === true,
      libraryId: typeof record.libraryId === 'string' ? record.libraryId : null,
    }
  } catch {
    return { enabled: false, libraryId: null }
  }
}

export function writeCameraStageAssetTarget(target: CameraStageAssetTarget): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(target))
}

export async function resolveCameraStageAssetTarget(target: CameraStageAssetTarget): Promise<{
  target: CameraStageAssetTarget
  libraries: AssetLibraryRecord[]
}> {
  const libraries = await listAssetLibraries()
  if (!target.libraryId || libraries.some((library) => library.id === target.libraryId)) {
    return { target, libraries }
  }
  const fallback = { enabled: target.enabled, libraryId: null }
  writeCameraStageAssetTarget(fallback)
  return { target: fallback, libraries }
}

export async function collectCameraStageAsset(
  input: CameraStageAssetCollectionInput,
): Promise<AssetRecord | null> {
  if (!input.target.enabled) return null
  try {
    const asset = await addMediaReferenceToLibrary({
      filePath: input.filePath,
      mediaType: input.mediaType,
      source: 'camera-stage',
      displayName: input.displayName,
      libraryIds: input.target.libraryId ? [input.target.libraryId] : undefined,
    })
    logger.info('3D 导出已收录到资产库', {
      event: 'camera_stage.asset_collection.completed',
      requestId: input.requestId,
      assetId: asset.id,
      context: { mediaType: input.mediaType, libraryId: input.target.libraryId },
    })
    return asset
  } catch (error) {
    logger.error('3D 导出收录资产失败', error, {
      event: 'camera_stage.asset_collection.failed',
      requestId: input.requestId,
      context: { mediaType: input.mediaType, libraryId: input.target.libraryId },
    })
    return null
  }
}
