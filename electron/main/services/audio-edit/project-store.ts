import fs from 'node:fs/promises'

import type { AudioEditProjectDocument } from '../../../../src/core/audioEdit/types'
import { audioEditProjectFromDocument } from '../../../../src/core/audioEdit/documentContent'
import { getDocumentService } from '../documents/runtime'

/*
 * 口播的主进程读取口（3.3 口播接入）：口播是作品目录或项目里的 `.hjaud` 文档文件，
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

/** 按文档 ID 读口播；找不到、不是口播或内容读不懂时抛错（消息给用户看）。返回可修改的副本。 */
export async function requireAudioEditProject(documentId: string): Promise<AudioEditProjectDocument> {
  return structuredClone(await readAudioEditProjectSnapshot(documentId))
}

/**
 * 只读读取：文件没变时每次返回同一个已冻结的对象，不复制。试听、擦洗取块这类高频只读路径用它，
 * 下游可以按对象身份缓存“作品 → 渲染源”（文件一改就换成新对象）。要修改请用 requireAudioEditProject。
 */
export async function readAudioEditProjectSnapshot(documentId: string): Promise<Readonly<AudioEditProjectDocument>> {
  const cached = cache.get(documentId)
  if (cached) {
    const stamp = await fileStamp(cached.path)
    if (stamp && stamp.mtimeMs === cached.mtimeMs && stamp.size === cached.size) {
      cache.delete(documentId); cache.set(documentId, cached)
      return cached.project
    }
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
  const project = deepFreeze(audioEditProjectFromDocument(read.meta, read.content).project)
  const stamp = await fileStamp(read.meta.path)
  if (stamp) {
    cache.set(documentId, { path: read.meta.path, ...stamp, project })
    while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value as string)
  }
  return project
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) deepFreeze(child)
  }
  return value
}

/** 仅供测试：清空读取缓存。 */
export function clearAudioEditProjectCacheForTests(): void {
  cache.clear()
}
