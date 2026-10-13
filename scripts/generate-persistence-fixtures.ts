import { mcpConnectionStorageSchema } from '../src/core/persistence/mcpConnectionSchema'
import { llmStoredConfigSchema } from '../src/core/persistence/llmSchemas'
import { compileCodeMaterial } from '../src/core/videoEdit/codeMaterial/compiler'
import fs from 'node:fs'
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
import { codeAssetSchema } from '../src/core/videoEdit/codeAsset'
import { BUILTIN_STYLE_KITS } from '../src/core/videoEdit/styleKitPresets'
import { BUILTIN_TITLE_TEMPLATES } from '../src/core/videoEdit/titleTemplates'
import { VIDEO_EDIT_EXPORT_PRESETS } from '../src/core/videoEdit/exportPresets'
import { videoEditTextStyleSchema } from '../src/core/videoEdit/text'
import { createImageEditDocumentV3, createImageEditEffectLayerV3, createImageEditRasterLayerV3, createImageEditAdjustmentLayerV3, createImageEditPathLayerV3 } from '../src/core/imageEdit/v3/documentFactory'
import { createDefaultImageEditColorModeV3 } from '../src/core/imageEdit/v3/colorTypes'
import { embedImageEditRasterV3 } from '../src/core/imageEdit/v3/smartContent/commands'
import { IMAGE_WORKING_VERSION, IMAGE_PACKAGE_VERSION, CANVAS_LAYER_PACKAGE_VERSION } from '../src/core/persistence/schemaVersions'
import { createThemePayloadV2 } from '../src/core/theme/themeMigration'
import { DEFAULT_THEME_SEED } from '../src/core/theme/themeEngine'
import { BLACK_HEX, DEFAULT_THEME_COLOR_SCHEME_HEX, SETTINGS_ACCENT_HEX } from '../src/core/theme/colorTokens'

const timestamp = '2026-10-09T00:00:00.000Z'
const source = "export default { apiVersion: 1, languageVersion: 3, name: \"黄金代码\", kind: \"generator\", mode: \"dynamic\", width: 1920, height: 1080, durationSeconds: 4, seed: 1, parameters: { label: { type: \"text\", title: \"标题\", default: \"黄金样本\", maxLength: 200 }, size: { type: \"number\", title: \"字号\", default: 24, min: 1, max: 72, step: 1, unit: \"px\" } }, render(ctx) { return [rect({ id: \"golden-box\", x: 0, y: 0, width: 100, height: 100, fill: [0, 0, 0, 1] })]; } };\n"
const program = compileCodeMaterial(source)
const hash = createHash('sha256').update(source).digest('hex')
const sourceVersion = { apiVersion: 1 as const, languageVersion: 3 as const, entry: 'main.ts', files: [{ path: 'main.ts', location: '/persistence-project/代码/标题/v1/main.ts', hash }], imports: [] }
const document = createVideoEditDocument('持久格式黄金样本')
document.id = 'golden-video'
document.codeMaterials = [{ id: 'code-definition', name: '代码标题', defaultVersionId: 'code-version', versions: [{ id: 'code-version', ...sourceVersion }] }]
document.items.push({ id: 'code-item', name: '代码标题', kind: 'code', code: { definitionId: 'code-definition', versionId: 'code-version', parameters: { label: '黄金样本', size: 24 }, curves: { size: [{ id: 'source-key', sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, value: 24, interpolation: 'linear' }] } } })
const sequence = createVideoEditSequence()
sequence.id = 'golden-sequence'
document.sequences.push(sequence)
const clip = makeVideoEditItemClip(document, 'code-item', sequence.id, { frame: 0, duration: 90 }, () => program)
clip.id = 'golden-clip'
clip.snapToBeat = true
clip.curves = { opacity: [{ time: 0, value: 0, interpolation: 'linear' }, { time: 20, value: 1, interpolation: 'ease' }] }
clip.effects = [{ id: 'golden-grade', name: '全能调色', enabled: true, amount: 1, builtin: { id: 'color_grade', params: { exposure: 0.25 } } }, { id: 'golden-blur', name: '高斯模糊', enabled: true, amount: 0.5, builtin: { id: 'gaussian_blur', params: { sigma_fraction_height: 0.003, axis: 'both', edge_mode: 'clamp' } } }]
sequence.clips.push(clip)
sequence.captions = [{ id: 'golden-caption', start: 5, duration: 40, text: '字幕原文', sourceText: '字幕原文、', translation: 'Golden caption' }]
sequence.transitions = [{ id: 'golden-transition', kind: 'cross_dissolve', rightClipId: clip.id, durationFrames: 10 }]
sequence.markers = [{ id: 'golden-marker', frame: 20, name: '审查点' }, { id: 'golden-beat', frame: 30, name: '重音', type: 'beat', strength: .9 }]
document.exportHistory = [{ id: 'golden-export', taskId: 'golden-render', sequenceId: sequence.id, name: '黄金导出', presetName: '自定义导出', rangeSource: 'explicit',
  path: '/persistence-project/导出/黄金.mp4', completedAt: Date.parse(timestamp), settings: VIDEO_EDIT_EXPORT_PRESETS[0].settings,
  range: { startFrame: 0, endFrame: 30 }, assetRef: { kind: 'asset', id: 'golden-export-asset' } }]
videoEditDocumentSchema.parse(document)
const { format: _format, version: _version, id: _id, name: _name, revision: _revision, ...videoContent } = document
const soundDocument = createVideoEditDocument('节拍声音样本'), soundSequence = createVideoEditSequence()
soundSequence.id = 'golden-sound-sequence'; soundDocument.sequences.push(soundSequence)
soundDocument.media.push({ id: 'golden-sound', name: '鼓点', path: '/persistence-project/素材/鼓点.wav', kind: 'audio', durationSeconds: 3, width: 0, height: 0, hasAudio: true })
soundDocument.items.push({ id: 'golden-sound-item', name: '鼓点', kind: 'audio', mediaId: 'golden-sound' })
const soundClip = makeVideoEditItemClip(soundDocument, 'golden-sound-item', soundSequence.id, { frame: 0, duration: 90 })
soundClip.id = 'golden-sound-clip'; soundClip.snapToBeat = true
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
const values: Record<string, unknown> = {
  'image-layout-page':layoutPage,
  'image-layout-candidate':layoutCandidate,
  'creative-intent-page': (() => { const { draft, samples } = createMotionFixture('S01').input; return { version: 1, kind: 'samples', ownerRef: draft.ownerRef, sourceDigest: draft.sourceDigest, monoSpanUs: [samples[0].monoUs, samples[samples.length - 1].monoUs], seqSpan: [samples[0].seq, samples[samples.length - 1].seq], count: samples.length, entries: samples } })(),
  'creative-intent-candidate': { version: 1, ...optimizeMotionDraft(createMotionFixture('S01').input).candidates[0] },
  'document.video_edit': videoContent,
  'document.canvas': { nodes: [{ id: 'golden-node', type: 'textDisplay', position: { x: 0, y: 0 }, data: { text: '黄金样本' } }], edges: [] },
  'document.audio_edit': { source: { mediaType: 'audio', sourcePath: '/persistence-project/素材/voice.wav', audioPath: '/persistence-project/素材/voice.wav', durationFrames: 48000, sampleRate: 48000, channels: 1 }, referenceScript: '参考稿', transcript: [{ id: 'word', text: '你好', startFrame: 0, endFrame: 24000, included: true, locked: false, granularity: 'word' }], suggestions: [], vstEnabled: false, cuts: [{ id: 'cut', startFrame: 24000, endFrame: 48000, reason: 'manual', enabled: true }], processorChain: [] },
  'document.camera_stage': { objects: [{ id: 'camera', name: '主摄影机', type: 'camera', position: [0, 1, 5] }], activeCameraId: 'camera', sceneSettings: { sky: {} }, stateKeyframes: [{ id: 'key', time: 0, objects: {} }] },
  'document.image_document': { workingRevision: 0, emptyUntilRevision: 0, width: 32, height: 40, layers: image.layers.length },
  project: buildProjectManifest({ id: 'golden-project', createdAt: timestamp, locale: 'zh', draft: false, mainVideoEditId: document.id }),
  'project-package': { format: 'henji-package', version: 1, type: 'project', name: '黄金项目', exportedAt: timestamp, folders: { generated: '生成结果', materials: '素材' }, documents: [{ id: document.id, path: '黄金剪辑.henji-video' }] },
  'code-version': { id: 'code-version', ...sourceVersion },
  'code-component': { schemaVersion: 1, name: '组件', version: 1, description: '黄金组件', exports: ['value'], imports: [] },
  'code-asset': codeAssetSchema.parse({ format: 'henji-code-asset', version: 1, name: '代码标题', sourceVersion, codeSources: [{ hash, source }], parameters: { label: '黄金样本' }, curves: {}, images: [] }),
  'image-header': { format: 'henji-image-document', version: 1, id: image.id, revision: 0, kindVersion: 1, createdAt: timestamp, updatedAt: timestamp, contentRevision: 0, emptyUntilRevision: 0, summary: { width: 32, height: 40, layers: image.layers.length } },
  'image-package': { packageFormat: 'henjiimg', packageVersion: IMAGE_PACKAGE_VERSION, createdAt: timestamp, document: working, resources: [...image.creativeIntents.resources.map(r=>({resourceId:r.resourceId,sha256:r.digest.slice(7),byteLength:r.bytes,path:r.path,mediaType:'application/vnd.henji.layout+json'})),{resourceId:historyId,sha256:historyId.slice(7),byteLength:historyBytes.byteLength,path:`resources/${historyId.slice(7)}`,mediaType:'application/vnd.henji.image-history+json'}] },
  'image-working-copy': working,
  settings: { providerKeyStatus: { kie: false }, uploadProvider: 'kie', uploadFallbackEnabled: false, canvasLodLevel: 'balanced', videoEditBinsFirst: true },
  theme: { theme: 'dark' },
  'style-kits': [{ ...BUILTIN_STYLE_KITS[0], id: 'golden-kit', name: '黄金风格' }],
  'title-templates': [{ ...BUILTIN_TITLE_TEMPLATES[0], id: 'golden-template', name: '黄金标题' }],
  'text-presets': [{ id: 'golden-text', name: '黄金字型', style: videoEditTextStyleSchema.parse({}) }],
  'export-presets': [{ ...VIDEO_EDIT_EXPORT_PRESETS[0], id: 'golden-export', name: '黄金导出' }],
  'voice-library': [{ voiceId: 'golden-voice', voiceName: '黄金音色', providerId: 'kie', createdAt: timestamp, updatedAt: timestamp, status: 'ready', activated: true }],
  'preset-export': { version: '1.0', name: '黄金生成预设', description: null, modelId: null, params: { prompt: '黄金样本' } },
  'theme-payload': createThemePayloadV2({ seed: DEFAULT_THEME_SEED }),
  'canvas-layer-package': { format: 'henji-canvas-layer', version: CANVAS_LAYER_PACKAGE_VERSION, documentId: image.id, contentRevision: 0 },
  keystore: { version: 1, keys: {} },
  'media-grants': { version: 1, roots: [{ path: '/persistence-project', grantedAt: 1791504000000 }] },
  'llm-config': llmStoredConfigSchema.parse({ providers: [{ providerId: 'synthetic', displayName: '合成测试供应商', adapter: 'openai', enabled: false }], models: [], promptProfiles: [], textProcessingPromptTemplates: [], agentProfiles: [{ id: 'golden-agent', name: '测试助手', primary: { providerId: 'synthetic', modelId: 'test' }, settings: { timeoutMs: 60000, maxRetries: 0, maxOutputTokens: 4096, contextWindowBudget: 64000 }, verifications: [], createdAt: timestamp, updatedAt: timestamp }], tools: [], policy: { allowedTools: [], requireHumanConfirmation: true }, memory: { longTermNamespace: 'golden' } }),
  'mcp-connections': mcpConnectionStorageSchema.parse({ version: 2, connections: [{ id: '00000000-0000-4000-8000-000000000001', name: '合成测试连接', token: '0'.repeat(64), allowWrites: true, allowPaid: false, allowDestructive: false }] }),
  'document-envelope': buildDocumentEnvelope({ kind: 'canvas', kindVersion: 1, id: 'golden-envelope', name: '外壳样本', createdAt: timestamp, updatedAt: timestamp, revision: 0, draft: false, content: { nodes: [], edges: [] } }),
  'llm-config-journal': { version: 1, configBefore: null },
  'node-defaults': { imageGen: { modelId: 'golden-model', params: { quality: 'high' } } },
  'model-defaults': modelDefaultsSchema.parse({ version: MODEL_DEFAULTS_VERSION, providerId: 'kie', models: { image: '', video: '', audio: '', transcription: 'groq.speech-recognition.whisper-large-v3-turbo' } }),
  onboarding: { version: 2, status: 'in_progress', entryReason: 'fresh_install', activeStepId: 'provider', completedStepIds: ['welcome'], configuredProviders: [], verifiedProviders: [], shownHintIds: [], firstTaskPrepared: false, firstTaskCompleted: false, startedAt: timestamp, completedAt: null },
  'subtitle-manifest': { version: SUBTITLE_MANIFEST_VERSION, projectId: document.id, sequenceId: sequence.id, signature: 'golden-signature', startFrame: 0, endFrame: 90, soundClips: [soundClip], soundIdentities: { 'golden-sound-clip': 'golden-sound-identity' }, captions: sequence.captions, committed: true },
  'storyboard-metadata': { version: 1, gridRows: 2, gridCols: 2, frameNotes: ['远景', '特写'] },
  'setting-records': { key: 'user_data_root', value: '{"root":"/persistence-project","locale":"zh"}', type: 'json' },
  'asset-records': { id: 'golden-asset', media_type: 'code', display_name: '代码标题', file_path: '/persistence-project/代码/标题.henjicode', source: 'video-edit', mime_type: 'application/x-henji-code', size_bytes: 100, width: null, height: null, duration_seconds: null, thumbnail_name: null, inspection_status: 'pending', inspection_error: null, file_modified_at: null, content_identity: null, last_used_at: null, created_at: 1791504000000, updated_at: 1791504000000 },
  'generation-presets': { id: 'golden-preset', name: '黄金生成预设', description: null, model_id: null, params: '{}', is_favorite: 0, use_count: 0, created_at: timestamp, updated_at: timestamp },
  sqlite: { version: 21, name: 'global_media_recycle', applied_at: 1791504000000 },
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
    const raw = format.id.startsWith('document.') ? buildDocumentEnvelope({ kind: format.id.slice('document.'.length), kindVersion: format.version, id: `golden-${format.id.split('.')[1]}`, name: format.name, createdAt: timestamp, updatedAt: timestamp, revision: 0, draft: false, content })
      : format.id === 'settings' || format.id === 'theme' ? { version: format.version, state: content }
      : (format.storage === 'local-storage' && !['model-defaults', 'onboarding'].includes(format.id)) || format.id === 'voice-library' || format.id === 'llm-config' ? { version: format.version, content } : content
    const directory = path.join(root, 'tests/fixtures/persistence', format.id)
    fs.mkdirSync(directory, { recursive: true })
    fs.writeFileSync(path.join(directory, `v${format.version}.json`), `${JSON.stringify(raw, null, 2)}\n`, { flag: 'wx' })
    if (format.id === 'theme-payload') fs.writeFileSync(path.join(directory, 'v1.json'), `${JSON.stringify({ version: 1, themeTonePreset: 'neutral', uiRadiusPreset: 'default', accentColor: SETTINGS_ACCENT_HEX, colors: DEFAULT_THEME_COLOR_SCHEME_HEX }, null, 2)}\n`, { flag: 'wx' })
  }
  return PERSISTENCE_FORMATS.length
}
