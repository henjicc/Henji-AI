import fs from 'node:fs/promises'
import path from 'node:path'
import { webRecordingDocumentKind } from '../../../../src/core/documents/kinds/webRecording'
import { WEB_RECORDING_FILES, WEB_RECORDING_VERSION, WEB_RECORDING_MIGRATIONS, webRecordingManifestSchema, type WebRecordingManifest } from '../../../../src/core/webReplay/schema'
import { persistenceForwardFields, upgradePersistenceContent } from '../../../../src/core/persistence/migrations'
import { restoreForwardFields } from '../../../../src/core/persistence/forwardCompat'
import { backupBeforePersistenceUpgrade } from '../persistence/file-upgrade'
import { writeBufferAtomically } from '../fs/atomic-file'
import type { PackageDocumentAdapter } from '../documents/package-adapters'
import { WebRecordingStore } from './store'

/**
 * `.hjweb` 文件夹的头信息就是 recording.json：ID 即录制 ID，名称写进标题（文件夹名与标题保持一致），
 * 录制没有草稿；修改时间取 recording.json 的。内容版本即录制格式版本。
 */
export function createWebRecordingDocumentAdapter(): PackageDocumentAdapter {
  return {
    kind: webRecordingDocumentKind.id,
    headerFile: WEB_RECORDING_FILES.manifest,
    async readHeader(directory) {
      const manifest = await new WebRecordingStore(directory).readManifest()
      const stat = await fs.stat(path.join(directory, WEB_RECORDING_FILES.manifest))
      return {
        id: manifest.id, name: manifest.title ?? path.basename(directory), draft: false, revision: 0, kindVersion: manifest.version,
        createdAt: manifest.createdAt, updatedAt: new Date(stat.mtimeMs).toISOString(), summary: webRecordingDocumentKind.summarize(manifest),
      }
    },
    async writeHeader(directory, patch) {
      const filePath = path.join(directory, WEB_RECORDING_FILES.manifest)
      const original = await fs.readFile(filePath, 'utf8')
      const raw = JSON.parse(original) as { version: number; minReaderVersion: number }
      const contract = { id: 'web-recording', name: '网页录制', version: WEB_RECORDING_VERSION, schema: webRecordingManifestSchema, migrations: WEB_RECORDING_MIGRATIONS }
      const backupPath = raw.version < contract.version ? await backupBeforePersistenceUpgrade(filePath, contract, raw.version, original) : undefined
      const upgraded = upgradePersistenceContent(contract, raw, raw.version, backupPath, raw.minReaderVersion) as WebRecordingManifest
      const { title, ...manifest } = upgraded
      const name = patch.name?.slice(0, 120) ?? title
      const value = restoreForwardFields({ ...manifest, version: Math.max(raw.version, contract.version), ...(patch.id ? { id: patch.id } : {}), ...(name ? { title: name } : {}), ...(patch.foreign ? { foreign: patch.foreign } : {}) }, persistenceForwardFields(upgraded))
      await writeBufferAtomically(filePath, Buffer.from(JSON.stringify(value)))
    },
    isEmpty: async () => false,
  }
}
