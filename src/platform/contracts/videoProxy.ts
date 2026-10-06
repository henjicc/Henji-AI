import type { VideoProxyRequest, VideoProxyResult } from '../../core/videoEdit/proxy'
export const VIDEO_PROXY_CHANNELS = { create: 'video:proxy-create', lookup: 'video:proxy-lookup', cancel: 'video:proxy-cancel', progress: 'video:proxy-progress' } as const
export interface VideoProxyPlatform {
  create(request: VideoProxyRequest): Promise<VideoProxyResult>
  lookup(request: Omit<VideoProxyRequest, 'requestId'>): Promise<VideoProxyResult | null>
  cancel(requestId: string): Promise<void>
  onProgress(listener: (event: { requestId: string; progress: number }) => void): () => void
}
