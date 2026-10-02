/** @vitest-environment jsdom */

import React from 'react'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/commands/video', () => ({ compressVideoToFit: vi.fn() }))

import { VideoTrimModal } from './VideoTrimModal'

function renderModal(open: boolean) {
  return (
    <VideoTrimModal
      open={open}
      previewUrl="henji-media://clip.mp4"
      maxClipSeconds={5}
      onConfirm={() => undefined}
      onClose={() => undefined}
    />
  )
}

/** jsdom 不实现媒体播放：给出时长并加载元数据，返回当前 <video>。 */
async function loadVideo(): Promise<HTMLVideoElement> {
  const video = await waitFor(() => {
    const element = document.body.querySelector('video')
    if (!element) throw new Error('video not mounted')
    return element
  })
  Object.defineProperty(video, 'duration', { configurable: true, value: 10 })
  fireEvent.loadedMetadata(video)
  return video
}

/** 播放越过选区终点：监听存在时会暂停并回到起点。 */
function playPastEnd(video: HTMLVideoElement): void {
  video.currentTime = 6
  fireEvent.timeUpdate(video)
}

beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('VideoTrimModal', () => {
  it('预览播放越过选区终点时停回起点（弹窗内容延后挂载）', async () => {
    render(renderModal(true))
    const video = await loadVideo()
    playPastEnd(video)
    expect(video.currentTime).toBe(0)
  })

  it('同一选区关闭后重新打开，监听绑定到新的 <video> 而不是已卸载的旧元素', async () => {
    const { rerender } = render(renderModal(true))
    const first = await loadVideo()
    rerender(renderModal(false))
    await waitFor(() => expect(document.body.querySelector('video')).toBeNull())

    rerender(renderModal(true))
    const second = await loadVideo()
    expect(second).not.toBe(first)
    playPastEnd(second)
    expect(second.currentTime).toBe(0)
  })
})
