// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { recordingCursorFixture } from '@/tests/recordingCursorFixture'
import { makeVideoEditItemClip } from '@/core/videoEdit/projectItems'
import { getPlatform } from '@/platform/runtime'
import { closeAllVideoEdits, createVideoEditTestProject } from './videoEditDocumentTestKit'
import { editVideoProject } from './videoEditService'
import { readVideoEditTrackingBox } from './videoEditTrackingEdits'

beforeEach(() => installHarnessNativeStorage())
afterEach(async () => { await closeAllVideoEdits(); vi.unstubAllGlobals(); vi.restoreAllMocks(); uninstallHarnessNativeStorage() })

// 主线程读录屏跟踪框不经任何 mock：读取方式由剪辑实例绑定时显式接线，文档里的磁盘路径按文件读取，不拿去 fetch。
it('主线程读录屏窗口跟踪框：按磁盘路径读取真实事件页，窗口移动后框跟着移动', async () => {
  const log = await recordingCursorFixture(4, { windows: true })
  const pages = log.source.pages.map((page, index) => ({ ...page, path: `D:/录屏/事件/page-${index}.capture.json` }))
  const files = new Map(pages.map((page, index) => [page.path, log.bytes.get(log.source.pages[index].path)!]))
  const readFile = vi.spyOn(getPlatform().system.fs, 'readFile').mockImplementation(async path => files.get(path)!)
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
  const owner = await createVideoEditTestProject(); const id = owner.document.id
  const prompt: [number, number, number, number] = [100 / 1920, 100 / 1080, 800 / 1920, 600 / 1080]
  editVideoProject(id, document => {
    document = structuredClone(document)
    document.media.push({ id: 'screen', path: 'D:/录屏/screen.mp4', name: '录屏', kind: 'video', width: 1920, height: 1080, durationSeconds: 4, hasAudio: false, recordingCursor: { ...log.source, pages } })
    document.items.push({ id: 'item', mediaId: 'screen', name: '录屏', kind: 'video' })
    const sequence = document.sequences[0]
    const clip = makeVideoEditItemClip(document, 'item', sequence.id, { frame: 0, duration: 120 })
    sequence.clips = [{ ...clip, id: 'clip', trackers: [{ id: 'win', name: '编辑器窗口', method: 'box', prompts: [{ timeUs: 0, box: prompt }], recording: { kind: 'window', windowId: 'editor' } }] }]
    return document
  })
  const before = await readVideoEditTrackingBox(id, owner.activeSequenceId, 'clip', 'win', 30)
  const after = await readVideoEditTrackingBox(id, owner.activeSequenceId, 'clip', 'win', 90)
  expect(fetch).not.toHaveBeenCalled()
  expect(readFile).toHaveBeenCalled()
  expect(readFile.mock.calls.every(([path]) => files.has(path))).toBe(true)
  // 1 秒时窗口仍在 (100,100) 800×600；3 秒时已移到 (400,200) 1200×600。
  expect(before?.slice(0, 4).map(value => Math.round(value * 1000) / 1000)).toEqual(prompt.map(value => Math.round(value * 1000) / 1000))
  expect(after?.[0]).toBeCloseTo(400 / 1920, 3)
  expect(after?.[2]).toBeCloseTo(1200 / 1920, 3)
})
