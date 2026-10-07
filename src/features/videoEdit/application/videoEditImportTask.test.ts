// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { createVideoEditTestProject } from './videoEditDocumentTestKit'
import { closeVideoEditProject, listVideoEditInstances } from './videoEditService'
import { reportVideoEditImport, subscribeVideoEditImportCompletion, videoEditImportTask, withVideoEditImportTask } from './videoEditImportTask'

beforeEach(() => { installHarnessNativeStorage() })
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
