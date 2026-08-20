export type LocalMediaKind = 'image' | 'video' | 'audio'

export type LocalMediaOwnership = 'managed' | 'referenced'

export interface ImportMediaFromPathRequest {
  importId: string
  sourcePath: string
  expectedKind: LocalMediaKind
  ownership: LocalMediaOwnership
  mimeType?: string
}

export interface ImportMediaFromBytesRequest {
  importId: string
  bytes: Uint8Array
  fileName: string
  expectedKind: LocalMediaKind
  mimeType?: string
}

interface LocalMediaImportBase {
  importId: string
  fullPath: string
  ownership: LocalMediaOwnership
  mimeType: string
  sizeBytes: number
  cacheHit: boolean
}

export interface ImportedImageMedia extends LocalMediaImportBase {
  kind: 'image'
  previewPath: string
  aspectRatio: string
}

export interface ImportedVideoMedia extends LocalMediaImportBase {
  kind: 'video'
  posterPath: string
  aspectRatio: string
  durationSeconds: number
  hasAudio: boolean
}

export interface ImportedAudioMedia extends LocalMediaImportBase {
  kind: 'audio'
  durationSeconds: number
}

export type LocalMediaImportResult =
  | ImportedImageMedia
  | ImportedVideoMedia
  | ImportedAudioMedia
