// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { BUILTIN_STYLE_KITS } from '@/core/videoEdit/styleKitPresets'
import { renderStyleKitPreview } from '../application/videoEditStylePreview'
import { VideoEditStyleKitPreview } from './VideoEditStyleKitPreview'

vi.mock('../application/videoEditStylePreview', () => ({ renderStyleKitPreview: vi.fn() }))
beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers()
  vi.mocked(renderStyleKitPreview).mockResolvedValue(new Blob(['preview']))
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => `blob:style-${Math.random()}`), revokeObjectURL: vi.fn() }))
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals() })
const flush = async (): Promise<void> => { await act(async () => { await vi.advanceTimersByTimeAsync(180) }) }
it('预览隐藏中止后重新可见即启动，等值kit重建不重启，迟到图片不提交', async () => {
  const kit = structuredClone(BUILTIN_STYLE_KITS[1]); let finish!: (blob: Blob) => void
  vi.mocked(renderStyleKitPreview).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const view = render(<VideoEditStyleKitPreview kit={kit} width={1920} height={1080} />); await flush()
  const signal = vi.mocked(renderStyleKitPreview).mock.calls[0][3]
  view.rerender(<VideoEditStyleKitPreview kit={structuredClone(kit)} width={1920} height={1080} />)
  await flush(); expect(signal.aborted).toBe(false); expect(renderStyleKitPreview).toHaveBeenCalledOnce()
  view.rerender(<VideoEditStyleKitPreview kit={kit} width={1920} height={1080} visible={false} />)
  expect(signal.aborted).toBe(true)
  view.rerender(<VideoEditStyleKitPreview kit={kit} width={1920} height={1080} />); await flush()
  expect(screen.getAllByRole('img')).toHaveLength(3)
  expect(vi.mocked(renderStyleKitPreview).mock.calls.at(-1)![2]).toEqual({ width: 960, height: 540 })
  await act(async () => { finish(new Blob(['late'])) }); expect(URL.createObjectURL).toHaveBeenCalledTimes(3)
  view.unmount(); expect(URL.revokeObjectURL).toHaveBeenCalledTimes(3)
})
it('单个风格样例失败后继续生成其余预览并显示可重试错误，重试成功', async () => {
  vi.mocked(renderStyleKitPreview).mockRejectedValueOnce(new Error('风格预览等待过久，请重试。'))
  render(<VideoEditStyleKitPreview kit={BUILTIN_STYLE_KITS[1]} width={1920} height={1080} />); await flush()
  expect(screen.getAllByRole('img')).toHaveLength(2)
  expect(screen.getByRole('alert').textContent).toContain('等待过久')
  fireEvent.click(screen.getByRole('button')); await flush()
  expect(screen.getAllByRole('img')).toHaveLength(3); expect(screen.queryByRole('alert')).toBeNull()
})
it('出画内容变化中止原任务并生成新候选', async () => {
  let finish!: (blob: Blob) => void
  vi.mocked(renderStyleKitPreview).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const kit = structuredClone(BUILTIN_STYLE_KITS[1])
  const view = render(<VideoEditStyleKitPreview kit={kit} width={1920} height={1080} />); await flush()
  const signal = vi.mocked(renderStyleKitPreview).mock.calls[0][3]
  const next = structuredClone(kit); next.tokens.motion.enterDuration = 1
  view.rerender(<VideoEditStyleKitPreview kit={next} width={1920} height={1080} />); await flush()
  expect(signal.aborted).toBe(true); expect(screen.getAllByRole('img')).toHaveLength(3)
  await act(async () => { finish(new Blob(['late'])) }); expect(URL.createObjectURL).toHaveBeenCalledTimes(3)
})
