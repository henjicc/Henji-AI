import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import {
  WEB_RECORDING_FILES, storageSnapshotSchema, webRecordingBehaviorSchema, webRecordingDataSchema, webRecordingManifestSchema, webRecordingResourcesSchema,
  WEB_RECORDING_VERSION, type StoredBody, type StorageSnapshotValue, type WebRecordingBehaviorEvent, type WebRecordingData, type WebRecordingManifest, type WebRecordingResources, type WireBodyValue,
} from '../../../../src/core/webReplay/schema'
import { getUserFolderDir } from '../appPaths'
import { writeBufferAtomically } from '../fs/atomic-file'

export function webRecordingsRoot(): string { return path.join(getUserFolderDir('uploads'), 'web-recordings') }
export function webRecordingDirectory(id: string): string {
  if (!z.string().uuid().safeParse(id).success) throw new Error('录制编号无效')
  return path.join(webRecordingsRoot(), id)
}

export function sha256(bytes: Uint8Array): string { return crypto.createHash('sha256').update(bytes).digest('hex') }
export function digestBase64(base64: string): string { return sha256(Buffer.from(base64, 'base64')) }

/**
 * One recording directory. Blobs are content addressed and written once; JSON files are replaced
 * atomically. Every read is validated against the registered format.
 */
export class WebRecordingStore {
  constructor(readonly directory: string) {}

  static forId(id: string): WebRecordingStore { return new WebRecordingStore(webRecordingDirectory(id)) }

  blobPath(digest: string): string { return path.join(this.directory, WEB_RECORDING_FILES.blobs, digest) }

  async prepare(): Promise<void> { await fs.mkdir(path.join(this.directory, WEB_RECORDING_FILES.blobs), { recursive: true }) }

  /** Synchronous digest; the write happens in the background and is awaited by `flushBlobs`. */
  private pendingBlobs: Promise<void>[] = []
  putBytes(bytes: Uint8Array): { blob: string; size: number } {
    const blob = sha256(bytes)
    const file = this.blobPath(blob)
    this.pendingBlobs.push(fs.writeFile(file, bytes, { flag: 'wx' }).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }))
    return { blob, size: bytes.byteLength }
  }
  storeBody = (body: WireBodyValue): StoredBody => ('text' in body ? { text: body.text } : this.putBytes(Buffer.from(body.base64, 'base64')))
  async flushBlobs(): Promise<void> { const pending = this.pendingBlobs.splice(0); await Promise.all(pending) }

  async readBlob(digest: string): Promise<Buffer> { return fs.readFile(this.blobPath(digest)) }
  async readBody(body: StoredBody): Promise<WireBodyValue> { return 'text' in body ? { text: body.text } : { base64: (await this.readBlob(body.blob)).toString('base64') } }

  private async writeJson(name: string, value: unknown): Promise<void> { await writeBufferAtomically(path.join(this.directory, name), Buffer.from(JSON.stringify(value))) }
  private async readJson<T>(name: string, schema: z.ZodType<T>): Promise<T> { return schema.parse(JSON.parse(await fs.readFile(path.join(this.directory, name), 'utf8'))) }

  writeManifest(manifest: WebRecordingManifest): Promise<void> { return this.writeJson(WEB_RECORDING_FILES.manifest, webRecordingManifestSchema.parse(manifest)) }
  writeData(data: WebRecordingData): Promise<void> { return this.writeJson(WEB_RECORDING_FILES.data, webRecordingDataSchema.parse(data)) }
  writeBehavior(events: WebRecordingBehaviorEvent[]): Promise<void> { return this.writeJson(WEB_RECORDING_FILES.behavior, webRecordingBehaviorSchema.parse({ events })) }
  writeStorage(snapshot: StorageSnapshotValue): Promise<void> { return this.writeJson(WEB_RECORDING_FILES.storage, storageSnapshotSchema.parse(snapshot)) }
  writeResources(resources: WebRecordingResources): Promise<void> { return this.writeJson(WEB_RECORDING_FILES.resources, webRecordingResourcesSchema.parse(resources)) }

  async appendJournal(lines: string): Promise<void> { await fs.appendFile(path.join(this.directory, WEB_RECORDING_FILES.journal), lines) }

  /** Reads the manifest and refuses recordings written by a newer Henji it cannot understand. */
  async readManifest(): Promise<WebRecordingManifest> {
    const manifest = await this.readJson(WEB_RECORDING_FILES.manifest, webRecordingManifestSchema)
    if (manifest.version > WEB_RECORDING_VERSION && manifest.minReaderVersion > WEB_RECORDING_VERSION) throw new Error('这段网页录制由更新版本的痕迹AI创建，请升级后再打开')
    return manifest
  }
  readData(): Promise<WebRecordingData> { return this.readJson(WEB_RECORDING_FILES.data, webRecordingDataSchema) }
  async readBehavior(): Promise<WebRecordingBehaviorEvent[]> { return (await this.readJson(WEB_RECORDING_FILES.behavior, webRecordingBehaviorSchema)).events }
  readStorage(): Promise<StorageSnapshotValue> { return this.readJson(WEB_RECORDING_FILES.storage, storageSnapshotSchema) }
  readResources(): Promise<WebRecordingResources> { return this.readJson(WEB_RECORDING_FILES.resources, webRecordingResourcesSchema) }
}
