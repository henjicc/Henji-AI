import { z } from 'zod'

import { imageEditOperationSchema } from '../../features/imageEdit/application/imageEditControlCatalog'
import {
  applicationRefSchema,
  type ApplicationCapabilityDefinition,
} from './applicationCapabilities'
import {
  APPLICATION_OBSERVATION_TARGETS,
  APPLICATION_SURFACE_IDS,
  APPLICATION_WINDOW_OBSERVATION_TARGET,
} from './applicationSurfaces'
import { agentAttachmentSchema } from './attachments'
import {
  capabilityControl,
  directOnlyObservedEffects,
} from './capabilities/defineApplicationCapability'

function defineCapability<TInput, TOutput>(
  definition: Omit<
    ApplicationCapabilityDefinition<TInput, TOutput>,
    'availability' | 'concurrencyKey'
  > & {
    availability?: string[]
    concurrencyKey?: string
  }
): ApplicationCapabilityDefinition<TInput, TOutput> {
  return {
    ...definition,
    availability: definition.availability
      ?? definition.requiredScopes.map((scope) => `${scope} 作用域可用`),
    concurrencyKey: definition.concurrencyKey ?? definition.domain,
    verificationContract: definition.verificationContract ?? (
      definition.readOnly || definition.control.impacts.every((impact) => (
        ['observe', 'navigate'].includes(impact.effect)
      ))
        ? undefined
        : {
            kind: 'effect_receipt' as const,
            requireEffects: true,
            requireVerifiedEffects: false,
          }
    ),
    resolveObservedEffects: definition.resolveObservedEffects
      ?? (definition.control.impacts.length > 0
        ? directOnlyObservedEffects<TOutput>(definition.control)
        : undefined),
  }
}

const revisionOutputSchema = z.object({
  revision: z.number().int().nonnegative(),
  scopeRevisions: z.record(z.string(), z.number().int().nonnegative()),
}).passthrough()

export const getCurrentApplicationContextCapability = defineCapability({
  id: 'get_current_application_context',
  version: 1,
  title: '读取当前应用位置',
  description: '读取用户当前所在页面、打开的工具或设置分区，以及当前焦点对象。',
  domain: 'application',
  aliases: ['当前页面', '这里', '当前工具', '当前位置', 'current page', 'surface'],
  side: 'frontend',
  readOnly: true,
  control: capabilityControl('observe', ['application.surface', 'application.entity']),
  risk: 'R0',
  dataClasses: ['C0'],
  permission: 'application:read',
  idempotent: true,
  destructive: false,
  timeoutMs: 5_000,
  supportsPreview: false,
  supportsUndo: false,
  requiredScopes: ['navigation'],
  prerequisites: ['应用界面已就绪。'],
  acceptsRefs: [],
  producesRefs: ['application.surface', 'application.entity'],
  successEvidence: ['返回当前 Surface、焦点引用和能力目录 revision。'],
  failureRecovery: ['界面未就绪时等待宿主恢复后重试。'],
  inputSchema: z.object({}).strict(),
  outputSchema: z.object({
    surface: z.object({
      id: z.string(),
      kind: z.string(),
      focusedRef: z.string().nullable(),
      selectedRefs: z.array(z.string()),
    }),
    catalogRevision: z.number().int().nonnegative(),
    ready: z.boolean(),
    revision: z.number().int().nonnegative(),
  }).passthrough(),
  aiInputSchema: { type: 'object', properties: {}, additionalProperties: false },
})

export const observeApplicationSurfaceCapability = defineCapability({
  id: 'observe_application_surface',
  // v2：target 取代 surfaceId，新增 window 整窗观察。
  version: 2,
  title: '观察应用界面',
  description: '读取当前 Henji-AI 窗口的视觉证据。默认用 target="window" 取完整界面，任何时候都可用；只在需要排除干扰、聚焦某一块时才指定具体页面。已有稳定媒体引用时优先读取原生媒体。',
  domain: 'application',
  aliases: ['观察当前页面', '查看界面', '读取预览', '视觉验证', 'observe surface'],
  side: 'frontend',
  readOnly: true,
  control: capabilityControl('observe', ['application.surface', 'asset']),
  risk: 'R0',
  dataClasses: ['C1', 'C2'],
  permission: 'application:read',
  idempotent: true,
  destructive: false,
  timeoutMs: 15_000,
  supportsPreview: false,
  supportsUndo: false,
  requiredScopes: ['navigation'],
  prerequisites: ['target="window" 无前置条件；指定具体页面时该页面必须当前可见。', '主模型或观察模型支持目标媒体模态。'],
  availability: ['只在至少一种媒体输入模态可用时开放，并按实际结果二次门禁。', '截图范围仅限当前 Henji-AI 应用窗口，不涉及桌面或其他应用。'],
  acceptsRefs: ['application.surface', 'asset'],
  producesRefs: ['asset'],
  successEvidence: ['返回稳定 asset 引用、观察目标、观察提供者、遮罩数量；视觉内容经模型读取后才能标记为已验证。'],
  failureRecovery: ['指定页面不可见时改用 target="window"，或先调用 open_application_surface。', '模型不支持图片时回退结构化能力并明确未验证。'],
  inputSchema: z.object({
    target: z.enum(APPLICATION_OBSERVATION_TARGETS).default(APPLICATION_WINDOW_OBSERVATION_TARGET),
    purpose: z.string().min(1).max(500),
    mediaRef: z.string().regex(/^asset:[^\s]+$/).optional(),
  }).strict(),
  outputSchema: z.object({
    target: z.enum(APPLICATION_OBSERVATION_TARGETS),
    providerId: z.string().min(1),
    sourceKind: z.enum(['native_media', 'viewport_3d', 'canvas_preview', 'surface_region', 'application_window']),
    verificationKind: z.literal('visual_pending_model'),
    attachment: agentAttachmentSchema,
    maskedRegionCount: z.number().int().nonnegative(),
    capturedAt: z.string().datetime(),
  }).strict(),
  aiInputSchema: {
    type: 'object',
    properties: {
      target: {
        type: 'string',
        enum: [...APPLICATION_OBSERVATION_TARGETS],
        description: '默认 window：截取整个应用窗口，任何时候都可用。只在需要聚焦某一块时才填具体页面 ID。',
      },
      purpose: { type: 'string' },
      mediaRef: { type: 'string', pattern: '^asset:' },
    },
    required: ['target', 'purpose'],
    additionalProperties: false,
  },
  completionKind: 'observed',
})

export const openApplicationSurfaceCapability = defineCapability({
  id: 'open_application_surface',
  version: 1,
  title: '打开应用页面',
  description: '打开明确指定的工作区、工具或设置分区。后台可完成的设置修改不应调用本能力。',
  domain: 'navigation',
  aliases: ['打开页面', '切换页面', '带我去', '打开设置', 'open page', 'navigate'],
  side: 'frontend',
  readOnly: false,
  control: capabilityControl('navigate', ['application.surface']),
  risk: 'R0',
  dataClasses: ['C0'],
  permission: 'navigation:write',
  idempotent: true,
  destructive: false,
  timeoutMs: 5_000,
  supportsPreview: false,
  supportsUndo: false,
  requiredScopes: ['navigation'],
  prerequisites: ['目标 Surface ID 来自能力目录或当前上下文。'],
  acceptsRefs: ['application.surface'],
  producesRefs: ['application.surface'],
  successEvidence: ['返回实际打开的 Surface ID 和最新 revision。'],
  failureRecovery: ['目标不存在时搜索应用能力或请求用户澄清，不猜测页面名称。'],
  inputSchema: z.object({
    surfaceId: z.enum(APPLICATION_SURFACE_IDS),
  }).strict(),
  outputSchema: revisionOutputSchema,
  aiInputSchema: {
    type: 'object',
    properties: { surfaceId: { type: 'string', enum: [...APPLICATION_SURFACE_IDS] } },
    required: ['surfaceId'],
    additionalProperties: false,
  },
})

export const closeApplicationSurfaceCapability = defineCapability({
  id: 'close_application_surface',
  version: 1,
  title: '关闭应用浮层',
  description: '关闭明确的设置面板、素材浮层或工具子页，不关闭整个应用。',
  domain: 'navigation',
  aliases: ['关闭设置', '关闭浮层', '返回当前页', 'close panel'],
  side: 'frontend',
  readOnly: false,
  control: capabilityControl('navigate', ['application.surface']),
  risk: 'R0',
  dataClasses: ['C0'],
  permission: 'navigation:write',
  idempotent: true,
  destructive: false,
  timeoutMs: 5_000,
  supportsPreview: false,
  supportsUndo: false,
  requiredScopes: ['navigation'],
  prerequisites: ['只能关闭注册过的非破坏性 Surface。'],
  acceptsRefs: ['application.surface'],
  producesRefs: ['application.surface'],
  successEvidence: ['返回关闭后的当前 Surface。'],
  failureRecovery: ['目标已经关闭时按幂等成功处理。'],
  inputSchema: z.object({ surfaceId: z.string().min(1).max(120).optional() }).strict(),
  outputSchema: revisionOutputSchema,
  aiInputSchema: {
    type: 'object',
    properties: { surfaceId: { type: 'string' } },
    additionalProperties: false,
  },
})

export const focusApplicationEntityCapability = defineCapability({
  id: 'focus_application_entity',
  version: 1,
  title: '定位应用对象',
  description: '根据稳定引用定位生成记录、素材、画布节点或项目。',
  domain: 'navigation',
  aliases: ['定位', '打开这条记录', '查看这个项目', 'focus entity'],
  side: 'frontend',
  readOnly: false,
  control: capabilityControl('navigate', ['application.entity']),
  risk: 'R0',
  dataClasses: ['C1'],
  permission: 'navigation:write',
  idempotent: true,
  destructive: false,
  timeoutMs: 8_000,
  supportsPreview: false,
  supportsUndo: false,
  requiredScopes: ['navigation'],
  prerequisites: ['必须提供由应用能力返回的稳定引用。'],
  acceptsRefs: ['generation.record', 'generation.result', 'asset', 'canvas.project', 'canvas.node'],
  producesRefs: ['application.entity'],
  successEvidence: ['返回实际定位的引用与 Surface。'],
  failureRecovery: ['引用失效时重新读取来源模块，不根据名称猜测对象。'],
  inputSchema: z.object({ ref: applicationRefSchema }).strict(),
  outputSchema: revisionOutputSchema,
  aiInputSchema: {
    type: 'object',
    properties: {
      ref: {
        type: 'object',
        properties: {
          kind: { type: 'string' },
          id: { type: 'string' },
          revision: { type: 'integer', minimum: 0 },
          label: { type: 'string' },
        },
        required: ['kind', 'id'],
        additionalProperties: false,
      },
    },
    required: ['ref'],
    additionalProperties: false,
  },
})

export const listGenerationHistoryCapability = defineCapability({
  id: 'list_generation_history',
  version: 1,
  title: '读取生成历史',
  description: '读取生成工作区的历史记录；“当前页、最后一张”在生成页面优先使用本能力。',
  domain: 'generation',
  aliases: ['生成历史', '最后一张', '最近生成', '上一张图', 'generation history'],
  side: 'frontend',
  readOnly: true,
  control: capabilityControl('observe', ['generation.record', 'generation.result']),
  risk: 'R0',
  dataClasses: ['C1'],
  permission: 'generation:read',
  idempotent: true,
  destructive: false,
  timeoutMs: 8_000,
  supportsPreview: false,
  supportsUndo: false,
  requiredScopes: ['generation'],
  prerequisites: ['生成历史数据库已就绪。'],
  acceptsRefs: [],
  producesRefs: ['generation.record', 'generation.result'],
  successEvidence: ['返回按时间倒序排列的记录及稳定引用，不暴露本地路径。'],
  failureRecovery: ['没有成功结果时明确返回空列表，不创建画布或其他项目。'],
  /*
   * 筛选维度与生成页的筛选栏一一对应。此前只有 mediaType / status / limit，
   * 界面上的关键词、供应商、模型、时间范围助手一概查不到——用户能筛出来的记录，
   * 助手说找不到。谓词与界面共用 generationHistoryFilter.ts，避免两套语义漂移。
   */
  inputSchema: z.object({
    mediaType: z.enum(['image', 'video', 'audio']).optional(),
    status: z.enum(['success', 'completed', 'error', 'failed']).optional(),
    keyword: z.string().min(1).max(200).optional(),
    providerId: z.string().min(1).max(120).optional(),
    modelId: z.string().min(1).max(200).optional(),
    timePreset: z.enum(['7d', '30d', '90d', 'custom']).optional(),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    limit: z.number().int().min(1).max(30).default(10),
  }).strict(),
  outputSchema: z.object({ records: z.array(z.record(z.string(), z.unknown())) }).strict(),
  aiInputSchema: {
    type: 'object',
    properties: {
      mediaType: { type: 'string', enum: ['image', 'video', 'audio'] },
      status: { type: 'string', enum: ['success', 'completed', 'error', 'failed'] },
      keyword: { type: 'string', description: '在提示词、模型名、供应商、错误信息里做大小写不敏感的子串匹配。' },
      providerId: { type: 'string', description: '供应商 id，如 ppio / fal / kie。' },
      modelId: { type: 'string', description: '模型 id，需与记录里的 modelId 完全一致。' },
      timePreset: { type: 'string', enum: ['7d', '30d', '90d', 'custom'], description: "相对区间；用 startDate / endDate 时填 'custom'。" },
      startDate: { type: 'string', description: "YYYY-MM-DD，仅 timePreset 为 'custom' 时生效。" },
      endDate: { type: 'string', description: "YYYY-MM-DD，仅 timePreset 为 'custom' 时生效。" },
      limit: { type: 'integer', minimum: 1, maximum: 30 },
    },
    additionalProperties: false,
  },
  inputExamples: [
    { keyword: '猫', mediaType: 'image', limit: 5 },
    { providerId: 'fal', timePreset: '7d', status: 'success' },
    { timePreset: 'custom', startDate: '2026-08-01', endDate: '2026-08-07' },
  ],
})

export const openImageEditorWithSourceCapability = defineCapability({
  id: 'open_image_editor_with_source',
  version: 1,
  title: '在图片编辑中打开结果',
  description: '把生成结果或素材引用直接传给图片编辑器，不经过画布，也不要求先写入素材库。',
  domain: 'image_edit',
  aliases: ['传到图片编辑', '打开图片编辑', '编辑最后一张', 'open image editor'],
  side: 'frontend',
  readOnly: false,
  control: capabilityControl('navigate', ['image_edit.session', 'application.surface']),
  risk: 'R0',
  dataClasses: ['C1'],
  permission: 'image_edit:write',
  idempotent: true,
  destructive: false,
  timeoutMs: 10_000,
  supportsPreview: false,
  supportsUndo: false,
  requiredScopes: ['generation', 'toolbox', 'navigation'],
  prerequisites: ['必须提供生成历史或素材能力返回的图片引用。'],
  acceptsRefs: ['generation.result', 'asset'],
  producesRefs: ['image_edit.session', 'application.surface'],
  successEvidence: ['图片编辑器打开并返回对应会话引用。'],
  failureRecovery: ['引用不存在或不是图片时停止并说明，不创建画布项目。'],
  inputSchema: z.object({ sourceRef: applicationRefSchema }).strict(),
  outputSchema: revisionOutputSchema,
  aiInputSchema: {
    type: 'object',
    properties: {
      sourceRef: {
        type: 'object',
        properties: { kind: { type: 'string' }, id: { type: 'string' }, label: { type: 'string' } },
        required: ['kind', 'id'],
        additionalProperties: false,
      },
    },
    required: ['sourceRef'],
    additionalProperties: false,
  },
})

export const createImageEditPreviewFromRefCapability = defineCapability({
  id: 'create_image_edit_preview_from_ref',
  version: 1,
  title: '创建图片编辑预览',
  description: '对生成结果或素材引用创建裁剪、旋转、镜像或标注预览，并在图片编辑器中显示。',
  domain: 'image_edit',
  aliases: ['矩形标注', '文字标注', '图片编辑预览', 'annotate image'],
  side: 'frontend',
  readOnly: false,
  // 同 create_image_edit_preview：预览是新建的实体，create 必须一并声明，Facet 才结得了账。
  control: capabilityControl('execute', ['image_edit.preview'], {
    alsoImpacts: [{ effect: 'create', entityTypes: ['image_edit.preview'] }],
  }),
  risk: 'R1',
  dataClasses: ['C1'],
  permission: 'image_edit:write',
  idempotent: true,
  destructive: false,
  timeoutMs: 15_000,
  supportsPreview: true,
  supportsUndo: true,
  requiredScopes: ['generation', 'toolbox', 'navigation'],
  prerequisites: ['图片引用有效，标注坐标和文本已明确。'],
  acceptsRefs: ['generation.result', 'asset'],
  producesRefs: ['image_edit.preview', 'image_edit.session'],
  successEvidence: ['返回预览引用、实际尺寸和操作数量，原图未被覆盖。'],
  failureRecovery: ['输入非法时读取图片信息后修正参数；不得改用画布猜测节点。'],
  inputSchema: z.object({
    sourceRef: applicationRefSchema,
    operations: z.array(imageEditOperationSchema).min(1).max(32),
  }).strict(),
  outputSchema: z.object({
    previewRef: z.string(),
    sourceRef: applicationRefSchema,
    operationCount: z.number().int().nonnegative(),
    hasEffect: z.boolean(),
    width: z.number().positive(),
    height: z.number().positive(),
  }).and(revisionOutputSchema),
  aiInputSchema: {
    type: 'object',
    properties: {
      sourceRef: {
        type: 'object',
        properties: { kind: { type: 'string' }, id: { type: 'string' }, label: { type: 'string' } },
        required: ['kind', 'id'],
        additionalProperties: false,
      },
      operations: {
        type: 'array',
        minItems: 1,
        maxItems: 32,
        items: { type: 'object', additionalProperties: true },
      },
    },
    required: ['sourceRef', 'operations'],
    additionalProperties: false,
  },
  resolveObservedEffects: (_input, output) => {
    const targetRefs = [{ kind: 'image_edit.preview', id: output.previewRef }]
    return [
      {
        effect: 'execute', entityTypes: ['image_edit.preview'], propertyIds: [],
        targetRefs, count: 1, verified: false, evidence: [],
      },
      {
        effect: 'create', entityTypes: ['image_edit.preview'], propertyIds: [],
        targetRefs, count: 1, verified: false, evidence: [],
      },
    ]
  },
})
