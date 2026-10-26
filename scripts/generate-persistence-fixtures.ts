import { emptyMemorySnapshot } from '../src/core/assistant/memoryEntries'
import { createWorkspaceLayoutEnvelope } from '../src/core/workspaceLayouts/schema'
import { defaultCameraStageLayout } from '../src/features/cameraStage/layout/dockLayout'
import { MOTION_CANDIDATE_VERSION } from '../src/core/creativeIntent/persistence'
import { mcpConnectionStorageSchema } from '../src/core/persistence/mcpConnectionSchema'
import { createRecordingDocument } from '../src/core/screenRecording/document'
import { llmStoredConfigSchema } from '../src/core/persistence/llmSchemas'
import { testCodeMetadata } from '../src/core/videoEdit/codeMaterial/sourceTestFixtures'
import fs from 'node:fs'
import { audioCaptureSettingsEnvelopeSchema, DEFAULT_AUDIO_CAPTURE_SETTINGS } from '../src/core/audioCapture/contracts'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { PERSISTENCE_FORMATS } from '../src/core/persistence/formats'
import { MODEL_DEFAULTS_VERSION, SUBTITLE_MANIFEST_VERSION, modelDefaultsSchema } from '../src/core/persistence/preferenceSchemas'
import { createMotionFixture } from '../src/core/creativeIntent/fixtures/motionFixtures'
import { optimizeMotionDraft } from '../src/core/creativeIntent/candidates'
import { creativeIntentPageSchema } from '../src/core/creativeIntent/pages'
import { creativeIntentsSchema } from '../src/core/creativeIntent/persistence'
import { imageLayoutPageSchema, imageLayoutCandidateSchema, imageLayoutIdentity } from '../src/core/imageEdit/v3/layoutDraft'
import { composeAffine, mapAffine } from '../src/core/imaging/transforms'
import { ImageEditCommandHistoryV3 } from '../src/core/imageEdit/v3/commandHistory'
import { splitImageEditHistoryPagesV3 } from '../src/core/imageEdit/v3/historyPaging/checkpoint'
import { buildDocumentEnvelope } from '../src/core/documents/envelope'
import { buildProjectManifest } from '../src/core/documents/projectManifest'
import { createVideoEditDocument, createVideoEditSequence, videoEditDocumentSchema } from '../src/core/videoEdit/document'
import { makeVideoEditItemClip } from '../src/core/videoEdit/projectItems'
import { setVideoEditClipTimeRemap } from '../src/core/videoEdit/clipSpeed'
import { videoEditFps } from '../src/core/videoEdit/time'
import { bindVideoEditCaptionSpeech } from '../src/core/videoEdit/captionSpeech'
import { CODE_ASSET_VERSION, codeAssetSchema } from '../src/core/videoEdit/codeAsset'
import { CODE_AUTHOR_API_VERSION } from '../src/core/videoEdit/codeMaterialPersistence'
import { titleGraphic } from '../src/core/videoEdit/titleGraphics'
import { BLANK_STYLE_SAMPLE_SOURCE } from '../src/core/videoEdit/styles/blankSample'
import { styleGuideTemplate } from '../src/core/videoEdit/styles/styleGuide'
import { VIDEO_EDIT_PRESET_PACKAGE_VERSION } from '../src/core/videoEdit/presetPackage'
import { VIDEO_EDIT_EXPORT_PRESETS } from '../src/core/videoEdit/exportPresets'
import { videoEditTextStyleSchema } from '../src/core/videoEdit/text'
import { createImageEditDocumentV3, createImageEditEffectLayerV3, createImageEditRasterLayerV3, createImageEditAdjustmentLayerV3, createImageEditPathLayerV3 } from '../src/core/imageEdit/v3/documentFactory'
import { createDefaultImageEditColorModeV3 } from '../src/core/imageEdit/v3/colorTypes'
import { embedImageEditRasterV3 } from '../src/core/imageEdit/v3/smartContent/commands'
import { IMAGE_WORKING_VERSION, IMAGE_PACKAGE_VERSION, CANVAS_LAYER_PACKAGE_VERSION } from '../src/core/persistence/schemaVersions'
import { createThemePayloadV2 } from '../src/core/theme/themeMigration'
import { DEFAULT_THEME_SEED } from '../src/core/theme/themeEngine'
import { BLACK_HEX, RECORDING_FRAME_SOLID_DEFAULT_HEX } from '../src/core/theme/colorTokens'

const timestamp = '2026-10-09T00:00:00.000Z'
const parameters = {
  nodes: { type: 'table', title: '节点数据', rowKey: 'id', fields: { id: { type: 'text', title: '键', default: '', maxLength: 64 }, label: { type: 'text', title: '文案', default: '', maxLength: 200 } }, default: [{ id: 'node-0', label: '首项' }] },
  titleStyle: { type: 'textStyle', title: '文字样式', layer: 'golden-motion', default: { fontFamily: 'sans-serif', fontSize: 64 } },
  label: { type: 'text', title: '标题', default: '黄金样本', maxLength: 200 },
  size: { type: 'number', title: '字号', default: 24, min: 1, max: 72, step: 1, unit: 'px' },
}
const source = `export default {
  name: "黄金代码", kind: "generator", mode: "dynamic", width: 1920, height: 1080, durationSeconds: 4,
  motionBlur: { shutter: 180, maxSamples: 16 },
  params: ${JSON.stringify(Object.entries(parameters).map(([key, value]) => ({ key, ...value })))},
  layers() {
    return [{ id: "golden-motion", bounds: [0, 0, 100, 100], blurShape: "lens", pose: t => ({ x: t * 10, blur: 8 }), draw(ctx) { ctx.fillStyle = "${BLACK_HEX}"; ctx.fillRect(0, 0, 100, 100) } }]
  }
}
`
const program = testCodeMetadata({ name: '黄金代码', width: 1920, height: 1080, durationSeconds: 4, parameters })
const hash = createHash('sha256').update(source).digest('hex')
const sourceVersion = { apiVersion: CODE_AUTHOR_API_VERSION, languageVersion: 4 as const, entry: 'main.ts', files: [{ path: 'main.ts', location: '/persistence-project/代码/标题/v1/main.ts', hash }], imports: [] }
const document = createVideoEditDocument('持久格式黄金样本')
document.id = 'golden-video'
document.codeMaterials = [{ id: 'code-definition', name: '代码标题', defaultVersionId: 'code-version', versions: [{ id: 'code-version', ...sourceVersion }] }]
document.items.push({ id: 'code-item', name: '代码标题', kind: 'code', code: { definitionId: 'code-definition', versionId: 'code-version', parameters: { label: '黄金样本', size: 24, titleStyle: videoEditTextStyleSchema.parse({ fontSize: 64 }), nodes: [{ id: 'node-0', label: '首项' }] }, curves: { size: [{ id: 'source-key', sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, value: 24, interpolation: 'linear' }] } } })
const sequence = createVideoEditSequence()
sequence.id = 'golden-sequence'
// 27：时间线统一开关。
sequence.motionBlur = true
sequence.frameBlend = true
document.sequences.push(sequence)
const clip = makeVideoEditItemClip(document, 'code-item', sequence.id, { frame: 0, duration: 90 }, () => program)
clip.id = 'golden-clip'
clip.snapToBeat = true
// 26：非等比缩放（解开缩放链条，垂直比水平多 20%）。
clip.scaleAspect = 1.2
// 31：序列运动模糊改为总开关，片段可单独关掉自身变换动画的模糊。
clip.motionBlur = false
clip.curves = { opacity: [{ time: 0, value: 0, interpolation: 'linear' }, { time: 20, value: 1, interpolation: 'ease' }] }
clip.effects = [{ id: 'golden-grade', name: '全能调色', enabled: true, amount: 1, builtin: { id: 'color_grade', params: { exposure: 0.25, temperature_kelvin: 5600, tint: 4, tone_lights: 12, mixer_orange_saturation: -10, wheel_mode: 'primary', global_hue: 200, global_strength: 6 }, curves: { temperature_kelvin: [{ time: 0, value: 5600, interpolation: 'linear' }, { time: 30, value: 6200, interpolation: 'linear' }] } } }, { id: 'golden-blur', name: '高斯模糊', enabled: true, amount: 0.5, builtin: { id: 'gaussian_blur', params: { sigma_fraction_height: 0.003, axis: 'both', edge_mode: 'clamp' } } }]
sequence.clips.push(clip)
sequence.captions = [{ id: 'golden-caption', start: 5, duration: 40, text: '字幕原文', sourceText: '字幕原文、', translation: 'Golden caption' },
  // 29：音频编辑动态链接来的字幕，文字与时间由音频编辑维护
  { id: 'golden-linked-caption', clipId: clip.id, linkedCaptionId: 'transcript-0', start: 50, duration: 20, text: '链接字幕', speech: { text: '链接字幕', aligned: true, words: [{ clipId: clip.id, text: '链接字幕', startUs: 0, endUs: 600000, precision: 'word' }] } }]
sequence.transitions = [{ id: 'golden-transition', kind: 'cross_dissolve', rightClipId: clip.id, durationFrames: 10 }]
sequence.markers = [{ id: 'golden-marker', frame: 20, name: '审查点' }, { id: 'golden-beat', frame: 30, name: '重音', type: 'beat', strength: .9 }]
const goldenAuthor = { kind: 'user' as const, name: '我' }
const goldenMark = (id: string, target: Record<string, unknown>, text: string, style?: { color: string; weight?: string }) => ({ id, frame: 12, space: 'composition-normalized', target, text, status: 'draft', author: goldenAuthor, createdAt: '2026-10-24T00:00:00.000Z', thread: [], ...(style ? { style } : {}) })
sequence.annotations = [
  goldenMark('golden-annotation-region', { kind: 'region', x: .1, y: .1, width: .2, height: .1 }, '这里换成产品图'),
  goldenMark('golden-annotation-arrow', { kind: 'arrow', from: { x: .2, y: .6 }, to: { x: .45, y: .4 } }, '指向这个按钮', { color: 'orange', weight: 'bold' }),
  goldenMark('golden-annotation-ellipse', { kind: 'ellipse', x: .5, y: .5, width: .2, height: .15 }, '圈出的数字放大', { color: 'blue' }),
  goldenMark('golden-annotation-text', { kind: 'text', x: .6, y: .1 }, '标题改短一点'),
  goldenMark('golden-annotation-marker', { kind: 'marker', x: .8, y: .8, number: 2 }, '第二步在这里停顿', { color: 'green' }),
] as typeof sequence.annotations
document.exportHistory = [{ id: 'golden-export', taskId: 'golden-render', sequenceId: sequence.id, name: '黄金导出', presetName: '自定义导出', rangeSource: 'explicit',
  path: '/persistence-project/导出/黄金.mp4', completedAt: Date.parse(timestamp), settings: VIDEO_EDIT_EXPORT_PRESETS[0].settings,
  range: { startFrame: 0, endFrame: 30 }, assetRef: { kind: 'asset', id: 'golden-export-asset' } }]
// 29：动态链接的音频编辑成品记着它由源录音的哪些采样帧区间拼成
document.media.push({ id: 'golden-voice', name: '口播 · 剪后声音', path: '/persistence-project/生成结果/finished-golden.wav', kind: 'audio', width: 0, height: 0, durationSeconds: 3, hasAudio: true, linkedTimeline: { sampleRate: 48000, spans: [0, 48000, 96000, 192000] } })
document.media.push({ id: 'golden-screen', name: '屏幕原片', path: '/persistence-project/素材/screen.mp4', kind: 'video', width: 1920, height: 1080, durationSeconds: 3, recordingCursor: {
  ownerRef: { kind: 'recording_session', id: 'golden-recording' }, sourceDigest: `sha256:${'a'.repeat(64)}`, cursorBakedIn: false, recordingStartUs: 0, width: 1920, height: 1080,
  pages: [{ path: '/persistence-project/素材/events.capture.json', sha256: 'b'.repeat(64), recordingSpanUs: [0, 3000000], seqSpan: [0, 255] }],
} })
document.items.push({ id: 'golden-screen-item', name: '屏幕原片', kind: 'video', mediaId: 'golden-screen' })
const cursorClip = makeVideoEditItemClip(document, 'golden-screen-item', sequence.id, { frame: 90, duration: 90 })
cursorClip.id = 'golden-cursor-clip'
cursorClip.effects = [{ id: 'golden-cursor', name: '录制光标', enabled: true, amount: 1, builtin: { id: 'recording_cursor', params: { size: 3, smoothing: 40, click_style: 'ripple' } } },
  { id: 'golden-zoom', name: '自动缩放', enabled: true, amount: 1, builtin: { id: 'recording_zoom', params: { connect: true, transition: 'smooth' }, regions: [
    { id: 'golden-zoom-follow', startUs: 500000, endUs: 1500000, depth: 3, focus: 'cursor', origin: 'auto' },
    { id: 'golden-zoom-fixed', startUs: 2000000, endUs: 2800000, depth: 5, focus: { x: 0.8, y: 0.2 }, origin: 'manual' },
  ] } },
  { id: 'golden-frame', name: '录屏画框', enabled: true, amount: 1, builtin: { id: 'recording_frame', params: { background: 'solid', color: RECORDING_FRAME_SOLID_DEFAULT_HEX, padding: 6, radius: 2.5, shadow: 50 } } }]
cursorClip.curves = { scale: [{ time: 0, value: 1, interpolation: 'linear', source: 'screen_attention', reframeOrigin: { time: 0, value: 1, interpolation: 'linear' } }, { time: 45, value: 1.8, interpolation: 'linear', source: 'screen_attention', reframeOrigin: { time: 45, value: 1.8, interpolation: 'linear' } }] }
// 剪辑内容 v20：两点跟踪的变换跟随（旋转、缩放）、录屏光标事件跟踪、防抖参数。
cursorClip.trackers = [
  { id: 'golden-two-point', name: '两点', method: 'point', prompts: [{ timeUs: 0, points: [[0.3, 0.4, 1], [0.6, 0.5, 1]] }] },
  { id: 'golden-cursor-track', name: '光标', method: 'point', prompts: [{ timeUs: 0, points: [[0.5, 0.5, 1]], window: { feature: 0.06, search: 0.2 } }], recording: { kind: 'cursor' } },
]
cursorClip.stabilization = { smoothness: 'natural', maxCrop: 0.1, rotation: true, scale: false }
clip.follow = { clipId: cursorClip.id, trackerId: 'golden-two-point', offsetX: 0.05, offsetY: -0.02, motion: { rotation: 12.5, size: 0.3 } }
sequence.clips.push(cursorClip)
const holdClip = makeVideoEditItemClip(document, 'golden-screen-item', sequence.id, { frame: 180, duration: 30 })
holdClip.id = 'golden-frame-hold'
holdClip.frameHold = true
sequence.clips.push(holdClip)
// 剪辑内容 v19：速度曲线（缓入慢放再加速）、帧混合与变调。
const remapClip = setVideoEditClipTimeRemap(makeVideoEditItemClip(document, 'golden-screen-item', sequence.id, { frame: 210, duration: 60 }), { points: [
  { offsetUs: 0, speed: 1, interpolation: 'ease' }, { offsetUs: 600000, speed: 0.25, interpolation: 'hold' }, { offsetUs: 900000, speed: 0.25, interpolation: 'linear' }, { offsetUs: 1500000, speed: 2, interpolation: 'linear' },
] }, videoEditFps(sequence.frameRate))
remapClip.id = 'golden-time-remap'
remapClip.frameInterpolation = 'blend'
remapClip.preservePitch = true
remapClip.pitchSemitones = 2
sequence.clips.push(remapClip)
// v22：工程风格副本（说明书 + 样片代码）绑定序列；代码模板联动代码定义，原生模板联动带 templateId 的图形片段。
// v30（剪辑）/ v3（风格库、风格包）/ v33（录制会话）：样片画布放宽到 3840×2160、60 帧，黄金风格按 4K60 写。
const goldenStyle = { userPreferences: [{ id: 'golden-style-memory', content: '标题少用装饰线。', source: 'user' as const, updatedAt: timestamp, revision: 1 }], id: 'golden-style', name: '黄金风格', description: '用于持久格式样本的风格。', version: 2, contentHash: 'a'.repeat(64), updatedAt: timestamp, guide: styleGuideTemplate('黄金风格', '冷静的科技讲解'), sample: { code: { entry: 'index.js', files: { 'index.js': BLANK_STYLE_SAMPLE_SOURCE } }, width: 3840, height: 2160, durationSeconds: 8, fps: 60, thumbnail: 1.2, anchors: [1.2, 3.2, 5.2, 6.4, 7.8] } }
document.styles = [goldenStyle]
sequence.styleId = goldenStyle.id
const nativeGraphic = titleGraphic('lower_third', { text: '姓名', subtitle: '职务' }, 1920, 1080, 119 / 30)
const nativeClipContent = { name: '人名条', kind: 'graphic' as const, graphic: nativeGraphic, track: 0, start: 0, duration: 120, sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, volume: 1, text: '' }
document.templates = [
  { id: 'golden-code-template', name: '代码标题模板', description: '换文字就能复用的标题。', version: 1, contentHash: 'b'.repeat(64), updatedAt: timestamp, style: { id: goldenStyle.id, version: 2 }, origin: { id: 'golden-library-template', version: 3 }, body: { kind: 'code', definitionId: 'code-definition' } },
  { id: 'golden-native-template', name: '人名条', description: '人物首次出场时介绍姓名。', version: 2, contentHash: 'c'.repeat(64), updatedAt: timestamp, style: null, origin: null, body: { kind: 'native', content: { width: 1920, height: 1080, fps: 30, clips: [nativeClipContent] } } },
]
document.items.push({ id: 'golden-native-item', name: '人名条', kind: 'graphic', graphic: nativeGraphic })
const nativeClip = makeVideoEditItemClip(document, 'golden-native-item', sequence.id, { frame: 300, duration: 120 })
nativeClip.id = 'golden-native-instance'; nativeClip.templateId = 'golden-native-template'; nativeClip.graphic = nativeGraphic
sequence.clips.push(nativeClip)
// 2026-10-22 之前的说明书风格与标题模板只出现在旧格式样本里，读取原样本作为这些冻结格式的当前内容。
const legacyFixture = (id: string, version: number): unknown => (JSON.parse(fs.readFileSync(path.join('tests/fixtures/persistence', id, `v${version}.json`), 'utf8')) as { content: unknown }).content
const legacyKits = legacyFixture('style-kits', 3) as unknown[]
const legacyTitles = legacyFixture('title-templates', 6) as unknown[]
const legacyPresetItems = (JSON.parse(fs.readFileSync('tests/fixtures/persistence/video-preset-package/v6.json', 'utf8')) as { items: unknown[] }).items
// v23：源增益独立保存，保留音量与关键帧。
videoEditDocumentSchema.parse(document)
// 第 28 版：音轨混音（音量、声像、轨道效果）与主轨。
const mixedTrack = sequence.tracks.find(track => track.kind === 'audio')!
Object.assign(mixedTrack, { volumeDb: -3, pan: -20, effects: [{ id: 'golden-track-eq', name: '高通（去低频）', enabled: true, amount: 1, builtin: { id: 'high_pass', params: { frequency: 80, slope: 'gentle' } } }] })
sequence.master = { volumeDb: -1, effects: [{ id: 'golden-master-limiter', name: '限幅器', enabled: true, amount: 1, builtin: { id: 'limiter', params: { ceiling: -1, boost: 0 } } }] }
const { format: _format, version: _version, id: _id, name: _name, revision: _revision, ...videoContent } = document
const soundDocument = createVideoEditDocument('节拍声音样本'), soundSequence = createVideoEditSequence()
soundSequence.id = 'golden-sound-sequence'; soundDocument.sequences.push(soundSequence)
soundDocument.media.push({ id: 'golden-sound', name: '鼓点', path: '/persistence-project/素材/鼓点.wav', kind: 'audio', durationSeconds: 3, width: 0, height: 0, hasAudio: true })
soundDocument.items.push({ id: 'golden-sound-item', name: '鼓点', kind: 'audio', mediaId: 'golden-sound' })
const soundClip = makeVideoEditItemClip(soundDocument, 'golden-sound-item', soundSequence.id, { frame: 0, duration: 90 })
soundClip.gainDb = 19
soundClip.id = 'golden-sound-clip'; soundClip.snapToBeat = true; soundClip.pitchSemitones = -3
soundClip.remix = { id: 'golden-remix', segment: 0, targetFrames: 90, repetition: 0.5, granularity: 'bar', seed: 0, analysisIdentity: `music-v1:${'b'.repeat(64)}`, sourceInUs: 0, sourceOutUs: 3000000 }
document.media.push(...soundDocument.media)
document.items.push(...soundDocument.items)
clip.contentAnchor = { ranges: [{ clipId: soundClip.id, itemId: soundClip.itemId, fromUs: 0, toUs: 3000000 }], startOffsetSeconds: 0, endOffsetSeconds: 0 }
sequence.clips.push(soundClip)
sequence.captions = sequence.captions.map(caption => ({ ...bindVideoEditCaptionSpeech(caption, [
  { clipId: soundClip.id, text: '字幕', startUs: 166667, endUs: 700000, precision: 'word' },
  { clipId: soundClip.id, text: '原文', startUs: 700000, endUs: 1500000, precision: 'word' },
]), reviewReasons: ['translation'] }))
const image = createImageEditDocumentV3({ width: 64, height: 48, documentId: 'golden-image', color: createDefaultImageEditColorModeV3() })
image.namedRegions = [{ id: 'golden-region', name: '主体', selection: { operations: [{ combine: 'replace', invertBefore: false, shape: { type: 'ellipse', x: .2, y: .1, width: .5, height: .7 } }], feather: .02, inverted: false } }]
image.namedRegions.push({id:'golden-outside',name:'画面外范围',selection:{operations:[{combine:'replace',invertBefore:false,shape:{type:'rectangle',x:-.4,y:1.1,width:1.5,height:.4}}],feather:0,inverted:false}})
image.namedRegions.push({id:'golden-float32',name:'精细范围',selection:{operations:[{combine:'replace',invertBefore:false,shape:{type:'mask',width:2,height:2,runs:[[0,1,Math.fround(.123456789)],[1,1,Math.fround(.50000006)],[2,1,1]],matrix:[1,0,0,1,0,0]}}],feather:0,inverted:false}})
image.layers.push(createImageEditRasterLayerV3('golden-layer', '空白图层'))
image.layers[0].fillOpacity = .7
image.layers[0].deformation = { kind: 'perspective', points: [[.1, 0], [.9, 0], [1, 1], [0, 1]] }
image.layers[0].maskAttachment.linked = false
image.layers[0].maskAttachment.density = .6
image.layers[0].filters = [{ id: 'golden-local-grade', operationType: 'adjustment', effectId: 'exposure',
  params: { stops: .4 }, enabled: true, opacity: .8, blendMode: 'normal', mask: null }]
image.layers.push(createImageEditAdjustmentLayerV3('golden-shared-grade', '共享调整', 'color_grade', {
  exposure: .25, curve_red_points: [{ x: 0, y: 0 }, { x: 50, y: 60 }, { x: 100, y: 100 }], shadow_hue: 230, shadow_strength: 12, hsl_saturation: -15,
  temperature_kelvin: 7200, tint: -3, tone_shadows: 10, mixer_blue_luminance: -15, grade_balance: 10, global_luminance: 4,
}))
image.layers.push(createImageEditEffectLayerV3('golden-shared-gaussian', '高斯模糊', 'gaussian_blur', { sigma_fraction_height: .009, axis: 'horizontal', edge_mode: 'transparent' }))
const annotation = createImageEditPathLayerV3('golden-quick-marks', '快速标记')
annotation.content.paint.strokes=[{enabled:true,color:BLACK_HEX,width:2,position:'center'}]
image.layers.push(annotation)
image.layers[0] = embedImageEditRasterV3(image, 'golden-layer')
image.layers[0].content.id = 'golden-smart-content'
image.layers[0].content.document.id = 'golden-smart-document'
image.layers[0].content.document.layers[0].id = 'golden-smart-inner-layer'
image.layers.push({ ...structuredClone(image.layers[0]), id: 'golden-smart-instance', transform: [1, 0, 0, 1, 4, 2] })
image.geometry.orientation = { rotate: 90, mirrored: true }
image.geometry.crop = { x: 1, y: 2, width: 32, height: 40 }
const owner={kind:'image_edit.document',id:`v3:${image.id}`},sourceDigest=`sha256:${'d'.repeat(64)}`
const basis=createMotionFixture('S01').input
const staticEntries=[image.layers[0],image.layers[3],image.layers[4]].map((layer,i)=>{
  const ref={kind:'image_edit.layer',id:`v3:${image.id}:${layer.id}`}
  const parent=composeAffine([1,0,0,1,-1,-2],composeAffine([0,1,-1,0,48,0],[-1,0,0,1,64,0])),affine=composeAffine(parent,layer.transform)
  const sample={...basis.samples[0],pose:{position:[affine[4]/64,affine[5]/48],scaleXY:[Math.hypot(affine[0],affine[1]),Math.hypot(affine[2],affine[3])],rotationTurns:Math.atan2(affine[1],affine[0])/(2*Math.PI),pivot:[.5,.5]},targetRef:ref,sampleId:`golden-layout:${i}`,takeRef:'golden-layout-take',clockSegmentRef:'static',seq:i,monoUs:i,timeline:null,unavailableReason:'static' as const,event:'up' as const}
  return {layerId:layer.id,sample,localAffine:layer.transform,parentAffine:parent,item:{targetRef:ref,affine,worldCorners:([[0,0],[32,0],[32,40],[0,40]] as [number,number][]).map(p=>mapAffine(affine,p)),translationLocked:i===0}}
})
const layoutPage=imageLayoutPageSchema.parse({version:1,kind:'image-layout',ownerRef:owner,sourceDigest,baseDigest:`sha256:${createHash('sha256').update(JSON.stringify({geometry:image.geometry,color:image.color,layers:image.layers})).digest('hex')}`,entries:staticEntries})
const samplePage=creativeIntentPageSchema.parse({version:1,kind:'samples',ownerRef:owner,sourceDigest,monoSpanUs:[0,2],seqSpan:[0,2],count:3,entries:staticEntries.map(e=>e.sample)})
const goldenDigest=(v:unknown):string=>`sha256:${createHash('sha256').update(JSON.stringify(v)).digest('hex')}`
const layoutBases=staticEntries.map(e=>({targetRef:e.item.targetRef,baseDigest:goldenDigest(e.localAffine),geometryDigest:goldenDigest([e.parentAffine,e.item.worldCorners])}))
const layoutCandidate=imageLayoutCandidateSchema.parse({version:1,id:'align',label:'按真实边缘整理',identity:imageLayoutIdentity(sourceDigest,owner,layoutBases,0),changes:staticEntries.map(e=>({targetRef:e.item.targetRef,affine:e.item.affine,delta:[0,0]})),maxConstraintError:0})
const stored=(value:unknown,kind:'page'|'recipe'|'candidate')=>{const bytes=Buffer.from(JSON.stringify(value)),id=`sha256:${createHash('sha256').update(bytes).digest('hex')}`;return {resourceId:id,digest:id,bytes:bytes.byteLength,path:`resources/${id.slice(7)}`,kind,sourceDigest}}
const geometryResource=stored(layoutPage,'recipe'),sampleResource=stored(samplePage,'page'),candidateResource=stored(layoutCandidate,'candidate')
image.creativeIntents=creativeIntentsSchema.parse({drafts:[{...basis.draft,id:'golden-layout',ownerRef:owner,mode:'static',label:'随手摆',fidelity:0,sourceDigest,
  targets:staticEntries.map((e,i)=>({...basis.draft.targets[0],ref:e.item.targetRef,basePose:e.sample.pose,baseDigest:layoutBases[i].baseDigest,geometryDigest:layoutBases[i].geometryDigest,ownerRef:owner,compositionSize:[64,48]})),
  clockSegments:[{id:'static',monoSpanUs:[0,3],mode:'hold',start:null,end:null,anchors:[]}],
  takes:[{id:'golden-layout-take',intent:'demonstrate',placement:true,pathDemonstration:false,monoSpanUs:[0,3],direction:0,visitRef:null,timelineRange:null,geometryDigest:sourceDigest,samplePages:[{resourceId:sampleResource.resourceId,digest:sampleResource.digest,bytes:sampleResource.bytes,kind:'samples',count:3,monoSpanUs:[0,2],seqSpan:[0,2]}]}],
  pins:[{id:'golden-pin',sampleId:staticEntries[0].sample.sampleId,targetRef:staticEntries[0].item.targetRef,properties:['position'],valueLocked:true,timeLocked:false}],constraints:[],
  recipeRefs:[{resourceId:geometryResource.resourceId,digest:geometryResource.digest,bytes:geometryResource.bytes}],candidateRefs:[{resourceId:candidateResource.resourceId,digest:candidateResource.digest,bytes:candidateResource.bytes}],selectedCandidateRef:candidateResource.resourceId,applications:[]}],sessions:[],resources:[geometryResource,sampleResource,candidateResource]})
const goldenHistory=new ImageEditCommandHistoryV3()
const goldenBody=goldenHistory.execute(image,{type:'document.atomic',commandId:'golden-atomic',expectedRevision:0,commands:[{type:'document.set-named-regions',commandId:'golden-regions',expectedRevision:0,regions:image.namedRegions}]})
const goldenHistoryPage=[...splitImageEditHistoryPagesV3(goldenHistory.createSnapshot())][0]
const historyBytes=Buffer.from(JSON.stringify(goldenHistoryPage)),historyId=goldenDigest(goldenHistoryPage)
const working = { format: 'henji-image-edit', formatVersion: IMAGE_WORKING_VERSION, documentId: image.id, revision:goldenBody.revision, createdAt: timestamp, updatedAt: timestamp, document:goldenBody,
  historyCheckpoint:{format:'henji-image-history',version:2,documentId:image.id,headRevision:goldenBody.revision,snapshotVersion:2,position:1,total:1,pages:[{resourceId:historyId,byteSize:historyBytes.byteLength,start:0,count:1}],resources:[]},resourceRefs:[...image.creativeIntents.resources.map(r=>r.resourceId),historyId].sort() }
const replayBaseline = createVideoEditDocument('重放起点')
replayBaseline.id = 'golden-replay'
const replaySequence = createVideoEditSequence('原始序列')
replaySequence.id = 'golden-replay-sequence'; replaySequence.styleId = goldenStyle.id; replayBaseline.sequences.push(replaySequence)
replayBaseline.styles = [goldenStyle]
const replayOperation = { target: { kind: 'video_edit.sequence', id: 'golden-replay:golden-replay-sequence' }, properties: { 'video_edit.sequence.name': '演示序列' } }
const values: Record<string, unknown> = {
  'document.screen_recording': { ...createRecordingDocument(), sessionId: '00000000-0000-4000-8000-000000000005', originUs: 1000000, startUs: 3000000, endUs: 13000000, pauses: [{ startUs: 6000000, endUs: 7000000 }], status: 'stopped',
    source: { name: '合成显示器', options: { sourceId: 'screen:1:0', backend: 'auto', width: 1920, height: 1080, fps: 30, bitrate: 12000000 }, cursorEmbedded: false, cursor: { size: 1.4, style: 'light' } },
    media: [{ id: 'screen-0', kind: 'screen', path: '/persistence-project/素材/screen.mp4', monoUs: 3000000, durationUs: 10000000 }],
    eventPages: [{ path: `/persistence-project/素材/0000000000000000-${'a'.repeat(64)}.capture.json`, firstSequence: 0, lastSequence: 2 }], markers: [{ id: 'golden-mark', monoUs: 4000000, note: '重点' }],
    scriptCapture: { baselines: [{ documentId: replayBaseline.id, content: replayBaseline }], calls: [{ callId: '00000000-0000-4000-8000-000000000006', operations: [replayOperation] }] },
    directorRun: { takes: [{ stepId: 'step', identity: 'golden', path: '/persistence-project/素材/voice.wav', durationUs: 1000000 }], redubs: [{ clipId: 'clip', documentId: 'video', identity: 'redub', taskId: 'task' }] },
    understanding: { director: { goal: '演示编辑器', confirmed: true, voice: { modelId: 'golden-tts', options: { voice_id: 'speaker' } }, narration: [{ stepId: 'step', text: '打开编辑器', picture: '剪辑工作区' }] }, operationScript: { steps: [{ id: 'step', title: '打开编辑器', startUs: 3000000, endUs: 13000000, operations: [replayOperation], narrationIds: ['word'], wait: { kind: 'capability_completed', settleMs: 700 }, blockedReason: null }] }, privacy: { candidates: [{ id: 'privacy', mediaId: 'screen-0', kind: 'email', hint: '••••', fingerprint: 'a'.repeat(64), startUs: 3000000, endUs: 5000000, status: 'accepted', samples: [{ monoUs: 3000000, box: [.1, .2, .4, .1], confidence: .99 }, { monoUs: 4000000, box: [.1, .3, .4, .1], confidence: .98 }] }], warnings: [] }, transcript: [{ id: 'word', startUs: 3000000, endUs: 4000000, text: '打开编辑器', granularity: 'word', audioDocumentId: 'audio', mediaId: 'mic', protected: false }],
      steps: [{ id: 'step', startUs: 3000000, endUs: 13000000, title: '打开编辑器', description: '进入编辑器', signal: 'capability', eventIds: ['event'] }],
      candidates: [{ id: 'wait', startUs: 5000000, endUs: 9000000, kind: 'wait', reason: '画面静止、无输入、无旁白', status: 'pending', eventIds: [] }],
      chapters: [{ id: 'chapter', title: '编辑', stepIds: ['step'] }], warnings: [] } },
  'image-layout-page':layoutPage,
  'image-layout-candidate':layoutCandidate,
  'creative-intent-page': (() => { const { draft, samples } = createMotionFixture('S01').input; return { version: 1, kind: 'samples', ownerRef: draft.ownerRef, sourceDigest: draft.sourceDigest, monoSpanUs: [samples[0].monoUs, samples[samples.length - 1].monoUs], seqSpan: [samples[0].seq, samples[samples.length - 1].seq], count: samples.length, entries: samples } })(),
  'creative-intent-candidate': { version: MOTION_CANDIDATE_VERSION, ...optimizeMotionDraft(createMotionFixture('S01').input).candidates[0] },
  'document.video_edit': videoContent,
  'document.canvas': { nodes: [{ id: 'golden-node', type: 'textDisplay', position: { x: 0, y: 0 }, data: { text: '黄金样本' } }], edges: [] },
  'document.audio_edit': { gainRegions: [{ id: 'gain', startFrame: 0, endFrame: 24000, gainDb: -6, fadeInFrames: 100, fadeOutFrames: 100, enabled: true }], repairs: [{ id: 'repair', kind: 'spectral_heal', startFrame: 1000, endFrame: 2000, lowHz: 100, highHz: 1000, strength: .5, enabled: true, strokes: [{ radius: .1, radiusY: .2, points: [{ x: .5, y: .5 }] }] }], source: { mediaType: 'audio', sourcePath: '/persistence-project/素材/voice.wav', audioPath: '/persistence-project/素材/voice.wav', durationFrames: 48000, sampleRate: 48000, channels: 1 }, referenceScript: '参考稿', transcript: [{ id: 'word', text: '你好', startFrame: 0, endFrame: 24000, included: true, locked: false, granularity: 'word' }], suggestions: [], cuts: [{ id: 'cut', startFrame: 24000, endFrame: 48000, reason: 'manual', enabled: true }],
    effectChain: [
      { id: 'fx-declick', kind: 'mouth_declick', enabled: true, sensitivity: 50, analyzed: true, clicks: [{ startFrame: 3000, endFrame: 3120 }], skipped: [{ startFrame: 9000, endFrame: 9080 }] },
      { id: 'fx-breath', kind: 'breath', enabled: true, mode: 'attenuate', reductionDb: -12, analyzed: true, breaths: [{ startFrame: 12000, endFrame: 14400 }] },
      { id: 'fx-dereverb', kind: 'separation', enabled: false, mode: 'dereverb', amount: .8 },
      { id: 'fx-plugin', kind: 'plugin', name: 'RX 10 Voice De-noise', enabled: false, pluginId: 'rx-golden', parameters: { Threshold: .4 } },
      { id: 'fx-essential', kind: 'essential', enabled: true, settings: { type: 'dialogue', repair: { noise: { enabled: true, amount: 50 }, hum: { enabled: false, amount: 60, mains: 50 } }, clarity: { eq: { enabled: true, amount: 50, preset: 'podcast' } } } },
      { id: 'fx-comp', kind: 'builtin', name: '压缩器', enabled: true, amount: 1, builtin: { id: 'compressor', params: { amount: 40, speed: 'normal', makeup: true } } },
    ],
    chainBypassed: false, output: { volumeDb: -1.5, loudness: { enabled: true, targetLufs: -16, gainDb: 3.5 } } },
  'document.camera_stage': { objects: [{ id: 'camera', name: '主摄影机', type: 'camera', position: [0, 1, 5] }], activeCameraId: 'camera', sceneSettings: { sky: {} }, stateKeyframes: [{ id: 'key', time: 0, objects: {} }] },
  'document.image_document': { workingRevision: 0, emptyUntilRevision: 0, width: 32, height: 40, layers: image.layers.length },
  project: buildProjectManifest({ id: 'golden-project', createdAt: timestamp, locale: 'zh', draft: false, mainVideoEditId: document.id, memories: [{ id: 'brand', content: '这期品牌色用红色。', source: 'user', revision: 1, updatedAt: timestamp }] }),
  'project-package': { format: 'henji-package', version: 1, type: 'project', name: '黄金项目', exportedAt: timestamp, folders: { generated: '生成结果', materials: '素材' }, documents: [{ id: document.id, path: '黄金剪辑.henji-video' }] },
  'code-version': { id: 'code-version', ...sourceVersion },
  'code-author-api': { apiVersion: CODE_AUTHOR_API_VERSION },
  'code-component': { schemaVersion: 1, name: '组件', version: 1, description: '黄金组件', exports: ['value'], imports: [] },
  'code-asset': codeAssetSchema.parse({ format: 'henji-code-asset', version: CODE_ASSET_VERSION, name: '代码标题', sourceVersion, codeSources: [{ hash, source }], parameters: { label: '黄金样本' }, curves: {}, images: [] }),
  'image-header': { format: 'henji-image-document', version: 1, id: image.id, revision: 0, kindVersion: 1, createdAt: timestamp, updatedAt: timestamp, contentRevision: 0, emptyUntilRevision: 0, summary: { width: 32, height: 40, layers: image.layers.length } },
  'image-package': { packageFormat: 'henjiimg', packageVersion: IMAGE_PACKAGE_VERSION, createdAt: timestamp, document: working, resources: [...image.creativeIntents.resources.map(r=>({resourceId:r.resourceId,sha256:r.digest.slice(7),byteLength:r.bytes,path:r.path,mediaType:'application/vnd.henji.layout+json'})),{resourceId:historyId,sha256:historyId.slice(7),byteLength:historyBytes.byteLength,path:`resources/${historyId.slice(7)}`,mediaType:'application/vnd.henji.image-history+json'}] },
  'image-working-copy': working,
  settings: { providerKeyStatus: { kie: false }, uploadProvider: 'kie', uploadFallbackEnabled: false, canvasLodLevel: 'balanced', videoEditBinsFirst: true, experimentalWebAppRecording: true, videoEditClipThumbnails: 'head_tail' },
  theme: { theme: 'dark' },
  'style-kits': legacyKits,
  'title-templates': legacyTitles,
  'video-style-library': goldenStyle,
  'video-template-library': { id: 'golden-library-template', name: '黄金模板', description: '代码标题模板。', version: 3, contentHash: 'd'.repeat(64), updatedAt: timestamp, style: { id: goldenStyle.id, version: 2 }, body: { kind: 'code', code: { entry: 'main.ts', files: { 'main.ts': source } }, durationSeconds: 4 } },
  'video-style-package': { format: 'henji-video-style', style: { ...goldenStyle, imported: true }, templates: [{ id: 'golden-library-template', name: '黄金模板', description: '代码标题模板。', version: 3, contentHash: 'd'.repeat(64), updatedAt: timestamp, style: { id: goldenStyle.id, version: 2 }, body: { kind: 'native', content: { width: 1920, height: 1080, fps: 30, clips: [nativeClipContent] } } }], media: { thumbnail: '/9j/4AAQ', anchors: ['/9j/4AAQ'] } },
  'text-presets': [{ id: 'golden-text', name: '黄金字型', style: videoEditTextStyleSchema.parse({}) }],
  'export-presets': [{ ...VIDEO_EDIT_EXPORT_PRESETS[0], id: 'golden-export', name: '黄金导出' }],
  'preset-preferences': [{ category: 'style', id: 'golden-kit', rating: 5, isDefault: true }, { category: 'transition', id: 'cross_dissolve', rating: 3, isDefault: false }],
  'video-preset-package': { format: 'henji-video-presets', version: VIDEO_EDIT_PRESET_PACKAGE_VERSION, items: legacyPresetItems },
  'voice-library': [{ voiceId: 'golden-voice', voiceName: '黄金音色', providerId: 'kie', createdAt: timestamp, updatedAt: timestamp, status: 'ready', activated: true }],
  'sound-library-folders': [{ id: '00000000-0000-4000-8000-000000000001', path: '/persistence-project/音效', addedAt: timestamp }],
  'preset-export': { version: '1.0', name: '黄金生成预设', description: null, modelId: null, params: { prompt: '黄金样本' } },
  'theme-payload': createThemePayloadV2({ seed: DEFAULT_THEME_SEED }),
  'canvas-layer-package': { format: 'henji-canvas-layer', version: CANVAS_LAYER_PACKAGE_VERSION, documentId: image.id, contentRevision: 0 },
  keystore: { version: 1, keys: {} },
  'media-grants': { version: 1, roots: [{ path: '/persistence-project', grantedAt: 1791504000000 }] },
  'web-recording': {
    version: 3, minReaderVersion: 1, id: '00000000-0000-4000-8000-0000000000a1', status: 'complete', createdAt: timestamp, title: '提问演示',
    app: { name: '知多少', version: '0.1.0' }, probe: { version: '0.1.0', protocol: 1 }, host: 'tauri',
    env: { url: 'http://tauri.localhost/', viewport: { width: 1280, height: 820, dpr: 1.5 }, colorScheme: 'light', reducedMotion: false, locale: 'zh-CN', timeZone: 'Asia/Shanghai', userAgent: 'golden' },
    wallAtZeroMs: 1791504000000, durationUs: 15688200, clock: { monoAtZeroUs: 140618465380, uncertaintyUs: 223 }, fonts: ['Microsoft YaHei'],
    warnings: [{ t: 7400, kind: 'boundary', message: 'xhr: GET /x' }],
  },
  'web-recording-backup-timing': { originUs: 140619097663, spans: [{ monoUs: 666267, durationUs: 15000000 }] },
  'llm-config': llmStoredConfigSchema.parse({ providers: [{ providerId: 'synthetic', displayName: '合成测试供应商', adapter: 'openai', enabled: false }], models: [], promptProfiles: [], textProcessingPromptTemplates: [], agentProfiles: [{ id: 'golden-agent', name: '测试助手', primary: { providerId: 'synthetic', modelId: 'test' }, settings: { timeoutMs: 60000, maxRetries: 0, maxOutputTokens: 4096, contextWindowBudget: 64000 }, verifications: [], createdAt: timestamp, updatedAt: timestamp }], tools: [], policy: { allowedTools: [], requireHumanConfirmation: true }, memory: { longTermNamespace: 'golden' } }),
  'mcp-connections': mcpConnectionStorageSchema.parse({ version: 2, connections: [{ id: '00000000-0000-4000-8000-000000000001', name: '合成测试连接', token: '0'.repeat(64), allowWrites: true, allowPaid: false, allowDestructive: false }] }),
  'document-envelope': buildDocumentEnvelope({ kind: 'canvas', kindVersion: 1, id: 'golden-envelope', name: '外壳样本', createdAt: timestamp, updatedAt: timestamp, revision: 0, draft: false, content: { nodes: [], edges: [] } }),
  'llm-config-journal': { version: 1, configBefore: null },
  'node-defaults': { imageGen: { modelId: 'golden-model', params: { quality: 'high' } } },
  'screen-capture': { version: 2, minReaderVersion: 1, sessionId: '00000000-0000-4000-8000-000000000001', options: { sourceId: 'screen:0:0', backend: 'auto', width: 1920, height: 1080, fps: 60, bitrate: 18000000, codec: 'hevc', rateControl: 'quality', keyframeFrames: 30, encoder: 'nvidia' }, backend: 'gfxcapture', cursorEmbedded: false, status: 'stopped', spans: [], encoding: { codec: 'hevc', encoder: 'hevc_nvenc', softwareFallback: false } },
  'recording-setup': { rateControl: 'quality', codec: 'hevc', keyframeFrames: 30, encoder: 'auto', range: 'region', sourceId: 'screen:1:0', region: { x: .1, y: .1, width: .5, height: .5 }, mode: 'quick', saveDirectory: 'D:/录屏', microphone: true, systemAudio: true, camera: false, cameraId: '', quality: '1440p', fps: 60, insert: true, webAppBackup: { enabled: true, range: 'screen', sourceId: 'screen:1:0', microphone: true, systemAudio: false, quality: '2160p', fps: 30, rateControl: 'vbr', bitrate: 20_000_000 } },
  'model-defaults': modelDefaultsSchema.parse({ version: MODEL_DEFAULTS_VERSION, providerId: 'kie', models: { image: '', video: '', audio: '', transcription: 'groq.speech-recognition.whisper-large-v3-turbo' } }),
  onboarding: { version: 2, status: 'in_progress', entryReason: 'fresh_install', activeStepId: 'provider', completedStepIds: ['welcome'], configuredProviders: [], verifiedProviders: [], shownHintIds: [], firstTaskPrepared: false, firstTaskCompleted: false, startedAt: timestamp, completedAt: null },
  'subtitle-manifest': { version: SUBTITLE_MANIFEST_VERSION, projectId: document.id, sequenceId: sequence.id, signature: 'golden-signature', startFrame: 0, endFrame: 90, soundClips: [soundClip], soundIdentities: { 'golden-sound-clip': 'golden-sound-identity' }, captions: sequence.captions, committed: true },
  'storyboard-metadata': { version: 1, gridRows: 2, gridCols: 2, frameNotes: ['远景', '特写'] },
  'workspace-layouts': createWorkspaceLayoutEnvelope({ activeId: 'default', current: defaultCameraStageLayout(), users: [{ id: 'user-golden', name: '个人布局', layout: defaultCameraStageLayout(true) }] }),
  'audio-capture-recovery': { version: 2, minReaderVersion: 1, files: ['录音 2026-10-23 120000.wav'], placements: { '录音 2026-10-23 120000.wav': { projectId: 'golden-audio_edit', startFrame: 48000, endFrame: 96000, revision: 1, spliceId: 'eced7817-a431-49e0-8890-5bf4b08ecb44' } } },
  'audio-capture-settings': audioCaptureSettingsEnvelopeSchema.parse({ version: 1, minReaderVersion: 1, settings: DEFAULT_AUDIO_CAPTURE_SETTINGS }),
  'setting-records': { key: 'user_data_root', value: '{"root":"/persistence-project","locale":"zh"}', type: 'json' },
  'asset-records': { id: 'golden-asset', media_type: 'code', display_name: '代码标题', file_path: '/persistence-project/代码/标题.henjicode', source: 'video-edit', mime_type: 'application/x-henji-code', size_bytes: 100, width: null, height: null, duration_seconds: null, thumbnail_name: null, inspection_status: 'pending', inspection_error: null, file_modified_at: null, content_identity: null, last_used_at: null, created_at: 1791504000000, updated_at: 1791504000000 },
  'generation-presets': { id: 'golden-preset', name: '黄金生成预设', description: null, model_id: null, params: '{}', is_favorite: 0, use_count: 0, created_at: timestamp, updated_at: timestamp },
  'assistant-memory': emptyMemorySnapshot(),
  sqlite: { version: 22, name: 'replace_assistant_memory_user_authorized_reset', applied_at: 1791504000000 },
}

/** Immutable layout bodies used by the official ZIP fixture authoring tool. */
export function getImageLayoutFixtureResources(): readonly unknown[] {
  return [layoutPage, samplePage, layoutCandidate]
}

/** Explicit authoring tool. Never rewrite an existing golden sample. */
export function generatePersistenceFixtures(root = process.cwd(), only?: string): number {
  for (const format of PERSISTENCE_FORMATS) {
    if (only && format.id !== only) continue
    const content = format.schema.parse(values[format.id])
    const raw = format.id.startsWith('document.') ? buildDocumentEnvelope({ kind: format.id.slice('document.'.length), kindVersion: format.version, kindMinReaderVersion: format.minReaderVersion ?? format.version, id: `golden-${format.id.split('.')[1]}`, name: format.name, createdAt: timestamp, updatedAt: timestamp, revision: 0, draft: false, content })
      : format.id === 'settings' || format.id === 'theme' ? { version: format.version, state: content }
      : (format.storage === 'local-storage' && !['model-defaults', 'onboarding'].includes(format.id)) || ['voice-library', 'llm-config', 'sound-library-folders'].includes(format.id) ? { version: format.version, content } : ['video-style-library', 'video-template-library', 'video-style-package'].includes(format.id) ? { version: format.version, minReaderVersion: format.minReaderVersion ?? format.version, content } : content
    const directory = path.join(root, 'tests/fixtures/persistence', format.id)
    fs.mkdirSync(directory, { recursive: true })
    fs.writeFileSync(path.join(directory, `v${format.version}.json`), `${JSON.stringify(raw, null, 2)}\n`, { flag: 'wx' })
  }
  return PERSISTENCE_FORMATS.length
}
