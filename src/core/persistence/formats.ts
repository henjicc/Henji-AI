import { storedVideoEditEffectLibrarySchema } from '../videoEdit/effectLibrary'
import { VIDEO_EDIT_EFFECT_LIBRARY_VERSION } from '../videoEdit/effectPresets'
import { formatMigrations } from './formatMigrations'
import { foreignContentSchema } from '../contentTrust'
import { gitCodeLocationSchema } from '../storage/gitCodeLocation'
import { memorySnapshotSchema } from '../assistant/memoryEntries'
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
import { CODE_ASSET_MIN_READER_VERSION, CODE_ASSET_VERSION, codeAssetSchema } from '../videoEdit/codeAsset'
import { CODE_AUTHOR_API_VERSION, CODE_MATERIAL_VERSION_RECORD, codeAuthorApiSchema, codeMaterialVersionSchema } from '../videoEdit/codeMaterialPersistence'
import { codeComponentMetadataSchema } from '../videoEdit/codeMaterial/components'
import { codeMaterialFilesSchema } from '../videoEdit/codeMaterial/sources'
import { styleKitMigrationSchema, titleTemplateMigrationSchema } from '../videoEdit/styles/styleTemplateMigration'
import { videoEditStyleSchema } from '../videoEdit/styles/styleSchemas'
import { VIDEO_EDIT_STYLE_LIBRARY_VERSION, VIDEO_EDIT_STYLE_PACKAGE_VERSION, VIDEO_EDIT_TEMPLATE_LIBRARY_VERSION, videoEditStylePackageSchema, videoEditTemplateSchema } from '../videoEdit/styles/templateSchemas'
import { VIDEO_EDIT_PRESET_PACKAGE_MIN_READER_VERSION, VIDEO_EDIT_PRESET_PACKAGE_VERSION, videoEditPresetPackageSchema, videoEditPresetPreferencesSchema } from '../videoEdit/presetPackage'
import { videoEditExportPresetSchema } from '../videoEdit/exportPresets'
import { videoEditExportMemorySchema } from '../videoEdit/exportMemory'
import { audioEditProjectSchema } from '../audioEdit/schema'
import { assetRecordSchema, packageManifestSchema, PACKAGE_VERSION, presetRecordSchema, settingRecordSchema, videoEditTextPresetSchema, voiceLibraryRecordSchema, videoEditSubtitleManifestSchema } from './storedSchemas'
import type { PersistenceContract } from './migrations'
import { rendererSettingsSchema, SETTINGS_STORAGE_VERSION } from './settingsSchema'
import { audioCaptureSettingsEnvelopeSchema, AUDIO_CAPTURE_SETTINGS_VERSION, audioCaptureRecoverySchema } from '../audioCapture/contracts'
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
    : ['video-effect-library', 'style-kits', 'title-templates', 'text-presets', 'export-presets', 'export-memory', 'preset-preferences', 'voice-library', 'node-defaults', 'llm-config', 'sound-library-folders', 'video-style-library', 'video-template-library', 'video-style-package'].includes(id) ? z.object({ version: z.literal(version), minReaderVersion: z.number().int().positive().max(version).optional(), content: schema }).strict() : undefined
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
  // 文件夹类型（网页录制 `.hjweb`）的内容就是上面已登记的文件格式（web-recording 的 recording.json），不重复登记。
  ...DOCUMENT_KINDS.filter(kind => kind.storage !== 'folder').map(kind => ({ ...format(`document.${kind.id}`, kind.untitledNames.zh.replace('未命名', ''), kind.version, 'DocumentEnvelope.kindVersion',
    kind.storage === 'package' ? 'electron/main/services/image-editor-v3/image-document/image-document-service.ts' : 'electron/main/services/documents/document-file.ts::decodeDocumentContent',
    kind.contentSchema, 'file', { ...(kind.id === 'video_edit' ? { domain: videoEditDocumentSchema } : {}), ...(kind.id === 'audio_edit' ? { domain: audioEditProjectSchema } : {}) }), minReaderVersion: kind.minReaderVersion, migrations: kind.migrations, ...(kind.id === 'image_document' ? { requiredFixtures: [{ extension: 'json' }, { extension: 'henjiimg', versionFormat: 'image-package' }] } : {}), migrationEntry: 'src/core/documents/kinds/对应类型.ts::migrations / src/core/persistence/migrations.ts::upgradePersistenceContent' })),
  { ...format('project', '项目说明', PROJECT_MANIFEST_VERSION, 'ProjectManifest.version', 'electron/main/services/documents/workspace.ts::readManifest', projectManifestSchema), minReaderVersion: 1 },
  { ...format('project-package', '项目和文档包', PACKAGE_VERSION, 'henji-package.json.version', 'electron/main/services/documents/package-service.ts::readManifest', packageManifestSchema), minReaderVersion: 1, requiredFixtures: [{ extension: 'json' }, { extension: 'henjipack' }] },
  format('code-git-location', 'Git 源码位置', 1, 'git:<40位提交OID>:<encodeURIComponent(仓库位置)>:<encodeURIComponent(POSIX仓库内路径)>；仓库位置存取时使用既有 henji:/ 编码。轻量版本标签：素材或组件/<转义名>@vN；撤回标签：撤回/<OID>。', 'src/core/storage/gitCodeLocation.ts::parseGitCodeLocation', gitCodeLocationSchema),
  { ...format('code-version', '代码源码版本', CODE_MATERIAL_VERSION_RECORD, '所在剪辑内容版本（记录随剪辑文档的 kindVersion 读写）', 'electron/main/services/documents/code-files.ts::read', codeMaterialVersionSchema, 'file', { source: codeMaterialFilesSchema }), minReaderVersion: 17 },
  // 作者宿主接口：每个代码版本记录 apiVersion；宿主接口变化时升版本并按 apiVersion 保持旧代码的原行为，不迁移源码。
  // 最低可读版本就是接口版本本身：按新接口写的代码只有认识它的宿主才能运行。
  format('code-author-api', '代码作者宿主接口', CODE_AUTHOR_API_VERSION, 'CodeMaterialVersion.apiVersion / CodeAsset.sourceVersion.apiVersion', 'src/features/videoEdit/engine/videoEditAuthorRuntime.ts', codeAuthorApiSchema),
  format('code-component', '项目组件说明', CODE_COMPONENT_SCHEMA_VERSION, '组件首行.schemaVersion（作品版本 version 与格式版本不同）', 'src/core/videoEdit/codeMaterial/components.ts::componentSourceMetadata', codeComponentMetadataSchema),
  { ...format('code-asset', '可编辑代码资产', CODE_ASSET_VERSION, 'CodeAsset.version', 'src/core/videoEdit/codeAsset.ts::decodeCodeAsset', codeAssetSchema), minReaderVersion: CODE_ASSET_MIN_READER_VERSION },
  // v15 只新增可选字段（实验性功能开关），旧版本程序仍能正确读取。
  { ...format('settings', '界面设置', SETTINGS_STORAGE_VERSION, 'settings-storage.version', 'src/stores/settingsStore.ts::persist', rendererSettingsSchema, 'local-storage'), minReaderVersion: 14 },
  format('theme', '主题选择', THEME_STORAGE_VERSION, 'theme-storage.version', 'src/stores/themeStore.ts::persist', z.object({ theme: z.enum(['dark', 'light']) }), 'local-storage'),
  // 2026-10-22 起停用：只读，风格库首次加载时把其中的个人风格与标题模板转存进新的风格库目录，原键不改写。
  { ...format('style-kits', '本机风格包', LOCAL_LIBRARY_FORMATS['video-edit-style-kits'].version, 'video-edit-style-kits.version', 'src/features/videoEdit/application/videoEditStyleLibrary.ts::importStoredStyleKits', z.array(styleKitMigrationSchema), 'local-storage'), minReaderVersion: 3 },
  { ...format('title-templates', '本机标题模板', LOCAL_LIBRARY_FORMATS['video-edit-title-templates'].version, 'video-edit-title-templates.version', 'src/features/videoEdit/application/videoEditStyleLibrary.ts::importStoredStyleKits', z.array(titleTemplateMigrationSchema), 'local-storage'), minReaderVersion: LOCAL_LIBRARY_FORMATS['video-edit-title-templates'].minReaderVersion },
  // 代码成员带完整快照，旧程序会拒绝风格件；最低可读版本只在改变语义时显式提高。样片与代码可用作者接口 10（排版）与 11（效果 key），旧程序无法执行，最低可读版本随版本提高。
  { ...format('video-style-library', '风格库中的风格', VIDEO_EDIT_STYLE_LIBRARY_VERSION, '风格库/styles/<id>/style.json.version', 'src/features/videoEdit/application/videoEditStyleLibrary.ts::readStyleFile', videoEditStyleSchema), minReaderVersion: 20 },
  // 风格库 19、模板库 19、风格包 25：网页图片引用新增可选 layer，旧程序的网页引用是严格结构，拒读，最低可读版本随版本提高。
  // 模板库 18、风格包 24：片段关键帧键新增 lightIntensity（灯光片段），旧程序拒读，最低可读版本随版本提高。
  // 模板库 17、风格包 23：原生模板片段可带三维表面字段，关键帧键扩大，旧程序拒读，最低可读版本随版本提高。
  // 风格库 18、模板库 16、风格包 22：风格件代码快照、样片与代码模板可用作者接口 17（三维作者的 host.time、host.space 标准材质与环境、元素轮廓 outline），旧程序无法执行，最低可读版本随版本提高。
  // 风格库 17、模板库 15、风格包 21：风格件代码快照、样片与代码模板可用作者接口 16（三维作者的 info.elements），旧程序无法执行，最低可读版本随版本提高。
  // 风格库 16、模板库 14、风格包 20：代码参数的片段引用分支只可能出现在风格件里，风格件拒绝它，模板片段的图形对象参数也写不出它，最低可读版本保持不变。
  // 模板库 3、风格包 6：原生模板片段新增 enabled:false，旧程序忽略它会把停用的模板片段当成启用，最低可读版本提高到新版本。
  { ...format('video-template-library', '风格库中的模板', VIDEO_EDIT_TEMPLATE_LIBRARY_VERSION, '风格库/templates/<id>.json.version', 'src/features/videoEdit/application/videoEditStyleLibrary.ts::readTemplateFile', videoEditTemplateSchema), minReaderVersion: 20 },
  { ...format('video-style-package', '可分享风格包', VIDEO_EDIT_STYLE_PACKAGE_VERSION, '.hjsty.version', 'src/features/videoEdit/application/videoEditStylePackages.ts::importVideoEditStylePackage', videoEditStylePackageSchema), minReaderVersion: 26 },
  // 效果库 v3 接入版本化 content 容器；v2 仅接受 {state, version:1|2}，不能读取该外壳。
  { ...format('video-effect-library', '本机风格件与效果收藏', VIDEO_EDIT_EFFECT_LIBRARY_VERSION, 'video-edit-effects-library.version', 'src/features/videoEdit/application/videoEditEffectPresets.ts::createVideoEditEffectLibraryStore', storedVideoEditEffectLibrarySchema, 'local-storage'), minReaderVersion: LOCAL_LIBRARY_FORMATS['video-edit-effects-library'].minReaderVersion },
  { ...format('text-presets', '本机文字和字幕预设', LOCAL_LIBRARY_FORMATS['video-edit-text-presets'].version, 'video-edit-text-presets.version', 'src/features/videoEdit/application/videoEditLocalLibrary.ts', z.array(videoEditTextPresetSchema), 'local-storage'), minReaderVersion: 1 },
  { ...format('export-presets', '本机导出预设', LOCAL_LIBRARY_FORMATS['video-edit-export-presets'].version, 'video-edit-export-presets.version', 'src/features/videoEdit/application/videoEditExportPresets.ts', z.array(videoEditExportPresetSchema), 'local-storage'), minReaderVersion: LOCAL_LIBRARY_FORMATS['video-edit-export-presets'].minReaderVersion },
  { ...format('export-memory', '上次导出设置', LOCAL_LIBRARY_FORMATS['video-edit-export-memory'].version, 'video-edit-export-memory.version', 'src/features/videoEdit/application/videoEditExportMemory.ts', videoEditExportMemorySchema, 'local-storage'), minReaderVersion: LOCAL_LIBRARY_FORMATS['video-edit-export-memory'].minReaderVersion },
  { ...format('preset-preferences', '预设评分与默认', LOCAL_LIBRARY_FORMATS['video-edit-preset-preferences'].version, 'video-edit-preset-preferences.version', 'src/features/videoEdit/application/videoEditPresetPreferences.ts', videoEditPresetPreferencesSchema, 'local-storage'), minReaderVersion: LOCAL_LIBRARY_FORMATS['video-edit-preset-preferences'].minReaderVersion },
  { ...format('video-preset-package', '可分享剪辑预设', VIDEO_EDIT_PRESET_PACKAGE_VERSION, 'henji-video-presets.version', 'src/features/videoEdit/application/videoEditPresetCatalog.ts::importVideoEditPresetPackage', videoEditPresetPackageSchema), minReaderVersion: VIDEO_EDIT_PRESET_PACKAGE_MIN_READER_VERSION },
  format('voice-library', '克隆音色库', LOCAL_LIBRARY_FORMATS['voice_library_records'].version, 'settings.voice_library_records.version', 'src/services/voiceLibrary/VoiceLibraryService.ts::parseVoiceRecords', z.array(voiceLibraryRecordSchema)),
  { ...format('sound-library-folders', '音效文件夹', SOUND_LIBRARY_FOLDERS_VERSION, 'settings.sound_library.folders.version', 'electron/main/services/sound-library/runtime.ts::readFolders', soundLibraryFoldersSchema), minReaderVersion: 1 },
  format('preset-export', '可分享生成预设', 1, 'PresetService export.version（1.0 → 1）', 'src/services/presets/PresetService.ts::importPreset', presetExportSchema),
  format('theme-payload', '可分享主题', 2, 'ThemePayloadV2.version', 'src/core/theme/themeMigration.ts::parseThemePayload', themePayloadSchema),
  format('node-defaults', '画布默认参数', NODE_DEFAULTS_VERSION, 'henji-canvas-node-parameter-defaults-v1.version', 'src/features/canvas/application/nodeParameterDefaults.ts::load', nodeDefaultsSchema, 'local-storage'),
  { ...format('recording-setup', '录制设置', RECORDING_SETUP_VERSION, 'henji-recording-setup.version', 'src/features/screenRecording/recordingSetupModel.ts::loadRecordingSetup', recordingSetupSchema, 'local-storage'), minReaderVersion: 3 },
  format('model-defaults', '默认生成与转写模型', MODEL_DEFAULTS_VERSION, 'ModelDefaultsState.version', 'src/features/settings/modelDefaultsManager.ts::loadState', modelDefaultsSchema, 'local-storage'),
  format('onboarding', '首次引导进度', ONBOARDING_VERSION, 'OnboardingStateV2.version', 'src/features/onboarding/application/onboardingManager.ts::loadState', onboardingSchema, 'local-storage'),
  // 22：声音片段新增 enabled:false（停用），旧程序忽略后会把停用的声音当成在发声，最低可读版本提高到 22。
  { ...format('subtitle-manifest', '字幕回填记录', SUBTITLE_MANIFEST_VERSION, '字幕声音.subtitle.json.version', 'src/features/videoEdit/application/videoEditAutoSubtitles.ts::complete', videoEditSubtitleManifestSchema), minReaderVersion: 33 },
  { ...format('setting-records', '设置记录', SETTING_RECORD_VERSION, 'SETTING_RECORD_VERSION（记录独立内容版本；SQL 升级仍走既有账本）', 'electron/main/services/settings/store.ts::getEntry', settingRecordSchema, 'sqlite-ledger', { paidApproval: paidApprovalSettingsSchema }), minReaderVersion: 22 },
  { ...format('asset-records', '素材库记录', ASSET_RECORD_VERSION, 'ASSET_RECORD_VERSION（记录独立内容版本；SQL 升级仍走既有账本）', 'electron/main/services/asset-library/index.ts', assetRecordSchema, 'sqlite-ledger', { foreign: foreignContentSchema }), minReaderVersion: 21 },
  format('generation-presets', '生成预设', GENERATION_PRESET_VERSION, 'GENERATION_PRESET_VERSION（记录独立内容版本；SQL 升级仍走既有账本）', 'electron/main/services/presets/store.ts', presetRecordSchema, 'sqlite-ledger'),
  // 2：全局记忆不再限条数与总字数；只放宽取值范围，旧内容原样有效，SQL 表结构不变。旧程序只在条目超出旧上限时读取失败，最低可读版本不变。
  { ...format('assistant-memory', '三层记忆与修改历史', 2, 'assistant_memory.state_json（SQLite账本v22）', 'electron/main/services/assistant/entry-store.ts::getState', memorySnapshotSchema, 'sqlite-ledger'), minReaderVersion: 1 },
  format('sqlite', '应用数据库', SQLITE_SCHEMA_VERSION, 'SCHEMA_MIGRATIONS / schema_migrations', 'electron/main/services/db-migrations.ts::runSchemaMigrations', z.object({ version: z.number().int().positive(), name: z.string(), applied_at: z.number() }), 'sqlite-ledger', { operationOrigin: operationOriginSchema.optional(), operationState: applicationOperationStateSchema, userConfirmation: applicationUserConfirmationSchema, paidGenerationEstimateKind: z.enum(['upper-bound', 'estimate']).optional(), paidReservation: paidReservationSchema, paidApproval: paidApprovalReceiptSchema }),
]

export function persistenceFormat(id: string): PersistenceFormat {
  const value = PERSISTENCE_FORMATS.find(format => format.id === id)
  if (!value) throw new Error(`持久格式未登记：${id}`)
  return value
}
