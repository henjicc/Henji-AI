import { z } from 'zod'

/** auto：源的一半（短边最高 1080），按代理自身分辨率帧率计算码率；720p：高度 720，横屏 4K 原片时更小更快（多机位提示里可选）；540p 只为读取旧代理保留。 */
export const videoProxyPresetSchema = z.enum(['auto', '720p', '540p'])
export type VideoProxyPreset = z.infer<typeof videoProxyPresetSchema>
export const videoProxyRequestSchema = z.object({ requestId: z.string().min(1).max(100), source: z.string().min(1).max(32768), preset: videoProxyPresetSchema }).strict()
export type VideoProxyRequest = z.infer<typeof videoProxyRequestSchema>
export const videoProxyResultSchema = z.object({ path: z.string().min(1), key: z.string().regex(/^[a-f0-9]{64}$/), contentIdentity: z.string().regex(/^[a-f0-9]{64}$/), preset: videoProxyPresetSchema, width: z.number().int().positive(), height: z.number().int().positive(), bytes: z.number().int().positive() }).strict()
export type VideoProxyResult = z.infer<typeof videoProxyResultSchema>
/** 代理尺寸（主进程生成与界面选项共用）：auto 为源的一半、短边最高 1080；720p/540p 按高度上限。宽高取偶数。 */
export function videoProxySize(sourceWidth: number, sourceHeight: number, preset: VideoProxyPreset): { width: number; height: number } {
  const even = (value: number): number => Math.max(2, Math.floor(value / 2) * 2)
  const scale = preset === 'auto'
    ? Math.min(0.5, 1080 / Math.min(sourceWidth, sourceHeight))
    : Math.min(1, (preset === '720p' ? 720 : 540) / sourceHeight)
  return { width: even(sourceWidth * scale), height: even(sourceHeight * scale) }
}
/** queued：已提交、还在等前面的代理生成完（只在 generating 时出现）。 */
export interface VideoEditProxyState { status: 'none' | 'generating' | 'ready'; progress: number; error: string; queued?: boolean }
export interface VideoEditProxyPreference { enabled: boolean; autoCreate: boolean }

/** Proxy pictures retain container presentation times; clip time mapping is deliberately unchanged. */
export function videoEditDecodeSource<T extends { path: string; kind: string }>(media: T, proxy: VideoProxyResult | undefined, enabled: boolean, purpose: 'playback' | 'export' | 'analysis'): T {
  return purpose === 'playback' && enabled && media.kind === 'video' && proxy ? { ...media, path: proxy.path } : media
}
