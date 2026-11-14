// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }), initReactI18next: { type: '3rdParty', init: () => undefined } }))
vi.mock('@xyflow/react', () => ({
  Handle: () => null,
  Position: { Left: 'left' },
  useReactFlow: () => ({ getZoom: () => 1 }),
}))
vi.mock('@/stores/canvasStore', () => {
  const state = { nodes: [], edges: [] }
  const store = Object.assign(() => state, { getState: () => state, subscribe: () => () => undefined })
  return { canvasViewStore: store, useCanvasStore: store }
})
vi.mock('@/services/localMediaImport', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/localMediaImport')>()),
  importLocalMedia: vi.fn(async (file: File, kind: string) => ({ kind, fullPath: `D:/media/${file.name}` })),
}))

const platform = vi.hoisted(() => ({ videoThumbnail: vi.fn(async () => ({ path: 'T:/thumbs/clip.webp' })) }))
vi.mock('@/platform', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/platform')>()
  return { ...actual, getPlatform: () => ({ video: { getCachedThumbnail: platform.videoThumbnail } }) }
})

import { MediaInputsRow } from './MediaInputRow'

afterEach(cleanup)

describe('参考素材行', () => {
  it('一次选多种素材上传时合并成一次提交，已有素材都保留', async () => {
    const onSourcesChange = vi.fn()
    const view = render(
      <MediaInputsRow
        nodeId="node"
        label="参考素材"
        handleKinds={['image', 'video']}
        onSourcesChange={onSourcesChange}
        sources={[
          { kind: 'image', maxCount: 4, inlineValue: ['D:/media/old.png'], onInlineChange: vi.fn() },
          { kind: 'video', maxCount: 2, inlineValue: [], onInlineChange: vi.fn() },
        ]}
      />,
    )
    const input = view.container.querySelector('input[type="file"]') as HTMLInputElement
    const files = [
      new File(['a'], 'a.png', { type: 'image/png' }),
      new File(['b'], 'b.mp4', { type: 'video/mp4' }),
    ]
    fireEvent.change(input, { target: { files } })

    await waitFor(() => expect(onSourcesChange).toHaveBeenCalledTimes(1))
    expect(onSourcesChange).toHaveBeenCalledWith({
      image: ['D:/media/old.png', 'D:/media/a.png'],
      video: ['D:/media/b.mp4'],
    })
  })

  it('视频缩略图用主进程缓存的首帧图，不挂常驻 video 解码器', async () => {
    const view = render(
      <MediaInputsRow
        nodeId="node"
        label="参考素材"
        handleKinds={['video']}
        onSourcesChange={vi.fn()}
        sources={[{ kind: 'video', maxCount: 2, inlineValue: ['D:/media/clip.mp4'], onInlineChange: vi.fn() }]}
      />,
    )
    await waitFor(() => expect(view.container.querySelector('img')?.getAttribute('src')).toContain('clip.webp'))
    expect(platform.videoThumbnail).toHaveBeenCalledWith('D:/media/clip.mp4', undefined, undefined)
    expect(view.container.querySelector('video')).toBeNull()
  })

  it('远程视频主进程无法抽帧，仍显示浏览器取的首帧', () => {
    platform.videoThumbnail.mockClear()
    const view = render(
      <MediaInputsRow
        nodeId="node"
        label="参考素材"
        handleKinds={['video']}
        onSourcesChange={vi.fn()}
        sources={[{ kind: 'video', maxCount: 2, inlineValue: ['https://example.com/clip.mp4'], onInlineChange: vi.fn() }]}
      />,
    )
    expect(view.container.querySelector('video')?.getAttribute('src')).toBe('https://example.com/clip.mp4#t=0.1')
    expect(platform.videoThumbnail).not.toHaveBeenCalled()
  })
})
