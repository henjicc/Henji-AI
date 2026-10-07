// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { getPlatform } from '@/platform/runtime'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { createVideoEditTestProject, closeAllVideoEdits } from '../application/videoEditDocumentTestKit'
import { addVideoEditProgramText } from '../application/videoEditProgramText'
import { applyTitleTemplate } from '../application/videoEditTitleTemplates'
import { createVideoEditCaption } from '../application/videoEditTimedContent'
import { getActiveVideoEditSequence, setVideoEditTimelineView, undoVideoEdit } from '../application/videoEditService'
import { VideoEditTextStylePanel } from './VideoEditTextStylePanel'
import { VideoEditGraphicPanel } from './VideoEditGraphicPanel'
import { VideoEditTitleTemplatesPanel } from './VideoEditTitleTemplatesPanel'
import { VideoEditSubtitleActions } from './VideoEditSubtitleActions'
beforeEach(() => { installHarnessNativeStorage(); vi.spyOn(getPlatform().audioEdit, 'listAsrModels').mockResolvedValue([]); vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ font: '', measureText: (text: string) => ({ width: text.length * 20 }) } as unknown as CanvasRenderingContext2D) })
afterEach(async () => { cleanup(); await closeAllVideoEdits(); vi.restoreAllMocks(); uninstallHarnessNativeStorage() })
it.each(['text', 'graphic', 'title', 'subtitle'] as const)('四宿主 %s 同一外观写入/撤销，图形复用对象列表及关键帧行', async host => {
  const owner = await createVideoEditTestProject(); const projectId = owner.document.id; const sequenceId = owner.activeSequenceId; const error = vi.fn()
  let element: React.ReactElement; let read: () => boolean | undefined
  if (host === 'text') {
    const id = addVideoEditProgramText(owner, { x: .5, y: .5 }); const clip = getActiveVideoEditSequence(owner).clips.find(value => value.id === id)!
    element = <VideoEditTextStylePanel projectId={projectId} sequenceId={sequenceId} clip={clip} height={1080} onError={error} />
    read = () => getActiveVideoEditSequence(owner).clips.find(value => value.id === id)?.textStyle?.allCaps
  } else if (host === 'subtitle') {
    const id = createVideoEditCaption(projectId, sequenceId, { start: 0, duration: 30, text: '字幕' })
    element = <VideoEditSubtitleActions instance={owner} sequence={getActiveVideoEditSequence(owner)} selectedCaptionId={id} onError={error} />
    read = () => { const style = getActiveVideoEditSequence(owner).captions?.find(value => value.id === id)?.style; return style ? style.allCaps : undefined }
  } else {
    const [id] = applyTitleTemplate(projectId, sequenceId, 'title:lower_third'); setVideoEditTimelineView(projectId, { selectedClipIds: [id] }, id)
    element = host === 'graphic' ? <VideoEditGraphicPanel projectId={projectId} sequenceId={sequenceId} clipId={id} onError={error} /> : <VideoEditTitleTemplatesPanel instance={owner} onError={error} />
    read = () => getActiveVideoEditSequence(owner).clips.find(value => value.id === id)?.graphic?.objects.filter(value => value.kind === 'text').at(-1)?.textStyle?.allCaps
  }
  const history = owner.past.length; const view = render(element)
  if (host === 'subtitle') fireEvent.click(view.getByLabelText('自动字幕与样式'))
  fireEvent.click(await view.findByLabelText('全部大写')); expect(read()).toBe(true); expect(owner.past).toHaveLength(history + 1)
  undoVideoEdit(projectId); expect(read()).not.toBe(true); expect(error).not.toHaveBeenCalled()
  if (host === 'graphic') { expect(view.getAllByLabelText('图形对象层级')).toHaveLength(1); expect(view.container.querySelector('[data-video-edit-code-keyframes="scale"]')).toBeTruthy() }
})
