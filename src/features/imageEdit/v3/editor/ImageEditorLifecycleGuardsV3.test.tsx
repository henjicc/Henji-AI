/** @vitest-environment jsdom */

import '@/tests/imageEditDocumentFixture'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { useState } from 'react'
import { VirtuosoMockContext } from 'react-virtuoso'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createImageEditDocumentV3,
  createImageEditGroupLayerV3,
  createImageEditRasterLayerV3,
} from '@/core/imageEdit/v3/documentFactory'
import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes'
import i18n from '@/i18n/config'
import { useImageEditorInteractionStoreV3, useImageEditorSessionStoreV3 } from '../store'
import { mockKonvaViewportRect } from './imageEditorKonvaTestUtils'
import { ImageEditorV3 } from './ImageEditorV3'
import type { ImageEditorV3PreviewRenderer } from './types'

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

const previewRenderer: ImageEditorV3PreviewRenderer = () => ({
  kind: 'content',
  content: <div style={{ width: 400, height: 225 }} />,
})

function documentWithLayers(): ImageEditDocumentV3 {
  const document = createImageEditDocumentV3({
    width: 1600,
    height: 900,
    documentId: 'lifecycle-document',
  })
  document.layers = [
    createImageEditRasterLayerV3('bottom', '底层'),
    createImageEditRasterLayerV3('top', '顶层'),
  ]
  return document
}

function ControlledEditor({
  onDocumentChange,
}: {
  onDocumentChange: (document: ImageEditDocumentV3) => void
}): JSX.Element {
  const [document, setDocument] = useState(documentWithLayers)
  return (
    <div style={{ width: 1000, height: 700 }}>
      <ImageEditorV3
        sourceImageUrl="preview.png"
        document={document}
        profileId="mask"
        previewRenderer={previewRenderer}
        onDocumentChange={(next) => {
          onDocumentChange(next)
          setDocument(next)
        }}
      />
    </div>
  )
}

describe('ImageEditorV3 lifecycle guards', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh-CN')
    vi.stubGlobal('ResizeObserver', ResizeObserverStub)
    useImageEditorSessionStoreV3.setState({ sessions: {} })
    useImageEditorInteractionStoreV3.setState({
      layerDragBySession: {},
      viewportZoomBySession: {},
      viewportPanBySession: {},
    })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('矢量手势在工具切换时取消且不提交',async()=>{
    mockKonvaViewportRect()
    const changes=vi.fn(),initial=documentWithLayers()
    const rendered=render(<div style={{width:1000,height:700}}><ImageEditorV3 sourceImageUrl="preview.png" document={initial} profileId="full" onDocumentChange={changes} previewRenderer={previewRenderer}/></div>)
    fireEvent.click(await screen.findByRole('button',{name:'文字与图形'}))
    fireEvent.click(await screen.findByRole('menuitem',{name:'矩形'}))
    const overlay=await waitFor(()=>{const value=rendered.container.querySelector<HTMLElement>('[data-vector-overlay]');expect(value).toBeTruthy();return value!})
    overlay.setPointerCapture=vi.fn()
    fireEvent.pointerDown(overlay,{pointerId:1,button:0,clientX:20,clientY:20})
    fireEvent.pointerMove(overlay,{pointerId:1,clientX:100,clientY:80})
    fireEvent.click(screen.getByRole('button',{name:'移动图像或图层'}))
    await waitFor(()=>expect(rendered.container.querySelector('[data-vector-overlay]')).toBeNull())
    expect(changes).not.toHaveBeenCalled()
  })

  it('添加空蒙版只提交一次，切换图层不会把蒙版写到新选择', async () => {
    const changes: ImageEditDocumentV3[] = []
    const rendered = render(
      <ControlledEditor onDocumentChange={(document) => changes.push(document)} />,
    )

    fireEvent.click(await rendered.findByRole('button', { name: '添加蒙版' }))
    await waitFor(() => expect(changes).toHaveLength(1))
    const topSelect = Array.from(
      rendered.container.querySelectorAll<HTMLButtonElement>('[data-layer-select]'),
    ).find((button) => button.textContent?.includes('顶层'))
    fireEvent.click(topSelect as HTMLButtonElement)

    expect(changes[0].layers[0].mask).toMatchObject({
      kind: 'sparse-mask',
      defaultValue: 1,
      tiles: {},
    })
    expect(changes[0].layers[1].mask).toBeNull()
    expect(changes[0].revision).toBe(1)
    expect((screen.getByRole('button', { name: '添加蒙版' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('opacity pointercancel 清除瞬态值且不提交历史', async () => {
    const changes = vi.fn()
    render(
      <ControlledEditor
        onDocumentChange={changes}
      />,
    )
    fireEvent.click(await screen.findByRole('tab', { name: '基础' }))
    const opacity = await screen.findByRole('slider', { name: '不透明度滑杆' }) as HTMLInputElement
    fireEvent.change(opacity, { target: { value: '35' } })
    expect(opacity.value).toBe('35')
    fireEvent.pointerCancel(opacity)

    expect((screen.getByRole('slider', { name: '不透明度滑杆' }) as HTMLInputElement).value).toBe('100')
    expect(changes).not.toHaveBeenCalled()
  })

  it('祖先锁定时禁用内容动作，混合选择删除保持原子预检', async () => {
    const child = createImageEditRasterLayerV3('locked-child', '锁定组子层')
    const group = {
      ...createImageEditGroupLayerV3('locked-group', '锁定组'),
      locked: true,
      children: [child],
    }
    const document = createImageEditDocumentV3({ width: 640, height: 480, documentId: 'locked-ui' })
    document.layers = [createImageEditRasterLayerV3('outside', '外部层'), group]
    const rendered = render(
      <VirtuosoMockContext.Provider value={{ viewportHeight: 264, itemHeight: 44 }}><div style={{ width: 1000, height: 700 }}>
        <ImageEditorV3
          sourceImageUrl="preview.png"
          document={document}
          profileId="full"
          previewRenderer={previewRenderer}
          onDocumentChange={vi.fn()}
        />
      </div></VirtuosoMockContext.Provider>,
    )
    fireEvent.click(await screen.findByRole('button', { name: '展开图层组' }))
    const layerButton = (name: string): HTMLButtonElement | undefined => Array.from(
      rendered.container.querySelectorAll<HTMLButtonElement>('[data-layer-select]'),
    ).find((button) => button.textContent?.includes(name))
    await waitFor(() => expect(layerButton('锁定组子层')).toBeDefined())
    fireEvent.click(layerButton('锁定组子层') as HTMLButtonElement)
    fireEvent.click(screen.getByRole('tab', { name: '基础' }))

    expect((screen.getByRole('switch', { name: '可见' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('switch', { name: '锁定' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('slider', { name: '不透明度滑杆' }) as HTMLInputElement).matches(':disabled')).toBe(true)
    expect(screen.queryByRole('combobox', { name: '混合模式' })).toBeNull()
    expect((screen.getByRole('button', { name: '删除所选图层' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: '复制图层' }) as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(layerButton('外部层') as HTMLButtonElement, { ctrlKey: true })
    expect((screen.getByRole('button', { name: '删除所选图层' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
