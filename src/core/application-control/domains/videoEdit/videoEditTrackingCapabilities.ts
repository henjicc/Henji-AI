import { z } from 'zod'
import { VIDEO_EDIT_MAX_SEQUENCE_FRAMES } from '../../../videoEdit/time'
import { VIDEO_EDIT_STABILIZATION_SMOOTHNESS } from '../../../videoEdit/stabilization'
import { applicationRefSchema } from '../../applicationCapabilities'
import { capabilityControl, defineApplicationCapability } from '../shared/defineApplicationCapability'

/*
 * 跟踪与防抖的算法能力（对标 AE 跟踪器、PR 变形稳定器）：都要读后台结果或录制事件再换算，不能用属性写入表达。
 * 参数调整（防抖程度、裁切、跟随取消等）走通用属性 video_edit.clip.stabilization / video_edit.clip.follow。
 */

const documentRef = applicationRefSchema.extend({ kind: z.literal('video_edit.document') }).strict()
const clipRef = applicationRefSchema.extend({ kind: z.literal('video_edit.clip') }).strict()
const trackerRef = applicationRefSchema.extend({ kind: z.literal('video_edit.tracker') }).strict()
const frame = z.number().int().nonnegative().max(VIDEO_EDIT_MAX_SEQUENCE_FRAMES)
const verification = z.object({ verified: z.boolean(), target: applicationRefSchema, condition: z.string() }).strict()
const common = {
  version: 1, domain: 'video_edit', readOnly: false, dataClasses: ['C1' as const], permission: 'video_edit:write', idempotent: false, destructive: false,
  supportsPreview: false, supportsUndo: true, requiredScopes: ['video_edit'],
}
const receipt = (result: { resultRef: z.infer<typeof applicationRefSchema>; verification: z.infer<typeof verification> }, entityType: string) => [{ effect: 'execute' as const, propertyIds: [], verified: result.verification.verified, evidence: result.verification.verified ? [result.verification.condition] : [], entityTypes: [entityType], targetRefs: [result.resultRef], count: 1 }]

export const followVideoEditTrackerCapability = defineApplicationCapability({
  ...common, id: 'follow_video_edit_tracker', title: '让片段跟随跟踪器',
  description: '让文字、图片、视频、图形或嵌套片段（clipRef）跟着同序列另一片段上的跟踪器（trackerRef）走，对标 AE 跟踪器的“编辑目标 + 应用”。在 frame（序列帧，省略为跟随片段的第一帧）建立绑定：元素停在当前位置，之后随跟踪移动。follow.rotation 跟随旋转（两点及以上的点跟踪、平面跟踪），follow.scale 跟随缩放（不能用一点跟踪），都省略只跟位置；follow.cornerPin 把图片/视频/嵌套片段四角贴到平面或四点跟踪上（透视）。apply=live（默认）保持跟踪驱动，重算或纠错后自动更新；apply=keyframes 把每帧位置、缩放、旋转写成线性关键帧并去掉绑定（AE 的“应用”，角点贴合不支持）。录屏片段的光标、窗口跟踪器同样可用（先 track_video_edit_recording）。等跟踪覆盖后执行，一步撤销；取消跟随写 video_edit.clip.follow=null。',
  aliases: ['跟随跟踪', '贴到跟踪点', '跟着鼠标', '跟踪应用到变换', '应用跟踪为关键帧', 'attach to tracker'], timeoutMs: 600000,
  acceptsRefs: ['video_edit.document', 'video_edit.clip', 'video_edit.tracker'], producesRefs: ['video_edit.clip'],
  inputSchema: z.object({
    documentRef, clipRef: clipRef.describe('要跟随的片段（文字、图片、视频、图形或嵌套片段）。'), trackerRef: trackerRef.describe('同序列另一片段上的跟踪器，取自 video_edit.tracker。'),
    follow: z.object({ rotation: z.boolean().optional(), scale: z.boolean().optional(), cornerPin: z.boolean().optional() }).strict().optional().describe('要跟随的分量；省略只跟位置。'),
    frame: frame.optional().describe('建立绑定的序列帧，元素在这一帧保持原位；省略为跟随片段第一帧。'),
    apply: z.enum(['live', 'keyframes']).optional().describe('live 跟踪驱动（默认）；keyframes 写成位置、缩放、旋转关键帧。'),
  }).strict(),
  outputSchema: z.object({ resultRef: clipRef, follow: z.record(z.string(), z.unknown()).nullable(), keyframes: z.object({ x: z.number().int(), y: z.number().int(), scale: z.number().int(), rotation: z.number().int() }).strict().optional(), message: z.string(), verification }).strict(),
  resolveConcurrencyKey: input => `video_edit:${input.documentRef.id}`,
  resolveOperationTargets: input => [input.documentRef, input.clipRef, input.trackerRef], resolveOperationWriteTargets: input => [input.documentRef],
  control: capabilityControl('execute', ['video_edit.clip'], { revisionScopes: ['video_edit'] }),
  verificationContract: { kind: 'effect_receipt', requireEffects: true, requireVerifiedEffects: true },
  resolveObservedEffects: (_input, result) => receipt(result, 'video_edit.clip'),
  summarize: result => result.message,
})

export const stabilizeVideoEditClipCapability = defineApplicationCapability({
  ...common, id: 'stabilize_video_edit_clip', title: '视频防抖',
  description: '对视频或嵌套序列片段防抖（对标 PR 变形稳定器的“平滑运动 / 无运动”）：后台估计相机运动（背景特征点 + RANSAC，跳过前景运动物体，按素材内容缓存），按 L1 最优相机路径平滑，反向补偿并统一放大到不露黑边；渲染时实时修正，不重新编码素材，与片段自身的位置、缩放、旋转、关键帧和跟随叠加。smoothness：subtle 轻微（只去抖，保留运镜）、natural 自然（默认，平滑运动）、locked 锁定（无运动）；maxCrop 允许的最大裁切比例（默认 0.1）；rotation、scale 是否校正旋转与缩放（默认都校正）。等分析完成并返回实际裁切比例，一步撤销；之后改参数走通用属性 video_edit.clip.stabilization，关闭写 null。',
  aliases: ['防抖', '稳定画面', '变形稳定器', '去抖动', 'warp stabilizer', 'stabilize'], timeoutMs: 600000,
  acceptsRefs: ['video_edit.document', 'video_edit.clip'], producesRefs: ['video_edit.clip'],
  inputSchema: z.object({
    documentRef, clipRef: clipRef.describe('视频或嵌套序列片段。'),
    smoothness: z.enum(VIDEO_EDIT_STABILIZATION_SMOOTHNESS).optional().describe('subtle 轻微、natural 自然（默认）、locked 锁定无运动。'),
    maxCrop: z.number().finite().min(0.02).max(0.5).optional().describe('允许的最大裁切比例，默认 0.1（边长裁掉 10% 以内）。'),
    rotation: z.boolean().optional().describe('是否校正旋转，默认 true。'), scale: z.boolean().optional().describe('是否校正缩放（推拉抖动），默认 true。'),
  }).strict(),
  outputSchema: z.object({ resultRef: clipRef, stabilization: z.object({ smoothness: z.enum(VIDEO_EDIT_STABILIZATION_SMOOTHNESS), maxCrop: z.number(), rotation: z.boolean(), scale: z.boolean() }).strict(), crop: z.number().min(0).max(1), analyzedFrames: z.number().int().nonnegative(), message: z.string(), verification }).strict(),
  resolveConcurrencyKey: input => `video_edit:${input.documentRef.id}`,
  resolveOperationTargets: input => [input.documentRef, input.clipRef], resolveOperationWriteTargets: input => [input.documentRef],
  control: capabilityControl('execute', ['video_edit.clip'], { revisionScopes: ['video_edit'] }),
  verificationContract: { kind: 'effect_receipt', requireEffects: true, requireVerifiedEffects: true },
  resolveObservedEffects: (_input, result) => receipt(result, 'video_edit.clip'),
  summarize: result => result.message,
})

export const trackVideoEditRecordingCapability = defineApplicationCapability({
  ...common, id: 'track_video_edit_recording', title: '录屏光标与窗口跟踪',
  description: '在录屏导入的屏幕片段上建立跟踪器，结果直接由录制时的光标与前台窗口事件换算（精确、零计算，不做视觉跟踪）。target=cursor 跟踪鼠标光标（size 为光标周围区域边长，占画面高度，默认 0.06）；target=window 跟踪 frame 那一刻的前台窗口，region 为窗口里的一块区域 [x,y,宽,高]（片段画面归一化，省略为整个窗口），随窗口移动、缩放。frame 为序列帧，省略为当前播放头（夹在片段内）。之后像普通跟踪器一样用：follow_video_edit_tracker 让标注跟着鼠标；效果作用区域 mask {regionId:tracker,trackerId} 给窗口区域打码、模糊或放大。一步撤销。',
  aliases: ['跟着鼠标', '跟踪光标', '跟踪窗口', '窗口打码', 'cursor tracking'], timeoutMs: 60000,
  acceptsRefs: ['video_edit.document', 'video_edit.clip'], producesRefs: ['video_edit.tracker'],
  inputSchema: z.object({
    documentRef, clipRef: clipRef.describe('带录制事件的屏幕视频片段。'),
    target: z.enum(['cursor', 'window']).describe('cursor 鼠标光标；window 前台窗口。'),
    frame: frame.optional().describe('建立跟踪的序列帧；省略为当前播放头。'),
    region: z.tuple([z.number().min(0).max(1), z.number().min(0).max(1), z.number().min(0.002).max(1), z.number().min(0.002).max(1)]).optional().describe('window：窗口里要跟的区域 [x,y,宽,高]（片段画面归一化）；省略为整个窗口。'),
    size: z.number().min(0.01).max(0.3).optional().describe('cursor：光标周围区域边长（占画面高度），默认 0.06。'),
    name: z.string().trim().min(1).max(60).optional(),
  }).strict().superRefine((input, context) => {
    if (input.target === 'cursor' && input.region) context.addIssue({ code: 'custom', path: ['region'], message: 'region 只用于 window；光标区域大小用 size。' })
    if (input.target === 'window' && input.size !== undefined) context.addIssue({ code: 'custom', path: ['size'], message: 'size 只用于 cursor；窗口里的区域用 region。' })
  }),
  outputSchema: z.object({ resultRef: trackerRef, clipRef, message: z.string(), verification }).strict(),
  resolveConcurrencyKey: input => `video_edit:${input.documentRef.id}`,
  resolveOperationTargets: input => [input.documentRef, input.clipRef], resolveOperationWriteTargets: input => [input.documentRef],
  control: capabilityControl('create', ['video_edit.tracker'], { revisionScopes: ['video_edit'] }),
  verificationContract: { kind: 'effect_receipt', requireEffects: true, requireVerifiedEffects: true },
  resolveObservedEffects: (_input, result) => [{ effect: 'create' as const, propertyIds: [], verified: result.verification.verified, evidence: result.verification.verified ? [result.verification.condition] : [], entityTypes: ['video_edit.tracker'], targetRefs: [result.resultRef], count: 1 }],
  summarize: result => result.message,
})

export const VIDEO_EDIT_TRACKING_CAPABILITIES = [followVideoEditTrackerCapability, stabilizeVideoEditClipCapability, trackVideoEditRecordingCapability]
