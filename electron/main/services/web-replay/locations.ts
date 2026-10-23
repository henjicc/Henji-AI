import fs from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { WEB_RECORDING_FILES } from '../../../../src/core/webReplay/schema'
import { getDocumentService } from '../documents/runtime'
import { webRecordingDirectory, webRecordingsRoot } from './store'

/**
 * 网页录制在两处：不属于项目的录制在应用数据的 web-recordings/<录制ID>/（旧有位置，原样读写、不迁移不改名）；
 * 存进项目的录制是 `.hjweb` 文档（默认 素材/录屏/<名称>.hjweb），位置由作品索引记录。
 * 录制 ID 在两处之间唯一：进项目时 ID 已被占用就换新 ID。
 */
export interface WebRecordingLocation {
  id: string
  directory: string
  /** 所在项目；不属于项目时为 null。 */
  projectId: string | null
  /** 作品索引里的文档 ID（等于录制 ID）；不属于项目时为 null。 */
  documentId: string | null
}

const UUID_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** Directories of recordings still being written: they are not in the index until the manifest is final. */
const active = new Map<string, WebRecordingLocation>()

export function rememberActiveWebRecording(location: WebRecordingLocation): void { active.set(location.id, location) }
export function forgetActiveWebRecording(id: string): void { active.delete(id) }

async function hasManifest(directory: string): Promise<boolean> {
  return fs.access(path.join(directory, WEB_RECORDING_FILES.manifest)).then(() => true, () => false)
}

async function projectRecordings(): Promise<WebRecordingLocation[]> {
  const documents = await getDocumentService().listDocuments({ kind: 'web_recording', includeMissing: false })
  return documents.map(document => ({ id: document.id, directory: document.path, projectId: document.container.kind === 'project' ? document.container.projectId : null, documentId: document.id }))
}

/** Every recording location, the app-data ones first; unreadable index entries are left to the caller's read. */
export async function listWebRecordingLocations(): Promise<WebRecordingLocation[]> {
  const root = webRecordingsRoot()
  const names = (await fs.readdir(root).catch(() => [] as string[])).filter(name => UUID_NAME.test(name))
  const result = new Map<string, WebRecordingLocation>()
  for (const name of names) result.set(name.toLowerCase(), { id: name, directory: path.join(root, name), projectId: null, documentId: null })
  for (const location of [...await projectRecordings(), ...active.values()]) if (!result.has(location.id.toLowerCase())) result.set(location.id.toLowerCase(), location)
  return [...result.values()]
}

export async function resolveWebRecordingLocation(id: string): Promise<WebRecordingLocation> {
  if (!z.string().uuid().safeParse(id).success) throw new Error('录制编号无效')
  const running = active.get(id)
  if (running) return running
  const legacy = webRecordingDirectory(id)
  if (await hasManifest(legacy)) return { id, directory: legacy, projectId: null, documentId: null }
  const found = (await projectRecordings()).find(location => location.id === id)
  if (found) return found
  throw new Error('没有找到这段网页录制，它可能已被删除或移走；请重新列出网页录制')
}

export async function resolveWebRecordingDirectory(id: string): Promise<string> { return (await resolveWebRecordingLocation(id)).directory }

/** Whether a recording id is already used anywhere (a copied folder brought into a project then needs a new id). */
export async function webRecordingIdTaken(id: string): Promise<boolean> {
  if (active.has(id) || await hasManifest(webRecordingDirectory(id))) return true
  return (await projectRecordings()).some(location => location.id === id)
}
