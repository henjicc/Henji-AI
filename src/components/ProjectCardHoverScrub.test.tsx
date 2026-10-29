// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { DocumentCoverSource } from '@/core/documents/types'
import { ProjectCardHoverScrub } from './ProjectCardHoverScrub'

const cache = vi.hoisted(() => ({ ready: 'first.webp' as string | null, acquire: vi.fn(() => vi.fn()) }))
const images = vi.hoisted(() => ({ load: vi.fn(async (_path: string) => ({})) }))
vi.mock('@/hooks/useFilmstripFrames', () => ({ useFilmstripFramesRevision: () => 0 }))
vi.mock('@/services/videoFilmstrip/filmstripFrameService', () => ({ acquireFilmstripFrames: cache.acquire, nearestFilmstripFrame: () => cache.ready }))
vi.mock('@/services/imageSource', () => ({ loadImageElement: (path: string) => images.load(path), resolveImageDisplayUrl: (path: string) => path }))
vi.mock('@/hooks/useRafCallback', () => ({ useRafCallback: (fn: (next: number) => void) => ({ schedule: fn, cancel: vi.fn() }) }))
afterEach(cleanup)

function move(element: Element, fraction: number): void {
  fireEvent(element, new MouseEvent('pointermove', { bubbles: true, clientX: fraction * 100 }))
}

it('合成帧可选满 48 个位置，离开恢复封面，再次进入重新加载；原素材未就绪时沿用上一帧', async () => {
  const load = vi.fn(async () => (fraction: number): DocumentCoverSource => ({ sourceKind: 'image', source: `frame-${Math.min(47, Math.round(fraction * 48))}.webp` }))
  const view = render(<ProjectCardHoverScrub load={load}><span>静态封面</span></ProjectCardHoverScrub>)
  const surface = view.container.firstElementChild!
  vi.spyOn(surface, 'getBoundingClientRect').mockReturnValue({ left: 0, width: 100 } as DOMRect)
  await act(async () => { fireEvent.pointerEnter(surface) })
  for (let index = 0; index < 48; index++) {
    await act(async () => { move(surface, index / 48) })
    expect(view.container.querySelector('img')?.getAttribute('src')).toBe(`frame-${index}.webp`)
  }
  fireEvent.pointerLeave(surface)
  expect(view.container.querySelector('img')).toBeNull()
  expect(view.getByText('静态封面')).toBeTruthy()
  load.mockResolvedValue(() => ({ sourceKind: 'video', source: 'video.mp4', atSeconds: 0 }))
  await act(async () => { fireEvent.pointerEnter(surface) })
  expect(load).toHaveBeenCalledTimes(2)
  move(surface, 0.1)
  expect(view.container.querySelector('img')?.getAttribute('src')).toBe('first.webp')
  cache.ready = null
  move(surface, 0.8)
  expect(view.container.querySelector('img')?.getAttribute('src')).toBe('first.webp')
})

it('合成图片尚未加载时继续显示上一帧，加载完成后才切换', async () => {
  const load = async () => (fraction: number): DocumentCoverSource => ({ sourceKind: 'image', source: fraction < 0.5 ? 'a.webp' : 'b.webp' })
  const view = render(<ProjectCardHoverScrub load={load}><span>封面</span></ProjectCardHoverScrub>)
  const surface = view.container.firstElementChild!
  vi.spyOn(surface, 'getBoundingClientRect').mockReturnValue({ left: 0, width: 100 } as DOMRect)
  await act(async () => { fireEvent.pointerEnter(surface); move(surface, 0.1) })
  expect(view.container.querySelector('img')?.getAttribute('src')).toBe('a.webp')
  let finish!: () => void
  images.load.mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve({}) }))
  move(surface, 0.9)
  expect(view.container.querySelector('img')?.getAttribute('src')).toBe('a.webp')
  await act(async () => { finish() })
  expect(view.container.querySelector('img')?.getAttribute('src')).toBe('b.webp')
})
