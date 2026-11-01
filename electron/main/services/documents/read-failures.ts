import type { PathStyle } from '../../../../src/core/storage/pathSyntax'
import { pathKey } from '../../../../src/core/storage/pathSyntax'
import { ProjectManifestError } from '../../../../src/core/documents/projectManifest'
import { PersistenceError } from '../../../../src/core/persistence/migrations'
import { kindForPath, statDocumentLocation, type DocumentFileDependencies, type DocumentFileStat } from './document-file'
import { DocumentFormatError, errorCode } from './errors'

/** 内容错误可以复用；备份、权限与磁盘故障必须重试。 */
export function isUnreadableFileContent(error: unknown): boolean {
  let cause = error
  const seen = new Set<unknown>()
  while (cause instanceof Error && !seen.has(cause)) {
    seen.add(cause)
    if (/^E[A-Z0-9]+$/.test(errorCode(cause) ?? '') || (cause instanceof PersistenceError && cause.code === 'backup-failed')) return false
    cause = cause.cause
  }
  return error instanceof DocumentFormatError || error instanceof ProjectManifestError
    || error instanceof SyntaxError || (error instanceof PersistenceError && error.code !== 'backup-failed')
}

/** 只记失败，不缓存内容；沿用成功索引的大小与修改时间判据，不写入持久索引。 */
export class DocumentReadFailures {
  private readonly failures = new Map<string, { stat: DocumentFileStat; error: unknown }>()

  constructor(private readonly style: PathStyle, private readonly dependencies: DocumentFileDependencies) {}

  async read<T>(filePath: string, operation: () => Promise<T>, onFailure: (error: unknown, repeated: boolean) => void,
    snapshot?: { documentId: string; stat?: DocumentFileStat }): Promise<T> {
    const key = JSON.stringify([pathKey(this.style, filePath) ?? filePath, snapshot?.documentId])
    let stat = snapshot?.stat
    if (!stat) {
      try { stat = await statDocumentLocation(kindForPath(this.dependencies.kinds, filePath), filePath, this.dependencies.adapters) }
      catch { /* 以正式读取的错误为准；无法取得指纹时不复用失败。 */ }
    }
    const previous = this.failures.get(key)
    if (stat && previous && stat.size === previous.stat.size && stat.mtimeMs === previous.stat.mtimeMs) {
      onFailure(previous.error, true)
      throw previous.error
    }
    this.failures.delete(key)
    try { return await operation() }
    catch (error) {
      if (stat && isUnreadableFileContent(error)) this.failures.set(key, { stat, error })
      onFailure(error, false)
      throw error
    }
  }
}
