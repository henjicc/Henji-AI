import { expect, it, vi } from 'vitest'
vi.mock('../db', () => ({ getDb: vi.fn() }))
vi.mock('../logging', () => ({ createMainLogger: () => ({ info: vi.fn(), error: vi.fn() }) }))
import { assertAudioEditProjectIdle, cancelAudioEditTask, registerAudioEditTaskController } from './task-store'

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
