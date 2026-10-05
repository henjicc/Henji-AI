import fs from 'node:fs/promises'

import type { AudioEditProjectDocument } from '../../../../src/core/audioEdit/types'
import { audioEditProjectFromDocument } from '../../../../src/core/audioEdit/documentContent'
import { getDocumentService } from '../documents/runtime'

/*
 * 口播的主进程读取口（3.3 口播接入）：口播是作品目录或项目里的 `.henji-audio` 文档文件，
 * 唯一的写入方是渲染层的文档会话（自动保存）。转写、停顿分析、试听、处理与导出在主进程按文档 ID 读文件，
 * 渲染层发起这些操作前先把修改写完（`withAudioEditProjectOperation` 里的 flush）。
 * 主进程不再写口播内容：转写、重新定位素材的结果返回给渲染层，由实例接收后经会话保存。
 *
 * 试听一次播放会连续请求很多段，按文件修改时间与大小缓存最近读到的内容，文件没变就不重复读取与换算。
 */

interface CachedProject {
  path: string
  mtimeMs: number
  size: number
  project: AudioEditProjectDocument
}

const cache = new Map<string, CachedProject>()
const CACHE_LIMIT = 8

async function fileStamp(path: string): Promise<{ mtimeMs: number; size: number } | null> {
  try {
    const stat = await fs.stat(path)
    return { mtimeMs: stat.mtimeMs, size: stat.size }
  } catch {
    return null
  }
}

/** 按文档 ID 读口播；找不到、不是口播或内容读不懂时抛错（消息给用户看）。 */
export async function requireAudioEditProject(documentId: string): Promise<AudioEditProjectDocument> {
  const cached = cache.get(documentId)
  if (cached) {
    const stamp = await fileStamp(cached.path)
    if (stamp && stamp.mtimeMs === cached.mtimeMs && stamp.size === cached.size) return structuredClone(cached.project)
    cache.delete(documentId)
  }
  let read
  try {
    read = await getDocumentService().readDocument({ id: documentId })
  } catch (error) {
    if (error instanceof Error && error.name === 'DocumentNotFoundError') throw new Error('NOT_FOUND：口播不存在或文件已被移走。')
    throw error
  }
  if (read.meta.kind !== 'audio_edit') throw new Error('NOT_FOUND：需要处理的文档不是口播。')
  const { project } = audioEditProjectFromDocument(read.meta, read.content)
  const stamp = await fileStamp(read.meta.path)
  if (stamp) {
    cache.set(documentId, { path: read.meta.path, ...stamp, project })
    while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value as string)
  }
  return structuredClone(project)
}

/** 仅供测试：清空读取缓存。 */
export function clearAudioEditProjectCacheForTests(): void {
  cache.clear()
}
