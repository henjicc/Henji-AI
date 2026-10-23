import fs from 'node:fs/promises'
import path from 'node:path'
import { webRecordingDocumentKind } from '../../../../src/core/documents/kinds/webRecording'
import { WEB_RECORDING_FILES } from '../../../../src/core/webReplay/schema'
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
      const store = new WebRecordingStore(directory)
      const { title, ...manifest } = await store.readManifest()
      const name = patch.name?.slice(0, 120) ?? title
      await store.writeManifest({ ...manifest, ...(patch.id ? { id: patch.id } : {}), ...(name ? { title: name } : {}) })
    },
    isEmpty: async () => false,
  }
}
