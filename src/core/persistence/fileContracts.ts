import { STORYBOARD_METADATA_VERSION, storyboardMetadataSchema } from './preferenceSchemas'
import { z } from 'zod'
import { IMAGE_EDIT_HISTORY_CHECKPOINT_VERSION_V3, imageEditHistoryCheckpointSchemaV3 } from '../imageEdit/v3/historyPaging/schema'
import type { PersistenceFormat } from './formats'
import { formatMigrations } from './formatMigrations'
import { imageDocumentHeaderSchema, imagePackageManifestSchema, imageWorkingCopySchema } from './imageSchemas'
import { canvasLayerHeaderSchema, encryptedKeystoreSchema, llmStoredConfigSchema, mediaGrantsSchema, providerSettingsJournalSchema } from './auxiliarySchemas'
import { CANVAS_LAYER_PACKAGE_VERSION, IMAGE_HEADER_VERSION, IMAGE_PACKAGE_VERSION, IMAGE_WORKING_VERSION, KEYSTORE_VERSION, LLM_CONFIG_VERSION, LLM_JOURNAL_VERSION, MEDIA_GRANTS_VERSION } from './schemaVersions'

function file(id: string, name: string, version: number, versionSource: string, readEntry: string, schema: z.ZodType, extra: Readonly<Record<string, z.ZodType>> = {}): PersistenceFormat {
  return { id, name, version, versionSource, readEntry, schema, schemas: { content: schema, ...extra }, migrations: formatMigrations(id), storage: 'file', migrationEntry: 'src/core/persistence/formatMigrations.ts / migrations.ts::upgradePersistenceContent' }
}

/** A light registry partition: runtime file readers must not load video/compiler or the whole inventory. */
export const FILE_PERSISTENCE_FORMATS: readonly PersistenceFormat[] = [
  file('image-history-checkpoint', '图片历史检查点', IMAGE_EDIT_HISTORY_CHECKPOINT_VERSION_V3, 'ImageEditHistoryCheckpointV3.version', 'electron/main/services/image-editor-v3/history-pages/store.ts::readPage', imageEditHistoryCheckpointSchemaV3),
  file('image-header', '图片文档头', IMAGE_HEADER_VERSION, 'henji-document.json.version', 'electron/main/services/image-editor-v3/image-document/header.ts::parseImageDocumentHeader', imageDocumentHeaderSchema),
  file('image-package', '图片文档包', IMAGE_PACKAGE_VERSION, 'manifest.json.packageVersion', 'electron/main/services/image-editor-v3/package-types.ts::validateHenjiImagePackageManifest', imagePackageManifestSchema),
  file('image-working-copy', '图片工作副本', IMAGE_WORKING_VERSION, 'ImageEditDocumentEnvelope.formatVersion / document.version', 'electron/main/services/image-editor-v3/document-repository.ts::validateImageEditDocumentEnvelope', imageWorkingCopySchema),
  file('canvas-layer-package', '画布内嵌图层包', CANVAS_LAYER_PACKAGE_VERSION, 'henji-document.json.version', 'electron/main/services/image-editor-v3/canvas-layers/canvas-layer-packages.ts', canvasLayerHeaderSchema, { package: imagePackageManifestSchema }),
  file('keystore', '供应商凭据文件', KEYSTORE_VERSION, 'KeystoreFile.version', 'electron/main/services/keystore.ts::readKeystoreFile', encryptedKeystoreSchema),
  file('media-grants', '媒体目录授权', MEDIA_GRANTS_VERSION, 'PersistedGrantsFile.version', 'electron/main/services/media/rootGrants.ts::restorePersistedMediaRoots', mediaGrantsSchema),
  file('llm-config', '助手模型配置', LLM_CONFIG_VERSION, 'llm-config.json.version（内容仍为公共SDK DTO）', 'electron/main/services/llm/provider-settings-storage.ts::readConfig', llmStoredConfigSchema, { container: z.object({ version: z.literal(LLM_CONFIG_VERSION), content: llmStoredConfigSchema }).strict() }),
  file('storyboard-metadata', '分镜图片描述', STORYBOARD_METADATA_VERSION, 'StoryboardCopilotMetadata.version（PNG iTXt）', 'electron/main/services/image/png-metadata.ts::readStoryboardMetadataFromPng', storyboardMetadataSchema),
  file('llm-config-journal', '助手配置事务恢复记录', LLM_JOURNAL_VERSION, 'ProviderSettingsJournal.version', 'electron/main/services/llm/provider-settings-storage.ts::readJournal', providerSettingsJournalSchema),
]

export function persistenceFileContract(id: string): PersistenceFormat {
  const contract = FILE_PERSISTENCE_FORMATS.find(value => value.id === id)
  if (!contract) throw new Error(`持久文件格式未登记：${id}`)
  return contract
}
