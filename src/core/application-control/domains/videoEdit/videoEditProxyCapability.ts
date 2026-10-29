import { z } from 'zod'
import { applicationRefSchema } from '../../applicationCapabilities'
import { capabilityControl, defineApplicationCapability } from '../shared/defineApplicationCapability'
import { videoProxyPresetSchema } from '../../../videoEdit/proxy'

const documentRef = applicationRefSchema.extend({ kind: z.literal('video_edit.document') }).strict()
const mediaRef = applicationRefSchema.extend({ kind: z.literal('video_edit.media') }).strict()
const input = z.object({ documentRef, mediaRef, preset: videoProxyPresetSchema.default('auto').describe('auto（默认）为原片的一半、短边最高 1080；720p/540p 只为兼容旧代理保留。') }).strict()
const output = z.object({ resultRef: mediaRef, preset: videoProxyPresetSchema, verified: z.boolean(), message: z.string() }).strict()
export const generateVideoEditProxyCapability = defineApplicationCapability({
  id: 'generate_video_edit_proxy', title: '生成视频素材的剪辑代理',
  description: '免费本地后台把视频素材转成低分辨率代理（默认原片的一半、短边最高 1080，H.264，优先显卡编码，关键帧间隔不超过半秒），支持取消。保留原片每帧时间戳与帧率，最多一百万帧；相同原片与预设复用已有代理。只写作品目录下的缓存，不改原素材或剪辑内容。状态从video_edit.media.proxy_state读取；随后通过通用video_edit.document.proxy_preference.enabled开启代理：节目只在播放和拖动播放头时用代理，停下后换回原片完整画质；取帧观察、声音、跟踪与智能区域分析始终用原片；导出默认用原片，可在 export_video_edit.settings.useProxies 显式选择已有代理画面。',
  version: 1, domain: 'video_edit', aliases: ['创建代理', '代理剪辑', 'create proxies'], readOnly: false, dataClasses: ['C1'],
  destructive: false, supportsPreview: false, supportsUndo: false, idempotent: true, timeoutMs: 600000, requiredScopes: ['video_edit'], acceptsRefs: ['video_edit.document', 'video_edit.media'], producesRefs: ['video_edit.media'],
  inputSchema: input, outputSchema: output,
  resolveConcurrencyKey: parsed => `video_edit_proxy:${parsed.mediaRef.id}`,
  resolveOperationTargets: parsed => [parsed.documentRef, parsed.mediaRef], resolveOperationWriteTargets: parsed => [parsed.documentRef, parsed.mediaRef],
  control: capabilityControl('execute', ['video_edit.media'], { propertyIds: ['video_edit.media.proxy_state'], revisionScopes: ['video_edit'], cancelable: true }),
  verificationContract: { kind: 'effect_receipt', requireEffects: true, requireVerifiedEffects: true },
  resolveObservedEffects: (_parsed, result) => [{ effect: 'execute', entityTypes: ['video_edit.media'], propertyIds: ['video_edit.media.proxy_state'], targetRefs: [result.resultRef], count: 1, verified: result.verified, evidence: result.verified ? ['已按原片内容身份与预设回读代理缓存并核对文件。'] : [] }],
  summarize: result => result.message,
})
