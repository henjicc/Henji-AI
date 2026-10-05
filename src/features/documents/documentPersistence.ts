import type { DocumentKindDescriptor } from '@/core/documents/kinds'

import { DocumentSessionUnsupportedError } from './documentErrors'
import type { DocumentPersistence, DocumentSessionCommands } from './documentSessionTypes'

/*
 * 保存策略（实施方案 2.4）：
 * - JSON 类型（剪辑、画布、口播、镜头参考）：每次保存直接写文档文件，主进程负责版本核对、
 *   内容没变不写、原子替换。
 * - 单文件包类型（图片文档）：save 写程序目录的工作副本、commit 在空闲与关闭时写回 `.henjiimg`，
 *   由 3.5 实现 DocumentPersistence 并在打开时传入。
 */

export function createJsonDocumentPersistence(commands: Pick<DocumentSessionCommands, 'saveDocument'>): DocumentPersistence {
  return {
    mode: 'json',
    save: (request) => commands.saveDocument(request),
  }
}

/** 按类型的存储方式选默认策略；单文件包类型没有默认实现，必须由调用方提供。 */
export function resolveDocumentPersistence(
  kind: DocumentKindDescriptor,
  commands: Pick<DocumentSessionCommands, 'saveDocument'>,
  provided?: DocumentPersistence,
): DocumentPersistence {
  if (provided) {
    if (provided.mode !== kind.storage) throw new DocumentSessionUnsupportedError(`文档类型 ${kind.id} 的保存方式与传入的策略不一致。`)
    return provided
  }
  if (kind.storage === 'json') return createJsonDocumentPersistence(commands)
  throw new DocumentSessionUnsupportedError(`文档类型 ${kind.id} 是单文件包，打开时需要提供工作副本保存策略。`)
}
