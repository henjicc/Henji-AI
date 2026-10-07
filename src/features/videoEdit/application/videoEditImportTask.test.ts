// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { clearLogEvents, getLogEvents } from '@/core/logging'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { createVideoEditTestProject } from './videoEditDocumentTestKit'
import { closeVideoEditProject, listVideoEditInstances } from './videoEditService'
import { reportVideoEditImport, subscribeVideoEditImport, subscribeVideoEditImportCompletion, videoEditImportTask, withVideoEditImportTask } from './videoEditImportTask'

beforeEach(() => { clearLogEvents(); installHarnessNativeStorage() })
afterEach(async () => { for (const owner of listVideoEditInstances()) await closeVideoEditProject(owner.document.id); uninstallHarnessNativeStorage() })
it('清理阶段追加请求仍进入同一个队列，连续累加进度并只发一次完成通知，没有悬空请求', async () => {
  const owner = (await createVideoEditTestProject())!; const id = owner.document.id
  let finishCleanup!: () => void; let cleaning = false
  const gate = new Promise<void>(resolve => { finishCleanup = resolve })
  const notices: number[] = []; const unsubscribe = subscribeVideoEditImportCompletion((_id, imported) => notices.push(imported))
  try {
    const first = withVideoEditImportTask(id, undefined, async task => {
      task.imported = 1; reportVideoEditImport(task, { phase: 'probing', completed: 1, total: 1, totalKnown: true })
      return 'first'
    }, { total: 1, cleanup: async () => { cleaning = true; await gate } })
    await vi.waitFor(() => expect(cleaning).toBe(true))
    const second = withVideoEditImportTask(id, undefined, async task => {
      task.imported = 1; reportVideoEditImport(task, { phase: 'probing', completed: 1, total: 1, totalKnown: true })
      return 'second'
    }, { total: 1 })
    expect(videoEditImportTask(id)).toMatchObject({ queued: 1, requests: 2, total: 2, completed: 1 })
    finishCleanup()
    expect(await Promise.all([first, second])).toEqual(['first', 'second'])
    expect(videoEditImportTask(id)).toBeUndefined(); expect(notices).toEqual([2])
  } finally { finishCleanup(); unsubscribe() }
})

it('进度订阅者抛错不能中断入队、运行和收尾，也不影响其他订阅者', async () => {
  const owner = await createVideoEditTestProject(); const id = owner.document.id
  const failure = new Error('进度通知失败'); const observe = vi.fn()
  const stopFailed = subscribeVideoEditImport(() => { throw failure })
  const stopObserve = subscribeVideoEditImport(observe)
  const cleanup = vi.fn()
  try {
    await expect(withVideoEditImportTask(id, undefined, async task => {
      reportVideoEditImport(task, { phase: 'probing', completed: 1, total: 1, totalKnown: true })
      return 'imported'
    }, { cleanup })).resolves.toBe('imported')
    expect(observe).toHaveBeenCalled(); expect(videoEditImportTask(id)).toBeUndefined()
    expect(cleanup).toHaveBeenCalledOnce()
    expect(getLogEvents().some(event => event.event === 'video_edit.media.queue.progress_notification_failed' && event.level === 'error')).toBe(true)
    await expect(withVideoEditImportTask(id, undefined, async () => 'next')).resolves.toBe('next')
  } finally { stopFailed(); stopObserve() }
})

it('完成订阅者抛错不影响后续通知与请求兑现，也不会产生未处理拒绝', async () => {
  const owner = await createVideoEditTestProject(); const id = owner.document.id
  const observe = vi.fn()
  const stopFailed = subscribeVideoEditImportCompletion(() => { throw new Error('完成通知失败') })
  const stopObserve = subscribeVideoEditImportCompletion(observe)
  try {
    await expect(withVideoEditImportTask(id, undefined, async () => 'imported')).resolves.toBe('imported')
    expect(observe).toHaveBeenCalledWith(id, 0, 0); expect(videoEditImportTask(id)).toBeUndefined()
    expect(getLogEvents().some(event => event.event === 'video_edit.media.queue.completion_notification_failed' && event.level === 'error')).toBe(true)
  } finally { stopFailed(); stopObserve() }
})
