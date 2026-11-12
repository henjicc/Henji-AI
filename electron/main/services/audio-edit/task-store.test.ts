import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createCountedSqlite } from '../documents/sqlite.test-support'

const state = vi.hoisted(() => ({ sqlite: undefined as ReturnType<typeof import('../documents/sqlite.test-support').createCountedSqlite> | undefined }))
vi.mock('../db', () => ({ getDb: () => state.sqlite!.db }))
vi.mock('../db-locations', () => ({ databaseLocations: { use: <T>(work: (scope: { encodeValue: (value: unknown) => unknown; decodeValue: (value: unknown) => unknown }) => T) => work({ encodeValue: (value) => value, decodeValue: (value) => value }) } }))
vi.mock('../logging', () => ({ createMainLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }))
import {
  assertAudioEditProjectIdle, cancelAudioEditTask, claimAudioEditTask, findAudioEditTranscription, isAudioEditTaskActive,
  markInterruptedAudioEditTasks, registerAudioEditTaskController, settleStaleAudioEditTask, updateOwnedAudioEditTask,
} from './task-store'

// 心跳计时器是模块级的：每个用例都用假计时器，结束时再走一拍，让空了的心跳自己停掉
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
  state.sqlite = createCountedSqlite()
  state.sqlite.native.exec(`CREATE TABLE audio_edit_tasks (request_id TEXT PRIMARY KEY, document_id TEXT NOT NULL, kind TEXT NOT NULL, state TEXT NOT NULL,
    provider_task_id TEXT, input_digest TEXT NOT NULL, result_json TEXT, error_message TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`)
})
afterEach(() => { vi.advanceTimersByTime(5_000); vi.useRealTimers() })
const row = (requestId: string): { state: string; updated_at: number; result_json: string | null } => state.sqlite!.native.prepare('SELECT state, updated_at, result_json FROM audio_edit_tasks WHERE request_id = ?').get(requestId) as never
const insert = (requestId: string, taskState: string, updatedAt: number): void => { state.sqlite!.native.prepare("INSERT INTO audio_edit_tasks VALUES (?, 'doc', 'transcription', ?, NULL, 'd', NULL, NULL, 1, ?)").run(requestId, taskState, updatedAt) }
const claim = (owner: string, takeoverUpdatedAt?: number): boolean => claimAudioEditTask({ requestId: 'task', projectId: 'doc', kind: 'transcription', inputDigest: 'd', owner, result: { billing: 'not_charged' }, ...(takeoverUpdatedAt !== undefined ? { takeoverUpdatedAt } : {}) })

it('read-only audio analysis does not block edits while mutations still exclude each other', () => {
  const preview = new AbortController()
  const releasePreview = registerAudioEditTaskController('preview', 'p', preview, true)
  const releaseWrite = registerAudioEditTaskController('write', 'p', new AbortController())
  try {
    expect(() => assertAudioEditProjectIdle('p')).toThrow('处理任务')
    releaseWrite()
    expect(() => assertAudioEditProjectIdle('p')).not.toThrow()
    cancelAudioEditTask('preview')
    expect(preview.signal.aborted).toBe(true)
  } finally { releasePreview(); releaseWrite() }
})

it('两个进程同时为同一份口播发起转写：只有一方认领成功', () => {
  expect(claim('A')).toBe(true)
  expect(claim('B')).toBe(false)
  expect(JSON.parse(row('task').result_json!)).toMatchObject({ owner: 'A' })
})

it('接管只认读到时的那一行：读之后原执行者写过（updated_at 变了）就落空；接管后原执行者的写入一个字也改不了', () => {
  expect(claim('A')).toBe(true)
  expect(updateOwnedAudioEditTask('task', 'A', { state: 'failed', result: { billing: 'not_charged' } })).toBe(true)
  const seen = findAudioEditTranscription('doc')!
  // 原执行者其实还活着，又写了一次
  expect(updateOwnedAudioEditTask('task', 'A', { state: 'failed', result: { billing: 'not_charged' } })).toBe(true)
  expect(claim('B', seen.updated_at)).toBe(false)
  expect(claim('B', findAudioEditTranscription('doc')!.updated_at)).toBe(true)
  const after = row('task')
  expect(updateOwnedAudioEditTask('task', 'A', { state: 'cancelled', result: { billing: 'not_charged' } })).toBe(false)
  expect(row('task')).toEqual(after)
  expect(JSON.parse(after.result_json!)).toMatchObject({ owner: 'B' })
})

it('心跳只在令牌对得上时刷新；令牌被接管后本进程这次转写自己停下', () => {
  expect(claim('A')).toBe(true)
  const controller = new AbortController()
  const release = registerAudioEditTaskController('task', 'doc', controller, false, 'A')
  try {
    const before = row('task').updated_at
    vi.advanceTimersByTime(5_000)
    expect(row('task').updated_at).toBeGreaterThan(before)
    expect(controller.signal.aborted).toBe(false)
    state.sqlite!.native.prepare("UPDATE audio_edit_tasks SET result_json = json_set(result_json, '$.owner', 'B')").run()
    vi.advanceTimersByTime(5_000)
    expect(controller.signal.aborted).toBe(true)
  } finally { release() }
})

it('别的进程是否在跑看心跳：一分钟内算在跑，停了更久或时钟拨回超过一分钟算中断；有命令行在跑时启动只标心跳停了的', () => {
  const now = Date.now()
  insert('fresh', 'running', now - 5_000)
  insert('stale', 'running', now - 120_000)
  insert('future', 'running', now + 120_000)
  insert('done', 'failed', now)
  expect(['fresh', 'stale', 'future', 'done'].map(isAudioEditTaskActive)).toEqual([true, false, false, false])
  markInterruptedAudioEditTasks(true)
  expect(['fresh', 'stale', 'future'].map((id) => row(id).state)).toEqual(['running', 'failed', 'failed'])
  markInterruptedAudioEditTasks(false)
  expect(row('fresh').state).toBe('failed')
  insert('stuck', 'running', now - 120_000)
  insert('busy', 'running', now)
  settleStaleAudioEditTask('stuck'); settleStaleAudioEditTask('busy')
  expect([row('stuck').state, row('busy').state]).toEqual(['failed', 'running'])
})
