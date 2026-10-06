import { z } from 'zod'

import type { ApplicationCapabilityDefinition } from '../../applicationCapabilities'
import { DOCUMENT_KIND_IDS } from '../../../documents/types'
import { capabilityControl, capabilityOutputSchema, defineApplicationCapability } from '../shared/defineApplicationCapability'

/*
 * 通用文档与项目能力（存储底座 2.5，实施方案 2.12）：取代各工具各写一套的项目管理能力。
 * 文档 = 剪辑、画布、口播、镜头参考、图片文档；项目 = 装文档与素材的文件夹（“总项目”）。
 *
 * 改名不在这里：文档与项目的名称是 `documents.document.name` / `documents.project.name` 两条可写属性，
 * 走 change_application_entities。这里只放无法用属性写入表达的动作：
 * 新建（落一个新文件 / 文件夹，重名策略）、移动（换容器并复制原项目里引用的素材）、
 * 创建副本、移到系统回收站（不可撤销）、打开（进入对应工具的界面）、导出为单文件包（4.1）。
 *
 * 导入单文件包不向助手开放：它要读用户选的一个包文件，而助手能力不收文件路径；界面的“导入单个文件…”由用户自己选文件。
 *
 * 输入只收文档 / 项目 ID，不收路径；位置用项目 ID 表达（不在任何项目里 = 作品目录）。
 * 能力处理器委托渲染层唯一的通用文档操作服务（与项目页右键同一条路）。
 */

export const DOCUMENTS_DOMAIN = 'documents'
export const DOCUMENT_ENTITY_TYPE = 'documents.document'
export const DOCUMENT_PROJECT_ENTITY_TYPE = 'documents.project'

const documentKindSchema = z.enum(DOCUMENT_KIND_IDS).describe('文档类型：video_edit 剪辑、canvas 画布、audio_edit 口播、camera_stage 镜头参考、image_document 图片文档')
const nameSchema = z.string().trim().min(1).max(200)
const documentRefSchema = z.object({ kind: z.literal(DOCUMENT_ENTITY_TYPE), id: z.string().min(1) }).strict()
const projectRefSchema = z.object({ kind: z.literal(DOCUMENT_PROJECT_ENTITY_TYPE), id: z.string().min(1) }).strict()

export const documentListItemSchema = z.object({
  ref: documentRefSchema,
  name: z.string(),
  kind: documentKindSchema,
  /** 所在项目；不在任何项目里时为 null。 */
  projectId: z.string().nullable(),
  projectName: z.string().nullable(),
  draft: z.boolean(),
  missing: z.boolean(),
  external: z.boolean(),
  updatedAt: z.number(),
}).strict()

export const projectListItemSchema = z.object({
  ref: projectRefSchema,
  name: z.string(),
  draft: z.boolean(),
  external: z.boolean(),
  missing: z.boolean(),
  documentCount: z.number().int().nonnegative(),
}).strict()

const NAME_CONFLICT_RECOVERY = '目标位置已有同名文件时返回 NAME_CONFLICT：换一个名称，或（移动时）用 onConflict="keepBoth" 自动加序号保留两者；不要猜测已存在文件的名称。'

const listDocuments = defineApplicationCapability({
  id: 'list_documents', version: 1, title: '列出文档',
  description: '按类型、所在项目与草稿状态列出剪辑、画布、口播、镜头参考、图片文档，返回稳定引用（不含文件路径）。',
  domain: DOCUMENTS_DOMAIN,
  aliases: ['文档列表', '我的画布', '我的口播', '镜头参考列表', '项目里的文档', 'list documents'],
  readOnly: true, risk: 'R0', dataClasses: ['C1'], permission: 'documents:read', idempotent: true, destructive: false,
  timeoutMs: 10_000, supportsPreview: false, supportsUndo: false, requiredScopes: [],
  producesRefs: [DOCUMENT_ENTITY_TYPE, DOCUMENT_PROJECT_ENTITY_TYPE],
  inputSchema: z.object({
    kind: documentKindSchema.optional(),
    location: z.enum(['any', 'standalone', 'project']).default('any').describe('any 全部；standalone 不在任何项目里；project 某个项目（需 projectId）'),
    projectId: z.string().min(1).optional().describe('location=project 时必填，来自 list_projects'),
    drafts: z.enum(['include', 'exclude', 'only']).default('include').describe('草稿（尚未保存起名的文档）是否列出'),
    limit: z.number().int().min(1).max(200).default(50),
  }).strict(),
  outputSchema: capabilityOutputSchema({
    documents: z.array(documentListItemSchema),
    total: z.number().int().nonnegative(),
  }),
  concurrencyKey: 'documents_catalog',
  control: capabilityControl('observe', [DOCUMENT_ENTITY_TYPE]),
  summarize: (output) => `文档列表返回 ${output.documents.length} 项（共 ${output.total} 项）。`,
})

const listProjects = defineApplicationCapability({
  id: 'list_projects', version: 1, title: '列出项目',
  description: '列出项目（装文档与素材的文件夹），返回稳定引用与其中的文档数量（不含文件路径）。',
  domain: DOCUMENTS_DOMAIN,
  aliases: ['项目列表', '总项目', '我的项目', 'list projects'],
  readOnly: true, risk: 'R0', dataClasses: ['C1'], permission: 'documents:read', idempotent: true, destructive: false,
  timeoutMs: 10_000, supportsPreview: false, supportsUndo: false, requiredScopes: [],
  producesRefs: [DOCUMENT_PROJECT_ENTITY_TYPE],
  inputSchema: z.object({
    includeDrafts: z.boolean().default(false).describe('是否列出尚未保存起名的草稿项目'),
  }).strict(),
  outputSchema: capabilityOutputSchema({ projects: z.array(projectListItemSchema) }),
  concurrencyKey: 'documents_catalog',
  control: capabilityControl('observe', [DOCUMENT_PROJECT_ENTITY_TYPE]),
  summarize: (output) => `项目列表返回 ${output.projects.length} 项。`,
})

const createDocument = defineApplicationCapability({
  id: 'create_document', version: 1, title: '新建文档',
  description: '用给定名称新建一份空文档（不是草稿），可放进某个项目；不打开、不切换界面。剪辑只能放在项目里。',
  domain: DOCUMENTS_DOMAIN,
  aliases: ['新建画布', '新建口播', '新建镜头参考', '新建图片文档', 'create document'],
  readOnly: false, risk: 'R1', dataClasses: ['C1'], permission: 'documents:write', idempotent: false, destructive: false,
  timeoutMs: 15_000, supportsPreview: false, supportsUndo: false, requiredScopes: [],
  acceptsRefs: [DOCUMENT_PROJECT_ENTITY_TYPE], producesRefs: [DOCUMENT_ENTITY_TYPE],
  failureRecovery: [NAME_CONFLICT_RECOVERY],
  inputSchema: z.object({
    kind: documentKindSchema,
    name: nameSchema,
    projectId: z.string().min(1).optional().describe('放进哪个项目（来自 list_projects）；省略则不放进任何项目'),
  }).strict(),
  outputSchema: capabilityOutputSchema({ resultRef: documentRefSchema, name: z.string(), kind: documentKindSchema, projectId: z.string().nullable() }),
  concurrencyKey: 'documents_write',
  resolveOperationTargets: (input) => input.projectId ? [{ kind: DOCUMENT_PROJECT_ENTITY_TYPE, id: input.projectId }] : [],
  resolveOperationWriteTargets: (_input, operationId) => [{ kind: DOCUMENT_ENTITY_TYPE, id: `pending:${operationId}` }],
  control: capabilityControl('create', [DOCUMENT_ENTITY_TYPE], { revisionScopes: [DOCUMENTS_DOMAIN] }),
  summarize: (output) => `已新建文档“${output.name}”。`,
})

const openDocument = defineApplicationCapability({
  id: 'open_document', version: 1, title: '打开文档',
  description: '在对应工具里打开一份文档供用户查看与编辑（会切换界面）。只在用户要求查看或进入编辑时使用。给了 fromDocumentId（一份打开着的剪辑）时以嵌入模式打开：工具命令带显示“返回剪辑 · 项目名”，返回时回到那份剪辑。',
  domain: DOCUMENTS_DOMAIN,
  aliases: ['打开画布', '打开口播', '进入文档', 'open document'],
  readOnly: false, risk: 'R1', dataClasses: ['C1'], permission: 'documents:open', idempotent: true, destructive: false,
  timeoutMs: 20_000, supportsPreview: false, supportsUndo: false, requiredScopes: ['navigation'],
  acceptsRefs: [DOCUMENT_ENTITY_TYPE], producesRefs: [DOCUMENT_ENTITY_TYPE, 'application.surface'],
  successEvidence: ['文档已交给对应工具打开，应用切换到该工具的编辑器页面。'],
  failureRecovery: ['该类型尚未接入通用打开方式时返回原因，改用对应工具自己的打开能力；不要反复重试。'],
  inputSchema: z.object({
    documentId: z.string().min(1),
    fromDocumentId: z.string().min(1).optional().describe('从哪份打开着的剪辑里打开（剪辑的文档 ID）；给了就是嵌入模式'),
  }).strict(),
  outputSchema: capabilityOutputSchema({ resultRef: documentRefSchema, name: z.string(), kind: documentKindSchema, embedded: z.boolean() }),
  concurrencyKey: 'documents_open',
  control: capabilityControl('navigate', [DOCUMENT_ENTITY_TYPE, 'application.surface']),
  summarize: (output) => `已打开文档“${output.name}”。`,
})

const moveDocument = defineApplicationCapability({
  id: 'move_document', version: 1, title: '移动文档',
  description: '把文档移到某个项目里，或移出项目（projectId 为 null）。原项目里被它引用的素材会一并复制过去（原处保留）。',
  domain: DOCUMENTS_DOMAIN,
  aliases: ['移到项目', '移出项目', '放进项目', 'move document'],
  readOnly: false, risk: 'R1', dataClasses: ['C1'], permission: 'documents:write', idempotent: false, destructive: false,
  timeoutMs: 60_000, supportsPreview: false, supportsUndo: false, requiredScopes: [],
  acceptsRefs: [DOCUMENT_ENTITY_TYPE, DOCUMENT_PROJECT_ENTITY_TYPE], producesRefs: [DOCUMENT_ENTITY_TYPE],
  failureRecovery: [NAME_CONFLICT_RECOVERY, '剪辑只能放在项目里，不能移出项目。'],
  inputSchema: z.object({
    documentId: z.string().min(1),
    projectId: z.string().min(1).nullable().describe('目标项目（来自 list_projects）；null 表示移出项目'),
    onConflict: z.enum(['fail', 'keepBoth']).default('fail').describe('目标位置有同名文件时：fail 报错；keepBoth 自动加序号保留两者'),
  }).strict(),
  outputSchema: capabilityOutputSchema({ resultRef: documentRefSchema, name: z.string(), projectId: z.string().nullable(), copiedFiles: z.number().int().nonnegative() }),
  concurrencyKey: 'documents_write',
  resolveConcurrencyKey: (input) => `documents_document:${input.documentId}`,
  resolveOperationTargets: (input) => [{ kind: DOCUMENT_ENTITY_TYPE, id: input.documentId }],
  control: capabilityControl('update', [DOCUMENT_ENTITY_TYPE], { revisionScopes: [DOCUMENTS_DOMAIN] }),
  summarize: (output) => output.projectId ? `已把“${output.name}”移到项目。` : `已把“${output.name}”移出项目。`,
})

const duplicateDocument = defineApplicationCapability({
  id: 'duplicate_document', version: 1, title: '创建文档副本',
  description: '创建一份副本（新的文档、新的引用），名称自动加序号。默认放在原文档所在的文件夹；给了 projectId 时复制进那个项目（原项目里它用到的素材一并复制）。',
  domain: DOCUMENTS_DOMAIN,
  aliases: ['复制文档', '创建副本', 'duplicate document'],
  readOnly: false, risk: 'R1', dataClasses: ['C1'], permission: 'documents:write', idempotent: false, destructive: false,
  timeoutMs: 60_000, supportsPreview: false, supportsUndo: false, requiredScopes: [],
  acceptsRefs: [DOCUMENT_ENTITY_TYPE], producesRefs: [DOCUMENT_ENTITY_TYPE],
  inputSchema: z.object({
    documentId: z.string().min(1),
    projectId: z.string().min(1).optional().describe('复制进哪个项目（来自 list_projects）；省略则与原文档放在同一文件夹'),
  }).strict(),
  outputSchema: capabilityOutputSchema({ resultRef: documentRefSchema, name: z.string(), sourceRef: documentRefSchema, projectId: z.string().nullable() }),
  concurrencyKey: 'documents_write',
  resolveOperationTargets: (input) => [{ kind: DOCUMENT_ENTITY_TYPE, id: input.documentId }],
  resolveOperationWriteTargets: (_input, operationId) => [{ kind: DOCUMENT_ENTITY_TYPE, id: `pending:${operationId}` }],
  control: capabilityControl('create', [DOCUMENT_ENTITY_TYPE], { revisionScopes: [DOCUMENTS_DOMAIN] }),
  summarize: (output) => `已创建副本“${output.name}”。`,
})

const trashDocument = defineApplicationCapability({
  id: 'trash_document', version: 1, title: '把文档移到回收站',
  description: '把文档文件移到系统回收站（用户可以从回收站找回，应用内不能撤销）。正在编辑的文档会被拒绝。',
  domain: DOCUMENTS_DOMAIN,
  aliases: ['删除文档', '删除画布', '删除口播', 'trash document', 'delete document'],
  readOnly: false, risk: 'R2', dataClasses: ['C1'], permission: 'documents:delete', idempotent: true, destructive: true,
  timeoutMs: 15_000, supportsPreview: true, supportsUndo: false, requiredScopes: [],
  acceptsRefs: [DOCUMENT_ENTITY_TYPE],
  failureRecovery: ['文档正在编辑时先请用户关闭；文档已不存在时重新列出文档。'],
  inputSchema: z.object({ documentId: z.string().min(1) }).strict(),
  outputSchema: capabilityOutputSchema({ resultRef: documentRefSchema, name: z.string(), status: z.literal('trashed') }),
  concurrencyKey: 'documents_write',
  resolveConcurrencyKey: (input) => `documents_document:${input.documentId}`,
  resolveOperationTargets: (input) => [{ kind: DOCUMENT_ENTITY_TYPE, id: input.documentId }],
  preview: (input) => ({ title: '把文档移到回收站', summary: `把文档 ${input.documentId} 移到系统回收站；可以从回收站找回，应用内不能撤销。`, targetIds: { documentId: input.documentId }, reversible: false, dataClasses: ['C1'] }),
  control: capabilityControl('delete', [DOCUMENT_ENTITY_TYPE], { revisionScopes: [DOCUMENTS_DOMAIN] }),
  summarize: (output) => `“${output.name}”已移到回收站。`,
})

const createProject = defineApplicationCapability({
  id: 'create_project', version: 1, title: '新建项目',
  description: '用给定名称新建一个项目文件夹（不是草稿），之后可以把文档放进去；不切换界面。',
  domain: DOCUMENTS_DOMAIN,
  aliases: ['新建总项目', '创建项目', 'create project'],
  readOnly: false, risk: 'R1', dataClasses: ['C1'], permission: 'documents:write', idempotent: false, destructive: false,
  timeoutMs: 15_000, supportsPreview: false, supportsUndo: false, requiredScopes: [],
  producesRefs: [DOCUMENT_PROJECT_ENTITY_TYPE],
  failureRecovery: [NAME_CONFLICT_RECOVERY],
  inputSchema: z.object({ name: nameSchema }).strict(),
  outputSchema: capabilityOutputSchema({ resultRef: projectRefSchema, name: z.string() }),
  concurrencyKey: 'documents_write',
  resolveOperationTargets: () => [],
  resolveOperationWriteTargets: (_input, operationId) => [{ kind: DOCUMENT_PROJECT_ENTITY_TYPE, id: `pending:${operationId}` }],
  control: capabilityControl('create', [DOCUMENT_PROJECT_ENTITY_TYPE], { revisionScopes: [DOCUMENTS_DOMAIN] }),
  summarize: (output) => `已新建项目“${output.name}”。`,
})

const exportPackageInput = z.object({
  documentId: z.string().min(1).optional().describe('导出单个文档（来自 list_documents）'),
  projectId: z.string().min(1).optional().describe('导出整个项目（来自 list_projects）'),
}).strict().superRefine((value, ctx) => {
  if (Boolean(value.documentId) === Boolean(value.projectId)) ctx.addIssue({ code: 'custom', message: 'documentId 与 projectId 必须且只能给一个。' })
})

const exportDocumentPackage = defineApplicationCapability({
  id: 'export_document_package', version: 1, title: '导出为单个文件',
  description: '把一份文档或整个项目连同引用的素材、内嵌图层包导出为一个 .henjipack 文件（放进作品目录的“导出”文件夹，重名自动加序号），便于发给别人或备份；对方在痕迹AI里“导入单个文件…”即可打开。不改原文档。',
  domain: DOCUMENTS_DOMAIN,
  aliases: ['导出项目包', '打包项目', '导出文档包', '单文件包', 'export package'],
  readOnly: false, risk: 'R1', dataClasses: ['C1'], permission: 'documents:write', idempotent: false, destructive: false,
  timeoutMs: 600_000, supportsPreview: false, supportsUndo: false, requiredScopes: [],
  acceptsRefs: [DOCUMENT_ENTITY_TYPE, DOCUMENT_PROJECT_ENTITY_TYPE],
  successEvidence: ['包文件已写进作品目录的“导出”文件夹，并回读确认存在。'],
  failureRecovery: ['引用到但找不到的素材不会进包，结果里给出数量；先“收集素材”或重新定位后再导出。'],
  inputSchema: exportPackageInput,
  outputSchema: capabilityOutputSchema({ fileName: z.string(), files: z.number().int().nonnegative(), missingFiles: z.number().int().nonnegative() }),
  concurrencyKey: 'documents_export',
  resolveOperationTargets: (input) => input.documentId ? [{ kind: DOCUMENT_ENTITY_TYPE, id: input.documentId }] : input.projectId ? [{ kind: DOCUMENT_PROJECT_ENTITY_TYPE, id: input.projectId }] : [],
  control: capabilityControl('execute', [DOCUMENT_ENTITY_TYPE, DOCUMENT_PROJECT_ENTITY_TYPE]),
  summarize: (output) => `已导出“${output.fileName}”（${output.files} 个文件）。`,
})

export const DOCUMENTS_APPLICATION_CAPABILITIES: ApplicationCapabilityDefinition[] = [
  listDocuments, listProjects, createDocument, openDocument, moveDocument, duplicateDocument, trashDocument, createProject, exportDocumentPackage,
]
