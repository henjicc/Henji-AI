// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { getPlatform } from '@/platform/runtime'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { createVideoEditTestProject } from '../application/videoEditDocumentTestKit'
import { appendVideoEditMedia, closeVideoEditProject, listVideoEditInstances } from '../application/videoEditService'
import { readVideoEditSource, updateVideoEditSource } from '../application/videoEditSource'
import { VideoEditSourcePanel } from './VideoEditSourcePanel'
import type { VideoEditSourceRequest } from '../application/videoEditSource'

const feedback = vi.hoisted(() => ({ scrub: vi.fn() }))
vi.mock('./videoEditSourcePresenter', () => ({ createVideoEditSourcePresenter: () => ({
  present: async (request: VideoEditSourceRequest) => ({ ...request, presentedTimeUs: request.timeUs }),
  scrub: feedback.scrub, release: async () => {}, dispose: async () => {},
}) }))
vi.mock('@/hooks/useWaveformData', () => ({ useWaveformData: () => ({ status: 'idle' }), retryWaveform: vi.fn() }))

beforeEach(() => {
  installHarnessNativeStorage(); feedback.scrub.mockClear()
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} })
  vi.spyOn(getPlatform().system.dialog, 'save').mockResolvedValue('/fixture/source.henji-video')
  vi.spyOn(getPlatform().system.fs, 'writeTextFile').mockResolvedValue(undefined)
})
afterEach(async () => { cleanup(); for (const owner of listVideoEditInstances()) await closeVideoEditProject(owner.document.id); vi.restoreAllMocks(); vi.unstubAllGlobals(); uninstallHarnessNativeStorage() })

it.each(['video', 'audio'] as const)('源%s进度条单击静音，拖动试听，左右键按一帧试听，松手后普通跳转静音', async kind => {
  const owner = await createVideoEditTestProject()
  appendVideoEditMedia(owner.document.id, { id: 'm', name: '源', path: '/fixture/source.mp4', kind, width: 320, height: 180, durationSeconds: 3, hasAudio: true, frameRate: { numerator: 30, denominator: 1 } })
  const itemId = owner.document.items.find(item => item.mediaId === 'm')!.id
  const onError = vi.fn(); const view = render(<VideoEditSourcePanel instance={owner} onError={onError} />)
  await act(async () => { await updateVideoEditSource(owner.document.id, { itemId, timeUs: 0, playing: false }) })
  const progress = view.getByLabelText(kind === 'video' ? '源素材进度' : '音频播放位置')
  const change = async (seconds: number) => { await act(async () => { fireEvent.change(progress, { target: { value: kind === 'video' ? seconds * 1e6 : seconds } }) }) }
  const pointer = (type: string, x: number) => { const event = new MouseEvent(type, { bubbles: true, clientX: x, button: 0 }); Object.defineProperty(event, 'pointerId', { value: 1 }); fireEvent(progress, event) }
  pointer('pointerdown', 10); await change(.5)
  expect(feedback.scrub).not.toHaveBeenCalled()
  pointer('pointermove', 20); await change(1)
  expect(feedback.scrub).toHaveBeenLastCalledWith(1, 1)
  pointer('pointerup', 20); await change(1.5)
  expect(feedback.scrub).toHaveBeenCalledOnce()
  await act(async () => { fireEvent.keyDown(progress, { key: 'ArrowRight' }) })
  expect(feedback.scrub).toHaveBeenLastCalledWith(1.5 + 1 / 30, 1)
  expect(readVideoEditSource(owner.document.id).timeUs).toBe(1_533_333)
  expect(onError).not.toHaveBeenCalled()
})
