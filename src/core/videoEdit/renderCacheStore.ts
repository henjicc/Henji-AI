import { z } from 'zod'

/**
 * 预渲染文件的宿主存储契约：渲染层编码，主进程把文件放进作品目录缓存（按窗口指纹与编码档案寻址）
 * 并记录它属于哪个剪辑、哪条序列，供删除剪辑或序列时回收。
 */
const projectId = z.string().regex(/^[\w-]+$/).max(100)
const windowKey = z.string().min(1).max(200)
/** 编码档案：编码格式、画质与码率；档案不同的旧文件不再播放，自动预渲染会按新档案重做。 */
const profile = z.string().min(1).max(200)

export const videoRenderCacheEntrySchema = z.object({
  projectId, sequenceId: z.string().min(1).max(200), windowKey, profile,
  startFrame: z.number().int().min(0), endFrame: z.number().int().min(1),
  width: z.number().int().positive(), height: z.number().int().positive(), fps: z.number().positive(),
}).strict()
export type VideoRenderCacheEntry = z.infer<typeof videoRenderCacheEntrySchema>
export type VideoRenderCacheStoredEntry = VideoRenderCacheEntry & { path: string; bytes: number }

export const videoRenderCacheBeginSchema = z.object({ projectId, windowKey, profile }).strict()
export const videoRenderCacheCommitSchema = z.object({ temporaryPath: z.string().min(1).max(32768), entry: videoRenderCacheEntrySchema }).strict()
export const videoRenderCacheRemoveSchema = z.object({
  projectId,
  /** 只删这些窗口；省略时按序列筛选。 */
  windowKeys: z.array(windowKey).max(10000).optional(),
  /** 只保留这些序列的文件（其余序列已删除）；省略时不按序列筛选。 */
  keepSequenceIds: z.array(z.string().min(1).max(200)).max(10000).optional(),
}).strict()
