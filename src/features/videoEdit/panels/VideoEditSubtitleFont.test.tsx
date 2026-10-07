// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { getPlatform } from '@/platform/runtime'
import { createVideoEditTestProject, closeAllVideoEdits } from '../application/videoEditDocumentTestKit'
import { editVideoProject, getActiveVideoEditSequence, undoVideoEdit } from '../application/videoEditService'
import { VideoEditSubtitleActions } from './VideoEditSubtitleActions'
afterEach(async () => { cleanup(); await closeAllVideoEdits(); vi.restoreAllMocks(); uninstallHarnessNativeStorage() })
it('字幕字体悬停临时生效，选中即时提交一次并只影响指定字幕', async () => {
  installHarnessNativeStorage(); vi.spyOn(getPlatform().audioEdit, 'listAsrModels').mockResolvedValue([])
  const instance = await createVideoEditTestProject(); const onError = vi.fn()
  editVideoProject(instance.document.id, document => { document.sequences[0].captions = [{ id: 'one', text: '第一句', start: 0, duration: 30 }, { id: 'two', text: '第二句', start: 30, duration: 30 }]; return document })
  const sequence = getActiveVideoEditSequence(instance); const history = instance.past.length
  const view = render(<VideoEditSubtitleActions instance={instance} sequence={sequence} selectedCaptionId="one" onError={onError} />)
  fireEvent.click(view.getByLabelText('自动字幕与样式')); fireEvent.click(await view.findByLabelText('字幕字体'))
  const option = await view.findByRole('option', { name: /系统衬线/ }); fireEvent.pointerEnter(option.parentElement!)
  const cues = () => getActiveVideoEditSequence(instance).captions!
  await waitFor(() => { const style = cues()[0].style; expect(style && style.fontFamily).toBe('serif') }); expect(instance.past).toHaveLength(history); expect(cues()[1].style).toBeUndefined()
  fireEvent.click(option); await waitFor(() => expect(instance.past).toHaveLength(history + 1))
  act(() => { undoVideoEdit(instance.document.id) }); expect(cues()[0].style).toBeUndefined(); expect(onError).not.toHaveBeenCalled()
})
