import { migrateVideoAuthor } from '../../videoEdit/styles/authorVersionMigration'
import { migrateAudioMergedEffects, migrateAudioEqualizerModes } from '../../audio/effects/mergedEffectsMigration'
import { migrateVideoEditTransitions } from '../../videoEdit/transitionMigration'
import { z } from 'zod'
import { migrateVideoEditCaptionOwnership } from '../../videoEdit/captionOwnershipMigration'
import { migrateEmbeddedVideoColorGradesV1 } from '../../videoEdit/colorGradeMigration'

import { henjiExtension, henjiLegacyExtensions } from '../../fileExtensions'
import type { DocumentKindDescriptor } from './registry'
import { videoEditInPlaceRecordsSchema } from '../../videoEdit/inPlacePersistence'
import { colorLutAssetSchema } from '../../videoEdit/colorLutAsset'
import { migrateVideoEditStyles } from '../../videoEdit/styles/styleTemplateMigration'
import { migrateVideoEditMotionBlurMaster } from '../../videoEdit/motionBlurMigration'
import { migrateVideoEditClipFades } from '../../videoEdit/fadeTransitionMigration'
import { migrateVideoEditMergedEffects } from '../../videoEdit/mergedEffectsMigration'
import { videoEditDocumentSchema } from '../../videoEdit/document'
import { creativeIntentsSchema } from '../../creativeIntent/persistence'
import { VIDEO_EDIT_CONTENT_VERSION } from '../../persistence/schemaVersions'

/*
 * 剪辑（`.hjvid`，3.1 剪辑接入）：项目的主文档，始终放在项目里（可以在项目之间移动）。
 *
 * 内容 = 剪辑的持久部分（内存形态，素材位置都是绝对路径）：
 * - media：引用的源文件；bins / items：素材箱与素材项；sequences：序列（轨道、片段、标注、标记、字幕、转场）；
 * - codeMaterials：可编辑代码素材的固定源码版本（可选）。
 * 稳定 ID、名称与版本由文档外壳表达（剪辑名就是文件名），不进内容。
 *
 * 这里只校验外层结构，细节由剪辑工具打开时按完整 schema（`videoEditDocumentSchema`）逐项校验。
 * 嵌套对象一律保留未知字段：主进程保存时持久化的是 schema 解析结果，剥掉字段就等于丢数据。
 * 本文件主进程与渲染层共用，只能相对导入纯模块。
 */

const identified = z.looseObject({ id: z.string().min(1) })
const ratioSchema = z.looseObject({ numerator: z.number(), denominator: z.number() })

const clipSchema = z.looseObject({
  id: z.string().min(1),
  start: z.number(),
  duration: z.number(),
})

const sequenceSchema = z.looseObject({
  id: z.string().min(1),
  frameRate: ratioSchema,
  tracks: z.array(identified),
  clips: z.array(clipSchema),
  annotations: z.array(identified),
})

export const videoEditContentSchema = z.object({
  foreign: videoEditDocumentSchema.shape.foreign,
  exportHistory: videoEditDocumentSchema.shape.exportHistory,
  creativeIntents: creativeIntentsSchema.optional(),
  styles: videoEditDocumentSchema.shape.styles,
  templates: videoEditDocumentSchema.shape.templates,
  colorLuts: z.array(colorLutAssetSchema).optional(),
  media: z.array(z.looseObject({ id: z.string().min(1), path: z.string().min(1) })),
  bins: z.array(identified),
  items: z.array(identified),
  sequences: z.array(sequenceSchema),
  codeMaterials: z.array(identified).optional(),
  posterFrame: z.looseObject({ sequenceId: z.string().min(1), frame: z.number() }).optional(),
  inPlaceGenerations: videoEditInPlaceRecordsSchema.optional(),
  creativePlacements: videoEditDocumentSchema.shape.creativePlacements,
  scenes: z.array(identified).optional(),
})

export type VideoEditDocumentContent = z.infer<typeof videoEditContentSchema>

/** 一条序列里内容的结束帧（片段、字幕、标记取最大）。 */
function sequenceEndFrame(sequence: VideoEditDocumentContent['sequences'][number]): number {
  const captions = Array.isArray(sequence.captions) ? sequence.captions as Array<{ start?: unknown; duration?: unknown }> : []
  const ends = [
    ...sequence.clips.map((clip) => clip.start + clip.duration),
    ...captions.map((caption) => (typeof caption.start === 'number' && typeof caption.duration === 'number' ? caption.start + caption.duration : 0)),
  ]
  return ends.length ? Math.max(0, ...ends) : 0
}

function sequenceHasContent(sequence: VideoEditDocumentContent['sequences'][number]): boolean {
  const optional = ['markers', 'captions', 'transitions'] as const
  return sequence.clips.length > 0
    || sequence.annotations.length > 0
    || optional.some((key) => Array.isArray(sequence[key]) && (sequence[key] as unknown[]).length > 0)
}

/**
 * 空内容：没有引用任何素材、没有素材项与素材箱、没有代码素材，序列里也没有任何片段、标注、标记、字幕或转场。
 * 新建后只是改了序列规格或多建了一条空序列的草稿项目离开时直接丢弃，不询问。
 */
function isEmptyVideoEditContent(content: VideoEditDocumentContent): boolean {
  return (content.exportHistory?.length ?? 0) === 0
    && content.media.length === 0
    && (content.creativeIntents?.drafts.length ?? 0) === 0
    && (content.creativeIntents?.sessions.length ?? 0) === 0
    && (content.colorLuts?.length ?? 0) === 0
    && content.items.length === 0
    && content.bins.length === 0
    && (content.codeMaterials?.length ?? 0) === 0
    && (content.inPlaceGenerations?.length ?? 0) === 0
    && (content.scenes?.length ?? 0) === 0
    && !content.sequences.some(sequenceHasContent)
}

/** 列表摘要：片段数与时长（秒，取最长的序列）。 */
function summarizeVideoEdit(content: VideoEditDocumentContent): { clips: number; durationSeconds: number } {
  let durationSeconds = 0
  for (const sequence of content.sequences) {
    const fps = sequence.frameRate.denominator > 0 ? sequence.frameRate.numerator / sequence.frameRate.denominator : 0
    if (fps > 0) durationSeconds = Math.max(durationSeconds, sequenceEndFrame(sequence) / fps)
  }
  return {
    clips: content.sequences.reduce((total, sequence) => total + sequence.clips.length, 0),
    durationSeconds: Math.round(durationSeconds * 100) / 100,
  }
}

/** 新剪辑只有素材集合，时间线由用户新建或首次拖入素材时建立。 */
function createEmptyVideoEditContent(): VideoEditDocumentContent {
  return { media: [], bins: [], items: [], sequences: [] }
}

export const videoEditDocumentKind: DocumentKindDescriptor<VideoEditDocumentContent> = {
  id: 'video_edit',
  extension: henjiExtension('video_edit'),
  legacyExtensions: henjiLegacyExtensions('video_edit'),
  standaloneFolderNames: { zh: '剪辑', en: 'Video Edits' },
  untitledNames: { zh: '未命名剪辑', en: 'Untitled Edit' },
  storage: 'json',
  // 版本 1 = 旧剪辑文件第 2 版的持久字段（去掉 format / version / id / name / revision，由外壳表达）。
  version: VIDEO_EDIT_CONTENT_VERSION,
  // 25：批注新增箭头、椭圆、文字、编号圆点形状。旧程序的批注目标是封闭联合，读不懂这些分支，
  // 按“改变已有字段（target）可取值”处理，提高到 25，让旧程序明确提示升级而不是报内容损坏。
  // 26：片段新增非等比缩放 scaleAspect，旧程序忽略它会按等比渲染与导出（画面变形不同），提高到 26。
  // 27：序列新增运动模糊与帧混合开关，旧程序忽略它们会渲染出不同的画面，提高到 27。
  // 28：音轨混音（轨道音量、声像、轨道效果）、主轨与片段基本声音，旧程序忽略它们会混出不同的声音，提高到 28。
  // 31：序列 motionBlur 改为总开关（同时管代码图层的位姿模糊），片段新增 motionBlur:false；旧程序会把关掉的总开关当成代码图层照常模糊，提高到 31。
  // 37：片段新增 enabled:false（停用），旧程序忽略它会照常播放与导出停用的片段；新增片子数据 scenes 与代码参数值 {kind:'scene'}，
  // 代码版本可写作者接口 v5 与内置库 libraries，旧程序读不懂这些（作者接口最高只认 v4），提高到 37，让旧程序明确提示升级。
  // 38：作者接口 v6 可使用排版库；旧程序无法执行，最低可读版本同步提高。
  // 47：内置效果换成合并后的“模糊”（blur），旧程序不认识这个效果，会把整份剪辑当成内容无效，提高到 47 让它明确提示升级。
  // 55：新建代码素材默认作者接口 11，旧程序的作者接口枚举不认识它，会把整份剪辑判成内容无效；旧程序也会忽略元素效果覆盖，渲染出不同的画面。提高到 55 让它明确提示升级。
  // 56：新建代码素材默认作者接口 12（网页文本声明），旧程序的作者接口枚举不认识它，会把整份剪辑判成内容无效；提高到 56 让它明确提示升级。
  // 57：新建代码素材默认作者接口 13（累积模拟），旧程序的作者接口枚举不认识它，会把整份剪辑判成内容无效；提高到 57 让它明确提示升级。
  // 63：片段新增发光强度 spaceEmission，并可做关键帧；旧程序的片段关键帧键是封闭枚举，读到 curves.spaceEmission 会把整份剪辑判成内容无效，提高到 63 让它明确提示升级。
  // 64：代码图片参数新增片段引用 {kind:'clip'}；旧程序的图片引用是封闭联合，读到它会把整份剪辑判成内容无效，提高到 64 让它明确提示升级。
  // 65：新建代码素材默认作者接口 16（三维作者的 info.elements），旧程序的作者接口上限不认识它，会把整份剪辑判成内容无效，提高到 65 让它明确提示升级。
  // 68：新建代码素材默认作者接口 17（三维作者的 host.time、host.space 标准材质与环境、元素轮廓 outline），旧程序的作者接口上限不认识它，会把整份剪辑判成内容无效，提高到 68 让它明确提示升级。
  // 69：片段关键帧新增 spaceThickness（三维厚度）；旧程序的片段关键帧键是封闭枚举，读到它会把整份剪辑判成内容无效，提高到 69 让它明确提示升级。
  // 70：新增灯光片段与灯光素材项（kind light）及关键帧键 lightIntensity；旧程序的 kind 与关键帧键是封闭枚举，读到会把整份剪辑判成内容无效，提高到 70。
  // 71：网页图片引用新增可选 layer（{ only } 或 { hide }，按文字拆层）；旧内容没有该字段，画面不变。旧程序的网页引用是严格结构且画不出拆层，读到会把整份内容判成无效，提高到 71 让它明确提示升级。
  // 72：新建代码素材默认作者接口 18（没有位姿的图层比较相邻帧的绘制指令，draw 里的动画也有运动模糊），旧程序的作者接口上限不认识它，提高到 72。
  // 74：片段淡入淡出并进单侧过渡。旧程序靠 fadeInFrames 给没拆开的视频、嵌套序列的声音做淡化，只认音频过渡，打开新文件这些声音不再淡；提高到 74。
  minReaderVersion: 74,
  contentSchema: videoEditContentSchema,
  // 2026-10-21 兼容起点：此前的开发期版本不再读取；今后每次升版本在这里登记 N → N+1。
  migrations: {
    // 69 → 70：新增灯光片段与灯光素材项（kind light，字段 lightKind、lightColor、lightIntensity 可关键帧、lightCastShadow、lightSoftness、lightAngle），序列 spaceRender 新增 defaultLighting；旧内容没有灯光，画面不变；片段与素材项的 kind、关键帧键是封闭枚举，旧程序读到 light 或 curves.lightIntensity 会拒读，最低可读版本随版本提高。
    // 70 → 71：网页图片引用新增可选 layer（{ only } 或 { hide }，按文字拆层）；旧内容没有该字段，画面不变。旧程序的网页引用是严格结构且画不出拆层，读到会把整份内容判成无效，最低可读版本提高到 71。
    // 71 → 72：接受作者接口 18（没有位姿的图层比较相邻帧的绘制指令，draw 里的动画也有运动模糊）。
    // 72 → 73：片段 motionBlur 从只能写 false 放宽到 true/false（true 强制打开）；代码元素覆盖新增 motionBlur。旧程序读不了 true，提高最低可读版本。
    // 73 → 74：片段的 fadeInFrames / fadeOutFrames 并进过渡，成为片段一端的单侧过渡（画面交叉溶解、声音恒定功率，见 fadeTransitionMigration.ts）；
    // 自带声音的画面片段的声音改由单侧画面过渡带着淡，旧程序不会，最低可读版本提高到 74。
    73: content => migrateVideoEditClipFades(content),
    72: content => structuredClone(content),
    71: content => structuredClone(content),
    70: content => structuredClone(content),
    69: content => structuredClone(content),
    // 68 → 69：片段新增三维表面：厚度 spaceThickness（可关键帧）、受光 spaceLit、材质 spaceMaterial、倒角 spaceBevel、投影 spaceCastShadow / spaceReceiveShadow；旧内容没有这些字段，缺省为平面画面，画面不变；关键帧键是封闭枚举，旧程序读到 curves.spaceThickness 会拒读，最低可读版本随版本提高。
    68: content => structuredClone(content),
    // 67 → 68：接受作者接口 17（三维作者的 host.time、host.space 标准材质与环境、元素轮廓 outline）；序列 spaceRender 新增可选 bloomThreshold、bloomRadius（泛光阈值与范围），省略即今天的 0.75 与 0.45，画面不变。旧源码与固定接口原样保留。
    67: content => structuredClone(content),
    // 66 → 67：序列 spaceRender 新增可选 environment、environmentIntensity、environmentRotation（三维环境光预设、强度与转角），省略即无环境光，画面不变；旧程序忽略它们只是不打环境光，最低可读版本保持 65。
    66: content => structuredClone(content),
    // 65 → 66：序列 spaceRender 新增可选 exposure（三维曝光 EV）与 toneMapping（三维色调映射），省略即 0 与 neutral，画面不变；旧程序忽略它们只是不做这两项，最低可读版本保持 65。
    65: content => structuredClone(content),
    // 64 → 65：接受作者接口 16（三维作者的 info.elements）；旧源码与固定接口原样保留。
    64: content => structuredClone(content),
    // 63 → 64：代码图片参数新增片段引用 {kind:'clip', clipId}；旧内容没有这一分支，原样保留。
    63: content => structuredClone(content),
    // 62 → 63：片段新增可选发光强度 spaceEmission（0–10）及其关键帧；旧内容没有该字段，缺省 0 不改变画面，原样保留。
    62: content => structuredClone(content),
    // 61 → 62：序列 spaceRender 新增可选 bloom、ambientOcclusion、reflections（三维泛光、环境光遮蔽、屏幕反射强度），缺省即不开；旧程序忽略它们只是不出这些效果，最低可读版本保持 60。
    61: content => structuredClone(content),
    // 60 → 61：序列新增可选 spaceRender（三维成片渲染器与路径追踪采样数），缺省即实时渲染；旧程序忽略它只是按实时渲染成片，最低可读版本保持 60。
    60: content => structuredClone(content),
    // 59 → 60：空间片段、相机与绑定轨迹，以及作者接口 15（createThree 与 space:true 空间入口）；片段关键帧允许右边界控制点，旧内容不补默认值。旧程序读不懂作者接口 15，最低可读版本提高到 60。
    59: content => structuredClone(content),
    // 58 → 59：导出记录的设置新增可选 useWebCache，缺省不用网页缓存，最低可读版本保持 58。
    58: content => structuredClone(content),
    // 57 → 58：接受作者接口 14 的 fill 图层画面来源；旧源码、接口与库锁定原样保留。
    57: content => structuredClone(content),
    // 54 → 55：新增可选的元素效果覆盖、片段修改记录与作者接口 11（效果 key），已有内容原样保留；旧程序读不懂接口 11、会忽略效果覆盖，最低可读版本提高到 55。
    54: content => structuredClone(content),
    // 55 → 56：代码可携带作者接口 12 的网页文本声明，已有内容原样保留；旧程序读不懂接口 12，最低可读版本提高到 56。
    55: content => structuredClone(content),
    // 56 → 57：代码可携带作者接口 13 的累积模拟，已有内容原样保留；旧程序读不懂接口 13，最低可读版本提高到 57。
    56: content => structuredClone(content),
    // 53 → 54：接受作者接口 10，样片补固定历史版本。
    53: migrateVideoAuthor,
    // 52 → 53：风格件可带代码滤镜快照，历史内容原样保留。
    52: content => structuredClone(content),
    // 51 → 52：容器接受作者接口 v9 的调整层，旧源码与接口保持原样。
    51: content => structuredClone(content),
    // 50 → 51：允许作者接口 v8 的 all 显隐条件，旧版本源码和接口保持原样。
    50: content => structuredClone(content),
    // 49 → 50：过渡合并为 ID + 方式，参数与动画逐键改名；旧程序不认识新 ID，最低可读版本提高到 50。
    49: migrateVideoEditTransitions,
    // 48 → 49：音频效果合并、均衡方式拆分并保留声音身份别名；旧程序无法理解新效果，最低可读版本同步提高。
    48: content => migrateAudioEqualizerModes(migrateAudioMergedEffects(content)),
    // 47 → 48：工程风格新增可选风格件，默认旋钮已归一化到效果参数，最低可读版本保持 47。
    47: content => structuredClone(content),
    // 46 → 47：高斯、方向、缩放、镜头模糊并成“模糊”（方式 + 模糊度，曲线逐帧换算），旧暗角的负数量换成正数量配白色；每一帧画面不变。
    46: migrateVideoEditMergedEffects,
    // 45 → 46：导出历史新增可选高级编码，旧记录保持直接导出语义，最低可读版本保持 45。
    45: content => structuredClone(content),
    // 44 → 45：允许作者接口 7 的图层效果，旧源码与库锁定保持原样。
    44: content => structuredClone(content),
    // 43 → 44：导出设置新增可选 renderAtOutputResolution，缺省为开，最低可读版本保持 42。
    43: content => structuredClone(content),
    // 42 → 43：导出记录的设置新增可选 usePreviews，缺省不使用预览，最低可读版本保持 42。
    42: content => structuredClone(content),
    // 41 → 42：删除旧程序依赖的 linkedCaptionId；旧程序会追加链接字幕并写回退役字段，最低可读版本提高到 42。
    41: migrateVideoEditCaptionOwnership,
    // 40 → 41：代码图片参数新增网页画面引用 {kind:'web'}（本机网页的路径、视口、取景、倍率、取帧时刻与要读矩形的选择器）；
    // 旧内容原样有效，最低可读版本不变。
    40: content => structuredClone(content),
    // 39 → 40：作者源码与固定组件依赖不设容量或深度上限，内容原样保留。
    39: content => structuredClone(content),
    38: content => structuredClone(content),
    // 37 → 38：只接受新作者接口；旧源码、apiVersion 与固定库版本原样保留。
    37: content => structuredClone(content),
    // 36 → 37：片段新增可选 enabled:false，文档新增可选片子数据 scenes，代码参数可引用片子数据，代码版本新增可选内置库 libraries 并接受作者接口 v5；
    // 旧内容不含这些，原样有效。
    36: content => structuredClone(content),
    // 35 → 36：代码视频参数新增可选取帧时间表 spans；旧内容原样有效，旧程序忽略它只会改按片段时间取帧，最低可读版本不变。
    35: content => structuredClone(content),
    // 34 → 35：可选 project 固定工程提交与入口，原闭包 files 仍可独立读取。
    34: content => structuredClone(content),
    // 33 → 34：location 新增 Git 对象引用；普通打开保留旧路径，显式迁移才做 I/O。
    33: content => structuredClone(content),
    // 17 → 18：全能调色参数格式 v2（开尔文白平衡、创意分离色调并入色轮），含关键帧。
    17: content => migrateEmbeddedVideoColorGradesV1(content),
    // 18 → 19：片段新增可选的速度曲线 timeRemap、补帧 frameInterpolation 与变调 pitchSemitones；旧内容原样有效。
    18: content => content,
    // 19 → 20：只新增可选字段（跟随 motion 变换跟随、跟踪器 recording 录屏事件来源、片段 stabilization 防抖），原内容不变。
    19: content => content,
    // 20 → 21：片段新增可选的音频重构记录 remix，旧内容原样保留。
    20: content => content,
    // 21 → 22：风格说明书换成 Frameflow 的风格包机制。工程风格包转成风格副本（旧栏目并入新栏目、参考示例记进“样片与代码”），
    // 序列绑定 styleKitId 改名 styleId；新增工程模板 templates 与原生模板实例标记 clip.templateId。
    21: content => migrateVideoEditStyles(content),
    // 22 → 23：新增可选 gainDb，缺省按 0 dB 读取，旧音量与关键帧原样保留。
    22: content => content,
    // 23 → 24：工程风格副本新增可选使用者偏好。
    23: content => content,
    // 24 → 25：批注新增箭头/椭圆/文字/编号圆点目标与可选 style.color；旧批注原样有效。
    24: content => content,
    // 25 → 26：片段新增可选 scaleAspect（非等比缩放），批注样式新增可选 weight（线条粗细）；旧内容原样有效。
    25: content => content,
    // 26 → 27：序列新增可选 motionBlur（运动模糊）与 frameBlend（帧混合默认补帧）；旧内容原样有效。
    26: content => content,
    // 27 → 28：轨道新增可选 volumeDb / pan / effects，序列新增可选 master，片段新增可选 essentialSound；旧内容原样有效。
    27: content => content,
    // 28 → 29：字幕新增可选 linkedCaptionId（音频编辑动态链接的字幕段），素材新增可选 linkedTimeline（成品对应的源录音区间）；旧内容原样有效。
    28: content => content,
    // 29 → 30：工程风格副本的样片画布放宽到 3840×2160、60 帧；旧内容原样有效，旧程序只在副本确实超出旧上限时拒绝打开。
    29: content => content,
    // 30 → 31：序列运动模糊改为总开关。此前关着的序列里代码图层照常模糊、片段变换不模糊：
    // 改为打开总开关，并给有变换动画的片段写 motionBlur:false，画面与旧版一致。
    30: content => migrateVideoEditMotionBlurMaster(content),
    // 31 → 32：工程风格副本的样片时长放宽到 30 秒、锚点 10 张；旧内容原样有效，旧程序只在副本确实超出旧上限时拒绝打开。
    31: content => content,
    // 32 → 33：过渡种类加入 74 个 gl-transitions 转场（gl.*）；旧内容原样有效，旧程序只在确实用了 gl.* 时拒绝打开。
    32: content => content,
  },
  dependencyContent: ({ exportHistory: _exportHistory, ...dependencies }) => dependencies,
  createEmptyContent: createEmptyVideoEditContent,
  isEmptyContent: isEmptyVideoEditContent,
  summarize: summarizeVideoEdit,
}

