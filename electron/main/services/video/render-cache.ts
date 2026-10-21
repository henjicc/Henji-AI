import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { videoRenderCacheEntrySchema, type VideoRenderCacheEntry, type VideoRenderCacheStoredEntry } from '../../../../src/core/videoEdit/renderCacheStore'
import type { ContentDiskCache } from '../media/content-disk-cache'
import { removeUnmanagedCachePath } from '../media-recycle/cache-deletion'

/**
 * 预渲染文件（PR 渲染条的预览文件）的主进程存储：视频与说明各一份通用磁盘缓存，键由窗口指纹与编码档案得出。
 * 渲染层先 begin 拿到临时文件、按块写入编码结果，再 commit 原子改名；中途失败或取消 discard。
 * 说明记录所属剪辑与序列：删除剪辑、删除序列、启动时发现剪辑已不存在，都按它回收。
 */
export function videoRenderCacheKey(windowKey: string, profile: string): string {
  return createHash('sha256').update(JSON.stringify(['render-v1', windowKey, profile])).digest('hex')
}

interface Pending { key: string; projectId: string }

export class VideoRenderCacheService {
  private readonly pending = new Map<string, Pending>()
  constructor(private readonly files: ContentDiskCache, private readonly metadata: ContentDiskCache, private readonly directory: () => string | undefined) {}

  private async readAll(): Promise<Array<{ key: string; entry: VideoRenderCacheEntry; bytes: number }>> {
    const root = this.directory()
    if (!root) return []
    let names: string[]
    try { names = await fs.readdir(root) } catch { return [] }
    const result: Array<{ key: string; entry: VideoRenderCacheEntry; bytes: number }> = []
    for (const name of names) {
      const match = /^([0-9a-f]{64})\.json$/.exec(name)
      if (!match) continue
      try {
        const raw = JSON.parse(await fs.readFile(path.join(root, name), 'utf8')) as Record<string, unknown>
        const bytes = typeof raw.bytes === 'number' ? raw.bytes : 0
        delete raw.bytes
        result.push({ key: match[1], entry: videoRenderCacheEntrySchema.parse(raw), bytes })
      } catch { await this.metadata.remove(match[1]).catch(() => undefined) }
    }
    return result
  }

  /** 该剪辑已完成的预渲染文件；视频文件已被清理的说明一并删掉。读取会刷新最后使用时间。 */
  async list(projectId: string): Promise<VideoRenderCacheStoredEntry[]> {
    const entries: VideoRenderCacheStoredEntry[] = []
    for (const { key, entry, bytes } of await this.readAll()) {
      if (entry.projectId !== projectId) continue
      const file = await this.files.locate(key)
      if (!file) { await this.metadata.remove(key); continue }
      entries.push({ ...entry, path: file, bytes })
    }
    return entries
  }

  async begin(projectId: string, windowKey: string, profile: string): Promise<string> {
    const key = videoRenderCacheKey(windowKey, profile)
    const temporary = await this.files.prepareTemporary(key)
    if (!temporary) throw new Error('作品目录不可用，暂时无法预渲染。')
    await fs.writeFile(temporary, new Uint8Array(), { flag: 'wx' })
    this.pending.set(temporary, { key, projectId })
    return temporary
  }

  async commit(temporaryPath: string, entry: VideoRenderCacheEntry): Promise<VideoRenderCacheStoredEntry> {
    const pending = this.pending.get(temporaryPath)
    const key = videoRenderCacheKey(entry.windowKey, entry.profile)
    if (!pending || pending.key !== key || pending.projectId !== entry.projectId) throw new Error('预渲染临时文件无效。')
    this.pending.delete(temporaryPath)
    const bytes = (await fs.stat(temporaryPath)).size
    if (!bytes) { await this.discard(temporaryPath); throw new Error('预渲染文件为空。') }
    const file = await this.files.adopt(key, temporaryPath)
    await this.metadata.write(key, Buffer.from(JSON.stringify({ ...entry, bytes })))
    return { ...entry, path: file, bytes }
  }

  async discard(temporaryPath: string): Promise<void> {
    if (!this.pending.delete(temporaryPath)) return
    await removeUnmanagedCachePath(temporaryPath, { force: true }).catch(() => undefined)
  }

  /** 删除剪辑的预渲染文件：指定窗口、只保留仍存在的序列，或（都不指定）全部。返回删除数量。 */
  async remove(request: { projectId: string; windowKeys?: readonly string[]; keepSequenceIds?: readonly string[] }): Promise<number> {
    const windows = request.windowKeys ? new Set(request.windowKeys) : undefined
    const keep = request.keepSequenceIds ? new Set(request.keepSequenceIds) : undefined
    let removed = 0
    for (const { key, entry } of await this.readAll()) {
      if (entry.projectId !== request.projectId) continue
      if (windows && !windows.has(entry.windowKey)) continue
      if (!windows && keep && keep.has(entry.sequenceId)) continue
      if (await this.removeKey(key)) removed++
    }
    return removed
  }

  /** 启动时：所属剪辑已不存在的文件。 */
  async removeOrphans(liveProjectIds: ReadonlySet<string>): Promise<number> {
    let removed = 0
    for (const { key, entry } of await this.readAll()) if (!liveProjectIds.has(entry.projectId) && await this.removeKey(key)) removed++
    return removed
  }

  private async removeKey(key: string): Promise<boolean> {
    try { await this.files.remove(key) } catch { return false /* 正在播放，下次再删 */ }
    await this.metadata.remove(key).catch(() => undefined)
    return true
  }
}
