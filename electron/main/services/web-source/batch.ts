import fs from 'node:fs'
import fsp from 'node:fs/promises'
import { hashWebSourceFiles, type WebFileHash } from './hashes'
import { webSourceFiles } from './site'

export interface WebSourceManifest { rootIdentity: string; contentHash: string; files: WebFileHash[] }

async function manifest(root: string, signal?: AbortSignal): Promise<WebSourceManifest> {
  const real = await fsp.realpath(root), stat = await fsp.stat(root)
  const result = await hashWebSourceFiles(await webSourceFiles(root), signal)
  return { rootIdentity: JSON.stringify([real, stat.dev, stat.ino]), ...result }
}

/** 一批录制只认同一份来源；即使改动后恢复原字节，也不能发布中间态产生的画面。 */
export class WebSourceBatch {
  private watcher?: fs.FSWatcher
  private invalid = false
  private closed = false
  private constructor(readonly root: string, readonly source: WebSourceManifest) {}

  static async begin(root: string, signal?: AbortSignal): Promise<WebSourceBatch> {
    signal?.throwIfAborted()
    // 先监视再散列，避免枚举/读取期间的保存被当成稳定基线。
    let changed = false
    const watcher = fs.watch(root, { recursive: true }, () => { changed = true })
    watcher.on('error', () => { changed = true })
    try {
      const source = await manifest(root, signal)
      if (changed) throw new Error('网页来源在批次开始时变化')
      const batch = new WebSourceBatch(root, source)
      batch.watcher = watcher
      watcher.removeAllListeners('change')
      watcher.on('change', () => { batch.invalid = true })
      watcher.on('error', () => { batch.invalid = true })
      watcher.unref()
      return batch
    } catch (error) { watcher.close(); throw error }
  }

  get current(): boolean { return !this.closed && !this.invalid }

  async validate(signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted()
    if (!this.current) throw new Error('网页录制批次已失效')
    const actual = await manifest(this.root, signal)
    if (!this.current || actual.rootIdentity !== this.source.rootIdentity || actual.contentHash !== this.source.contentHash ||
      JSON.stringify(actual.files) !== JSON.stringify(this.source.files)) {
      this.invalid = true
      throw new Error('网页来源清单或字节已变化，作废本批录制')
    }
  }

  close(): void { this.closed = true; this.watcher?.close(); this.watcher = undefined }
}
