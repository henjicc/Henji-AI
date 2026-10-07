// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { createVideoEditTestProject } from '../application/videoEditDocumentTestKit'
import { closeVideoEditProject, listVideoEditInstances } from '../application/videoEditService'
import { reportVideoEditImport, subscribeVideoEditImportCompletion, withVideoEditImportTask, type VideoEditImportTask } from '../application/videoEditImportTask'
import { VideoEditImportProgress } from './VideoEditImportProgress'

beforeEach(() => { installHarnessNativeStorage() })
afterEach(async () => { cleanup(); for (const owner of listVideoEditInstances()) await closeVideoEditProject(owner.document.id); uninstallHarnessNativeStorage() })
it('查找阶段显示已发现数量和不定进度，探测阶段显示整队计数，完成后浮层消失且只通知一次', async () => {
  const owner = (await createVideoEditTestProject())!; const id = owner.document.id
  const events: number[] = []; const unsubscribe = subscribeVideoEditImportCompletion((_id, imported) => events.push(imported))
  let finish!: () => void; let task!: VideoEditImportTask
  const gate = new Promise<void>(resolve => { finish = resolve })
  const view = render(<VideoEditImportProgress projectId={id} />)
  let importing!: Promise<void>
  await act(async () => { importing = withVideoEditImportTask(id, undefined, async value => { task = value; reportVideoEditImport(task, { phase: 'enumerating', completed: 0, total: 5, totalKnown: false, discovered: 5 }); await gate }) })
  expect(view.getByRole('status').textContent).toBe('正在查找素材 · 已发现 5 个')
  expect(view.getByRole('progressbar').getAttribute('aria-valuenow')).toBeNull()
  act(() => { reportVideoEditImport(task, { phase: 'probing', completed: 2, total: 5, totalKnown: true }); task.imported = 2 })
  expect(view.getByRole('status').textContent).toBe('正在导入 2 / 5')
  expect(view.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('2')
  await act(async () => { finish(); await importing })
  expect(view.queryByRole('progressbar')).toBeNull(); expect(events).toEqual([2]); unsubscribe()
})
it('取消按钮取消整个队列，并在等待结束前显示正在取消', async () => {
  const owner = (await createVideoEditTestProject())!; const id = owner.document.id
  let finish!: () => void; let task!: VideoEditImportTask
  const gate = new Promise<void>(resolve => { finish = resolve })
  const view = render(<VideoEditImportProgress projectId={id} />)
  let importing!: Promise<void | unknown>
  await act(async () => { importing = withVideoEditImportTask(id, undefined, async value => { task = value; await gate; task.controller.signal.throwIfAborted() }, { total: 1 }).catch(error => error) })
  fireEvent.click(view.getByRole('button', { name: '取消整个导入队列' }))
  expect(task.controller.signal.aborted).toBe(true); expect(view.getByRole('button').textContent).toBe('正在取消')
  await act(async () => { finish(); await importing })
  expect(view.queryByRole('progressbar')).toBeNull()
})
