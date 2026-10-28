// @vitest-environment jsdom
import { useSyncExternalStore } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { getPlatform } from '@/platform/runtime'
import { createVideoEditTestProject, closeAllVideoEdits } from '../application/videoEditDocumentTestKit'
import { editVideoProject, getActiveVideoEditSequence, subscribeVideoEdit, undoVideoEdit, videoEditRevision, type VideoEditInstance } from '../application/videoEditService'
import { selectVideoEditSubtitle } from '../application/videoEditSubtitleSelection'
import { VideoEditEffectsPanel } from './VideoEditEffectsPanel'
import { VideoEditSubtitleStyleFields } from './VideoEditSubtitleStylePanel'
beforeEach(() => { installHarnessNativeStorage(); vi.spyOn(getPlatform().audioEdit, 'listAsrModels').mockResolvedValue([]) })
afterEach(async () => { cleanup(); await closeAllVideoEdits(); vi.restoreAllMocks(); uninstallHarnessNativeStorage() })

function Panel({ owner, onError }: { owner: VideoEditInstance; onError: (error: unknown) => void }): React.ReactElement {
  useSyncExternalStore(subscribeVideoEdit, videoEditRevision)
  return <VideoEditEffectsPanel instance={owner} onError={onError} />
}
async function selectedCaption(): Promise<VideoEditInstance> {
  const instance = await createVideoEditTestProject()
  editVideoProject(instance.document.id, document => { document.sequences[0].captions = [{ id: 'one', text: '第一句', start: 0, duration: 30 }, { id: 'two', text: '第二句', start: 30, duration: 30 }]; return document })
  selectVideoEditSubtitle(instance.document.id, instance.activeSequenceId, 'one')
  return instance
}
const cues = (instance: VideoEditInstance) => getActiveVideoEditSequence(instance).captions!

it('效果控件显示选中字幕的样式；“全局样式”默认开，改动作用于全部字幕，一步撤销（重要记录 019）', async () => {
  const instance = await selectedCaption(); const onError = vi.fn(); const history = instance.past.length
  const view = render(<Panel owner={instance} onError={onError} />)
  expect(view.container.querySelector('[data-video-edit-effects-caption="one"]')?.textContent).toContain('第一句')
  expect((await view.findByRole('switch', { name: '全局样式' })).getAttribute('aria-checked')).toBe('true')
  fireEvent.click(await view.findByLabelText('字幕字体'))
  fireEvent.click(await view.findByRole('option', { name: /系统衬线/ }))
  await waitFor(() => expect(cues(instance).map(cue => cue.style ? cue.style.fontFamily : undefined)).toEqual(['serif', 'serif']))
  expect(instance.past).toHaveLength(history + 1)
  act(() => { undoVideoEdit(instance.document.id) }); expect(cues(instance).map(cue => cue.style)).toEqual([undefined, undefined]); expect(onError).not.toHaveBeenCalled()
})

it('关掉“全局样式”只改选中的字幕：字体悬停临时生效，选中提交一步撤销', async () => {
  const instance = await selectedCaption(); const onError = vi.fn(); const history = instance.past.length
  const view = render(<Panel owner={instance} onError={onError} />)
  fireEvent.click(await view.findByRole('switch', { name: '全局样式' }))
  fireEvent.click(await view.findByLabelText('字幕字体'))
  const option = await view.findByRole('option', { name: /系统衬线/ }); fireEvent.pointerEnter(option.parentElement!)
  await waitFor(() => { const style = cues(instance)[0].style; expect(style && style.fontFamily).toBe('serif') }); expect(instance.past).toHaveLength(history); expect(cues(instance)[1].style).toBeUndefined()
  fireEvent.click(option); await waitFor(() => expect(instance.past).toHaveLength(history + 1)); expect(cues(instance)[1].style).toBeUndefined()
  act(() => { undoVideoEdit(instance.document.id) }); expect(cues(instance)[0].style).toBeUndefined(); expect(onError).not.toHaveBeenCalled()
})

it('“全局样式”两处入口共用一份；关掉又没选中字幕、或字幕轨锁定时字段不出现，只说明原因', async () => {
  const instance = await selectedCaption(); const sequenceId = instance.activeSequenceId
  const view = render(<><Panel owner={instance} onError={vi.fn()} /><div data-testid="popover"><VideoEditSubtitleStyleFields instance={instance} sequenceId={sequenceId} onError={vi.fn()} /></div></>)
  const popover = within(view.getByTestId('popover'))
  fireEvent.click(popover.getByRole('switch', { name: '全局样式' }))
  expect(view.getAllByRole('switch', { name: '全局样式' }).map(item => item.getAttribute('aria-checked'))).toEqual(['false', 'false'])
  expect(popover.getByText(/先选中一条字幕/)).toBeTruthy(); expect(popover.queryByLabelText('字幕字体')).toBeNull()
  act(() => { editVideoProject(instance.document.id, document => { document.sequences[0].captionTrackLocked = true; return document }) })
  expect(view.getAllByText('字幕轨道已锁定，请先解锁')).toHaveLength(2); expect(view.queryByLabelText('字幕字体')).toBeNull()
})
