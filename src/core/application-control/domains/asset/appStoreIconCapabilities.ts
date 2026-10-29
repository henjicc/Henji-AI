import { z } from 'zod'
import type { ApplicationCapabilityDefinition } from '../../applicationCapabilities'
import { appStoreIconCandidateSchema, saveAppStoreIconSchema, searchAppStoreIconsSchema } from '../../../appStoreIcons'
import { capabilityControl, capabilityOutputSchema, defineApplicationCapability } from '../shared/defineApplicationCapability'

const assetRef = z.object({ kind: z.literal('asset'), id: z.string().min(1) }).strict()

export const APP_STORE_ICON_CAPABILITIES: ApplicationCapabilityDefinition[] = [
  defineApplicationCapability({
    id: 'search_app_store_icons', version: 1, title: '搜索 App Store 高清图标',
    description: '联网查询苹果 App Store 应用。query 可为中文名称、App Store 链接或编号（可带 id 前缀）；链接中的地区优先。返回候选编号、名称、开发者、平台与类别，确认应用后用 save_app_store_icon 保存。',
    domain: 'assets', aliases: ['苹果应用图标', '应用商店图标', 'App Store', '高清图标', 'search app icons'],
    readOnly: true, dataClasses: ['C0'], idempotent: true, destructive: false,
    timeoutMs: 30_000, supportsPreview: false, supportsUndo: false, requiredScopes: [],
    inputSchema: searchAppStoreIconsSchema,
    outputSchema: capabilityOutputSchema({ country: z.string(), candidates: z.array(appStoreIconCandidateSchema).min(1).max(25) }),
    control: capabilityControl('observe', ['asset']), concurrencyKey: 'app_store_search',
    successEvidence: ['苹果 Search API 返回符合目标平台且有高清图标的应用。'],
    failureRecovery: ['没有候选时换地区、换平台或粘贴 App Store 链接；网络失败时按返回的 HTTP 状态或超时事实重试。'],
    summarize: output => `找到 ${output.candidates.length} 个应用图标候选。`,
  }),
  defineApplicationCapability({
    id: 'save_app_store_icon', version: 1, title: '保存 App Store 高清图标',
    description: '按应用编号联网获取高清 PNG 并登记为项目素材。默认保存 1024 像素官方透明圆角图标；square 为方形原图。存到项目素材的图标分类，同名加序号。projectId 省略时使用当前文档所在项目；没有当前项目需先 list_projects。返回 assetRef，可继续用 import_video_edit_asset 引入剪辑；不切换页面。',
    domain: 'assets', aliases: ['下载应用图标', '保存苹果图标', '透明圆角图标', 'save app icon'],
    readOnly: false, dataClasses: ['C1'], idempotent: false, destructive: false,
    timeoutMs: 90_000, supportsPreview: false, supportsUndo: false, requiredScopes: ['assets'],
    acceptsRefs: ['documents.project'], producesRefs: ['asset'], inputSchema: saveAppStoreIconSchema,
    outputSchema: capabilityOutputSchema({ assetRef, projectId: z.string(), name: z.string(), width: z.number().int(), height: z.number().int(), transparentCorners: z.boolean(),
      verification: z.object({ verified: z.literal(true), condition: z.string() }) }),
    control: capabilityControl('create', ['asset'], { revisionScopes: ['assets'] }),
    concurrencyKey: 'app_store_save',
    resolveOperationTargets: input => input.projectId ? [{ kind: 'documents.project', id: input.projectId }] : [],
    resolveOperationWriteTargets: (_input, operationId) => [{ kind: 'asset', id: `pending:${operationId}` }],
    resolveObservedEffects: (_input, output) => [{ effect: 'create', entityTypes: ['asset'], propertyIds: [], targetRefs: [output.assetRef], count: 1,
      verified: output.verification.verified, evidence: [output.verification.condition] }],
    successEvidence: ['从落盘文件解码确认 PNG、请求尺寸、官方版透明角，并回读素材库记录。'],
    failureRecovery: ['写入失败且已清理时可以修正项目或网络后重试；结果未知时先查原操作。已保存的图标可通过素材库删除记录，文件保留在项目中。'],
    summarize: output => `已保存“${output.name}”${output.width}×${output.height} PNG 图标并登记为素材。`,
  }),
]
