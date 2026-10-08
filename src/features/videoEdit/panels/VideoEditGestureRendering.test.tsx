// @vitest-environment jsdom
import { Profiler } from 'react'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { defaultVideoEditTextStyle } from '@/core/videoEdit/text'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { createVideoEditTestProject, closeAllVideoEdits } from '../application/videoEditDocumentTestKit'
import { appendVideoEditClip, beginVideoEditGesture, finishVideoEditGesture, subscribeVideoEditDomain, updateVideoEditPicturePosition, videoEditCommittedDocument, type VideoEditInstance } from '../application/videoEditService'
import { videoEditTextPresetLibrary } from '../application/videoEditTextPresets'
import { VideoEditTypographyPanel } from './VideoEditTypographyPanel'
import { VideoEditAnnotationsPanel } from './VideoEditAnnotationsPanel'
import { VideoEditFontWarnings } from './VideoEditFontWarnings'
import { useSyncExternalStore } from 'react'
import * as fonts from '../application/videoEditFonts'
import * as elements from '../application/videoEditCodeElements'
import { VideoEditCodeElementOverlay } from '../VideoEditCodeElementOverlay'

vi.mock('./VideoEditAnnotationThumbnail', () => ({ VideoEditAnnotationThumbnail: () => <div /> }))
vi.mock('react-virtuoso', () => ({ Virtuoso: () => <div /> }))
afterEach(async () => { cleanup(); await closeAllVideoEdits(); vi.restoreAllMocks(); uninstallHarnessNativeStorage() })

it('unrelated typography and annotation panels do not commit per position update; font inspection waits for finish', async () => {
  installHarnessNativeStorage()
  const owner = await createVideoEditTestProject(); appendVideoEditClip(owner.document.id)
  const clipId = owner.document.sequences[0].clips[0].id
  const fontCalls = vi.spyOn(fonts, 'videoEditFontUses').mockResolvedValue([])
  const commits = { typography: 0, annotations: 0 }
  function WarningsHost({ instance }: { instance: VideoEditInstance }): React.ReactElement {
    const document = useSyncExternalStore(subscribeVideoEditDomain, () => videoEditCommittedDocument(instance))
    return <VideoEditFontWarnings document={document} />
  }
  render(<><Profiler id="typography" onRender={() => commits.typography++}><VideoEditTypographyPanel style={defaultVideoEditTextStyle(1080)} onChange={vi.fn()} onError={vi.fn()} /></Profiler><Profiler id="annotations" onRender={() => commits.annotations++}><VideoEditAnnotationsPanel instance={owner} onError={vi.fn()} /></Profiler><WarningsHost instance={owner} /></>)
  await act(async () => { await Promise.resolve() })
  const before = { ...commits }; const initialFonts = fontCalls.mock.calls.length
  const handle = beginVideoEditGesture(owner.document.id)
  for (let i = 1; i <= 10; i++) act(() => { updateVideoEditPicturePosition(handle, owner.activeSequenceId, clipId, { x: i / 100, y: .1 }) })
  const during = { typography: commits.typography - before.typography, annotations: commits.annotations - before.annotations, fontInspections: fontCalls.mock.calls.length - initialFonts }
  if (process.env.HENJI_GESTURE_BENCH === '1') process.stdout.write(`${JSON.stringify({ updates: 10, panelCommits: during })}\n`)
  act(() => { finishVideoEditGesture(handle) }); await act(async () => { await Promise.resolve() })
  expect(during).toEqual({ typography: 0, annotations: 0, fontInspections: 0 })
  expect(fontCalls.mock.calls.length).toBe(initialFonts + 1)
  const previous = commits.typography
  act(() => { videoEditTextPresetLibrary.save('手势测试预设', defaultVideoEditTextStyle(1080)) })
  expect(commits.typography).toBe(previous + 1)
})

it('an idle element overlay does not build a hit index for each document publication', async () => {
  installHarnessNativeStorage(); const owner = await createVideoEditTestProject(); appendVideoEditClip(owner.document.id)
  const build = vi.spyOn(elements, 'videoEditCodeElementFrames'); const hit = vi.spyOn(elements, 'hitVideoEditCodeElement'); const onError = vi.fn()
  const view = render(<div data-testid="monitor"><VideoEditCodeElementOverlay instance={owner} enabled onError={onError} /></div>)
  const handle = beginVideoEditGesture(owner.document.id)
  for (let i = 1; i <= 10; i++) act(() => { updateVideoEditPicturePosition(handle, owner.activeSequenceId, owner.document.sequences[0].clips[0].id, { x: i / 100, y: .1 }) })
  expect(build).not.toHaveBeenCalled()
  fireEvent(view.getByTestId('monitor'), new MouseEvent('pointermove', { bubbles: true, clientX: 10, clientY: 10, buttons: 0 }))
  expect(hit).toHaveBeenCalledTimes(1); expect(onError).not.toHaveBeenCalled()
  act(() => { finishVideoEditGesture(handle) })
})
