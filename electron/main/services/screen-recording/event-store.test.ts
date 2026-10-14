import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CaptureLogCollector } from '../../../../src/core/captureLog/collector'
import type { CaptureLogPage } from '../../../../src/core/captureLog/events'
import { RecordingEventStore } from './event-store'
vi.mock('../logging', () => ({ createMainLogger: () => ({ warn: vi.fn() }) }))

const directories: string[] = []
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }) })
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'henji-capture-test-')); directories.push(directory)
  const store = new RecordingEventStore(directory); let id = 0
  const collector = new CaptureLogCollector({ ownerRef: { kind: 'screen_recording.session', id: 's' }, sourceDigest: `sha256:${'b'.repeat(64)}`, originUs: 0, id: () => `${id++}` }, page => store.write(page), () => {})
  return { directory, store, collector }
}
it('恢复已同步完整页；崩溃留下的半页不进入索引；恢复只读，不重演能力', async () => {
  const { directory, store, collector } = await fixture()
  collector.start(0)
  collector.record(1, { kind: 'capability', callId: 'call', capability: 'read_application_entity', targets: [{ kind: 'video_edit.document', id: 'doc' }], phase: 'started' })
  collector.record(2, { kind: 'capability', callId: 'call', capability: 'read_application_entity', targets: [{ kind: 'video_edit.document', id: 'doc' }], phase: 'completed' })
  await collector.stop(3)
  await writeFile(join(directory, 'interrupted.capture.json.pending'), '{')
  const recovered: CaptureLogPage[] = []; for await (const page of store.recover()) recovered.push(page)
  expect(recovered.flatMap(page => page.entries).filter(event => event.kind === 'capability')).toHaveLength(2)
  expect(await readdir(directory)).toHaveLength(2)
})
it('正文损坏不能被当作空日志，写入页需符合权威schema', async () => {
  const { directory, store, collector } = await fixture(); collector.start(0); await collector.stop(10)
  const [file] = await readdir(directory); await writeFile(join(directory, file), '{"version":1}')
  await expect(async () => { for await (const _page of store.recover()) { /* consume */ } }).rejects.toThrow('校验')
})
