// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { getPlatform } from '@/platform/runtime'
import { appendVideoEditMedia, closeVideoEditProject, createVideoEditProject, getActiveVideoEditSequence, listVideoEditInstances } from '../application/videoEditService'
import { appendVideoEditItems } from '../application/videoEditProjectItems'
import { VideoEditAudioChannelsDialog } from './VideoEditAudioChannelsDialog'

beforeEach(() => {
  installHarnessNativeStorage()
  vi.spyOn(getPlatform().system.dialog, 'save').mockResolvedValue('D:/fixture/dialog.henji-video')
  vi.spyOn(getPlatform().system.fs, 'writeTextFile').mockResolvedValue(undefined)
})
afterEach(async () => { cleanup(); for (const owner of listVideoEditInstances()) await closeVideoEditProject(owner.document.id); vi.restoreAllMocks(); uninstallHarnessNativeStorage() })

async function mxfProject() {
  const owner = (await createVideoEditProject())!; const id = owner.document.id
  appendVideoEditMedia(id, { id: 'mxf', name: '摄影机', path: 'D:/fixture/camera.mxf', kind: 'video', width: 1920, height: 1080, durationSeconds: 4, hasAudio: true, audioStreams: [{ channels: 1 }, { channels: 1 }, { channels: 1 }, { channels: 1 }] })
  return { owner, id, item: owner.document.items[0] }
}

it('项目项“音频声道”：预设立体声把四条单声道两两合成，逐声道改源后确定只写入项目项；预设回到使用文件即清除', async () => {
  const { owner, id, item } = await mxfProject()
  const close = vi.fn()
  const target = { kind: 'items' as const, itemIds: [item.id], mediaId: 'mxf' }
  const view = render(<VideoEditAudioChannelsDialog projectId={id} target={target} onClose={close} />)
  await vi.waitFor(() => expect((view.getByLabelText('音频声道预设') as HTMLSelectElement).value).toBe('file'))
  expect(view.getAllByLabelText(/源声道$/)).toHaveLength(4)
  expect(view.getByText('只影响之后放入序列的片段，已在序列中的片段保持不变。')).toBeTruthy()
  fireEvent.change(view.getByLabelText('音频声道预设'), { target: { value: 'stereo' } })
  expect((view.getByLabelText('片段声道格式') as HTMLSelectElement).value).toBe('stereo')
  expect((view.getByLabelText('音频片段数量') as HTMLSelectElement).value).toBe('2')
  fireEvent.change(view.getByLabelText('音频片段 1 右源声道'), { target: { value: '3:0' } })
  expect((view.getByLabelText('音频声道预设') as HTMLSelectElement).value).toBe('custom')
  await act(async () => fireEvent.click(view.getByRole('button', { name: '确定' })))
  expect(owner.document.items[0].audioChannels).toEqual([{ format: 'stereo', sources: [{ stream: 0, channel: 0 }, { stream: 3, channel: 0 }] }, { format: 'stereo', sources: [{ stream: 2, channel: 0 }, { stream: 3, channel: 0 }] }])
  expect(close).toHaveBeenCalledTimes(1)
  cleanup()
  const again = render(<VideoEditAudioChannelsDialog projectId={id} target={{ ...target, layout: owner.document.items[0].audioChannels }} onClose={vi.fn()} />)
  await vi.waitFor(() => expect((again.getByLabelText('音频声道预设') as HTMLSelectElement).value).toBe('custom'))
  fireEvent.change(again.getByLabelText('音频声道预设'), { target: { value: 'file' } })
  await act(async () => fireEvent.click(again.getByRole('button', { name: '确定' })))
  expect(owner.document.items[0]).not.toHaveProperty('audioChannels')
})

it('时间线片段“音频声道”只改源声道、不改声道格式；改回文件默认即不保存映射', async () => {
  const { owner, id, item } = await mxfProject()
  appendVideoEditItems(id, [item.id], owner.activeSequenceId, { frame: 0 })
  const sound = getActiveVideoEditSequence(owner).clips[1]
  const target = { kind: 'clip' as const, sequenceId: owner.activeSequenceId, clipIds: [sound.id], mediaId: 'mxf' }
  const view = render(<VideoEditAudioChannelsDialog projectId={id} target={target} onClose={vi.fn()} />)
  await vi.waitFor(() => expect(view.getAllByLabelText(/源声道$/)).toHaveLength(1))
  expect(view.queryByLabelText('音频声道预设')).toBeNull()
  expect(view.getByText('单声道', { selector: 'span' })).toBeTruthy()
  fireEvent.change(view.getByLabelText('单声道源声道'), { target: { value: '2:0' } })
  await act(async () => fireEvent.click(view.getByRole('button', { name: '确定' })))
  expect(getActiveVideoEditSequence(owner).clips[1].audioMapping).toEqual({ format: 'mono', sources: [{ stream: 2, channel: 0 }] })
  cleanup()
  const back = render(<VideoEditAudioChannelsDialog projectId={id} target={{ ...target, mapping: getActiveVideoEditSequence(owner).clips[1].audioMapping }} onClose={vi.fn()} />)
  await vi.waitFor(() => expect((back.getByLabelText('单声道源声道') as HTMLSelectElement).value).toBe('2:0'))
  fireEvent.change(back.getByLabelText('单声道源声道'), { target: { value: '0:0' } })
  await act(async () => fireEvent.click(back.getByRole('button', { name: '确定' })))
  expect(getActiveVideoEditSequence(owner).clips[1]).not.toHaveProperty('audioMapping')
})
