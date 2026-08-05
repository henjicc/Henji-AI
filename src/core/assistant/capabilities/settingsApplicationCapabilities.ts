import { z } from 'zod'

import { capabilityControl, defineApplicationCapability } from './defineApplicationCapability'

const settingChangeSchema = z.object({
  id: z.string().min(1).max(120),
  value: z.unknown(),
}).strict()

export const searchApplicationSettingsCapability = defineApplicationCapability({
  id: 'search_application_settings', version: 1, title: '搜索应用设置',
  description: '按用户语言搜索可读取或修改的应用设置，不返回密钥和原始本地路径。',
  domain: 'settings', aliases: ['设置', '偏好', '毛玻璃', '主题', '上传', '画布', 'settings'],
  side: 'frontend', readOnly: true,
  control: capabilityControl('observe', ['application.setting']),
  risk: 'R0', dataClasses: ['C0'], permission: 'settings:read', idempotent: true,
  destructive: false, timeoutMs: 5_000, supportsPreview: false, supportsUndo: false,
  requiredScopes: ['settings'], prerequisites: ['应用设置注册中心已就绪。'],
  acceptsRefs: [], producesRefs: ['application.setting'],
  successEvidence: ['返回稳定设置 ID、用户化说明、约束和设置页位置。'],
  failureRecovery: ['无结果时刷新设置目录或请求更具体的设置名称。'],
  inputSchema: z.object({
    query: z.string().max(500).default(''),
    limit: z.number().int().min(1).max(30).default(12),
  }).strict(),
  outputSchema: z.object({ settings: z.array(z.record(z.string(), z.unknown())) }).strict(),
  aiInputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string' },
      limit: { type: 'integer', minimum: 1, maximum: 30 },
    },
    additionalProperties: false,
  },
})

export const getApplicationSettingsCapability = defineApplicationCapability({
  id: 'get_application_settings', version: 1, title: '读取应用设置',
  description: '读取明确设置的当前值；密钥只返回是否已配置，路径只返回状态。',
  domain: 'settings', aliases: ['读取设置', '当前设置', '是否开启', 'get settings'],
  side: 'frontend', readOnly: true,
  control: capabilityControl('observe', ['application.setting']),
  risk: 'R0', dataClasses: ['C1'], permission: 'settings:read', idempotent: true,
  destructive: false, timeoutMs: 5_000, supportsPreview: false, supportsUndo: false,
  requiredScopes: ['settings'], prerequisites: ['设置 ID 必须来自设置搜索结果。'],
  acceptsRefs: ['application.setting'], producesRefs: ['application.setting'],
  successEvidence: ['返回设置当前值或脱敏状态。'],
  failureRecovery: ['设置 ID 不存在时重新搜索，不猜测 ID。'],
  inputSchema: z.object({ ids: z.array(z.string().min(1)).min(1).max(30) }).strict(),
  outputSchema: z.object({
    revision: z.number().int().nonnegative(),
    settings: z.array(z.record(z.string(), z.unknown())),
  }).strict(),
  aiInputSchema: {
    type: 'object',
    properties: { ids: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 30 } },
    required: ['ids'],
    additionalProperties: false,
  },
})

export const planApplicationSettingsChangeCapability = defineApplicationCapability({
  id: 'plan_application_settings_change', version: 1, title: '规划设置修改',
  description: '校验一组设置修改并返回变更前后差异、联动影响和刷新或重启要求，不写入。',
  domain: 'settings', aliases: ['修改设置', '设置计划', '批量设置', 'plan settings'],
  side: 'frontend', readOnly: true,
  control: capabilityControl('observe', ['application.setting', 'settings.plan']),
  risk: 'R0', dataClasses: ['C1'], permission: 'settings:read', idempotent: true,
  destructive: false, timeoutMs: 5_000, supportsPreview: true, supportsUndo: false,
  requiredScopes: ['settings'], prerequisites: ['设置 ID 和目标值已明确。'],
  acceptsRefs: ['application.setting'], producesRefs: ['settings.plan'],
  successEvidence: ['所有值通过约束校验并返回绑定 revision 的计划引用。'],
  failureRecovery: ['任一值非法时修正输入；不会写入部分设置。'],
  inputSchema: z.object({ changes: z.array(settingChangeSchema).min(1).max(30) }).strict(),
  outputSchema: z.object({
    planRef: z.string(), revision: z.number().int().nonnegative(),
    changes: z.array(z.record(z.string(), z.unknown())),
    requiresReload: z.boolean(), requiresRestart: z.boolean(),
  }).strict(),
  aiInputSchema: {
    type: 'object',
    properties: {
      changes: {
        type: 'array', minItems: 1, maxItems: 30,
        items: {
          type: 'object', properties: { id: { type: 'string' }, value: {} },
          required: ['id', 'value'], additionalProperties: false,
        },
      },
    },
    required: ['changes'],
    additionalProperties: false,
  },
})

export const applyApplicationSettingsChangeCapability = defineApplicationCapability({
  id: 'apply_application_settings_change', version: 1, title: '应用设置修改',
  description: '原子应用已校验的设置计划；revision 冲突时不会写入。',
  domain: 'settings', aliases: ['应用设置', '确认修改', '关闭毛玻璃', 'apply settings'],
  side: 'frontend', readOnly: false,
  control: capabilityControl('update', ['application.setting'], { revisionScopes: ['settings'] }),
  risk: 'R1', dataClasses: ['C1'], permission: 'settings:write', idempotent: true,
  destructive: false, timeoutMs: 8_000, supportsPreview: true, supportsUndo: true,
  requiredScopes: ['settings'], prerequisites: ['先创建设置修改计划，并保持设置 revision 未变化。'],
  acceptsRefs: ['settings.plan'], producesRefs: ['application.setting'],
  successEvidence: ['返回每项已生效的新值和新 revision。'],
  failureRecovery: ['revision 冲突时重新读取设置并重新规划。'],
  inputSchema: z.object({ planRef: z.string().min(1) }).strict(),
  outputSchema: z.object({
    applied: z.array(z.record(z.string(), z.unknown())),
    revision: z.number().int().nonnegative(), undoRef: z.string().min(1),
    requiresReload: z.boolean(), requiresRestart: z.boolean(),
  }).strict(),
  aiInputSchema: {
    type: 'object', properties: { planRef: { type: 'string' } },
    required: ['planRef'], additionalProperties: false,
  },
})

export const SETTINGS_APPLICATION_CAPABILITIES = [
  searchApplicationSettingsCapability,
  getApplicationSettingsCapability,
  planApplicationSettingsChangeCapability,
  applyApplicationSettingsChangeCapability,
]
