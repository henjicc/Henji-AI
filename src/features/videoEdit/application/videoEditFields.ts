import { videoEditTrackerSchema } from '@/core/videoEdit/tracking'
import { videoEditLabelSchema } from '@/core/videoEdit/labels'
import { videoEditTextStyleSchema } from '@/core/videoEdit/text'
import { z } from 'zod'
import { type ApplicationFieldDefinition, type JsonValue, type ApplicationSchemaRef } from '@/core/application-control'
import { APPLICATION_CAPABILITY_CATALOG_VERSION } from '@/core/application-control/applicationCapabilities'
import { videoEditAnnotationSchema, videoEditClipSchema, videoEditSequenceSchema, videoEditBinSchema, videoEditItemSchema, videoEditTrackSchema } from '@/core/videoEdit/document'
import { codeMaterialInstanceSchema, codeMaterialVersionSchema } from '@/core/videoEdit/codeMaterialPersistence'
import { codeMaterialCurvesSchema } from '@/core/videoEdit/codeMaterialAnimation'
import { videoEditTimelineViewSchema, videoEditProgramPlaybackSchema } from '@/core/videoEdit/timelineSelection'
import { videoEditPlaybackResolutionSchema } from '@/core/videoEdit/playbackResolution'
import { videoEditMarkerSchema, videoEditCaptionSchema } from '@/core/videoEdit/timedContent'
import { videoEditEffectSchema, videoEditBuiltinEffectInstanceSchema, videoEditEffectMaskSchema, videoEditAdjustmentSchema, VIDEO_EDIT_MAX_EFFECTS } from '@/core/videoEdit/compositing'
import { videoEditTransitionSchema } from '@/core/videoEdit/transitions'
import { VIDEO_EDIT_COMPOSITE_TYPES } from './videoEditCompositeEntities'
import { videoEditAudioLayoutSchema, videoEditAudioMappingSchema, videoEditAudioStreamsSchema } from '@/core/videoEdit/audioChannels'
import { VIDEO_EDIT_ANIMATABLE_KEYS, videoEditKeyframesSchema } from '@/core/videoEdit/keyframes'
import { VIDEO_EDIT_BUILTIN_EFFECTS_DEFINITIONS } from '@/core/videoEdit/builtinEffects'

export const VIDEO_EDIT_TYPES = ['video_edit.document', 'video_edit.clip', 'video_edit.annotation', 'video_edit.media', 'video_edit.sequence', 'video_edit.bin', 'video_edit.item', 'video_edit.track', 'video_edit.source', 'video_edit.code_material', 'video_edit.code_version', 'video_edit.marker', 'video_edit.caption', ...VIDEO_EDIT_COMPOSITE_TYPES, 'video_edit.builtin_effect'] as const
export type VideoEditEntityType = typeof VIDEO_EDIT_TYPES[number]
export type VideoEditFieldData = Record<string, JsonValue>
export function videoEditPropertyKey(key: string): string { return key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`) }
export function videoEditDataKey(key: string): string { return key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()) }
const text = z.string().max(2000)
export const VIDEO_EDIT_TIME_CASCADES = [
  { declarationId: 'video_edit.sequence_clip_time', effect: 'update', entityType: 'video_edit.clip', propertyIds: ['video_edit.clip.start', 'video_edit.clip.duration', ...VIDEO_EDIT_ANIMATABLE_KEYS.map(key => `video_edit.clip.${videoEditPropertyKey(key)}.keyframes`)], revisionScopes: ['video_edit'] },
  { declarationId: 'video_edit.sequence_annotation_time', effect: 'update', entityType: 'video_edit.annotation', propertyIds: ['video_edit.annotation.frame'], revisionScopes: ['video_edit'] },
  { declarationId: 'video_edit.sequence_marker_time', effect: 'update', entityType: 'video_edit.marker', propertyIds: ['video_edit.marker.frame'], revisionScopes: ['video_edit'] },
  { declarationId: 'video_edit.sequence_caption_time', effect: 'update', entityType: 'video_edit.caption', propertyIds: ['video_edit.caption.start', 'video_edit.caption.duration'], revisionScopes: ['video_edit'] },
] as const
export const VIDEO_EDIT_CLIP_KEYFRAME_TIME_CASCADE = { declarationId: 'video_edit.clip_keyframe_time', effect: 'update' as const, entityType: 'video_edit.clip', propertyIds: VIDEO_EDIT_ANIMATABLE_KEYS.map(key => `video_edit.clip.${videoEditPropertyKey(key)}.keyframes`), revisionScopes: ['video_edit'] }
export const VIDEO_EDIT_CLIP_CONTENT_CASCADES = (['create', 'update', 'delete'] as const).flatMap(effect => (['marker', 'caption'] as const).map(kind => ({ declarationId: `video_edit.clip_${kind}_${effect}`, effect, entityType: `video_edit.${kind}`, propertyIds: effect === 'update' ? kind === 'marker' ? ['video_edit.marker.frame', 'video_edit.marker.clip_id'] : ['video_edit.caption.start', 'video_edit.caption.duration', 'video_edit.caption.clip_id'] : [], revisionScopes: ['video_edit'] })))
const compositeUpdateKeys = { 'video_edit.tracker': ['name', 'method', 'prompts'], 'video_edit.graphic_object': ['name', 'parameters', 'curves'], 'video_edit.effect': ['name', 'enabled', 'amount', 'version_id', 'parameters', 'curves', 'mask', ...new Set(VIDEO_EDIT_BUILTIN_EFFECTS_DEFINITIONS.flatMap(definition => definition.params.map(param => `parameters.${videoEditPropertyKey(param.key)}.keyframes`)))], 'video_edit.transition': ['kind', 'duration_frames', 'alignment', 'frames_before_cut', 'parameters'] }
export const VIDEO_EDIT_COMPOSITE_CASCADES = (['create', 'update', 'delete'] as const).flatMap(effect => VIDEO_EDIT_COMPOSITE_TYPES.map(entityType => ({ declarationId: `${entityType}_${effect}`, effect, entityType, propertyIds: effect === 'update' ? compositeUpdateKeys[entityType].map(key => `${entityType}.${key}`) : [], revisionScopes: ['video_edit'] })))
export const VIDEO_EDIT_SOURCE_PROGRAM_CASCADE = { declarationId: 'video_edit.source_foreground_program_pause', effect: 'update' as const, entityType: 'video_edit.document', propertyIds: ['video_edit.document.program_playback'], revisionScopes: ['video_edit'] }
export const VIDEO_EDIT_PROGRAM_SOURCE_CASCADE = { declarationId: 'video_edit.program_foreground_source_pause', effect: 'update' as const, entityType: 'video_edit.source', propertyIds: ['video_edit.source.playing'], revisionScopes: ['video_edit'] }
const schemas: Record<VideoEditEntityType, Record<string, z.ZodType>> = {
  'video_edit.document': { name: z.string().min(1).max(200), frame: z.number().int().nonnegative(), selection: z.string(), activeSequenceId: z.string(), dirty: z.boolean(), selectedItemIds: z.array(z.string().min(1)).max(500), selectedBinId: z.string().max(100), openSequenceIds: z.array(z.string().min(1)).min(1).max(32) },
  // 速度（4.13）以 speed_percent 百分比公开（见下），不公开内部有理数。
  'video_edit.clip': Object.fromEntries(Object.entries(videoEditClipSchema.shape).filter(([key]) => !['id', 'sourceRemainder', 'speed', 'curves'].includes(key))),
  'video_edit.annotation': Object.fromEntries(Object.entries(videoEditAnnotationSchema.shape).filter(([key]) => key !== 'id' && key !== 'sourceRemainder')),
  'video_edit.sequence': Object.fromEntries(Object.entries(videoEditSequenceSchema.shape).filter(([key]) => !['id', 'clips', 'annotations', 'tracks', 'markers', 'captions'].includes(key))),
  'video_edit.marker': { ...Object.fromEntries(Object.entries(videoEditMarkerSchema.shape).filter(([key]) => key !== 'id')), clipId: z.string().max(100) },
  'video_edit.caption': { ...Object.fromEntries(Object.entries(videoEditCaptionSchema.shape).filter(([key]) => key !== 'id')), clipId: z.string().max(100) },
  'video_edit.bin': Object.fromEntries(Object.entries(videoEditBinSchema.shape).filter(([key]) => key !== 'id')),
  'video_edit.item': Object.fromEntries(Object.entries(videoEditItemSchema.shape).filter(([key]) => key !== 'id')),
  // index/kind are read-only: clips are placed by the integer track index, so agents must be able to read it.
  'video_edit.track': Object.fromEntries(Object.entries(videoEditTrackSchema.shape).filter(([key]) => key !== 'id')),
  'video_edit.media': { name: text, kind: z.enum(['video', 'image', 'audio']), durationSeconds: z.number(), width: z.number(), height: z.number() },
  'video_edit.source': { itemId: z.string().max(100), timeUs: z.number().int().nonnegative(), presentedTimeUs: z.number().int().nonnegative(), playing: z.boolean(), volume: z.number().min(0).max(1), inUs: z.number().int().nonnegative().nullable(), outUs: z.number().int().nonnegative().nullable(), playbackDirection: z.union([z.literal(1), z.literal(-1)]), status: z.enum(['closed', 'loading', 'ready', 'error']), error: text },
  'video_edit.code_material': { name: z.string().min(1).max(200), source: z.string().max(65536), defaultVersionId: z.string().min(1).max(100), versionIds: z.array(z.string()).max(64), binId: z.string().max(100) },
  'video_edit.code_version': { source: codeMaterialVersionSchema.shape.source, apiVersion: codeMaterialVersionSchema.shape.apiVersion, languageVersion: codeMaterialVersionSchema.shape.languageVersion, definitionId: z.string().min(1).max(100) },
  'video_edit.tracker': { name: videoEditTrackerSchema.shape.name, method: videoEditTrackerSchema.shape.method, prompts: videoEditTrackerSchema.shape.prompts, status: text, clipId: z.string().min(1).max(100), sequenceId: z.string().min(1).max(100) },
  'video_edit.graphic_object': { name: z.string().trim().min(1).max(200), kind: z.enum(['rect', 'ellipse', 'text']), clipId: z.string().min(1).max(100), sequenceId: z.string().min(1).max(100), parameters: codeMaterialInstanceSchema.shape.parameters, curves: codeMaterialCurvesSchema },
  'video_edit.effect': { name: videoEditEffectSchema.shape.name, enabled: videoEditEffectSchema.shape.enabled, amount: videoEditEffectSchema.shape.amount, definitionId: codeMaterialInstanceSchema.shape.definitionId, versionId: codeMaterialInstanceSchema.shape.versionId, parameters: codeMaterialInstanceSchema.shape.parameters, curves: codeMaterialCurvesSchema, clipId: z.string().min(1).max(100), sequenceId: z.string().min(1).max(100), mask: videoEditEffectMaskSchema.nullable(), regionStatus: text },
  'video_edit.transition': { ...Object.fromEntries(Object.entries(videoEditTransitionSchema.shape).filter(([key]) => key !== 'id')), sequenceId: z.string().min(1).max(100) },
  // 内置效果目录（4.7a，只读）：助手据此选效果、按参数语义取值，再用 video_edit.effect 加到片段上。
  'video_edit.builtin_effect': { name: text, group: text, description: text, params: z.array(z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]))).max(Math.max(16, ...VIDEO_EDIT_BUILTIN_EFFECTS_DEFINITIONS.map(definition => definition.params.length))) },
}
schemas['video_edit.clip'].codeParameters = codeMaterialInstanceSchema.shape.parameters
for (const key of VIDEO_EDIT_ANIMATABLE_KEYS) schemas['video_edit.clip'][`${key}.keyframes`] = videoEditKeyframesSchema
for (const key of new Set(VIDEO_EDIT_BUILTIN_EFFECTS_DEFINITIONS.flatMap(definition => definition.params.map(param => param.key)))) schemas['video_edit.effect'][`parameters.${key}.keyframes`] = videoEditKeyframesSchema
for (const key of ['anchorX', 'anchorY'] as const) schemas['video_edit.clip'][key] = videoEditClipSchema.shape[key].unwrap()
schemas['video_edit.clip'].textStyle = videoEditTextStyleSchema.nullable()
schemas['video_edit.clip'].graphic = videoEditClipSchema.shape.graphic.nullable()
schemas['video_edit.clip'].adjustment = videoEditClipSchema.shape.adjustment.nullable()
schemas['video_edit.item'].graphic = videoEditItemSchema.shape.graphic.nullable()
// 颜色标签：读出 null 表示按类型默认，写 null 恢复默认（3.2）。
for (const type of ['video_edit.item', 'video_edit.bin', 'video_edit.sequence'] as const) schemas[type].label = videoEditLabelSchema.nullable()
schemas['video_edit.clip'].graphicObjectIds = z.array(z.string().min(1).max(100)).max(32)
schemas['video_edit.clip'].effectIds = z.array(z.string().min(1).max(100)).max(VIDEO_EDIT_MAX_EFFECTS)
schemas['video_edit.clip'].adjustmentFromTrack = videoEditAdjustmentSchema.shape.fromTrack.nullable()
schemas['video_edit.item'].graphicKind = z.enum(['solid', 'rect', 'ellipse', 'text']).nullable()
schemas['video_edit.item'].graphicWidth = z.number().int().min(16).max(8192).nullable()
schemas['video_edit.item'].graphicHeight = z.number().int().min(16).max(8192).nullable()
schemas['video_edit.effect'].parameters = codeMaterialInstanceSchema.shape.parameters.or(videoEditBuiltinEffectInstanceSchema.shape.params.refine(value => Object.keys(value).length <= 128, '内置效果参数最多128个。'))
schemas['video_edit.document'].lumetriLuts = z.array(z.object({ id: z.string(), name: z.string() }).strict()).max(200)
schemas['video_edit.document'].timelineView = videoEditTimelineViewSchema
schemas['video_edit.document'].programPlayback = videoEditProgramPlaybackSchema
// 回放分辨率（4.9）：节目监视器的视图偏好，按剪辑记在本机，不进剪辑文件与撤销栈。
schemas['video_edit.document'].playbackResolution = videoEditPlaybackResolutionSchema
schemas['video_edit.clip'].codeCurves = codeMaterialCurvesSchema
schemas['video_edit.clip'].codeVersionId = z.string().min(1).max(100)
schemas['video_edit.clip'].linkId = z.string().max(100)
schemas['video_edit.clip'].groupId = z.string().max(100)
schemas['video_edit.clip'].sourceComponent = z.enum(['all', 'video', 'audio'])
schemas['video_edit.media'].assetId = z.string().max(100).optional()
schemas['video_edit.media'].hasAudio = z.boolean().nullable()
schemas['video_edit.clip'].creativeSource = videoEditClipSchema.shape.creativeSource.unwrap().nullable()
// 可切回的镜头版本（4.12）：由“替换镜头”记下、restore_video_edit_clip_take 切换，只读
schemas['video_edit.clip'].trackers = videoEditClipSchema.shape.trackers.unwrap().nullable()
schemas['video_edit.clip'].follow = videoEditClipSchema.shape.follow.unwrap().nullable()
schemas['video_edit.clip'].takes = videoEditClipSchema.shape.takes.unwrap().nullable()
schemas['video_edit.media'].frameRate = z.object({ numerator: z.number().int().positive(), denominator: z.number().int().positive() }).nullable()
schemas['video_edit.media'].frameRateMode = z.enum(['sampled-constant', 'variable', 'unknown'])
// Audio channels (task 2.6): null reads as "file default" (Use File / the first stream) and writing null restores it.
schemas['video_edit.media'].audioStreams = videoEditAudioStreamsSchema.nullable()
schemas['video_edit.item'].audioChannels = videoEditAudioLayoutSchema.nullable()
schemas['video_edit.clip'].audioMapping = videoEditAudioMappingSchema.nullable()
// 淡化手柄（4.3）：没有淡化时读出 0，写 0 去掉。
schemas['video_edit.clip'].fadeInFrames = z.number().int().min(0).max(108_000)
schemas['video_edit.clip'].fadeOutFrames = z.number().int().min(0).max(108_000)
// 片段速度（4.13）：百分比（100 原速），写入时时长按速度换算；倒放与保持音调为开关。
schemas['video_edit.clip'].speedPercent = z.number().min(1, '速度须在 1 到 10000（%）之间。').max(10000, '速度须在 1 到 10000（%）之间。')
schemas['video_edit.clip'].reverse = z.boolean()
schemas['video_edit.clip'].preservePitch = z.boolean()
for (const type of ['video_edit.bin', 'video_edit.item', 'video_edit.sequence'] as const) schemas[type][type === 'video_edit.bin' ? 'parentId' : 'binId'] = z.string().max(100)
export function videoEditSchemaRef(kind: 'entity' | 'property', id: string): ApplicationSchemaRef {
  const hash = [...id].reduce((result, char) => (result * 33 + char.charCodeAt(0)) >>> 0, 5381).toString(16)
  return { catalogVersion: APPLICATION_CAPABILITY_CATALOG_VERSION, kind, id, version: 1, digest: `sha256:${hash.repeat(64).slice(0, 64)}` }
}
const labels: Record<string, string> = { name: '名称', selectedItemIds: '所选素材项', selectedBinId: '当前素材箱', openSequenceIds: '打开的序列', tags: '标签', assetId: '资产来源', frameRateMode: '源帧率状态', timeUs: '源定位微秒', presentedTimeUs: '实际画面微秒', playing: '源播放', status: '源预览状态', error: '预览失败原因', frame: '当前帧', selection: '所选片段', width: '宽度', height: '高度', fps: '序列帧率', dirty: '尚未保存', activeSequenceId: '当前序列', frameRate: '帧率', pixelAspectRatio: '像素长宽比', sampleRate: '音频采样率', channels: '声道数量', parentId: '父素材箱', binId: '素材箱', itemId: '素材项', enabled: '输出启用', locked: '锁定', muted: '静音', solo: '独奏', mediaId: '源素材标识', kind: '类型', track: '轨道', start: '时间线开始帧', duration: '时长帧', sourceInUs: '源素材入点微秒', x: '水平位置', y: '垂直位置', scale: '缩放', rotation: '旋转角度', opacity: '不透明度', volume: '音量', brightness: '亮度', text: '文字', clipId: '所属片段标识', space: '坐标空间', durationSeconds: '源时长秒', index: '轨道号' }
Object.assign(labels, { codeParameters: '代码实例参数', codeCurves: '参数关键帧', codeVersionId: '固定源码版本', linkId: '片段链接', groupId: '片段编组', sourceComponent: '使用画面或声音', syncLocked: '同步波纹编辑', hasAudio: '已检测到音轨', timelineView: '时间线选区、工具、链接选择与范围', programPlayback: '节目播放控制', playbackResolution: '节目回放分辨率', inUs: '源入点微秒', outUs: '源出点微秒', playbackDirection: '播放方向（反向静音）' })
Object.assign(labels, { audioStreams: '源声音流（文件顺序，每条的声道数与采样率）', audioChannels: '放入序列时的音频声道（每项一个音频片段：单声道或立体声及其源声道；空为按文件）', audioMapping: '声道映射（单声道或立体声及其源声音流与声道；空为第一条声音流原声道）' })
Object.assign(labels, { label: '颜色标签（空为按类型默认）', graphic: '图形对象结构', effects: '效果链', adjustment: '调整图层范围', transitions: '序列转场' })
Object.assign(labels, { lumetriLuts: '项目 LUT', graphicObjectIds: '图形对象顺序（从下到上）', effectIds: '效果执行顺序', adjustmentFromTrack: '调整起始轨道', graphicKind: '创建图形类型', graphicWidth: '图形宽度', graphicHeight: '图形高度', parameters: '实例参数', curves: '参数关键帧', versionId: '固定源码版本', definitionId: '滤镜源码定义', sequenceId: '所属序列', leftClipId: '左侧片段', rightClipId: '右侧片段', durationFrames: '转场时长帧' })
Object.assign(labels, { alignment: '过渡对齐（center 中心切点、start 起点切点即整段在切点后、end 终点切点即整段在切点前、custom 自定义起点）', framesBeforeCut: '过渡在切点之前的帧数（对齐为 custom 时生效）', fadeInFrames: '淡入帧数（0 为不淡入；画面从透明渐显，声音按恒定功率渐强）', fadeOutFrames: '淡出帧数（0 为不淡出）' })
Object.assign(labels, { group: '分组', description: '作用与适用场景', params: '参数（键、类型、范围、单位、默认值与取值含义）', mask: '作用区域', regionStatus: '作用区域分析状态' })
Object.assign(labels, { speedPercent: '速度百分比', reverse: '倒放', preservePitch: '变速时保持音调' })
Object.assign(labels, { takes: '可切回的镜头版本（替换镜头后记下的原素材，新的在前；用 restore_video_edit_clip_take 切回）' })
/** 个别属性的说明比通用模板更具体（助手据此取值）。 */
labels.textStyle = '文字样式'
Object.assign(labels, { translation: '第二语言字幕', style: '字幕样式' })
const descriptions: Record<string, string> = {
  'video_edit.caption.translation': '第二语言字幕；原文保持在 text，译文显示在原文下方，并进入字幕文件导出与烧录。空字符串清除；自动生成用 translate_video_edit_subtitles（可能计费，须审批）。',
  'video_edit.caption.style': '字幕整体样式：fontFamily（sans-serif/serif/monospace）、fontSize（1080p参考字号12–200）、outline 描边、background 底框、bottomMargin 底部安全区比例0.05–0.4。空字符串恢复默认样式。可从 video_edit.subtitle_preset.style 读取模板，在同一通用事务中批量应用，一步撤销。原文与译文合计最多三行。',
  'video_edit.clip.text_style': '文字片段样式；null 保留旧片段默认外观。对象含 fontFamily（系统字体名）、fontSize（序列像素，1–512）、color/strokeColor/shadowColor/backgroundColor（六位十六进制颜色）、align（left/center/right）、anchor（top 顶边，middle 首行中心）、strokeWidth（0–20 像素，0 无描边）、shadow、shadowBlur（0–50 像素）、background、boxWidth（序列宽度比例，0 为点文字，0–1 为固定宽度换行）。整体替换，先读后改。样式在运动缩放前生效，位置使用片段 x/y：序列画面归一化，0 表示序列中心，左上为 -.5/-.5；运动锚点 anchor_x/anchor_y 默认 .5/.5 时，anchor 为 top 时文字第一行顶边在此锚点，为 middle 时首行中心在此锚点，对齐决定文字向左/右展开；scale 与 rotation 复用运动属性。',
  'video_edit.clip.x': '片段运动锚点相对序列中心的水平位移，以序列宽度归一化；0 居中，-.5 左缘，.5 右缘。文字片段的样式锚点也使用此运动位置。',
  'video_edit.clip.y': '片段运动锚点相对序列中心的垂直位移，以序列高度归一化；0 居中，-.5 上缘，.5 下缘。文字片段的样式锚点也使用此运动位置。',
  'video_edit.tracker.method': 'shape 形状跟踪（点选或框选遮罩），box 物体框跟踪（box），point 点跟踪（1–4 个正向 points，各提示点数与顺序一致），planar 平面跟踪（quad 四角按左上、右上、右下、左下顺序）；只用于视频图片片段。新建与纠错后自动向两边跟满片段。',
  'video_edit.tracker.prompts': '1–16 个提示：timeUs 素材绝对时间微秒；points 为 [[x,y,1选中或0排除]]，box 为 [x,y,宽,高]，坐标相对片段原画面归一化 0–1；至少有点或框，同一时间只有一个提示。仅 shape 单点可写 candidate 1–3 选择候选；point 可写 window:{feature,search}（画面高度比例，默认 0.04/0.2，搜索框不小于特征框）；planar 写 quad:[[x,y],…] 四角，不混用点与框；整体替换，纠错请保留其他时间的提示。写入自动重跟；status 读进度，导出自动等待。',
  'video_edit.tracker.status': '只读：idle；tracking:<百分比>；ready:<覆盖率>；stopped:<覆盖率>；failed:<用户可处理的原因>。由跟踪定义驱动的后台长任务维护。',
  'video_edit.clip.trackers': '只读聚合；请在片段下通过 video_edit.tracker 增删与修改跟踪器，每片段最多 8 个。',
  'video_edit.clip.follow': '片段跟随：null 取消；{clipId,trackerId,offsetX,offsetY,scaleReference?,mode?} 引用同序列视频图片上的跟踪器。位置为跟踪框中心加偏移（序列宽高比例）；scaleReference 是建立绑定时跟踪框大小（序列中几何平均边长除以序列高度），省略只跟位置。mode:corner_pin 将本图片/视频四角贴到 planar 跟踪平面上，偏移与缩放参考忽略（offsetX/offsetY 写 0）；省略 mode 或 position 为普通跟随。禁止自跟随与循环；缺结果时保持原位，导出自动等待。',
  'video_edit.clip.speed_percent': '片段速度百分比，1–10000，100 为原速（只有视频、音频与代码素材片段可改）。改速度时开头的内容不动，时长按速度换算（200% 时长减半）；变长时后面有片段则只用到空白为止。要按实际时长原子波纹调整后续片段，请用 ripple_video_edit_clip_speed；普通属性写入的链接音画请两段都写。',
  'video_edit.clip.reverse': '倒放：用到的源内容不变，播放方向反过来（画面与声音都倒放）。',
  'video_edit.clip.preserve_pitch': '变速时保持音调（时间伸缩，速度不是 100% 时生效）；关闭时声音随速度变高或变低。',
  'video_edit.effect.definition_id': '效果来源，创建后不可改：内置效果写 effect:<ID>（画面效果如 effect:gaussian_blur 只能加到画面片段；音频效果如 effect:noise_reduction、effect:parametric_eq 只能加到声音片段；全部内置效果、适用片段及参数语义见 video_edit.builtin_effect），代码滤镜写滤镜源码定义 ID（只用于画面片段）。',
  'video_edit.document.lumetri_luts': '项目已导入LUT的id与名称，只读；在效果parameters的input_lut/look_lut写该id，强度为0–100。',
  'video_edit.effect.parameters': '效果参数。内置效果：键与范围见 video_edit.builtin_effect 的 params（强度多为 0–100，空间量按画面高度比例，与分辨率无关）；写入是整体替换：只存写入的键，没写的键按默认值（只改一项时先读出再整体写回）；越界或未知键会报错并列出可用范围。代码滤镜：按固定源码版本声明校验。',
  'video_edit.effect.amount': '效果与原画面（音频效果为原声）的混合比例 0–1：1 完全应用，0.5 一半强度；停用效果请写 enabled。',
  'video_edit.effect.version_id': '代码滤镜的固定源码版本；内置效果为空字符串且不可写。',
  'video_edit.effect.mask': '作用区域仅用于内置画面效果，null 为整个画面。智能区域 {regionId:face|person|background|text,feather?,expand?,invert?} 分别为人脸、人物、背景、文字；只用于视频图片，写入后后台自动分析（首次下载本地模型），region_status 读进度；未完成时预览不显示效果，导出等待。feather 0–100、expand -100–100，100 为画面高度的 10%；区域默认羽化/扩展：人脸 20/30，人物与背景 10/0，文字 10/15。手绘 {regionId:shapes,shapes:[{id,kind,box?,points?,mode?,feather?,expand?,opacity?,invert?,follow?}]} 用于任何画面片段；1–8 个形状，id 不重复；kind 为 rect/ellipse/path，矩形椭圆写 box:[x,y,宽,高]，钢笔写 points:[[x,y,入柄dx,dy,出柄dx,dy],…]（3–64 顶点，柄全零为尖角）。mode add/subtract/intersect 顺序相加/相减/交叉，默认 add；首项 subtract 从整画面挖掉。形状默认 feather 5、expand 0、opacity 100（0–100）。坐标相对片段原画面归一化，随片段几何变换。跟踪区域 {regionId:tracker,trackerId,feather?,expand?,invert?}：trackerId 从本片段 clip.trackers 读原始 id；手绘形状 follow:{trackerId,reference:[x,y,宽,高]} 用绑定帧跟踪框。两者复用后台结果，导出等待。',
  'video_edit.effect.region_status': '作用区域的分析状态（只读）：空字符串为没有作用区域；ready 已就绪；analyzing:<百分比> 后台分析中；failed:<原因> 分析失败（原因是给用户看的说明）。同一素材区域由多个效果共享分析，清空再写回 mask 不保证重试；直接重新分析目前由效果控件的“重试”触发。',
  'video_edit.effect.curves': '代码滤镜的参数关键帧（源时间微秒）；内置效果使用 parameters.<参数名>.keyframes（片段内整数帧），这里保持空对象。',
  'video_edit.transition.kind': '过渡种类，可改成同一媒介的其他种类（改种类时没写的参数回到新种类的默认值）。视频：cross_dissolve 交叉溶解、dip_to_black 黑场、dip_to_white 白场、wipe 擦除、push 推动、slide 滑动、cross_zoom 缩放过渡、blur_dissolve 模糊过渡、flash 闪光、iris_round 圆形划像；音频：constant_power 恒定功率、constant_gain 恒定增益、exponential_fade 指数淡化。每种的用途与参数见 video_edit.builtin_effect 里的 transition:<种类>。',
  'video_edit.transition.parameters': '带参数过渡（wipe、push、slide、cross_zoom、blur_dissolve、flash、iris_round）的参数，键与范围见 video_edit.builtin_effect 的 transition:<种类> 的 params（方向用选项值，羽化、边框等按画面高度比例，与分辨率无关）。写入是整体替换：只存写入的键，没写的键按默认值（只改一项时先读出再整体写回）；空对象表示全部默认；越界或未知键会报错并列出可用范围。其余种类没有参数，保持空对象。',
  'video_edit.document.playback_resolution': '节目监视器的回放分辨率（只影响看片时的流畅度与清晰度，不改剪辑内容，不进剪辑历史）。resolution：full 完整、half 1/2、quarter 1/4、eighth 1/8（按序列宽高各缩小到该比例渲染，素材多、效果重、播放卡顿时调低）。fullWhenPaused：true 暂停时自动回到完整分辨率（默认，便于看清细节），false 暂停时也用所选分辨率。导出、选帧加入资产库、设为项目封面始终按完整分辨率，与此无关。按剪辑记住。',
  'video_edit.clip.effect_ids': `效果执行顺序（从上到下依次处理画面；声音片段上是音频效果，依次处理声音），一个片段最多 ${VIDEO_EDIT_MAX_EFFECTS} 项。`,
  'video_edit.transition.left_clip_id': '过渡左侧（前一段）的片段 ID，创建后不可改。两个片段在同一轨道首尾相接时两端都写；只写 left_clip_id 是挂在该片段出点的单侧过渡（后面是空白，淡出）。视频过渡挂画面片段，音频过渡挂声音片段。',
  'video_edit.transition.right_clip_id': '过渡右侧（后一段）的片段 ID，创建后不可改。只写 right_clip_id 是挂在该片段入点的单侧过渡（前面是空白，淡入）。两端都不写会被拒绝；写错时错误信息会列出该序列可放这种过渡的编辑点。',
}
const codeKeys: Record<string, string> = { codeParameters: 'parameters', codeCurves: 'curves', codeVersionId: 'versionId' }
/** 剪辑名就是剪辑文件的文件名（3.1）：改名走通用文档属性。 */
export const VIDEO_EDIT_PROJECT_NAME_READ_ONLY = '剪辑名就是剪辑文件名，请改 documents.document 的 name（文档 ID 与本剪辑相同）；剪辑内容能力不改名。'
/** 内置效果目录的只读原因（属性与实体共用）：指向真正能加效果的写入路径。 */
export const VIDEO_EDIT_BUILTIN_CATALOG_READ_ONLY = '内置效果与过渡目录由应用登记、随版本更新，只读；给片段加效果请在片段下创建 video_edit.effect，definition_id 写这里的 ID（effect:<ID>），parameters 按 params 取值；加过渡请在序列下创建 video_edit.transition，kind 写 transition:<种类> 里的种类名，parameters 按 params 取值。'
export const VIDEO_EDIT_CONTROLLED_AGGREGATES = ['code', 'graphic', 'effects', 'adjustment', 'transitions', 'creativeSource', 'takes', 'trackers'] as const
export const VIDEO_EDIT_FIELDS = Object.fromEntries(VIDEO_EDIT_TYPES.map(entityType => [entityType, Object.entries(schemas[entityType]).map(([key, schema]): ApplicationFieldDefinition<VideoEditFieldData, VideoEditFieldData> => {
  const id = `${entityType}.${videoEditPropertyKey(key)}`
  const controlled = VIDEO_EDIT_CONTROLLED_AGGREGATES.some(value => value === key)
  const child = VIDEO_EDIT_COMPOSITE_TYPES.some(type => type === entityType)
  const curveKey = key.endsWith('.keyframes') ? key.split('.').at(-2)! : undefined
  const curveDataKey = entityType === 'video_edit.clip' ? 'curves' : 'frameCurves'
  const curveDescription = '整体替换关键帧序列；[] 关闭动画。time 为片段内整数帧（0 为片段第一帧，最大 duration−1），不是秒或素材时间。value 与原参数单位、范围一致。interpolation 控制到下一点：linear 线性，hold 定格至下一点，ease 三次贝塞尔缓入缓出（固定对称缓动）。开关与选项只能 hold。同一参数按 time 升序且不重复。片段跟随时 x/y 是跟踪位置上的偏移，scale 是跟踪缩放的乘数。'
  const writable = !controlled && !(entityType === 'video_edit.track' && ['index', 'kind'].includes(key)) && !(child && ['kind', 'definitionId', 'clipId', 'sequenceId', 'leftClipId', 'rightClipId', 'regionStatus', 'status'].includes(key) && !(entityType === 'video_edit.transition' && key === 'kind')) && entityType !== 'video_edit.media' && entityType !== 'video_edit.code_version' && entityType !== 'video_edit.builtin_effect' && (entityType !== 'video_edit.code_material' || key === 'name') && (entityType !== 'video_edit.document' || ['selectedItemIds', 'selectedBinId', 'openSequenceIds', 'timelineView', 'programPlayback', 'playbackResolution'].includes(key)) && !(entityType === 'video_edit.item' && ['kind', 'mediaId', 'graphicKind', 'graphicWidth', 'graphicHeight'].includes(key)) && (entityType !== 'video_edit.source' || ['itemId', 'timeUs', 'playing', 'volume', 'inUs', 'outUs', 'playbackDirection'].includes(key))
  return {
    propertyId: id, descriptor: { id, entityType, version: 1, title: curveKey ? `${labels[curveKey] ?? curveKey}关键帧` : key === 'codeParameters' ? '代码实例参数' : labels[key] ?? key, description: curveKey ? curveDescription : descriptions[id] ?? (key === 'source' ? '受限作者源码；只经AST白名单检查、指定帧试渲染后进入剪辑，不执行JavaScript或宿主脚本。源码版本不可原位改写。' : key === 'codeParameters' ? '按固定源码版本的声明校验参数字典；修改只作用于此片段，不重编译源码，复用剪辑历史和自动保存。' : key === 'programPlayback' ? '节目播放控制命令；回读为当前实际位置，播放观察可随帧推进。执行确认表示会话接受命令，实际画面由节目监视器呈现。' : `${labels[key] ?? key}；时间线使用整数帧，源入点使用微秒，画面位置使用归一化坐标。`), value: { kind: 'json', schemaRef: videoEditSchemaRef('property', id + '.value') }, nullable: key === 'code' || schema.isNullable(), ...((entityType === 'video_edit.source' && ['timeUs', 'playing'].includes(key) || entityType === 'video_edit.document' && key === 'programPlayback') ? { verificationStrategy: 'execution' as const } : {}), dataClass: 'C1', exposures: ['ui', 'assistant', 'local_adapter'], requiredPermissions: { read: ['video_edit:read'], write: writable ? ['video_edit:write'] : [] }, revisionScopes: ['video_edit'], schemaRef: videoEditSchemaRef('property', id), ...(!writable ? { readOnlyReason: entityType === 'video_edit.document' && key === 'name' ? VIDEO_EDIT_PROJECT_NAME_READ_ONLY : entityType === 'video_edit.builtin_effect' ? VIDEO_EDIT_BUILTIN_CATALOG_READ_ONLY : entityType === 'video_edit.tracker' && key === 'status' ? '由后台跟踪维护；新建或修改 prompts 自动开始，读 status 看进度。' : key === 'regionStatus' ? '由后台分析维护：写 mask 设置作用区域后自动开始分析，读这里看进度。' : '由剪辑会话、不可变源码或原素材维护。' } : {}) },
    read: source => curveKey ? (source[curveDataKey] && typeof source[curveDataKey] === 'object' && !Array.isArray(source[curveDataKey]) ? source[curveDataKey][curveKey] ?? [] : []) : codeKeys[key] ? source.code && typeof source.code === 'object' && !Array.isArray(source.code) ? source.code[codeKeys[key]] ?? (key === 'codeVersionId' ? '' : {}) : key === 'codeVersionId' ? '' : {} : source[key] ?? (['anchorX', 'anchorY'].includes(key) ? 0.5 : key === 'sourceComponent' ? 'all' : key === 'height' && entityType === 'video_edit.track' ? 32 : key === 'syncLocked' ? true : key === 'code' || schema.isNullable() ? null : ['tags', 'effects', 'transitions'].includes(key) ? [] : ['fadeInFrames', 'fadeOutFrames'].includes(key) ? 0 : key === 'frameRateMode' ? 'unknown' : ''), storeActions: [],
    ...(entityType === 'video_edit.sequence' && key === 'frameRate' ? { cascadeEffects: VIDEO_EDIT_TIME_CASCADES } : {}),
    ...(entityType === 'video_edit.clip' && ['start', 'duration', 'sourceInUs', 'speedPercent', 'reverse'].includes(key) ? { cascadeEffects: VIDEO_EDIT_CLIP_CONTENT_CASCADES } : {}),
    ...((entityType === 'video_edit.clip' || entityType === 'video_edit.sequence' || child) && writable ? { cascadeEffects: [...(entityType === 'video_edit.clip' && ['duration', 'speedPercent'].includes(key) ? [VIDEO_EDIT_CLIP_KEYFRAME_TIME_CASCADE] : []), ...(entityType === 'video_edit.clip' && ['start', 'duration', 'sourceInUs', 'speedPercent', 'reverse'].includes(key) ? VIDEO_EDIT_CLIP_CONTENT_CASCADES : []), ...(entityType === 'video_edit.sequence' && key === 'frameRate' ? VIDEO_EDIT_TIME_CASCADES : []), ...VIDEO_EDIT_COMPOSITE_CASCADES] } : {}),
    ...(entityType === 'video_edit.source' && writable ? { cascadeEffects: [VIDEO_EDIT_SOURCE_PROGRAM_CASCADE] } : {}),
    ...(entityType === 'video_edit.document' && key === 'programPlayback' ? { cascadeEffects: [VIDEO_EDIT_PROGRAM_SOURCE_CASCADE] } : {}),
    ...(writable ? { writer: { write: (draft: VideoEditFieldData, mutation: { value?: JsonValue }) => { const value = schema.parse(mutation.value) as JsonValue; if (curveKey) { const curves = draft[curveDataKey]; const next = { ...(curves && typeof curves === 'object' && !Array.isArray(curves) ? curves : {}), [curveKey]: value }; if (Array.isArray(value) && !value.length) delete next[curveKey]; draft[curveDataKey] = next } else if (codeKeys[key]) { if (!draft.code || typeof draft.code !== 'object' || Array.isArray(draft.code)) throw new Error('此片段没有代码实例。'); draft.code = { ...draft.code, [codeKeys[key]]: value } } else if ((['binId', 'parentId', 'linkId', 'groupId'].includes(key) || ['video_edit.marker', 'video_edit.caption'].includes(entityType) && key === 'clipId') && value === '' || key === 'sourceComponent' && value === 'all' || ['audioChannels', 'audioMapping', 'follow', 'textStyle'].includes(key) && value === null || ['fadeInFrames', 'fadeOutFrames'].includes(key) && value === 0) delete draft[key]; else draft[key] = value } } } : {}),
  }
})])) as Record<VideoEditEntityType, ApplicationFieldDefinition<VideoEditFieldData, VideoEditFieldData>[]>
export function videoEditSchemaDocuments(entityType: VideoEditEntityType): Array<{ ref: ApplicationSchemaRef; value: JsonValue }> {
  return Object.entries(schemas[entityType]).map(([key, schema]) => ({ ref: videoEditSchemaRef('property', `${entityType}.${videoEditPropertyKey(key)}.value`), value: z.toJSONSchema(schema) as JsonValue }))
}
export function videoEditCollectionValues(entityType: VideoEditEntityType, properties: Record<string, JsonValue>): VideoEditFieldData {
  const data: VideoEditFieldData = {}
  for (const [propertyId, value] of Object.entries(properties)) {
    const suffix = propertyId.slice(entityType.length + 1)
    const key = Object.keys(schemas[entityType]).find(key => videoEditPropertyKey(key) === suffix)
    if (!key) throw new Error('创建属性未登记。')
    const schema = schemas[entityType][key]
    const parsed = schema.parse(value) as JsonValue
    if (key.endsWith('.keyframes')) {
      const store = entityType === 'video_edit.clip' ? 'curves' : 'frameCurves'
      const curveKey = key.split('.').at(-2)!
      const curves = data[store]
      data[store] = { ...(curves && typeof curves === 'object' && !Array.isArray(curves) ? curves : {}), [curveKey]: parsed }
    } else if (!(entityType === 'video_edit.clip' && key === 'textStyle' && parsed === null)) data[key] = parsed
  }
  return data
}
