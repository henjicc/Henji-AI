import type {
  ApplicationCompletedStepResult,
  ApplicationEvidence,
  ApplicationMutationExecutor,
  ApplicationMutationOperation,
  ApplicationPlannedStep,
} from '@/core/application-control'
import { applyWriterTable, propertyOperations, writableProperties, type ApplicationPropertyWriterTable } from '@/core/application-control/execution/writerTable'

import { getDocumentOperations, isDocumentNameConflict, type DocumentOperations } from '../documentOperations'
import { DOCUMENTS_ENTITY_TYPES, documentWriterTable, projectWriterTable, type DocumentsEntityType, type DocumentsFieldDraft } from './documentsFields'
import { documentsRevisions } from './documentsReflection'

/*
 * 文档与项目的属性写入（只有名称）：委托通用文档操作服务改名，与项目页“重命名”同一条路。
 * 重名时由主进程报 DocumentNameConflictError，不加后缀；撤销 = 改回原名。
 */

type MutationStep = Extract<ApplicationPlannedStep, { kind: 'mutation' }>

const undoRecords = new Map<string, { entityType: DocumentsEntityType; id: string; previousName: string; nextName: string }>()

export class DocumentsMutationExecutor implements ApplicationMutationExecutor {
  readonly effectContract = { direct: [], cascades: [] }
  readonly writableProperties: ReadonlySet<string>
  readonly propertyOperations: ReadonlyMap<string, ReadonlySet<ApplicationMutationOperation>>

  constructor(readonly entityType: DocumentsEntityType, private readonly operations: () => DocumentOperations = getDocumentOperations) {
    const table = this.table()
    this.writableProperties = writableProperties(table)
    this.propertyOperations = propertyOperations(table)
  }

  async apply(step: MutationStep): Promise<ApplicationCompletedStepResult> {
    const draft: DocumentsFieldDraft = {}
    await applyWriterTable(this.table(), draft, step.mutations)
    const previousName = await this.currentName(step.target.id)
    const nextName = draft.name ?? previousName
    if (nextName !== previousName) await this.rename(step.target.id, nextName)
    const undoToken = `documents:${crypto.randomUUID()}`
    undoRecords.set(undoToken, { entityType: this.entityType, id: step.target.id, previousName, nextName })
    return {
      status: 'completed',
      resultingRevisions: documentsRevisions(this.operations()),
      directRefs: [{ kind: this.entityType, id: step.target.id }],
      evidence: step.mutations.map((mutation) => ({
        kind: 'property_value' as const,
        target: { kind: this.entityType, id: step.target.id },
        fact: `${this.entityType === DOCUMENTS_ENTITY_TYPES.document ? '文档' : '项目'}属性 ${mutation.propertyId} 已更新。`,
        data: mutation.value ?? null,
        capturedAt: new Date().toISOString(),
      })),
      undoToken,
    }
  }

  async compensate(_step: MutationStep, result: ApplicationCompletedStepResult): Promise<ApplicationEvidence[]> {
    if (!result.undoToken) return []
    return (await this.undo(result.undoToken)).evidence
  }

  async undo(undoToken: string): Promise<ApplicationCompletedStepResult> {
    const record = undoRecords.get(undoToken)
    if (!record) throw new Error('DOCUMENTS_UNDO_NOT_FOUND')
    const current = await this.currentName(record.id)
    if (current !== record.nextName) throw new Error('名称已在别处再次修改，不能撤销这次改名。')
    if (record.previousName !== record.nextName) await this.rename(record.id, record.previousName)
    undoRecords.delete(undoToken)
    return {
      status: 'completed',
      resultingRevisions: documentsRevisions(this.operations()),
      directRefs: [{ kind: this.entityType, id: record.id }],
      evidence: [{ kind: 'entity_state', target: { kind: this.entityType, id: record.id }, fact: '改名已撤销。', capturedAt: new Date().toISOString() }],
    }
  }

  private table(): ApplicationPropertyWriterTable<DocumentsFieldDraft> {
    return this.entityType === DOCUMENTS_ENTITY_TYPES.document ? documentWriterTable() : projectWriterTable()
  }

  private async currentName(id: string): Promise<string> {
    const operations = this.operations()
    return this.entityType === DOCUMENTS_ENTITY_TYPES.document ? (await operations.findDocument(id)).name : (await operations.findProject(id)).name
  }

  private async rename(id: string, name: string): Promise<void> {
    const operations = this.operations()
    try {
      if (this.entityType === DOCUMENTS_ENTITY_TYPES.document) {
        const document = await operations.findDocument(id)
        await operations.renameDocument({ id, path: document.path }, name)
      } else {
        await operations.renameProject(id, name)
      }
    } catch (error) {
      // 用户（或助手）给的名字重名不加后缀：说清楚改道办法
      if (isDocumentNameConflict(error)) throw new Error(`NAME_CONFLICT:同一位置已有名为“${name}”的${this.entityType === DOCUMENTS_ENTITY_TYPES.document ? '同类文档' : '文件夹'}，请换一个名称（不会自动加序号）。`)
      throw error
    }
  }
}
