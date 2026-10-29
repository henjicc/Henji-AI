import { removeUnmanagedCachePath } from '../media-recycle/cache-deletion'
import path from 'node:path'

import { DOCUMENT_ID_PATTERN } from '../../../../src/core/documents/envelope'
import type { DocumentSessionStateKey, WriteDocumentSessionStateRequest } from '../../../../src/core/documents/types'
import { readJsonFile, writeJsonFile } from '../fs/json-file'
import { KeyedSerialExecutor } from '../image-editor-v3/serial-executor'
import type { MainLogger } from '../logging/main-logger'

/*
 * 文档会话状态（3.4，实施方案 2.4“撤销记录、视口这类会话状态不写进文档，按文档 ID 存在程序目录”）。
 *
 * 位置：`<程序目录>/DocumentStore/session-state/<文档ID>/<键>.json`。内容由工具自己约定（如画布的撤销记录与视口），
 * 这里只按键存取 JSON，不解释。它是可以随时丢的缓存：读不懂、找不到都按“没有”处理；
 * 文档移到回收站、删除空草稿或从列表移除时整个文件夹一起删掉。
 * 同一文档的读写串行；写入整份原子替换。
 */

export interface DocumentSessionStateStoreOptions {
  directory: string
  logger: MainLogger
}

const KEY_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && 'code' in error ? String((error as NodeJS.ErrnoException).code) : undefined
}

export class DocumentSessionStateStore {
  private readonly executor = new KeyedSerialExecutor()

  constructor(private readonly options: DocumentSessionStateStoreOptions) {}

  private folder(docId: string): string {
    if (!DOCUMENT_ID_PATTERN.test(docId)) throw new Error('文档 ID 无效。')
    return path.join(this.options.directory, docId)
  }

  private file(request: DocumentSessionStateKey): string {
    if (!KEY_PATTERN.test(request.key)) throw new Error('会话状态键无效。')
    return path.join(this.folder(request.docId), `${request.key}.json`)
  }

  /** 没有或读不懂时返回 null。 */
  async read(request: DocumentSessionStateKey): Promise<unknown> {
    const target = this.file(request)
    return await this.executor.run(request.docId, async () => {
      try {
        return await readJsonFile(target)
      } catch (error) {
        if (errorCode(error) !== 'ENOENT') {
          this.options.logger.warn('文档会话状态无法读取，按没有处理', {
            event: 'documents.session_state.read.failed', context: { documentId: request.docId, key: request.key }, error,
          })
        }
        return null
      }
    })
  }

  /** value 为 null 时删除该键。 */
  async write(request: WriteDocumentSessionStateRequest): Promise<void> {
    const target = this.file(request)
    await this.executor.run(request.docId, async () => {
      if (request.value === null || request.value === undefined) {
        await removeUnmanagedCachePath(target, { force: true })
        return
      }
      await writeJsonFile(target, request.value)
    })
  }

  async remove(docId: string): Promise<void> {
    if (!DOCUMENT_ID_PATTERN.test(docId)) return
    await this.executor.run(docId, async () => {
      await removeUnmanagedCachePath(this.folder(docId), { recursive: true, force: true }).catch(() => undefined)
    })
  }
}
