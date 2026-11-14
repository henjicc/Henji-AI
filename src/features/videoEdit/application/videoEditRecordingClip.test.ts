// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { recordingCursorFixture } from '@/tests/recordingCursorFixture'
import { makeVideoEditItemClip } from '@/core/videoEdit/projectItems'
import { RECORDING_ZOOM_EFFECT } from '@/core/videoEdit/recordingZoom'
import { getPlatform } from '@/platform/runtime'
import { closeAllVideoEdits, createVideoEditTestProject } from './videoEditDocumentTestKit'
import { editVideoProject } from './videoEditService'
import { recordingClipEffect, regenerateRecordingClipZoom } from './videoEditRecordingClip'

beforeEach(() => installHarnessNativeStorage())
afterEach(async () => { await closeAllVideoEdits(); vi.unstubAllGlobals(); vi.restoreAllMocks(); uninstallHarnessNativeStorage() })

// 文档里的事件页是磁盘路径；主线程“重新生成”必须按文件读取，不能拿磁盘路径去 fetch。
it('重新生成自动缩放在主线程按磁盘路径读取录屏事件页', async () => {
  const log = await recordingCursorFixture(4)
  const pages = log.source.pages.map((page, index) => ({ ...page, path: `D:/录屏/事件/page-${index}.capture.json` }))
  const files = new Map(pages.map((page, index) => [page.path, log.bytes.get(log.source.pages[index].path)!]))
  const readFile = vi.spyOn(getPlatform().system.fs, 'readFile').mockImplementation(async path => files.get(path)!)
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
  const owner = await createVideoEditTestProject(); const id = owner.document.id
  editVideoProject(id, document => {
    document = structuredClone(document)
    document.media.push({ id: 'screen', path: 'D:/录屏/screen.mp4', name: '录屏', kind: 'video', width: 1920, height: 1080, durationSeconds: 4, hasAudio: false, recordingCursor: { ...log.source, pages } })
    document.items.push({ id: 'item', mediaId: 'screen', name: '录屏', kind: 'video' })
    const sequence = document.sequences[0]
    sequence.clips = [{ ...makeVideoEditItemClip(document, 'item', sequence.id, { frame: 0, duration: 120 }), id: 'clip' }]
    return document
  })
  const target = { projectId: id, sequenceId: owner.activeSequenceId, clipId: 'clip' }
  const count = await regenerateRecordingClipZoom(target, new AbortController().signal)
  expect(fetch).not.toHaveBeenCalled()
  expect(readFile.mock.calls.map(call => call[0])).toEqual(pages.map(page => page.path))
  const regions = recordingClipEffect(owner.document.sequences[0].clips[0], RECORDING_ZOOM_EFFECT)?.builtin?.regions
  expect(regions).toHaveLength(count)
  expect(count).toBeGreaterThan(0)
})

it('读不到事件页时给出可恢复的提示，不暴露内部实现', async () => {
  const log = await recordingCursorFixture(2)
  vi.spyOn(getPlatform().system.fs, 'readFile').mockRejectedValue(new Error('ENOENT: no such file'))
  const owner = await createVideoEditTestProject(); const id = owner.document.id
  editVideoProject(id, document => {
    document = structuredClone(document)
    document.media.push({ id: 'screen', path: 'D:/录屏/screen.mp4', name: '录屏', kind: 'video', width: 1920, height: 1080, durationSeconds: 2, hasAudio: false, recordingCursor: { ...log.source, pages: log.source.pages.map(page => ({ ...page, path: 'D:/已移走/page.capture.json' })) } })
    document.items.push({ id: 'item', mediaId: 'screen', name: '录屏', kind: 'video' })
    const sequence = document.sequences[0]
    sequence.clips = [{ ...makeVideoEditItemClip(document, 'item', sequence.id, { frame: 0, duration: 60 }), id: 'clip' }]
    return document
  })
  await expect(regenerateRecordingClipZoom({ projectId: id, sequenceId: owner.activeSequenceId, clipId: 'clip' }, new AbortController().signal)).rejects.toThrow('重新生成')
})
