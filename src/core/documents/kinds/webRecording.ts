import { henjiExtension, henjiLegacyExtensions } from '../../fileExtensions'
import type { DocumentKindDescriptor } from './registry'
import { WEB_RECORDING_MIGRATIONS, WEB_RECORDING_MIN_READER_VERSION, WEB_RECORDING_VERSION, webRecordingManifestSchema, type WebRecordingManifest } from '../../webReplay/schema'

/**
 * 网页录制 `.hjweb`：带后缀的文件夹，里面是录制原样的 recording.json / data.json / behavior.json / blobs/ 与备份录屏、重演视频，
 * 不压缩、不打包。文档头就是 recording.json（ID、标题、创建时间），内容版本即录制格式版本，由主进程文件夹适配器读写。
 * 只放在项目里（默认 素材/录屏/）；不属于任何项目的录制仍在应用数据的 web-recordings 下，不是文档。
 * 录制只能由网页应用录制产生，不能新建空文档。
 */
export const webRecordingDocumentKind: DocumentKindDescriptor<WebRecordingManifest> = {
  id: 'web_recording', extension: henjiExtension('web_recording'), legacyExtensions: henjiLegacyExtensions('web_recording'), storage: 'folder',
  version: WEB_RECORDING_VERSION, minReaderVersion: WEB_RECORDING_MIN_READER_VERSION, migrations: WEB_RECORDING_MIGRATIONS,
  standaloneFolderNames: null,
  projectMaterialsFolderNames: { zh: '录屏', en: 'Recordings' },
  untitledNames: { zh: '未命名网页录制', en: 'Untitled Web Recording' },
  contentSchema: webRecordingManifestSchema,
  createEmptyContent: () => { throw new Error('网页录制只能通过录制网页应用产生。') },
  isEmptyContent: () => false,
  summarize: content => ({ durationMs: Math.round(content.durationUs / 1000), status: content.status, app: content.app.name }),
}
