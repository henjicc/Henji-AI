/** Disposable derived media; never serialized into the editable project. */
export interface VideoPreviewProxyRequest { requestId: string; source: string; startSeconds: number; durationSeconds: number }
export interface VideoPreviewProxyResult { path: string; startSeconds: number; durationSeconds: number; preparationMs: number; sizeBytes: number; cacheHit: boolean }
export interface VideoEditPreviewSource { clipId: string; mediaId: string; path: string; startSeconds: number; endSeconds: number }
