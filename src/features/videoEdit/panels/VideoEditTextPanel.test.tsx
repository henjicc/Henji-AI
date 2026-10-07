import { createVideoEditTestProject as createVideoEditProject } from '../application/videoEditDocumentTestKit'
// @vitest-environment jsdom
import { useSyncExternalStore } from 'react'
import { VirtuosoMockContext } from 'react-virtuoso'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { makeVideoEditItemClip } from '@/core/videoEdit/projectItems'
import { buildVideoEditTextTranscription } from '@/core/videoEdit/textTranscript'
import { videoEditComposition } from '@/core/videoEdit/document'
import { editVideoProject, setVideoEditView, subscribeVideoEditDomain, videoEditDomainRevision, undoVideoEdit, type VideoEditInstance } from '../application/videoEditService'
import { closeAllVideoEdits } from '../application/videoEditDocumentTestKit'
import { VideoEditTextPanel } from './VideoEditTextPanel'

let owner: VideoEditInstance
const report = vi.fn()
beforeEach(async () => {
  installHarnessNativeStorage(); report.mockClear()
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  owner = await createVideoEditProject()
  editVideoProject(owner.document.id, document => {
    document.media = [{ id: 'm', name: '口播', kind: 'video', path: 'D:/voice.mp4', width: 64, height: 64, hasAudio: true, durationSeconds: 5 }]
    document.items = [{ id: 'item', name: '口播', kind: 'video', mediaId: 'm' }]
    const sequence = document.sequences[0]; const clip = makeVideoEditItemClip(document, 'item', sequence.id, { frame: 0, duration: 150 })
    sequence.clips = [clip]
    sequence.textTranscription = buildVideoEditTextTranscription(videoEditComposition(document, sequence.id), [clip], { id: 'audio', name: '口播', source: { mediaType: 'audio', sourcePath: 'D:/mix.wav', audioPath: 'D:/mix.wav', sampleRate: 1000, channels: 1, durationFrames: 5000 }, revision: 1, createdAt: 1, updatedAt: 1, referenceScript: '', vstEnabled: false, suggestions: [], transcript: [
      { id: 'w1', text: '价格', startFrame: 1000, endFrame: 1500, granularity: 'word', included: true, locked: false },
      { id: 'w2', text: '九元。', startFrame: 1500, endFrame: 2000, granularity: 'word', included: true, locked: false },
    ] }, 0)
    return document
  })
})
afterEach(async () => { cleanup(); await closeAllVideoEdits(); vi.unstubAllGlobals(); uninstallHarnessNativeStorage() })
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
  expect(owner.past.length).toBe(history + 1)
  expect(owner.document.sequences[0].clips.reduce((sum, clip) => sum + clip.duration, 0)).toBe(120)
  expect(view.queryByRole('button', { name: '跳转到：价格' })).toBeNull()
  act(() => undoVideoEdit(owner.document.id)); expect(owner.document.sequences).toEqual(before)
  expect(await view.findByRole('button', { name: '跳转到：价格' })).toBeTruthy(); expect(report).not.toHaveBeenCalled()
})
it('timeline edits invalidate an existing text selection instead of deleting newly mapped words', async () => {
  const view = render(<View />)
  fireEvent.click(await view.findByRole('button', { name: '跳转到：价格' }))
  expect(view.getByRole('button', { name: '删除' }).hasAttribute('disabled')).toBe(false)
  act(() => editVideoProject(owner.document.id, document => { document.sequences[0].clips[0].start = 15; return document }))
  expect(view.getByRole('button', { name: '删除' }).hasAttribute('disabled')).toBe(true)
  fireEvent.click(view.getByRole('button', { name: '跳转到：价格' })); expect(owner.frame).toBe(45)
})
