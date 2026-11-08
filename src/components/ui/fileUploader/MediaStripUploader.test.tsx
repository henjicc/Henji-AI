// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DragDropProvider } from '@/contexts/DragDropContext'
import { MediaStripUploader } from './MediaStripUploader'

vi.mock('@/hooks/useNativeDragDrop', () => ({ useNativeDragDrop: () => ({ isDragging: false, elementRef: { current: null } }) }))

afterEach(cleanup)

describe('MediaStripUploader', () => {
  it('每张按类型编号，与提示词里的“图片1”“视频1”对应', () => {
    render(
      <DragDropProvider>
        <MediaStripUploader files={['a.png', 'b.mp4', 'c.png']} fileTypes={['image', 'video', 'image']} hideUploadButton
          onUpload={() => undefined} onRemove={() => undefined} />
      </DragDropProvider>,
    )
    expect(screen.getAllByRole('button', { name: /^(图片|视频) \d$/ }).map(button => button.getAttribute('aria-label')))
      .toEqual(['图片 1', '视频 1', '图片 2'])
  })

  it('宿主给出编号时按宿主的走（混合素材调换顺序后仍与提示词引用一致）', () => {
    render(
      <DragDropProvider>
        <MediaStripUploader files={['c.png', 'b.mp4', 'a.png']} fileTypes={['image', 'video', 'image']} fileNumbers={[2, 1, 1]} hideUploadButton
          onUpload={() => undefined} onRemove={() => undefined} />
      </DragDropProvider>,
    )
    expect(screen.getAllByRole('button', { name: /^(图片|视频) \d$/ }).map(button => button.getAttribute('aria-label')))
      .toEqual(['图片 2', '视频 1', '图片 1'])
  })

  it('移除前先通知宿主记下布局，再移除对应那一张', () => {
    const order: string[] = []
    render(
      <DragDropProvider>
        <MediaStripUploader files={['a.png', 'b.png']} hideUploadButton onUpload={() => undefined}
          onBeforeLayoutChange={() => order.push('capture')} onRemove={(index) => order.push(`remove:${index}`)} />
      </DragDropProvider>,
    )
    fireEvent.click(screen.getAllByRole('button', { name: '移除' })[1])
    expect(order).toEqual(['capture', 'remove:1'])
  })
})
