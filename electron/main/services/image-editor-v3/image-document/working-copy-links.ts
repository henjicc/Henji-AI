import fsp from 'node:fs/promises'
import path from 'node:path'

import { writeBufferAtomically } from '../../fs/atomic-file'
import { isImageDocumentId } from './header'

/*
 * 图片文档与它在程序目录里的工作副本之间的记录（3.5）：`<图片编辑存储>/document-links/<文档ID>.json`。
 *
 * 工作副本就是 V3 文档仓库里同一个 ID 的文档（资源按哈希去重存放）。这份记录说明工作副本
 * 最后一次与 `.henjiimg` 一致是什么时候：
 * - packageRevision / fileSize / fileModifiedAt：那时文件的样子（文件被换掉后需要重新解包）；
 * - committedWorkingRevision：那时工作副本的版本。工作副本版本比它新，说明有没写回的修改
 *   （意外退出），再次打开时提示恢复。
 * 只存程序目录内部状态，不含任何路径；删掉它只会让下次打开重新解包。
 */

export interface ImageDocumentWorkingCopyLink {
  documentId: string
  packageRevision: number
  fileSize: number
  fileModifiedAt: number
  committedWorkingRevision: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function integer(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

export class ImageDocumentWorkingCopyLinks {
  constructor(private readonly directory: string) {}

  private file(documentId: string): string {
    if (!isImageDocumentId(documentId)) throw new Error(`图片文档 ID 无效：${documentId}`)
    return path.join(this.directory, `${documentId}.json`)
  }

  async read(documentId: string): Promise<ImageDocumentWorkingCopyLink | null> {
    let raw: string
    try {
      raw = await fsp.readFile(this.file(documentId), 'utf8')
    } catch {
      return null
    }
    try {
      const value = JSON.parse(raw) as unknown
      if (!isRecord(value) || value.documentId !== documentId) return null
      const packageRevision = integer(value.packageRevision)
      const fileSize = integer(value.fileSize)
      const fileModifiedAt = integer(value.fileModifiedAt)
      const committedWorkingRevision = integer(value.committedWorkingRevision)
      if (packageRevision === null || fileSize === null || fileModifiedAt === null || committedWorkingRevision === null) return null
      return { documentId, packageRevision, fileSize, fileModifiedAt, committedWorkingRevision }
    } catch {
      return null
    }
  }

  async write(link: ImageDocumentWorkingCopyLink): Promise<void> {
    await writeBufferAtomically(this.file(link.documentId), Buffer.from(`${JSON.stringify(link)}\n`, 'utf8'))
  }

  async remove(documentId: string): Promise<void> {
    await fsp.rm(this.file(documentId), { force: true })
  }

  /** 全部记录的文档 ID 与记录最后一次写入的时间（毫秒）；回收工作副本时按它排先后。 */
  async list(): Promise<Array<{ documentId: string; touchedAt: number }>> {
    const entries = await fsp.readdir(this.directory).catch(() => [] as string[])
    const result: Array<{ documentId: string; touchedAt: number }> = []
    for (const entry of entries) {
      if (!entry.endsWith('.json')) continue
      const documentId = entry.slice(0, -5)
      if (!isImageDocumentId(documentId)) continue
      const stat = await fsp.stat(path.join(this.directory, entry)).catch(() => null)
      if (stat?.isFile()) result.push({ documentId, touchedAt: stat.mtimeMs })
    }
    return result
  }
}
