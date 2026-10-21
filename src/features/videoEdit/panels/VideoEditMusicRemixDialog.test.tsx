// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { steadyMusicAnalysis } from '@/core/audioAnalysis/music/musicTestFixtures'
import { videoEditFps } from '@/core/videoEdit/time'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { createVideoEditTestProject } from '../application/videoEditDocumentTestKit'
import { appendVideoEditClip, appendVideoEditMedia, closeVideoEditProject, getActiveVideoEditSequence, listVideoEditInstances } from '../application/videoEditService'
import { VideoEditMusicRemixDialog } from './VideoEditMusicRemixDialog'

const boundary = vi.hoisted(() => ({ notify: vi.fn(), suitable: true }))
vi.mock('@/contexts/NotificationContext', () => ({ useNotification: () => ({ showNotification: boundary.notify }) }))
vi.mock('@/commands/musicAnalysis', async () => {
  const { steadyMusicAnalysis: fixture } = await import('@/core/audioAnalysis/music/musicTestFixtures')
  return { analyzeMusicStructure: async () => ({ analysis: { ...fixture(), ...(boundary.suitable ? {} : { suitable: false, unsuitableReason: '节奏是自由的，建议手动剪辑或淡入淡出。' }) }, analysisIdentity: 'music-v1:beat_this:x', cached: true, model: 'used', timings: null }) }
})
beforeEach(() => { installHarnessNativeStorage(); boundary.notify.mockClear(); boundary.suitable = true })
afterEach(async () => { cleanup(); for (const owner of listVideoEditInstances()) await closeVideoEditProject(owner.document.id); vi.restoreAllMocks(); uninstallHarnessNativeStorage() })

async function setup() {
  const owner = await createVideoEditTestProject(), id = owner.document.id
  appendVideoEditMedia(id, { id: 'song', name: '配乐', path: path.resolve(path.sep, 'fixture', 'song.mp3'), kind: 'audio', width: 0, height: 0, durationSeconds: steadyMusicAnalysis().durationSeconds, hasAudio: true })
  appendVideoEditClip(id, 'song', { frame: 0, track: getActiveVideoEditSequence(owner).tracks.find(t => t.kind === 'audio')!.index })
  const sequence = getActiveVideoEditSequence(owner)
  return { owner, request: { projectId: id, sequenceId: sequence.id, clipId: sequence.clips[0].id }, fps: videoEditFps(sequence.frameRate) }
}

it('右键“重构到时长”：填目标秒数、选粒度后重构，结果写进时间线并提示可撤销', async () => {
  const { owner, request, fps } = await setup(), close = vi.fn()
  const view = render(<VideoEditMusicRemixDialog request={request} onClose={close} />)
  fireEvent.change(view.getByLabelText('目标时长（秒）'), { target: { value: '75' } })
  fireEvent.blur(view.getByLabelText('目标时长（秒）'))
  fireEvent.click(view.getByRole('radio', { name: '乐句' }))
  await act(async () => { fireEvent.click(view.getByRole('button', { name: '重构' })) })
  await vi.waitFor(() => expect(close).toHaveBeenCalledTimes(1))
  const clips = getActiveVideoEditSequence(owner).clips.filter(clip => clip.remix)
  expect(clips.length).toBeGreaterThan(1)
  expect(clips.every(clip => clip.remix!.granularity === 'phrase')).toBe(true)
  expect(Math.max(...clips.map(clip => clip.start + clip.duration))).toBe(Math.round(75 * fps))
  expect(boundary.notify).toHaveBeenCalledWith(expect.objectContaining({ key: 'musicRemixed' }), 'success')
})

it('不适合重构时在弹窗里说明原因，不关闭、不改动时间线', async () => {
  const { owner, request } = await setup(), close = vi.fn()
  boundary.suitable = false
  const view = render(<VideoEditMusicRemixDialog request={request} onClose={close} />)
  await act(async () => { fireEvent.click(view.getByRole('button', { name: '重构' })) })
  await vi.waitFor(() => expect(view.getByText('节奏是自由的，建议手动剪辑或淡入淡出。')).toBeTruthy())
  expect(close).not.toHaveBeenCalled()
  expect(getActiveVideoEditSequence(owner).clips).toHaveLength(1)
})
