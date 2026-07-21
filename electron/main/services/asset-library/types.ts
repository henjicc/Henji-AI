export type AssetMediaType = 'image' | 'video' | 'audio'
export type AssetSource = 'generated' | 'canvas' | 'camera-stage' | 'imported' | 'external'
export type AssetInspectionStatus = 'pending' | 'ready' | 'missing' | 'failed'

export interface AssetDto {
  id: string
  wasExisting?: boolean
  mediaType: AssetMediaType
  displayName: string
  filePath: string
  displayUrl: string
  source: AssetSource
  mimeType: string | null
  sizeBytes: number | null
  width: number | null
  height: number | null
  durationSeconds: number | null
  thumbnailPath: string | null
  thumbnailUrl: string | null
  inspectionStatus: AssetInspectionStatus
  inspectionError: string | null
  fileModifiedAt: number | null
  lastUsedAt: number | null
  createdAt: number
  updatedAt: number
  tags: string[]
  libraryIds: string[]
}

export interface AssetLibraryDto { id: string; name: string; createdAt: number; updatedAt: number }
export interface AssetPageDto { items: AssetDto[]; total: number; page: number; pageSize: number }
export interface CreateAssetRequest { filePath: string; mediaType: AssetMediaType; displayName?: string; source: AssetSource; libraryIds?: string[] }
export interface UpdateAssetRequest { id: string; displayName: string }
export interface AssetQuery { mediaType?: AssetMediaType; libraryId?: string; tag?: string; keyword?: string; page: number; pageSize: number; sort?: 'created' | 'recent' }
