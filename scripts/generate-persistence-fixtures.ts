import { compileCodeMaterial } from '../src/core/videoEdit/codeMaterial/compiler'
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { PERSISTENCE_FORMATS } from '../src/core/persistence/formats'
import { buildDocumentEnvelope } from '../src/core/documents/envelope'
import { buildProjectManifest } from '../src/core/documents/projectManifest'
import { createVideoEditDocument, createVideoEditSequence, videoEditDocumentSchema } from '../src/core/videoEdit/document'
import { makeVideoEditItemClip } from '../src/core/videoEdit/projectItems'
import { codeAssetSchema } from '../src/core/videoEdit/codeAsset'
import { BUILTIN_STYLE_KITS } from '../src/core/videoEdit/styleKitPresets'
import { BUILTIN_TITLE_TEMPLATES } from '../src/core/videoEdit/titleTemplates'
import { VIDEO_EDIT_EXPORT_PRESETS } from '../src/core/videoEdit/exportPresets'
import { videoEditTextStyleSchema } from '../src/core/videoEdit/text'
import { createImageEditDocumentV3, createImageEditRasterLayerV3 } from '../src/core/imageEdit/v3/documentFactory'
import { createDefaultImageEditColorModeV3 } from '../src/core/imageEdit/v3/colorTypes'
import { createThemePayloadV2 } from '../src/core/theme/themeMigration'
import { DEFAULT_THEME_SEED } from '../src/core/theme/themeEngine'
import { DEFAULT_THEME_COLOR_SCHEME_HEX, SETTINGS_ACCENT_HEX } from '../src/core/theme/colorTokens'

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
clip.curves = { opacity: [{ time: 0, value: 0, interpolation: 'linear' }, { time: 20, value: 1, interpolation: 'ease' }] }
clip.effects = [{ id: 'golden-grade', name: '全能调色', enabled: true, amount: 1, builtin: { id: 'color_grade', params: { exposure: 0.25 } } }, { id: 'golden-blur', name: '高斯模糊', enabled: true, amount: 0.5, builtin: { id: 'gaussian_blur', params: { sigma_fraction_height: 0.003, axis: 'both', edge_mode: 'clamp' } } }]
sequence.clips.push(clip)
sequence.captions = [{ id: 'golden-caption', start: 5, duration: 40, text: '字幕原文', translation: 'Golden caption' }]
sequence.transitions = [{ id: 'golden-transition', kind: 'cross_dissolve', rightClipId: clip.id, durationFrames: 10 }]
sequence.markers = [{ id: 'golden-marker', frame: 20, name: '审查点' }]
videoEditDocumentSchema.parse(document)
const { format: _format, version: _version, id: _id, name: _name, revision: _revision, ...videoContent } = document
const image = createImageEditDocumentV3({ width: 64, height: 48, documentId: 'golden-image', color: createDefaultImageEditColorModeV3() })
image.layers.push(createImageEditRasterLayerV3('golden-layer', '空白图层'))
const working = { format: 'henji-image-edit', formatVersion: 3, documentId: image.id, revision: 0, createdAt: timestamp, updatedAt: timestamp, document: image, resourceRefs: [] }
const values: Record<string, unknown> = {
  'document.video_edit': videoContent,
  'document.canvas': { nodes: [{ id: 'golden-node', type: 'textDisplay', position: { x: 0, y: 0 }, data: { text: '黄金样本' } }], edges: [] },
  'document.audio_edit': { source: { mediaType: 'audio', sourcePath: '/persistence-project/素材/voice.wav', audioPath: '/persistence-project/素材/voice.wav', durationFrames: 48000, sampleRate: 48000, channels: 1 }, referenceScript: '参考稿', transcript: [{ id: 'word', text: '你好', startFrame: 0, endFrame: 24000, included: true, locked: false, granularity: 'word' }], suggestions: [], vstEnabled: false, cuts: [{ id: 'cut', startFrame: 24000, endFrame: 48000, reason: 'manual', enabled: true }], processorChain: [] },
  'document.camera_stage': { objects: [{ id: 'camera', name: '主摄影机', type: 'camera', position: [0, 1, 5] }], activeCameraId: 'camera', sceneSettings: { sky: {} }, stateKeyframes: [{ id: 'key', time: 0, objects: {} }] },
  'document.image_document': { workingRevision: 0, emptyUntilRevision: 0, width: 64, height: 48, layers: 1 },
  project: buildProjectManifest({ id: 'golden-project', createdAt: timestamp, locale: 'zh', draft: false, mainVideoEditId: document.id }),
  'project-package': { format: 'henji-package', version: 1, type: 'project', name: '黄金项目', exportedAt: timestamp, folders: { generated: '生成结果', materials: '素材' }, documents: [{ id: document.id, path: '黄金剪辑.henji-video' }] },
  'code-version': { id: 'code-version', ...sourceVersion },
  'code-component': { schemaVersion: 1, name: '组件', version: 1, description: '黄金组件', exports: ['value'], imports: [] },
  'code-asset': codeAssetSchema.parse({ format: 'henji-code-asset', version: 1, name: '代码标题', sourceVersion, codeSources: [{ hash, source }], parameters: { label: '黄金样本' }, curves: {}, images: [] }),
  'image-header': { format: 'henji-image-document', version: 1, id: image.id, revision: 0, kindVersion: 1, createdAt: timestamp, updatedAt: timestamp, contentRevision: 0, emptyUntilRevision: 0, summary: { width: 64, height: 48, layers: 1 } },
  'image-package': { packageFormat: 'henjiimg', packageVersion: 1, createdAt: timestamp, document: working, resources: [] },
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
  'canvas-layer-package': { format: 'henji-canvas-layer', version: 1, documentId: image.id, contentRevision: 0 },
  keystore: { version: 1, keys: {} },
  'media-grants': { version: 1, roots: [{ path: '/persistence-project', grantedAt: 1791504000000 }] },
  'llm-config': { providers: [], models: [], promptProfiles: [], textProcessingPromptTemplates: [], agentProfiles: [], tools: [], policy: {}, memory: {} },
  'llm-config-journal': { version: 1, configBefore: null },
  'node-defaults': { imageGen: { modelId: 'golden-model', params: { quality: 'high' } } },
  'model-defaults': { version: 1, providerId: 'kie', models: { image: '', video: '', audio: '' } },
  onboarding: { version: 2, status: 'in_progress', entryReason: 'fresh_install', activeStepId: 'provider', completedStepIds: ['welcome'], configuredProviders: [], verifiedProviders: [], shownHintIds: [], firstTaskPrepared: false, firstTaskCompleted: false, startedAt: timestamp, completedAt: null },
  'subtitle-manifest': { version: 1, projectId: document.id, sequenceId: sequence.id, signature: 'golden-signature', startFrame: 0, endFrame: 90, soundClips: [], soundIdentities: {}, captions: sequence.captions, committed: true },
  'storyboard-metadata': { version: 1, gridRows: 2, gridCols: 2, frameNotes: ['远景', '特写'] },
  'setting-records': { key: 'user_data_root', value: '{"root":"/persistence-project","locale":"zh"}', type: 'json' },
  'asset-records': { id: 'golden-asset', media_type: 'code', display_name: '代码标题', file_path: '/persistence-project/代码/标题.henjicode', source: 'video-edit', mime_type: 'application/x-henji-code', size_bytes: 100, width: null, height: null, duration_seconds: null, thumbnail_name: null, inspection_status: 'pending', inspection_error: null, file_modified_at: null, content_identity: null, last_used_at: null, created_at: 1791504000000, updated_at: 1791504000000 },
  'generation-presets': { id: 'golden-preset', name: '黄金生成预设', description: null, model_id: null, params: '{}', is_favorite: 0, use_count: 0, created_at: timestamp, updated_at: timestamp },
  sqlite: { version: 18, name: 'document_index_last_opened', applied_at: 1791504000000 },
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
