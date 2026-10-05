import { type ApplicationFieldDefinition, type ApplicationPropertyDescriptor, type ApplicationSchemaRef, type JsonValue, fieldWriterTable } from '@/core/application-control'
import type { ApplicationPropertyWriterTable } from '@/core/application-control/execution/writerTable'
import { APPLICATION_CAPABILITY_CATALOG_VERSION } from '@/core/application-control/applicationCapabilities'
import { DOCUMENT_ENTITY_TYPE, DOCUMENT_PROJECT_ENTITY_TYPE } from '@/core/application-control/domains/documents/documentsApplicationCapabilities'
import { DOCUMENT_KIND_IDS, type DocumentSummary, type ProjectSummary } from '@/core/documents/types'

/*
 * 通用文档与项目实体的字段（存储底座 2.5）：一条声明派生属性描述、读取映射与写入表。
 * 只有名称可写（改名走通用实体属性）；位置、草稿等由正式能力维护，只读理由里点名该用的能力。
 * 不暴露文件路径（助手用项目 ID 表达位置）。
 */

export const DOCUMENTS_ENTITY_TYPES = { document: DOCUMENT_ENTITY_TYPE, project: DOCUMENT_PROJECT_ENTITY_TYPE } as const
export type DocumentsEntityType = typeof DOCUMENTS_ENTITY_TYPES[keyof typeof DOCUMENTS_ENTITY_TYPES]

/** 写入草稿：执行器把新名称记在这里，再委托通用文档操作服务改名。 */
export interface DocumentsFieldDraft { name?: string }
export type DocumentFieldSource = { document: DocumentSummary }
export type ProjectFieldSource = { project: ProjectSummary }

export function documentsSchemaRef(kind: 'entity' | 'property', id: string): ApplicationSchemaRef {
  const value = [...id].reduce((total, char) => (total * 33 + char.charCodeAt(0)) >>> 0, 5381).toString(16)
  return { catalogVersion: APPLICATION_CAPABILITY_CATALOG_VERSION, kind, id, version: 1, digest: `sha256:${value.padEnd(64, value).slice(0, 64)}` } as const
}

const NAME = { kind: 'string', minLength: 1, maxLength: 200 } as const
const TEXT = { kind: 'string', maxLength: 2000 } as const
const BOOL = { kind: 'boolean' } as const
const TIME = { kind: 'integer', hardRange: { min: 0 } } as const

function field<TSource>(
  entityType: DocumentsEntityType,
  suffix: string,
  title: string,
  value: ApplicationPropertyDescriptor['value'],
  read: (source: TSource) => JsonValue,
  options: { writable?: boolean; readOnlyReason?: string } = {},
): ApplicationFieldDefinition<TSource, DocumentsFieldDraft> {
  const id = `${entityType}.${suffix}`
  const writable = options.writable === true
  return {
    propertyId: id,
    descriptor: {
      id, entityType, version: 1, title, description: `${title}。`, value, nullable: false, dataClass: 'C1',
      exposures: ['ui', 'assistant', 'local_adapter'],
      requiredPermissions: { read: ['documents:read'], write: writable ? ['documents:write'] : [] },
      revisionScopes: ['documents'], schemaRef: documentsSchemaRef('property', id),
      ...(!writable ? { readOnlyReason: options.readOnlyReason ?? '由文档文件与作品索引决定。' } : {}),
    },
    read,
    ...(writable ? {
      writer: {
        write: (draft: DocumentsFieldDraft, mutation: { value?: JsonValue }) => {
          if (typeof mutation.value !== 'string' || !mutation.value.trim()) throw new Error('INVALID_VALUE:名称不能为空')
          draft.name = mutation.value.trim()
        },
      },
    } : {}),
    storeActions: [],
  }
}

const D = DOCUMENTS_ENTITY_TYPES.document
const P = DOCUMENTS_ENTITY_TYPES.project
const MOVE_REASON = '所在项目由 move_document 改变（会复制原项目里引用的素材）。'

export const DOCUMENT_FIELDS: ApplicationFieldDefinition<DocumentFieldSource, DocumentsFieldDraft>[] = [
  field<DocumentFieldSource>(D, 'name', '文档名称（即文件名；同一文件夹里同类型不能重名）', NAME, (s) => s.document.name, { writable: true }),
  field<DocumentFieldSource>(D, 'kind', '文档类型', { kind: 'enum', values: DOCUMENT_KIND_IDS.map((value) => ({ value, label: value })) }, (s) => s.document.kind, { readOnlyReason: '文档类型在新建时确定。' }),
  field<DocumentFieldSource>(D, 'project_id', '所在项目 ID（不在任何项目里时为空字符串）', TEXT, (s) => (s.document.container.kind === 'project' ? s.document.container.projectId : ''), { readOnlyReason: MOVE_REASON }),
  field<DocumentFieldSource>(D, 'project_name', '所在项目名称（不在任何项目里时为空字符串）', TEXT, (s) => s.document.projectName ?? '', { readOnlyReason: MOVE_REASON }),
  field<DocumentFieldSource>(D, 'draft', '是否草稿（尚未保存起名）', BOOL, (s) => s.document.draft, { readOnlyReason: '草稿由用户在离开文档时保存或丢弃。' }),
  field<DocumentFieldSource>(D, 'missing', '文件是否找不到', BOOL, (s) => s.document.missing, { readOnlyReason: '由作品索引扫描判断。' }),
  field<DocumentFieldSource>(D, 'external', '是否位于作品目录之外', BOOL, (s) => s.document.external, { readOnlyReason: '由保存位置决定。' }),
  field<DocumentFieldSource>(D, 'updated_at', '最后修改时间（毫秒时间戳）', TIME, (s) => s.document.updatedAt, { readOnlyReason: '由保存自动更新。' }),
  field<DocumentFieldSource>(D, 'summary', '类型摘要（如节点数）', { kind: 'json', schemaRef: documentsSchemaRef('property', `${D}.summary`) }, (s) => s.document.summary, { readOnlyReason: '由文档内容计算。' }),
]

export const PROJECT_FIELDS: ApplicationFieldDefinition<ProjectFieldSource, DocumentsFieldDraft>[] = [
  field<ProjectFieldSource>(P, 'name', '项目名称（即文件夹名；同一位置不能重名）', NAME, (s) => s.project.name, { writable: true }),
  field<ProjectFieldSource>(P, 'draft', '是否草稿项目（尚未保存起名）', BOOL, (s) => s.project.draft, { readOnlyReason: '草稿项目由用户在离开时保存或丢弃。' }),
  field<ProjectFieldSource>(P, 'external', '是否位于作品目录之外', BOOL, (s) => s.project.external, { readOnlyReason: '由保存位置决定。' }),
  field<ProjectFieldSource>(P, 'missing', '文件夹是否找不到', BOOL, (s) => s.project.missing, { readOnlyReason: '由作品索引扫描判断。' }),
  field<ProjectFieldSource>(P, 'document_count', '项目里的文档数量', { kind: 'integer', hardRange: { min: 0 } }, (s) => s.project.documentCount, { readOnlyReason: '由作品索引统计。' }),
]

export function documentWriterTable(): ApplicationPropertyWriterTable<DocumentsFieldDraft> { return fieldWriterTable(DOCUMENT_FIELDS) }
export function projectWriterTable(): ApplicationPropertyWriterTable<DocumentsFieldDraft> { return fieldWriterTable(PROJECT_FIELDS) }
