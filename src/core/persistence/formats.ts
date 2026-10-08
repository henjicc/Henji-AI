import { FILE_PERSISTENCE_FORMATS } from './fileContracts'
import { z } from 'zod'
import { DOCUMENT_KINDS } from '../documents/kinds'
import { documentEnvelopeSchema } from '../documents/envelope'
import { PROJECT_MANIFEST_VERSION, projectManifestSchema } from '../documents/projectManifest'
import { videoEditDocumentSchema } from '../videoEdit/document'
import { CODE_ASSET_VERSION, codeAssetSchema } from '../videoEdit/codeAsset'
import { codeMaterialVersionSchema } from '../videoEdit/codeMaterialPersistence'
import { codeComponentMetadataSchema } from '../videoEdit/codeMaterial/components'
import { codeMaterialFilesSchema } from '../videoEdit/codeMaterial/sources'
import { styleKitSchema } from '../videoEdit/styleKit'
import { titleTemplateSchema } from '../videoEdit/titleTemplates'
import { videoEditExportPresetSchema } from '../videoEdit/exportPresets'
import { audioEditProjectSchema } from '../audioEdit/schema'
import { assetRecordSchema, packageManifestSchema, PACKAGE_VERSION, presetRecordSchema, settingRecordSchema, videoEditTextPresetSchema, voiceLibraryRecordSchema, videoEditSubtitleManifestSchema } from './storedSchemas'
import type { PersistenceContract } from './migrations'
import { rendererSettingsSchema, SETTINGS_STORAGE_VERSION } from './settingsSchema'
import { formatMigrations } from './formatMigrations'
import { LOCAL_LIBRARY_FORMATS } from './versionedJson'
import { presetExportSchema, themePayloadSchema } from './auxiliarySchemas'
import { THEME_STORAGE_VERSION, CODE_COMPONENT_SCHEMA_VERSION, SQLITE_SCHEMA_VERSION } from './schemaVersions'
import { MODEL_DEFAULTS_VERSION, modelDefaultsSchema, NODE_DEFAULTS_VERSION, nodeDefaultsSchema, ONBOARDING_VERSION, onboardingSchema } from './preferenceSchemas'

export interface PersistenceFormat extends PersistenceContract {
  readonly versionSource: string
  readonly readEntry: string
  readonly migrationEntry: string
  /** Extra authoritative nested schemas must participate even when the outer reader is loose. */
  readonly schemas: Readonly<Record<string, z.ZodType>>
  readonly storage: 'file' | 'local-storage' | 'sqlite-ledger'
}

function format(id: string, name: string, version: number, versionSource: string, readEntry: string, schema: z.ZodType, storage: PersistenceFormat['storage'] = 'file', schemas: Readonly<Record<string, z.ZodType>> = {}): PersistenceFormat {
  const container = ['settings', 'theme'].includes(id) ? z.object({ version: z.literal(version), state: schema })
    : ['style-kits', 'title-templates', 'text-presets', 'export-presets', 'voice-library', 'node-defaults', 'llm-config'].includes(id) ? z.object({ version: z.literal(version), content: schema }).strict() : undefined
  return { id, name, version, versionSource, readEntry, schema, schemas: { content: schema, ...(container ? { container } : {}), ...schemas }, migrations: formatMigrations(id), storage, migrationEntry: storage === 'sqlite-ledger' ? 'electron/main/services/db-migrations.ts::SCHEMA_MIGRATIONS / runSchemaMigrations' : 'src/core/persistence/formatMigrations.ts / migrations.ts::upgradePersistenceContent' }
}

/** Single inventory. SQL payloads inherit the existing SQLite ledger, never a parallel ledger. */
export const PERSISTENCE_FORMATS: readonly PersistenceFormat[] = [
  ...FILE_PERSISTENCE_FORMATS,
  ...DOCUMENT_KINDS.map(kind => ({ ...format(`document.${kind.id}`, kind.untitledNames.zh.replace('未命名', ''), kind.version, 'DocumentEnvelope.kindVersion',
    kind.storage === 'package' ? 'electron/main/services/image-editor-v3/image-document/image-document-service.ts' : 'electron/main/services/documents/document-file.ts::decodeDocumentContent',
    kind.contentSchema, 'file', { envelope: documentEnvelopeSchema, ...(kind.id === 'video_edit' ? { domain: videoEditDocumentSchema } : {}), ...(kind.id === 'audio_edit' ? { domain: audioEditProjectSchema } : {}) }), migrations: kind.migrations, migrationEntry: 'src/core/documents/kinds/对应类型.ts::migrations / src/core/persistence/migrations.ts::upgradePersistenceContent' })),
  format('project', '项目说明', PROJECT_MANIFEST_VERSION, 'ProjectManifest.version', 'electron/main/services/documents/workspace.ts::readManifest', projectManifestSchema),
  format('project-package', '项目和文档包', PACKAGE_VERSION, 'henji-package.json.version', 'electron/main/services/documents/package-service.ts::readManifest', packageManifestSchema),
  format('code-version', '代码源码版本', 1, 'CodeMaterialVersion.apiVersion（源码由父版本引用携带版本）', 'electron/main/services/documents/code-files.ts::read', codeMaterialVersionSchema, 'file', { source: codeMaterialFilesSchema }),
  format('code-component', '项目组件说明', CODE_COMPONENT_SCHEMA_VERSION, '组件首行.schemaVersion（作品版本 version 与格式版本不同）', 'src/core/videoEdit/codeMaterial/components.ts::componentSourceMetadata', codeComponentMetadataSchema),
  format('code-asset', '可编辑代码资产', CODE_ASSET_VERSION, 'CodeAsset.version', 'src/core/videoEdit/codeAsset.ts::decodeCodeAsset', codeAssetSchema),
  format('settings', '界面设置', SETTINGS_STORAGE_VERSION, 'settings-storage.version', 'src/stores/settingsStore.ts::persist', rendererSettingsSchema, 'local-storage'),
  format('theme', '主题选择', THEME_STORAGE_VERSION, 'theme-storage.version', 'src/stores/themeStore.ts::persist', z.object({ theme: z.enum(['dark', 'light']) }), 'local-storage'),
  format('style-kits', '本机风格包', LOCAL_LIBRARY_FORMATS['video-edit-style-kits'].version, 'video-edit-style-kits.version', 'src/features/videoEdit/application/videoEditLocalLibrary.ts', z.array(styleKitSchema), 'local-storage'),
  format('title-templates', '本机标题模板', LOCAL_LIBRARY_FORMATS['video-edit-title-templates'].version, 'video-edit-title-templates.version', 'src/features/videoEdit/application/videoEditLocalLibrary.ts', z.array(titleTemplateSchema), 'local-storage'),
  format('text-presets', '本机文字和字幕预设', LOCAL_LIBRARY_FORMATS['video-edit-text-presets'].version, 'video-edit-text-presets.version', 'src/features/videoEdit/application/videoEditLocalLibrary.ts', z.array(videoEditTextPresetSchema), 'local-storage'),
  format('export-presets', '本机导出预设', LOCAL_LIBRARY_FORMATS['video-edit-export-presets'].version, 'video-edit-export-presets.version', 'src/features/videoEdit/application/videoEditExportPresets.ts', z.array(videoEditExportPresetSchema), 'local-storage'),
  format('voice-library', '克隆音色库', LOCAL_LIBRARY_FORMATS['voice_library_records'].version, 'settings.voice_library_records.version', 'src/services/voiceLibrary/VoiceLibraryService.ts::parseVoiceRecords', z.array(voiceLibraryRecordSchema)),
  format('preset-export', '可分享生成预设', 1, 'PresetService export.version（1.0 → 1）', 'src/services/presets/PresetService.ts::importPreset', presetExportSchema),
  format('theme-payload', '可分享主题', 2, 'ThemePayloadV2.version', 'src/core/theme/themeMigration.ts::parseThemePayload', themePayloadSchema),
  format('node-defaults', '画布默认参数', NODE_DEFAULTS_VERSION, 'henji-canvas-node-parameter-defaults-v1.version', 'src/features/canvas/application/nodeParameterDefaults.ts::load', nodeDefaultsSchema, 'local-storage'),
  format('model-defaults', '默认生成模型', MODEL_DEFAULTS_VERSION, 'ModelDefaultsStateV1.version', 'src/features/settings/modelDefaultsManager.ts::loadState', modelDefaultsSchema, 'local-storage'),
  format('onboarding', '首次引导进度', ONBOARDING_VERSION, 'OnboardingStateV2.version', 'src/features/onboarding/application/onboardingManager.ts::loadState', onboardingSchema, 'local-storage'),
  format('subtitle-manifest', '字幕回填记录', 1, '字幕声音.subtitle.json.version', 'src/features/videoEdit/application/videoEditAutoSubtitles.ts::complete', videoEditSubtitleManifestSchema),
  format('setting-records', '设置记录', SQLITE_SCHEMA_VERSION, 'schema_migrations（现有SQLite账本）', 'electron/main/services/settings/store.ts::getEntry', settingRecordSchema, 'sqlite-ledger'),
  format('asset-records', '素材库记录', SQLITE_SCHEMA_VERSION, 'schema_migrations（现有SQLite账本）', 'electron/main/services/asset-library/index.ts', assetRecordSchema, 'sqlite-ledger'),
  format('generation-presets', '生成预设', SQLITE_SCHEMA_VERSION, 'schema_migrations（现有SQLite账本）', 'electron/main/services/presets/store.ts', presetRecordSchema, 'sqlite-ledger'),
  format('sqlite', '应用数据库', SQLITE_SCHEMA_VERSION, 'SCHEMA_MIGRATIONS / schema_migrations', 'electron/main/services/db-migrations.ts::runSchemaMigrations', z.object({ version: z.number().int().positive(), name: z.string(), applied_at: z.number() }), 'sqlite-ledger'),
]

/** Deliberate scope boundary: rebuildable projections and external formats are not user-project migrations. */
export const PERSISTENCE_EXCLUSIONS = [
  { id: 'session-state', readEntry: 'electron/main/services/documents/session-state.ts', reason: '明示可丢弃的撤销/视口缓存；文档仍能从权威文件完整打开。' },
  { id: 'working-copy-links', readEntry: 'electron/main/services/image-editor-v3/image-document/working-copy-links.ts / canvas-layers/canvas-layer-packages.ts', reason: '可由权威包与工作副本重建的同步投影，业务文档和未保存工作副本在 image-working-copy 中受保护。' },
  { id: 'derived-media', readEntry: 'electron/main/services/audio/ / video/ / fonts/scanner.ts / local-inference/', reason: '波形、缩略帧、字体目录缓存、区域检测/跟踪缓存可从原媒体重算；不是独立用户内容。' },
  { id: 'external-media-and-fonts', readEntry: '项目素材/生成结果/字体目录/代码/*.ts', reason: '图片、视频、音频、字体和作者源码的字节保持原样；来源格式属于外部编码协议，代码的API/语言版本由code-version固定。' },
  { id: 'sqlite-owned-content', readEntry: 'electron/main/services/db-migrations.ts', reason: '生成历史、自定义模型、素材库/标签/文件夹关系、助手记忆与调用账本统一由既有SQLite账本负责；不另建迁移账本。' },
] as const

export function persistenceFormat(id: string): PersistenceFormat {
  const value = PERSISTENCE_FORMATS.find(format => format.id === id)
  if (!value) throw new Error(`持久格式未登记：${id}`)
  return value
}
