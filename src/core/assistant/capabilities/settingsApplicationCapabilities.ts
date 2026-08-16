import { z } from 'zod'

import { capabilityControl, defineApplicationCapability } from './defineApplicationCapability'

/*
 * 实体类型必须与反射注册表登记的**同一个名字**：settings.registry（见
 * src/features/settings/application-control/settingsReflection.ts 的 SETTINGS_ENTITY_TYPE）。
 *
 * 这里曾经写成 application.setting——同一样东西两个名字。后果不是命名不整齐那么轻：能力发现
 * 把这个名字投影进 scriptApi.entities.entityTypes，模型照着写 app.entities.list("application.setting")，
 * 撞 ENTITY_TYPE_NOT_FOUND；而真正存在的 settings.registry 因为没有任何能力声明它，读写配对
 * 保底也认不出来，一个写入能力都租不到。实测一次改设置的任务因此烧掉 18 回合、25 万 token。
 */
export const searchApplicationSettingsCapability = defineApplicationCapability({
  id: 'search_application_settings', version: 1, title: '搜索应用设置',
  description: '按用户语言搜索可读取或修改的应用设置，不返回密钥和原始本地路径。',
  domain: 'settings', aliases: ['设置', '偏好', '毛玻璃', '主题', '上传', '画布', 'settings'],
  side: 'frontend', readOnly: true,
  control: capabilityControl('observe', ['settings.registry']),
  risk: 'R0', dataClasses: ['C0'], permission: 'settings:read', idempotent: true,
  destructive: false, timeoutMs: 5_000, supportsPreview: false, supportsUndo: false,
  requiredScopes: ['settings'], prerequisites: ['应用设置注册中心已就绪。'],
  acceptsRefs: [], producesRefs: ['settings.registry'],
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
  control: capabilityControl('observe', ['settings.registry']),
  risk: 'R0', dataClasses: ['C1'], permission: 'settings:read', idempotent: true,
  destructive: false, timeoutMs: 5_000, supportsPreview: false, supportsUndo: false,
  requiredScopes: ['settings'], prerequisites: ['设置 ID 必须来自设置搜索结果。'],
  acceptsRefs: ['settings.registry'], producesRefs: ['settings.registry'],
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

export const SETTINGS_APPLICATION_CAPABILITIES = [
  searchApplicationSettingsCapability,
  getApplicationSettingsCapability,
]
