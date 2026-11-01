// @vitest-environment jsdom
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createApplicationHarness } from './applicationHarness'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from './harnessNativeStorage'
import { getPlatform } from '@/platform'
import type { ApplicationRef } from '@/core/application-control'
import type { WebRecordingManifest } from '@/core/webReplay/schema'
import { isRejectedBeforeWrite } from '@/core/application-control/execution/rejectionErrors'
import { WEB_REPLAY_TAKE_TYPE } from '@/features/screenRecording/application/webReplayTake'

const boundary = vi.hoisted(() => ({ root: '', directory: '', recordingId: '' }))
vi.mock('electron', () => ({ net: {}, shell: {} }))
vi.mock('../../electron/main/services/appPaths', () => ({ getUserFolderDir: () => boundary.root }))
vi.mock('../../electron/main/services/web-replay/player/player', () => ({ WebRecordingPlayer: {} }))
vi.mock('../../electron/main/services/web-replay/backupVideo', () => ({ BACKUP_VIDEO_FILE: 'backup.mp4', BACKUP_AUDIO_DIRECTORY: 'audio', WebRecordingBackupVideo: {}, mixWebRecordingBackupAudio: vi.fn() }))
vi.mock('../../electron/main/services/web-replay/server', () => ({ WEB_REPLAY_PORT: 7891, WebReplayServer: class {} }))
vi.mock('../../electron/main/services/documents/runtime', () => ({ getDocumentService: () => { throw new Error('版本不能作为整段录制更新作品索引') } }))
vi.mock('../../electron/main/services/web-replay/locations', () => ({
  listWebRecordingLocations: async () => [{ id: boundary.recordingId, directory: boundary.directory, projectId: null }],
  resolveWebRecordingDirectory: async (id: string) => {
    if (id !== boundary.recordingId || !await fs.access(boundary.directory).then(() => true, () => false)) throw new Error('没有找到所属网页录制，请先恢复录制')
    return boundary.directory
  },
}))

import { cleanWebRecordingTrash, listDeletedWebRecordings, listWebRecordings, readWebRecording, removeWebRecordingTake, restoreWebRecording } from '../../electron/main/services/web-replay/runtime'
import { listWebReplayTakes, readWebReplayTake, TAKE_FILES, takeDirectory, webReplayTakeManifestSchema } from '../../electron/main/services/web-replay/takes'
import { WebRecordingStore, webRecordingsRoot } from '../../electron/main/services/web-replay/store'
import { webReplayRenderJobs } from '../../electron/main/services/web-replay/renderJobs'
import { markWebRecordingTrashed, WEB_RECORDING_TRASH_RETENTION_MS } from '../../electron/main/services/web-replay/trash'
import { createWebReplayApi } from '../../electron/preload/web-replay-api'
import { WEB_REPLAY_CHANNELS } from '@/platform/contracts/webReplay'

const parent = (): ApplicationRef => ({ kind: 'screen_recording.web_recording', id: boundary.recordingId })
const ref = (name = '首问'): ApplicationRef => ({ kind: WEB_REPLAY_TAKE_TYPE, id: `${boundary.recordingId}:${name}` })
const changes = (targets = [ref()]) => ({ summary: '删除单个网页重演版本', changes: [{ kind: 'remove_items', parent: parent(), entityType: WEB_REPLAY_TAKE_TYPE, targets }] })

async function seedTake(name = '首问', recordingId = boundary.recordingId): Promise<void> {
  const directory = takeDirectory(boundary.directory, name)
  await fs.mkdir(directory, { recursive: true })
  const manifest = webReplayTakeManifestSchema.parse({ version: 1, name, recordingId, createdAt: new Date().toISOString(), fps: 30, width: 1280, height: 820, frames: 30, durationUs: 1_000_000, pointer: false, video: true, conflicts: 0, warnings: 0 })
  await fs.writeFile(path.join(directory, TAKE_FILES.manifest), JSON.stringify(manifest))
  await fs.writeFile(path.join(directory, TAKE_FILES.video), `视频 ${name}`)
  await fs.writeFile(path.join(directory, TAKE_FILES.behavior), '{"events":[]}')
}

beforeEach(async () => {
  installHarnessNativeStorage()
  boundary.root = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-take-delete-'))
  const manifest = JSON.parse(await fs.readFile('tests/fixtures/persistence/web-recording/v4.json', 'utf8')) as WebRecordingManifest
  boundary.recordingId = manifest.id
  boundary.directory = path.join(webRecordingsRoot(), manifest.id)
  await fs.mkdir(boundary.directory, { recursive: true })
  await new WebRecordingStore(boundary.directory).writeManifest(manifest)
  await seedTake()
  await seedTake('保留')
  // 只替换 IPC 传输，公共注册、事务、领域读写与回收文件均用正式实现。
  const api = createWebReplayApi(async <T>(channel: string, payload?: unknown): Promise<T> => {
    const input = payload as { recordingId: string; take?: string }
    if (channel === WEB_REPLAY_CHANNELS.remove && input.take) return await removeWebRecordingTake(input.recordingId, input.take) as T
    if (channel === WEB_REPLAY_CHANNELS.restore) return await restoreWebRecording(input.recordingId) as T
    throw new Error(`意外 IPC：${channel}`)
  }, () => () => {})
  vi.spyOn(getPlatform().webReplay, 'recordings').mockImplementation(listWebRecordings)
  vi.spyOn(getPlatform().webReplay, 'removeTake').mockImplementation(api.removeTake)
  vi.spyOn(getPlatform().webReplay, 'restore').mockImplementation(api.restore)
})
afterEach(async () => {
  vi.restoreAllMocks()
  uninstallHarnessNativeStorage()
  await fs.rm(boundary.root, { recursive: true, force: true })
})

it('正式 describe→通用删除→读回：版本进现有回收区且读不到，撤销后视频及轨道回来，其他版本不变', async () => {
  const app = createApplicationHarness()
  try {
    const description = await app.requireResult('describe_application_entities', { entityTypes: [WEB_REPLAY_TAKE_TYPE], refs: [parent()] })
    expect(description.entities).toContainEqual(expect.objectContaining({ id: WEB_REPLAY_TAKE_TYPE, collectionWrite: expect.objectContaining({ removable: true }) }))
    expect((await app.requireResult('list_application_entities', { entityType: WEB_REPLAY_TAKE_TYPE })).refs).toContainEqual(expect.objectContaining(ref()))
    const original = await app.read(ref())
    const result = await app.requireResult('change_application_entities', changes())
    expect((await app.call('read_application_entity', { ref: ref() })).ok).toBe(false)
    expect((await listWebReplayTakes(boundary.directory)).map(take => take.name)).toEqual(['保留'])
    await expect(readWebRecording({ recordingId: boundary.recordingId, take: '首问', track: 'behavior', offset: 0, limit: 50 })).rejects.toThrow('没有叫“首问”的版本')
    const [deleted] = await listDeletedWebRecordings()
    expect(deleted).toMatchObject({ name: '首问', category: '网页重演版本' })
    const trashId = deleted.id.slice('web-recording:'.length)
    expect(await fs.readFile(path.join(webRecordingsRoot(), '.trash', trashId, TAKE_FILES.video), 'utf8')).toBe('视频 首问')
    await app.requireResult('undo_application_changes', { undoRef: result.undoRef })
    expect((await app.read(ref())).properties).toEqual(original.properties)
    expect(await listDeletedWebRecordings()).toEqual([])
    expect(await readWebRecording({ recordingId: boundary.recordingId, take: '首问', track: 'behavior', offset: 0, limit: 50 })).toMatchObject({ entries: [], total: 0 })
    expect(await fs.readFile(path.join(takeDirectory(boundary.directory, '首问'), TAKE_FILES.video), 'utf8')).toBe('视频 首问')
  } finally { app.dispose() }
})

it('不存在的版本明确报错且未写入，通用删除拒绝其他录制的版本', async () => {
  const error = await removeWebRecordingTake(boundary.recordingId, '不存在').catch((error: unknown) => error)
  expect(error).toBeInstanceOf(Error)
  expect((error as Error).message).toContain('没有叫“不存在”的版本')
  expect(isRejectedBeforeWrite(error)).toBe(true)
  const app = createApplicationHarness()
  try {
    const result = await app.call('change_application_entities', changes([ref('不存在')]))
    expect(result.ok).toBe(false)
    const wrongParent = changes()
    wrongParent.changes[0].parent = { ...parent(), id: '00000000-0000-4000-8000-000000000002' }
    expect((await app.call('change_application_entities', wrongParent)).ok).toBe(false)
    expect(await listDeletedWebRecordings()).toEqual([])
    expect((await readWebReplayTake(boundary.directory, '首问')).name).toBe('首问')
  } finally { app.dispose() }
})

it('同名版本重新产出后拒绝旧删除基线，刷新基线后可删除', async () => {
  const app = createApplicationHarness()
  try {
    const before = await app.read(ref())
    const manifestPath = path.join(takeDirectory(boundary.directory, '首问'), TAKE_FILES.manifest)
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as Record<string, unknown>
    await fs.writeFile(manifestPath, JSON.stringify({ ...manifest, createdAt: new Date(Date.now() + 1000).toISOString() }))
    const after = await app.read(ref())
    expect(after.revisions).not.toEqual(before.revisions)
    expect((await app.call('change_application_entities', changes(), before.revisions as Record<string, number>)).ok).toBe(false)
    expect((await readWebReplayTake(boundary.directory, '首问')).name).toBe('首问')
    expect(await listDeletedWebRecordings()).toEqual([])
    await app.requireResult('change_application_entities', changes())
    expect(await listDeletedWebRecordings()).toHaveLength(1)
  } finally { app.dispose() }
})

it('公共多项撤销遇到后项失败时回滚本步骤，修正后同一回执可重试', async () => {
  const app = createApplicationHarness()
  try {
    const result = await app.requireResult('change_application_entities', changes([ref(), ref('保留')]))
    const restore = vi.mocked(getPlatform().webReplay.restore)
    const realRestore = restore.getMockImplementation()!
    restore.mockImplementationOnce(realRestore).mockImplementationOnce(async () => {
      await app.read(ref())
      throw new Error('暂时无法恢复')
    })
    expect((await app.call('undo_application_changes', { undoRef: result.undoRef })).ok).toBe(false)
    expect(await listWebReplayTakes(boundary.directory)).toEqual([])
    expect(await listDeletedWebRecordings()).toHaveLength(2)
    await app.requireResult('undo_application_changes', { undoRef: result.undoRef })
    expect(await listDeletedWebRecordings()).toEqual([])
    expect((await listWebReplayTakes(boundary.directory)).map(take => take.name).sort()).toEqual(['保留', '首问'].sort())
  } finally { app.dispose() }
})

it.each(['queued', 'running'] as const)('%s 的重演沿用整段录制规则拒绝删除，结束后可删；同名重出与恢复冲突不覆盖', async state => {
  const jobId = crypto.randomUUID()
  webReplayRenderJobs.begin(jobId, boundary.recordingId)
  if (state === 'running') webReplayRenderJobs.running(jobId)
  try {
    await expect(removeWebRecordingTake(boundary.recordingId, '首问')).rejects.toThrow('正在重演')
    expect(await listDeletedWebRecordings()).toEqual([])
  } finally { webReplayRenderJobs.fail(jobId, new Error('测试结束')) }
  const trashId = await removeWebRecordingTake(boundary.recordingId, '首问')
  await seedTake()
  await expect(restoreWebRecording(trashId)).rejects.toThrow('原位置已有同名')
  expect(await listDeletedWebRecordings()).toHaveLength(1)
  const secondId = await removeWebRecordingTake(boundary.recordingId, '首问')
  expect(secondId).not.toBe(trashId)
  expect(await listDeletedWebRecordings()).toHaveLength(2)
  await restoreWebRecording(trashId)
  expect((await readWebReplayTake(boundary.directory, '首问')).name).toBe('首问')
})

it('恢复导入副本以原位置为准，不使用版本里的来源录制 ID；父录制不在时不制造半份目录，复用 30 天清理', async () => {
  await seedTake('首问', crypto.randomUUID())
  const trashId = await removeWebRecordingTake(boundary.recordingId, '首问')
  const renamed = `${boundary.directory}-改名`
  await fs.rename(boundary.directory, renamed)
  await expect(restoreWebRecording(trashId)).rejects.toThrow('先恢复录制')
  expect(await fs.access(boundary.directory).then(() => true, () => false)).toBe(false)
  await fs.rename(renamed, boundary.directory)
  await restoreWebRecording(trashId)
  expect((await readWebReplayTake(boundary.directory, '首问')).name).toBe('首问')
  const expired = await removeWebRecordingTake(boundary.recordingId, '首问')
  await markWebRecordingTrashed(path.join(webRecordingsRoot(), '.trash'), expired, new Date(Date.now() - WEB_RECORDING_TRASH_RETENTION_MS - 1000))
  await cleanWebRecordingTrash()
  expect(await listDeletedWebRecordings()).toEqual([])
  expect(await fs.readdir(path.join(webRecordingsRoot(), '.trash'))).toEqual([])
})
