import type { ApplicationPersistenceParticipant } from '@/core/application-control/execution/persistence'
import type { ApplicationEvidence } from '@/core/application-control/transactions'
import { DOCUMENT_ENTITY_TYPE } from '@/core/application-control/domains/documents/documentsApplicationCapabilities'

import { getDocumentSessionRegistry } from '../documentSessionRegistry'
import { externalOverwriteNote } from './documentsFields'

/*
 * 事务保存期间若某份打开的文档按应用里的内容覆盖了别处更新的版本，把这件事写进同一次事务回执：
 * 否则调用方只看到“已验证”，不知道别处（命令行助手、另一个实例）的修改已不在文档里。
 * confirmLast 让它在各领域保存参与者之后确认，读的是它们保存完之后的会话状态；对象唯一，事务引擎按身份核对参与者。
 */
export const documentOverwriteReceiptParticipant: ApplicationPersistenceParticipant = {
  key: 'documents:external_overwrite',
  confirmLast: true,
  begin() {
    const before = new Map(getDocumentSessionRegistry().list().map(session => [session.id, session.getState().externalOverwrite?.count ?? 0]))
    return {
      async confirm() {
        const evidence: ApplicationEvidence[] = getDocumentSessionRegistry().list().flatMap(session => {
          const overwrite = session.getState().externalOverwrite
          if (!overwrite || overwrite.count <= (before.get(session.id) ?? 0)) return []
          return [{
            kind: 'operation_result' as const,
            target: { kind: DOCUMENT_ENTITY_TYPE, id: session.id },
            fact: `“${session.documentMeta.name}”${externalOverwriteNote(overwrite)}`,
            capturedAt: new Date().toISOString(),
          }]
        })
        return evidence.length ? { effects: [], resultingRevisions: {}, evidence } : undefined
      },
      release() { /* 只读会话状态，没有要释放的批次。 */ },
    }
  },
}
