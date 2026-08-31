/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createImageEditDocumentV3,
  createImageEditGroupLayerV3,
  createImageEditRasterLayerV3,
} from '@/core/imageEdit/v3/documentFactory'
import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes'
import i18n from '@/i18n/config'
import { useImageEditorInteractionStoreV3, useImageEditorSessionStoreV3 } from '../store'
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

function installPointerCapture(overlay: SVGSVGElement) {
  const captured = new Set<number>()
  const set = vi.fn((pointerId: number) => { captured.add(pointerId) })
  const release = vi.fn((pointerId: number) => { captured.delete(pointerId) })
  Object.defineProperties(overlay, {
    hasPointerCapture: { configurable: true, value: (pointerId: number) => captured.has(pointerId) },
    releasePointerCapture: { configurable: true, value: release },
    setPointerCapture: { configurable: true, value: set },
  })
  return { release, set }
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
      annotationSelectionBySession: {},
    })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('标注手势同步 capture，严格匹配 pointerId，并在 cancel、lost 与工具切换时取消', async () => {
    const changes = vi.fn()
    const initial = documentWithLayers()
    const editor = (document: ImageEditDocumentV3) => (
      <div style={{ width: 1000, height: 700 }}>
        <ImageEditorV3
          sourceImageUrl="preview.png"
          document={document}
          profileId="full"
          previewRenderer={previewRenderer}
          onDocumentChange={changes}
        />
      </div>
    )
    const rendered = render(editor(initial))
    fireEvent.click(await screen.findByRole('button', { name: '矩形标注' }))
    const overlay = await waitFor(() => rendered.container.querySelector(
      '[data-annotation-editor-overlay]',
    ) as SVGSVGElement)
    vi.spyOn(overlay, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 400, bottom: 225, width: 400, height: 225,
      toJSON: () => ({}),
    })
    const capture = installPointerCapture(overlay)

    fireEvent.pointerDown(overlay, { button: 0, clientX: 20, clientY: 20, pointerId: 21 })
    expect(capture.set).toHaveBeenCalledWith(21)
    fireEvent.pointerUp(overlay, { clientX: 100, clientY: 80, pointerId: 22 })
    expect(changes).not.toHaveBeenCalled()
    expect(rendered.container.querySelector('[data-annotation-draft]')).toBeTruthy()
    fireEvent.pointerCancel(overlay, { pointerId: 21 })
    expect(capture.release).toHaveBeenCalledWith(21)
    expect(rendered.container.querySelector('[data-annotation-draft]')).toBeNull()

    fireEvent.pointerDown(overlay, { button: 0, clientX: 30, clientY: 30, pointerId: 23 })
    fireEvent.click(screen.getByRole('button', { name: '移动' }))
    await waitFor(() => expect(capture.release).toHaveBeenCalledWith(23))
    fireEvent.click(screen.getByRole('button', { name: '矩形标注' }))
    fireEvent.pointerDown(overlay, { button: 0, clientX: 40, clientY: 40, pointerId: 24 })
    fireEvent.lostPointerCapture(overlay, { pointerId: 24 })
    expect(capture.release).toHaveBeenCalledWith(24)

    fireEvent.pointerDown(overlay, { button: 0, clientX: 50, clientY: 50, pointerId: 25 })
    rendered.rerender(editor({ ...initial, revision: 1 }))
    await waitFor(() => expect(capture.release).toHaveBeenCalledWith(25))
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
    const opacity = await screen.findByRole('slider', { name: '不透明度' }) as HTMLInputElement
    fireEvent.change(opacity, { target: { value: '0.35' } })
    expect(opacity.value).toBe('0.35')
    fireEvent.pointerCancel(opacity)

    expect(opacity.value).toBe('1')
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
      <div style={{ width: 1000, height: 700 }}>
        <ImageEditorV3
          sourceImageUrl="preview.png"
          document={document}
          profileId="full"
          previewRenderer={previewRenderer}
          onDocumentChange={vi.fn()}
        />
      </div>,
    )
    fireEvent.click(await screen.findByRole('button', { name: '展开图层组' }))
    const selects = rendered.container.querySelectorAll<HTMLButtonElement>('[data-layer-select]')
    fireEvent.click(Array.from(selects).find((button) => button.textContent?.includes('锁定组子层')) as HTMLButtonElement)

    expect((screen.getByRole('switch', { name: '可见' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('switch', { name: '锁定' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('slider', { name: '不透明度' }) as HTMLInputElement).disabled).toBe(true)
    expect(screen.queryByRole('combobox', { name: '混合模式' })).toBeNull()
    expect((screen.getByRole('button', { name: '删除所选图层' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: '复制图层' }) as HTMLButtonElement).disabled).toBe(true)

    const outside = Array.from(selects).find((button) => button.textContent?.includes('外部层'))
    fireEvent.click(outside as HTMLButtonElement, { ctrlKey: true })
    expect((screen.getByRole('button', { name: '删除所选图层' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
