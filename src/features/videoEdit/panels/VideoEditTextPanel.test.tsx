import { createVideoEditTestProject as createVideoEditProject } from '../application/videoEditDocumentTestKit'
// @vitest-environment jsdom
import { useSyncExternalStore } from 'react'
import { VirtuosoMockContext } from 'react-virtuoso'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { makeVideoEditItemClip } from '@/core/videoEdit/projectItems'
import { buildVideoEditTextTranscription } from '@/core/videoEdit/textTranscript'
import { videoEditComposition } from '@/core/videoEdit/document'
import { editVideoProject, setVideoEditView, subscribeVideoEditDomain, videoEditDomainRevision, undoVideoEdit, type VideoEditInstance } from '../application/videoEditService'
import { closeAllVideoEdits } from '../application/videoEditDocumentTestKit'
import { VideoEditTextPanel } from './VideoEditTextPanel'
import { getPlatform } from '@/platform/runtime'

let owner: VideoEditInstance
const report = vi.fn()
beforeEach(async () => {
  installHarnessNativeStorage(); report.mockClear()
  const fileContent = { sizeBytes: 4096, fileModifiedAt: 1000, contentIdentity: 'a'.repeat(64) }
  vi.spyOn(getPlatform().assetLibrary, 'inspectFileContent').mockResolvedValue(fileContent)
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  owner = await createVideoEditProject()
  editVideoProject(owner.document.id, document => { document = structuredClone(document);
    document.media = [{ id: 'm', name: '口播', kind: 'video', path: 'D:/voice.mp4', width: 64, height: 64, hasAudio: true, durationSeconds: 5, assetContent: fileContent }]
    document.items = [{ id: 'item', name: '口播', kind: 'video', mediaId: 'm' }]
    const sequence = document.sequences[0]; const clip = makeVideoEditItemClip(document, 'item', sequence.id, { frame: 0, duration: 150 })
    sequence.clips = [clip]
    sequence.textTranscription = buildVideoEditTextTranscription(videoEditComposition(document, sequence.id), [clip], { id: 'audio', name: '口播', source: { mediaType: 'audio', sourcePath: 'D:/mix.wav', audioPath: 'D:/mix.wav', sampleRate: 1000, channels: 1, durationFrames: 5000 }, revision: 1, createdAt: 1, updatedAt: 1, referenceScript: '', suggestions: [], transcript: [
      { id: 'w1', text: '价格', startFrame: 1000, endFrame: 1500, granularity: 'word', included: true, locked: false },
      { id: 'w2', text: '九元。', startFrame: 1500, endFrame: 2000, granularity: 'word', included: true, locked: false },
    ] }, 0)
    return document
  })
})
afterEach(async () => { cleanup(); await closeAllVideoEdits(); vi.restoreAllMocks(); vi.unstubAllGlobals(); uninstallHarnessNativeStorage() })
function View(): React.ReactElement {
  useSyncExternalStore(subscribeVideoEditDomain, videoEditDomainRevision)
  return <VirtuosoMockContext.Provider value={{ viewportHeight: 300, itemHeight: 56 }}><VideoEditTextPanel instance={owner} sequence={owner.document.sequences[0]} onError={report} /></VirtuosoMockContext.Provider>
}
it('word clicks seek, playback highlights with voiceover gap tolerance, Shift selection deletes once and undo restores text', async () => {
  const view = render(<View />); const before = structuredClone(owner.document.sequences); const history = owner.past.length
  fireEvent.click(await view.findByRole('button', { name: '跳转到：价格' }))
  expect(owner.frame).toBe(30)
  expect(view.getByRole('button', { name: '跳转到：价格' }).getAttribute('aria-current')).toBe('true')
  act(() => setVideoEditView(owner.document.id, { frame: 48 }))
  expect(view.getByRole('button', { name: '跳转到：九元。' }).getAttribute('aria-current')).toBe('true')
  fireEvent.click(view.getByRole('button', { name: '跳转到：九元。' }), { shiftKey: true })
  fireEvent.click(view.getByRole('button', { name: '删除' }))
  await waitFor(() => expect(owner.past.length).toBe(history + 1))
  expect(owner.document.sequences[0].clips.reduce((sum, clip) => sum + clip.duration, 0)).toBe(120)
  expect(view.queryByRole('button', { name: '跳转到：价格' })).toBeNull()
  act(() => undoVideoEdit(owner.document.id)); expect(owner.document.sequences).toEqual(before)
  expect(await view.findByRole('button', { name: '跳转到：价格' })).toBeTruthy(); expect(report).not.toHaveBeenCalled()
})
it('timeline edits invalidate an existing text selection instead of deleting newly mapped words', async () => {
  const view = render(<View />)
  fireEvent.click(await view.findByRole('button', { name: '跳转到：价格' }))
  expect(view.getByRole('button', { name: '删除' }).hasAttribute('disabled')).toBe(false)
  act(() => editVideoProject(owner.document.id, document => { document = structuredClone(document); document.sequences[0].clips[0].start = 15; return document }))
  expect(view.getByRole('button', { name: '删除' }).hasAttribute('disabled')).toBe(true)
  fireEvent.click(view.getByRole('button', { name: '跳转到：价格' })); expect(owner.frame).toBe(45)
})

it('等待文件核对时可取消，迟到完成不剪辑，保留选词并可重试', async () => {
  const view = render(<View />); const before = owner.document; const history = owner.past.length
  fireEvent.click(await view.findByRole('button', { name: '跳转到：价格' }))
  let finish!: (value: { sizeBytes: number; fileModifiedAt: number; contentIdentity: string }) => void
  const inspect = vi.mocked(getPlatform().assetLibrary.inspectFileContent).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  fireEvent.click(view.getByRole('button', { name: '删除' }))
  await waitFor(() => expect(finish).toBeTypeOf('function'))
  expect(view.getByRole('button', { name: '删除' }).hasAttribute('disabled')).toBe(true)
  fireEvent.click(view.getByRole('button', { name: '取消' }))
  await act(async () => { finish(owner.document.media[0].assetContent as { sizeBytes: number; fileModifiedAt: number; contentIdentity: string }); await Promise.resolve() })
  expect(owner.document).toBe(before); expect(owner.past.length).toBe(history)
  await waitFor(() => expect(view.getByRole('button', { name: '删除' }).hasAttribute('disabled')).toBe(false))
  expect(inspect).toHaveBeenCalledOnce(); expect(report).not.toHaveBeenCalled()
  fireEvent.click(view.getByRole('button', { name: '删除' }))
  await waitFor(() => expect(owner.past.length).toBe(history + 1))
})

it('选中画面可关联文字并定位到词范围，一次撤销解除关联', async () => {
  act(() => editVideoProject(owner.document.id, document => { document = structuredClone(document);
    document.items.push({ id: 'label-item', name: '强调', kind: 'text' })
    const sequence = document.sequences[0]
    sequence.tracks.push({ ...sequence.tracks.find(track => track.kind === 'video')!, id: 'label-track', index: 2 })
    sequence.clips.push({ ...makeVideoEditItemClip(document, 'label-item', sequence.id, { frame: 0, duration: 15, track: 2 }), id: 'label', text: '九元' })
    return document
  }))
  act(() => setVideoEditView(owner.document.id, { selection: 'label' }))
  const view = render(<View />); const before = structuredClone(owner.document.sequences); const history = owner.past.length
  fireEvent.click(await view.findByRole('button', { name: '跳转到：价格' }))
  fireEvent.click(view.getByRole('button', { name: '跳转到：九元。' }), { shiftKey: true })
  let bind = view.queryByRole('button', { name: '选中画面随这段内容' })
  if (!bind) { fireEvent.click(view.getByRole('button', { name: '更多文本剪辑操作' })); bind = await view.findByRole('button', { name: '选中画面随这段内容' }) }
  fireEvent.click(bind)
  await waitFor(() => expect(owner.past.length).toBe(history + 1))
  expect(owner.document.sequences[0].clips.find(clip => clip.id === 'label')).toMatchObject({ start: 30, duration: 30, contentAnchor: { ranges: [{ fromUs: 1000000, toUs: 2000000 }] } })
  expect(owner.past.length).toBe(history + 1)
  act(() => undoVideoEdit(owner.document.id)); expect(owner.document.sequences).toEqual(before)
  expect(report).not.toHaveBeenCalled()
})
