import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { captureLogPageSchema, type CaptureLogPage } from '../../../../src/core/captureLog/events'
import { decodePersistenceResource } from '../../../../src/core/persistence/resourceContracts'
import { refKey } from '../../../../src/core/captureLog/clock'
import { writeBufferAtomically } from '../fs/atomic-file'

/** Recording assets, not diagnostic logs. Every sealed page is fsynced before exclusive publication. */
export class RecordingEventStore {
  constructor(private readonly directory: string) {}
  async write(page: CaptureLogPage): Promise<string> {
    const parsed = captureLogPageSchema.parse(page)
    const text = JSON.stringify(parsed)
    const hash = createHash('sha256').update(text).digest('hex')
    const name = `${String(parsed.seqSpan[0]).padStart(16, '0')}-${hash}.capture.json`
    await writeBufferAtomically(join(this.directory, name), Buffer.from(text, 'utf8'), undefined, { exclusive: true })
    return join(this.directory, name)
  }
  /** Ignore unfinished writes; reject corruption, swapped ownership and overlaps instead of rebuilding empty logs. */
  async *recover(): AsyncGenerator<CaptureLogPage> {
    let lastSeq = -1; let lastMono = -1; let owner: string | undefined; let source: string | undefined
    let names: string[]
    try { names = await readdir(this.directory) } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }
    for (const name of names.filter(name => /^\d{16}-[a-f0-9]{64}\.capture\.json$/.test(name)).sort()) {
      const text = await readFile(join(this.directory, name), 'utf8')
      if (createHash('sha256').update(text).digest('hex') !== name.slice(17, 81)) throw new Error('采集页校验失败')
      const page = decodePersistenceResource('capture-log-page', JSON.parse(text))
      if (page.seqSpan[0] !== Number(name.slice(0, 16)) || page.seqSpan[0] <= lastSeq || page.monoSpanUs[0] < lastMono) throw new Error('采集页顺序无效')
      if (owner !== undefined && owner !== refKey(page.ownerRef) || source !== undefined && source !== page.sourceDigest) throw new Error('采集页归属不符')
      owner = refKey(page.ownerRef); source = page.sourceDigest
      lastSeq = page.seqSpan[1]; lastMono = page.monoSpanUs[1]
      yield page
    }
  }
}
