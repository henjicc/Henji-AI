/** @vitest-environment jsdom */

import React from 'react'
import path from 'node:path'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/commands/video', () => ({ compressVideoToFit: vi.fn() }))

import { VideoTrimModal } from './VideoTrimModal'
import { compressVideoToFit } from '@/commands/video'

const clipPath = path.resolve(path.sep, 'media', 'clip.mp4')
const compressedPath = path.resolve(path.sep, 'media', 'compressed.mp4')

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
  vi.mocked(compressVideoToFit).mockReset()
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('VideoTrimModal', () => {
  it('处理期间可取消，关闭弹窗立即 abort；迟到压缩结果不回填', async () => {
    let complete!: (result: { path: string; sizeBytes: number }) => void
    vi.mocked(compressVideoToFit).mockImplementation(() => new Promise(resolve => { complete = resolve }))
    const onConfirm = vi.fn(); const onClose = vi.fn(); const onVideoCompressed = vi.fn()
    const result = render(<VideoTrimModal open previewUrl="henji-media://clip.mp4" maxClipSeconds={5} maxSizeMB={10}
      resolveSource={async () => clipPath} onConfirm={onConfirm} onClose={onClose} onVideoCompressed={onVideoCompressed} />)
    await loadVideo()
    fireEvent.click(screen.getByRole('button', { name: /confirm|确认|确定/i }))
    await waitFor(() => expect(compressVideoToFit).toHaveBeenCalledOnce())
    const signal = vi.mocked(compressVideoToFit).mock.calls[0][2]
    expect(signal).toBeInstanceOf(AbortSignal)
    const cancel = screen.getByRole('button', { name: /cancel|取消/i })
    expect((cancel as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(cancel); expect(signal?.aborted).toBe(true); expect(onClose).toHaveBeenCalledOnce()
    result.unmount()
    await act(async () => { complete({ path: compressedPath, sizeBytes: 3 }) })
    expect(onConfirm).not.toHaveBeenCalled(); expect(onVideoCompressed).not.toHaveBeenCalled()
  })

  it.each(['外部关闭', '更换来源'] as const)('懒解析期间%s后不启动旧压缩', async action => {
    let resolve!: (source: string) => void
    const resolveSource = () => new Promise<string>(done => { resolve = done })
    const onConfirm = vi.fn(); const onClose = vi.fn()
    const result = render(<VideoTrimModal open previewUrl="henji-media://old.mp4" maxClipSeconds={5} maxSizeMB={10}
      resolveSource={resolveSource} onConfirm={onConfirm} onClose={onClose} />)
    await loadVideo()
    fireEvent.click(screen.getByRole('button', { name: /confirm|确认|确定/i }))
    result.rerender(<VideoTrimModal open={action === '更换来源'}
      previewUrl={action === '更换来源' ? 'henji-media://new.mp4' : 'henji-media://old.mp4'}
      maxClipSeconds={5} maxSizeMB={10} resolveSource={resolveSource} onConfirm={onConfirm} onClose={onClose} />)
    await act(async () => { resolve(clipPath) })
    expect(compressVideoToFit).not.toHaveBeenCalled(); expect(onConfirm).not.toHaveBeenCalled()
  })
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
