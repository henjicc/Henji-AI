import fsp from 'node:fs/promises'
import path from 'node:path'

import { DOCUMENT_ID_PATTERN } from '../../../../src/core/documents/envelope'
import type { DocumentCoverResult, DocumentCoverSource, SaveDocumentCoverRequest } from '../../../../src/core/documents/types'
import { writeBufferAtomically } from '../fs/atomic-file'
import { KeyedSerialExecutor } from '../image-editor-v3/serial-executor'
import type { MainLogger } from '../logging/main-logger'

/*
 * 通用文档封面：按文档 ID 存在程序目录 `<程序目录>/DocumentStore/covers/<文档ID>/<时间戳>.webp`，
 * 不写进文档文件（文档里不出现程序目录的路径），文档改名、移动、拷贝都不影响。
 *
 * 文件名带时间戳且写完后删掉上一张：`<img>` 与媒体协议都按地址缓存，同名覆盖会让卡片继续显示旧封面。
 * 渲染与工程封面共用 covers/cover-render.ts。
 */

export interface DocumentCoverStoreOptions {
  directory: string
  render(sources: readonly DocumentCoverSource[]): Promise<{ bytes: Buffer; selected: DocumentCoverSource[] }>
  logger: MainLogger
  now?: () => number
}

const COVER_EXTENSION = '.webp'

export class DocumentCoverStore {
  private readonly executor = new KeyedSerialExecutor()
  private cache: Map<string, string> | null = null

  constructor(private readonly options: DocumentCoverStoreOptions) {}

  private folder(docId: string): string {
    if (!DOCUMENT_ID_PATTERN.test(docId)) throw new Error('文档 ID 无效。')
    return path.join(this.options.directory, docId)
  }

  private async newestCover(folder: string): Promise<string | null> {
    const names = await fsp.readdir(folder).catch(() => [] as string[])
    const covers = names.filter((name) => name.endsWith(COVER_EXTENSION)).sort()
    const newest = covers[covers.length - 1]
    return newest ? path.join(folder, newest) : null
  }

  /** 首次使用时读一遍封面目录，之后由保存与删除维护。 */
  private async loadCache(): Promise<Map<string, string>> {
    if (this.cache) return this.cache
    const cache = new Map<string, string>()
    const entries = await fsp.readdir(this.options.directory, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (!entry.isDirectory() || !DOCUMENT_ID_PATTERN.test(entry.name)) continue
      const cover = await this.newestCover(path.join(this.options.directory, entry.name))
      if (cover) cache.set(entry.name, cover)
    }
    this.cache = cache
    return cache
  }

  async get(docId: string): Promise<string | null> {
    return (await this.loadCache()).get(docId) ?? null
  }

  async getMany(docIds: readonly string[]): Promise<Map<string, string>> {
    const cache = await this.loadCache()
    return new Map(docIds.flatMap((id) => {
      const cover = cache.get(id)
      return cover ? [[id, cover] as const] : []
    }))
  }

  async save(request: SaveDocumentCoverRequest): Promise<DocumentCoverResult> {
    const folder = this.folder(request.docId)
    return await this.executor.run(request.docId, async () => {
      const logger = this.options.logger
      logger.info('开始更新文档封面', { event: 'documents.cover.save.start', context: { documentId: request.docId, sourceCount: request.sources.length } })
      try {
        const { bytes, selected } = await this.options.render(request.sources)
        const target = path.join(folder, `${this.options.now?.() ?? Date.now()}${COVER_EXTENSION}`)
        await writeBufferAtomically(target, bytes)
        const names = await fsp.readdir(folder).catch(() => [] as string[])
        await Promise.all(names
          .filter((name) => path.join(folder, name) !== target)
          .map((name) => fsp.rm(path.join(folder, name), { force: true }).catch(() => undefined)))
        ;(await this.loadCache()).set(request.docId, target)
        logger.info('文档封面已更新', {
          event: 'documents.cover.save.completed',
          context: { documentId: request.docId, sourceKinds: selected.map((source) => source.sourceKind) },
        })
        return { docId: request.docId, coverPath: target }
      } catch (error) {
        logger.error('文档封面更新失败', { event: 'documents.cover.save.failed', context: { documentId: request.docId }, error })
        throw error
      }
    })
  }

  async remove(docId: string): Promise<void> {
    if (!DOCUMENT_ID_PATTERN.test(docId)) return
    await this.executor.run(docId, async () => {
      await fsp.rm(this.folder(docId), { recursive: true, force: true }).catch(() => undefined)
      this.cache?.delete(docId)
    })
  }
}
