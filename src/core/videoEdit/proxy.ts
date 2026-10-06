import { z } from 'zod'

export const videoProxyPresetSchema = z.enum(['720p', '540p'])
export type VideoProxyPreset = z.infer<typeof videoProxyPresetSchema>
export const videoProxyRequestSchema = z.object({ requestId: z.string().min(1).max(100), source: z.string().min(1).max(32768), preset: videoProxyPresetSchema }).strict()
export type VideoProxyRequest = z.infer<typeof videoProxyRequestSchema>
export const videoProxyResultSchema = z.object({ path: z.string().min(1), key: z.string().regex(/^[a-f0-9]{64}$/), contentIdentity: z.string().regex(/^[a-f0-9]{64}$/), preset: videoProxyPresetSchema, width: z.number().int().positive(), height: z.number().int().positive(), bytes: z.number().int().positive() }).strict()
export type VideoProxyResult = z.infer<typeof videoProxyResultSchema>
export interface VideoEditProxyState { status: 'none' | 'generating' | 'ready'; progress: number; error: string }
export interface VideoEditProxyPreference { enabled: boolean; autoCreate: boolean }

/** Proxy pictures retain container presentation times; clip time mapping is deliberately unchanged. */
export function videoEditDecodeSource<T extends { path: string; kind: string }>(media: T, proxy: VideoProxyResult | undefined, enabled: boolean, purpose: 'playback' | 'export' | 'analysis'): T {
  return purpose === 'playback' && enabled && media.kind === 'video' && proxy ? { ...media, path: proxy.path } : media
}
