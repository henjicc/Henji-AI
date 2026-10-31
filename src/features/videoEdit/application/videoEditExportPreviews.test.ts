import { beforeEach, expect, it, vi } from 'vitest'
import { createVideoEditDocument, createVideoEditSequence, videoEditComposition } from '@/core/videoEdit/document'
import { videoEditSequenceExportSettings } from '@/core/videoEdit/exportPresets'
import { videoEditExportPreviews } from './videoEditExportPreviews'

const state = vi.hoisted(() => ({ owner: {} as { document: ReturnType<typeof createVideoEditDocument>; contentVersion: number }, ready: vi.fn() }))
vi.mock('./videoEditService', () => ({ requireVideoEditInstance: () => state.owner }))
vi.mock('./videoEditRenderCache', () => ({ prepareVideoEditRenderWindows: state.ready }))
beforeEach(() => { state.owner = { document: { ...createVideoEditDocument('导出'), sequences: [createVideoEditSequence()] }, contentVersion: 0 }; state.ready.mockReset() })

it('只选当前快照的就绪预览，并核对分辨率、帧率与开关', async () => {
  const snapshot = videoEditComposition(state.owner.document, state.owner.document.sequences[0].id)
  const settings = { ...videoEditSequenceExportSettings(snapshot), usePreviews: true }, signal = new AbortController().signal
  const ready = { key: 'ready', path: 'preview.mp4', startFrame: 0, endFrame: 120, width: snapshot.width, height: snapshot.height, fps: snapshot.fps }
  state.ready.mockResolvedValue([ready, { ...ready, key: 'small', width: settings.width / 2 }, { ...ready, key: 'fps', fps: snapshot.fps / 2 }])
  expect(await videoEditExportPreviews('project', snapshot, settings, signal)).toEqual([ready])
  expect(await videoEditExportPreviews('project', snapshot, { ...settings, captionMode: 'none' }, signal)).toEqual([ready])
  state.ready.mockClear()
  expect(await videoEditExportPreviews('project', snapshot, { ...settings, usePreviews: false }, signal)).toEqual([])
  expect(await videoEditExportPreviews('project', snapshot, { ...settings, usePreviews: undefined }, signal)).toEqual([])
  state.owner.document = { ...state.owner.document, revision: snapshot.revision + 1 }
  expect(await videoEditExportPreviews('project', snapshot, settings, signal)).toEqual([])
  expect(state.ready).not.toHaveBeenCalled()
})

it('加载中发生编辑、同 revision 的不同画面及不烧录字幕的输出都不借用预览', async () => {
  const snapshot = videoEditComposition(state.owner.document, state.owner.document.sequences[0].id)
  const settings = { ...videoEditSequenceExportSettings(snapshot), usePreviews: true }, signal = new AbortController().signal
  expect(await videoEditExportPreviews('project', { ...snapshot, width: snapshot.width + 2 }, settings, signal)).toEqual([])
  const captions = [{ id: 'caption', text: '字幕', start: 0, duration: 10 }]
  state.owner.document.sequences[0].captions = captions
  const captioned = videoEditComposition(state.owner.document, snapshot.id)
  expect(await videoEditExportPreviews('project', captioned, { ...settings, captionMode: 'srt' }, signal)).toEqual([])
  state.ready.mockImplementation(async () => { state.owner.document.revision++; return [{ key: 'old' }] })
  expect(await videoEditExportPreviews('project', captioned, settings, signal)).toEqual([])
})

it('等待前只比较一次合成，等待后以文档身份和内容版本拒绝迟到预览', async () => {
  const snapshot = videoEditComposition(state.owner.document, state.owner.document.sequences[0].id)
  const settings = { ...videoEditSequenceExportSettings(snapshot), usePreviews: true }
  const ready = { key: 'ready', width: snapshot.width, height: snapshot.height, fps: snapshot.fps }
  const serialize = vi.fn(() => [])
  Object.defineProperty(state.owner.document.media, 'toJSON', { value: serialize })
  state.ready.mockResolvedValue([ready])
  expect(await videoEditExportPreviews('project', snapshot, settings, new AbortController().signal)).toEqual([ready])
  expect(serialize).toHaveBeenCalledTimes(2)
  state.ready.mockImplementationOnce(async () => { state.owner.document = { ...state.owner.document }; return [ready] })
  expect(await videoEditExportPreviews('project', snapshot, settings, new AbortController().signal)).toEqual([])
  state.ready.mockImplementationOnce(async () => { state.owner.contentVersion++; return [ready] })
  expect(await videoEditExportPreviews('project', snapshot, settings, new AbortController().signal)).toEqual([])
})

it.each([true, false])('直接渲染与完整合成均按输出尺寸筛选预览，按输出渲染=%s', async renderAtOutputResolution => {
  const snapshot = videoEditComposition(state.owner.document, state.owner.document.sequences[0].id)
  const settings = { ...videoEditSequenceExportSettings(snapshot), width: 1280, height: 720, usePreviews: true, renderAtOutputResolution }
  const ready = { key: 'output-sized', width: 1280, height: 720, fps: snapshot.fps }
  state.ready.mockResolvedValue([ready, { ...ready, key: 'too-small', width: 1278 }])
  expect(await videoEditExportPreviews('project', snapshot, settings, new AbortController().signal)).toEqual([ready])
})
