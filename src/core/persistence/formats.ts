import { workspaceLayoutEnvelopeSchema, WORKSPACE_LAYOUT_VERSION } from '../workspaceLayouts/schema'
import { RESOURCE_PERSISTENCE_FORMATS } from './resourceContracts'
import { paidApprovalSettingsSchema, paidReservationSchema, paidApprovalReceiptSchema } from '../application-control/paidApproval'
import { FILE_PERSISTENCE_FORMATS } from './fileContracts'
import { generationOutputTimingsSchema } from '../media/speechTimings'
import { z } from 'zod'
import { DOCUMENT_KINDS } from '../documents/kinds'
import { documentEnvelopeSchema, documentEnvelopeContract } from '../documents/envelope'
import { PROJECT_MANIFEST_VERSION, projectManifestSchema } from '../documents/projectManifest'
import { videoEditDocumentSchema } from '../videoEdit/document'
import { CODE_ASSET_VERSION, codeAssetSchema } from '../videoEdit/codeAsset'
import { CODE_AUTHOR_API_VERSION, CODE_MATERIAL_VERSION_RECORD, codeAuthorApiSchema, codeMaterialVersionSchema } from '../videoEdit/codeMaterialPersistence'
import { codeComponentMetadataSchema } from '../videoEdit/codeMaterial/components'
import { codeMaterialFilesSchema } from '../videoEdit/codeMaterial/sources'
import { legacyStyleKitSchema, legacyTitleTemplateSchema } from '../videoEdit/styles/legacyStyles'
import { videoEditStyleSchema } from '../videoEdit/styles/styleSchemas'
import { VIDEO_EDIT_STYLE_LIBRARY_VERSION, VIDEO_EDIT_STYLE_PACKAGE_VERSION, VIDEO_EDIT_TEMPLATE_LIBRARY_VERSION, videoEditStylePackageSchema, videoEditTemplateSchema } from '../videoEdit/styles/templateSchemas'
import { VIDEO_EDIT_PRESET_PACKAGE_VERSION, videoEditPresetPackageSchema, videoEditPresetPreferencesSchema } from '../videoEdit/presetPackage'
import { videoEditExportPresetSchema } from '../videoEdit/exportPresets'
import { audioEditProjectSchema } from '../audioEdit/schema'
import { assetRecordSchema, packageManifestSchema, PACKAGE_VERSION, presetRecordSchema, settingRecordSchema, videoEditTextPresetSchema, voiceLibraryRecordSchema, videoEditSubtitleManifestSchema } from './storedSchemas'
import type { PersistenceContract } from './migrations'
import { rendererSettingsSchema, SETTINGS_STORAGE_VERSION } from './settingsSchema'
import { audioCaptureSettingsEnvelopeSchema, AUDIO_CAPTURE_SETTINGS_VERSION, audioCaptureRecoverySchema } from '../audioCapture/contracts'
import { formatMigrations } from './formatMigrations'
import { LOCAL_LIBRARY_FORMATS } from './versionedJson'
import { presetExportSchema, themePayloadSchema } from './auxiliarySchemas'
import { SOUND_LIBRARY_FOLDERS_VERSION, soundLibraryFoldersSchema } from '../soundLibrary/soundLibraryFolders'
import { THEME_STORAGE_VERSION, CODE_COMPONENT_SCHEMA_VERSION, SQLITE_SCHEMA_VERSION, SETTING_RECORD_VERSION, ASSET_RECORD_VERSION, GENERATION_PRESET_VERSION } from './schemaVersions'
import { MODEL_DEFAULTS_VERSION, modelDefaultsSchema, NODE_DEFAULTS_VERSION, nodeDefaultsSchema, RECORDING_SETUP_VERSION, recordingSetupSchema, ONBOARDING_VERSION, onboardingSchema, SUBTITLE_MANIFEST_VERSION } from './preferenceSchemas'
import { applicationOperationStateSchema, applicationUserConfirmationSchema } from '../application-control/userConfirmation'
import { operationOriginSchema } from '../application-control/operationReview'

export interface PersistenceFormat extends PersistenceContract {
  readonly versionSource: string
  readonly readEntry: string
  readonly migrationEntry: string
  /** Extra authoritative nested schemas must participate even when the outer reader is loose. */
  readonly schemas: Readonly<Record<string, z.ZodType>>
  readonly requiredFixtures?: readonly { extension: string; versionFormat?: string }[]
  readonly storage: 'file' | 'local-storage' | 'sqlite-ledger'
}

function format(id: string, name: string, version: number, versionSource: string, readEntry: string, schema: z.ZodType, storage: PersistenceFormat['storage'] = 'file', schemas: Readonly<Record<string, z.ZodType>> = {}): PersistenceFormat {
  const container = ['settings', 'theme'].includes(id) ? z.object({ version: z.literal(version), state: schema })
    : ['style-kits', 'title-templates', 'text-presets', 'export-presets', 'preset-preferences', 'voice-library', 'node-defaults', 'llm-config', 'sound-library-folders', 'video-style-library', 'video-template-library', 'video-style-package'].includes(id) ? z.object({ version: z.literal(version), minReaderVersion: z.number().int().positive().max(version).optional(), content: schema }).strict() : undefined
  return { id, name, version, versionSource, readEntry, schema, schemas: { content: schema, ...(container ? { container } : {}), ...schemas }, migrations: formatMigrations(id), storage, migrationEntry: storage === 'sqlite-ledger' ? 'electron/main/services/db-migrations.ts::SCHEMA_MIGRATIONS / runSchemaMigrations' : 'src/core/persistence/formatMigrations.ts / migrations.ts::upgradePersistenceContent' }
}

/** Single inventory. SQL payloads inherit the existing SQLite ledger, never a parallel ledger. */
export const PERSISTENCE_FORMATS: readonly PersistenceFormat[] = [
  format('audio-capture-settings', '本机录音设置', AUDIO_CAPTURE_SETTINGS_VERSION, 'settings.audio_capture.settings.version', 'electron/main/services/audio-capture/settings.ts::read', audioCaptureSettingsEnvelopeSchema, 'sqlite-ledger'),
  { ...format('audio-capture-recovery', '未完成录音', 2, 'settings.audio_capture.pending_files.version', 'electron/main/services/audio-capture/files.ts::read', audioCaptureRecoverySchema, 'sqlite-ledger'), minReaderVersion: 1 },
  format('generation-output-timings', '生成结果语音时间戳', 1, 'generation_submissions.response_json.metadata.outputTimings（SQLite 既有账本）', 'electron/main/services/ai-runtime/generation-submissions.ts::decodeResponse', generationOutputTimingsSchema, 'sqlite-ledger'),
  format('workspace-layouts', '工作区布局预设', WORKSPACE_LAYOUT_VERSION, 'settings.workspace.layout.<workspaceId>.version', 'src/services/workspaceLayouts/workspaceLayoutService.ts::load', workspaceLayoutEnvelopeSchema, 'sqlite-ledger'),
  ...RESOURCE_PERSISTENCE_FORMATS,
  { ...format('document-envelope', '文档外壳', documentEnvelopeContract.version, 'DocumentEnvelope.envelopeVersion', 'electron/main/services/documents/document-file.ts::loadDocumentFile', documentEnvelopeSchema), migrations: documentEnvelopeContract.migrations },
  ...FILE_PERSISTENCE_FORMATS,
  ...DOCUMENT_KINDS.map(kind => ({ ...format(`document.${kind.id}`, kind.untitledNames.zh.replace('未命名', ''), kind.version, 'DocumentEnvelope.kindVersion',
    kind.storage === 'package' ? 'electron/main/services/image-editor-v3/image-document/image-document-service.ts' : 'electron/main/services/documents/document-file.ts::decodeDocumentContent',
    kind.contentSchema, 'file', { ...(kind.id === 'video_edit' ? { domain: videoEditDocumentSchema } : {}), ...(kind.id === 'audio_edit' ? { domain: audioEditProjectSchema } : {}) }), minReaderVersion: kind.minReaderVersion, migrations: kind.migrations, ...(kind.id === 'image_document' ? { requiredFixtures: [{ extension: 'json' }, { extension: 'henjiimg', versionFormat: 'image-package' }] } : {}), migrationEntry: 'src/core/documents/kinds/对应类型.ts::migrations / src/core/persistence/migrations.ts::upgradePersistenceContent' })),
  format('project', '项目说明', PROJECT_MANIFEST_VERSION, 'ProjectManifest.version', 'electron/main/services/documents/workspace.ts::readManifest', projectManifestSchema),
  { ...format('project-package', '项目和文档包', PACKAGE_VERSION, 'henji-package.json.version', 'electron/main/services/documents/package-service.ts::readManifest', packageManifestSchema), requiredFixtures: [{ extension: 'json' }, { extension: 'henjipack' }] },
  format('code-version', '代码源码版本', CODE_MATERIAL_VERSION_RECORD, '所在剪辑内容版本（记录随剪辑文档的 kindVersion 读写）', 'electron/main/services/documents/code-files.ts::read', codeMaterialVersionSchema, 'file', { source: codeMaterialFilesSchema }),
  // 作者宿主接口：每个代码版本记录 apiVersion；宿主接口变化时升版本并按 apiVersion 保持旧代码的原行为，不迁移源码。
  format('code-author-api', '代码作者宿主接口', CODE_AUTHOR_API_VERSION, 'CodeMaterialVersion.apiVersion / CodeAsset.sourceVersion.apiVersion', 'src/features/videoEdit/engine/videoEditAuthorRuntime.ts', codeAuthorApiSchema),
  format('code-component', '项目组件说明', CODE_COMPONENT_SCHEMA_VERSION, '组件首行.schemaVersion（作品版本 version 与格式版本不同）', 'src/core/videoEdit/codeMaterial/components.ts::componentSourceMetadata', codeComponentMetadataSchema),
  format('code-asset', '可编辑代码资产', CODE_ASSET_VERSION, 'CodeAsset.version', 'src/core/videoEdit/codeAsset.ts::decodeCodeAsset', codeAssetSchema),
  format('settings', '界面设置', SETTINGS_STORAGE_VERSION, 'settings-storage.version', 'src/stores/settingsStore.ts::persist', rendererSettingsSchema, 'local-storage'),
  format('theme', '主题选择', THEME_STORAGE_VERSION, 'theme-storage.version', 'src/stores/themeStore.ts::persist', z.object({ theme: z.enum(['dark', 'light']) }), 'local-storage'),
  // 2026-10-22 起停用：只读，风格库首次加载时把其中的个人风格与标题模板转存进新的风格库目录，原键不改写。
  format('style-kits', '本机风格包', LOCAL_LIBRARY_FORMATS['video-edit-style-kits'].version, 'video-edit-style-kits.version', 'src/features/videoEdit/application/videoEditStyleLibrary.ts::readLegacyLibrary', z.array(legacyStyleKitSchema), 'local-storage'),
  format('title-templates', '本机标题模板', LOCAL_LIBRARY_FORMATS['video-edit-title-templates'].version, 'video-edit-title-templates.version', 'src/features/videoEdit/application/videoEditStyleLibrary.ts::readLegacyLibrary', z.array(legacyTitleTemplateSchema), 'local-storage'),
  format('video-style-library', '风格库中的风格', VIDEO_EDIT_STYLE_LIBRARY_VERSION, '风格库/styles/<id>/style.json.version', 'src/features/videoEdit/application/videoEditStyleLibrary.ts::readStyleFile', videoEditStyleSchema),
  format('video-template-library', '风格库中的模板', VIDEO_EDIT_TEMPLATE_LIBRARY_VERSION, '风格库/templates/<id>.json.version', 'src/features/videoEdit/application/videoEditStyleLibrary.ts::readTemplateFile', videoEditTemplateSchema),
  format('video-style-package', '可分享风格包', VIDEO_EDIT_STYLE_PACKAGE_VERSION, '.henjistyle.version', 'src/features/videoEdit/application/videoEditStylePackages.ts::importVideoEditStylePackage', videoEditStylePackageSchema),
  format('text-presets', '本机文字和字幕预设', LOCAL_LIBRARY_FORMATS['video-edit-text-presets'].version, 'video-edit-text-presets.version', 'src/features/videoEdit/application/videoEditLocalLibrary.ts', z.array(videoEditTextPresetSchema), 'local-storage'),
  format('export-presets', '本机导出预设', LOCAL_LIBRARY_FORMATS['video-edit-export-presets'].version, 'video-edit-export-presets.version', 'src/features/videoEdit/application/videoEditExportPresets.ts', z.array(videoEditExportPresetSchema), 'local-storage'),
  format('preset-preferences', '预设评分与默认', LOCAL_LIBRARY_FORMATS['video-edit-preset-preferences'].version, 'video-edit-preset-preferences.version', 'src/features/videoEdit/application/videoEditPresetPreferences.ts', videoEditPresetPreferencesSchema, 'local-storage'),
  format('video-preset-package', '可分享剪辑预设', VIDEO_EDIT_PRESET_PACKAGE_VERSION, 'henji-video-presets.version', 'src/features/videoEdit/application/videoEditPresetCatalog.ts::importVideoEditPresetPackage', videoEditPresetPackageSchema),
  format('voice-library', '克隆音色库', LOCAL_LIBRARY_FORMATS['voice_library_records'].version, 'settings.voice_library_records.version', 'src/services/voiceLibrary/VoiceLibraryService.ts::parseVoiceRecords', z.array(voiceLibraryRecordSchema)),
  format('sound-library-folders', '音效文件夹', SOUND_LIBRARY_FOLDERS_VERSION, 'settings.sound_library.folders.version', 'electron/main/services/sound-library/runtime.ts::readFolders', soundLibraryFoldersSchema),
  format('preset-export', '可分享生成预设', 1, 'PresetService export.version（1.0 → 1）', 'src/services/presets/PresetService.ts::importPreset', presetExportSchema),
  format('theme-payload', '可分享主题', 2, 'ThemePayloadV2.version', 'src/core/theme/themeMigration.ts::parseThemePayload', themePayloadSchema),
  format('node-defaults', '画布默认参数', NODE_DEFAULTS_VERSION, 'henji-canvas-node-parameter-defaults-v1.version', 'src/features/canvas/application/nodeParameterDefaults.ts::load', nodeDefaultsSchema, 'local-storage'),
  { ...format('recording-setup', '录制设置', RECORDING_SETUP_VERSION, 'henji-recording-setup.version', 'src/features/screenRecording/recordingSetupModel.ts::loadRecordingSetup', recordingSetupSchema, 'local-storage'), minReaderVersion: 1 },
  format('model-defaults', '默认生成与转写模型', MODEL_DEFAULTS_VERSION, 'ModelDefaultsState.version', 'src/features/settings/modelDefaultsManager.ts::loadState', modelDefaultsSchema, 'local-storage'),
  format('onboarding', '首次引导进度', ONBOARDING_VERSION, 'OnboardingStateV2.version', 'src/features/onboarding/application/onboardingManager.ts::loadState', onboardingSchema, 'local-storage'),
  format('subtitle-manifest', '字幕回填记录', SUBTITLE_MANIFEST_VERSION, '字幕声音.subtitle.json.version', 'src/features/videoEdit/application/videoEditAutoSubtitles.ts::complete', videoEditSubtitleManifestSchema),
  format('setting-records', '设置记录', SETTING_RECORD_VERSION, 'SETTING_RECORD_VERSION（记录独立内容版本；SQL 升级仍走既有账本）', 'electron/main/services/settings/store.ts::getEntry', settingRecordSchema, 'sqlite-ledger', { paidApproval: paidApprovalSettingsSchema }),
  format('asset-records', '素材库记录', ASSET_RECORD_VERSION, 'ASSET_RECORD_VERSION（记录独立内容版本；SQL 升级仍走既有账本）', 'electron/main/services/asset-library/index.ts', assetRecordSchema, 'sqlite-ledger'),
  format('generation-presets', '生成预设', GENERATION_PRESET_VERSION, 'GENERATION_PRESET_VERSION（记录独立内容版本；SQL 升级仍走既有账本）', 'electron/main/services/presets/store.ts', presetRecordSchema, 'sqlite-ledger'),
  format('sqlite', '应用数据库', SQLITE_SCHEMA_VERSION, 'SCHEMA_MIGRATIONS / schema_migrations', 'electron/main/services/db-migrations.ts::runSchemaMigrations', z.object({ version: z.number().int().positive(), name: z.string(), applied_at: z.number() }), 'sqlite-ledger', { operationOrigin: operationOriginSchema.optional(), operationState: applicationOperationStateSchema, userConfirmation: applicationUserConfirmationSchema, paidGenerationEstimateKind: z.enum(['upper-bound', 'estimate']).optional(), paidReservation: paidReservationSchema, paidApproval: paidApprovalReceiptSchema }),
]

/** Deliberate scope boundary: rebuildable projections and external formats are not user-project migrations. */
export const PERSISTENCE_EXCLUSIONS = [
  { id: 'screen-recording-standard-exports', readEntry: 'src/features/screenRecording/application/recordingProductService.ts', reason: 'Markdown/HTML 与 PNG/GIF 是面向用户交付的外部标准文件，回读只验证发布字节，不作为项目数据解释；可编辑产物复用已登记的 image-edit-v3 与 image-document-package。运行期导出记录不落盘。' },
  { id: 'session-state', readEntry: 'electron/main/services/documents/session-state.ts', reason: '明示可丢弃的撤销/视口缓存；文档仍能从权威文件完整打开。' },
  { id: 'working-copy-links', readEntry: 'electron/main/services/image-editor-v3/image-document/working-copy-links.ts / canvas-layers/canvas-layer-packages.ts', reason: '可由权威包与工作副本重建的同步投影，业务文档和未保存工作副本在 image-working-copy 中受保护。' },
  { id: 'video-edit-render-cache', readEntry: 'electron/main/services/video/render-cache.ts / src/features/videoEdit/application/videoEditRenderPerformance.ts', reason: '预览文件及按内容指纹保存的本机播放性能样本均可重建；版本变化直接失效并回收，不改变工程文件或用户设置。' },
  { id: 'derived-media', readEntry: 'electron/main/services/audio/ / audio-edit/speech-energy-service.ts / video/ / fonts/scanner.ts / local-inference/', reason: '波形、声音低谷、缩略帧、字体目录缓存、区域检测/跟踪缓存可从原媒体重算；不是独立用户内容，人工校对仍由作品文档保存。' },
  { id: 'external-media-and-fonts', readEntry: '项目素材/生成结果/字体目录/代码/*.ts', reason: '图片、视频、音频、字体和作者源码的字节保持原样；来源格式属于外部编码协议，代码的API/语言版本由code-version固定。' },
  { id: 'sqlite-owned-content', readEntry: 'electron/main/services/db-migrations.ts', reason: '生成历史、自定义模型、素材库/标签/文件夹关系、助手记忆与调用账本统一由既有SQLite账本负责；不另建迁移账本。' },
] as const

export function persistenceFormat(id: string): PersistenceFormat {
  const value = PERSISTENCE_FORMATS.find(format => format.id === id)
  if (!value) throw new Error(`持久格式未登记：${id}`)
  return value
}
