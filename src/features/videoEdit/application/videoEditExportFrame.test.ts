import { afterEach, expect, it, vi } from 'vitest'
import { VIDEO_EDIT_EXPORT_PRESETS } from '@/core/videoEdit/exportPresets'
import { prepareVideoEditExportFrame, videoEditExportProgress } from './videoEditExportFrame'

afterEach(() => { vi.unstubAllGlobals() })
it.each([true, false])('4K 到 1440p 输出路径，按输出渲染=%s', async renderAtOutputResolution => {
  const renderer = { setOutputScale: vi.fn(async () => {}) }
  const geometry = await prepareVideoEditExportFrame(renderer, { width: 3840, height: 2160 }, { ...VIDEO_EDIT_EXPORT_PRESETS[0].settings, width: 2560, height: 1440, renderAtOutputResolution })
  expect(renderer.setOutputScale).toHaveBeenCalledWith(2 / 3, renderAtOutputResolution)
  // 按输出尺寸合成时合成画面直接编码；否则 Worker 按这份几何把 4K 合成画面缩进成片。
  if (renderAtOutputResolution) expect(geometry).toBeUndefined()
  else expect(geometry).toEqual({ width: 2560, height: 1440, source: { x: 0, y: 0, width: 3840, height: 2160 }, destination: { x: 0, y: 0, width: 2560, height: 1440 } })
})

it('进度按经过的时间发布并让出；快帧不增加频率，慢帧也不等待五帧', async () => {
  let time = 0
  const publish = vi.fn(), yieldThread = vi.fn(async () => { time += 20 })
  const checkpoint = videoEditExportProgress(publish, yieldThread, () => time)
  for (let frame = 0; frame < 249; frame++) { time++; await checkpoint() }
  expect(publish).not.toHaveBeenCalled()
  time++; await checkpoint()
  expect(publish).toHaveBeenCalledOnce(); expect(yieldThread).toHaveBeenCalledOnce()
  time += 249; await checkpoint(); expect(publish).toHaveBeenCalledOnce()
  time += 501; await checkpoint(); expect(publish).toHaveBeenCalledTimes(2)
})
