/** @vitest-environment jsdom */
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { createImageEditDocumentV3, createImageEditRasterLayerV3 } from '@/core/imageEdit/v3/documentFactory'
import { ImageEditorLayerControlsV3 } from './ImageEditorLayerControlsV3'
import { ImageEditorLayerControlsPresentationV3 } from './layerControlsPresentationV3'

afterEach(cleanup)

function setup() {
  const document = createImageEditDocumentV3({ width: 1000, height: 800, documentId: 'controls' })
  document.layers = [createImageEditRasterLayerV3('layer', '图层')]
  const bounds = { x: 100, y: 80, width: 200, height: 160 }
  const presentation = new ImageEditorLayerControlsPresentationV3()
  const props = { presentation, document, layerId: 'layer', bounds, outputWidth: 1000, outputHeight: 800, zoom: 1 }
  const view = render(<ImageEditorLayerControlsV3 {...props} />)
  const position = () => {
    const handle = view.container.querySelector<HTMLElement>('[data-layer-transform-handle="nw"]')!
    return [handle.style.left, handle.style.top]
  }
  return { view, props, presentation, position }
}

describe('控制框瞬态与权威位置交接', () => {
  it('连续 100 次移动及预览重渲染都使用同一瞬态位置，不闪回旧文档', () => {
    const { view, props, presentation, position } = setup()
    expect(position()).toEqual(['10%', '10%'])
    for (let step = 1; step <= 100; step++) {
      act(() => presentation.updateTransform('controls', 0, 'layer', [1, 0, 0, 1, step * 10, step * 8]))
      position().forEach((value) => expect(parseFloat(value)).toBeCloseTo(10 + step, 10))
      // GPU frame-ready / CPU 草稿刷新都可能重渲染，但权威文档在松手前保持不变。
      view.rerender(<ImageEditorLayerControlsV3 {...props} bounds={{ ...props.bounds }} />)
      position().forEach((value) => expect(parseFloat(value)).toBeCloseTo(10 + step, 10))
    }
    expect(props.document.revision).toBe(0)
    expect(props.document.layers[0].transform).toEqual([1, 0, 0, 1, 0, 0])
  })

  it('手势期间边界固定，缩放视口不丢瞬态矩阵，取消后恢复权威边界', () => {
    const { view, props, presentation, position } = setup()
    act(() => presentation.updateTransform('controls', 0, 'layer', [2, 0, 0, 2, 100, 80]))
    const nextBounds = { x: 200, y: 160, width: 100, height: 80 }
    view.rerender(<ImageEditorLayerControlsV3 {...props} bounds={nextBounds} zoom={2} />)
    expect(position()).toEqual(['30%', '30%'])
    expect(view.container.querySelector<HTMLElement>('[data-layer-transform-handle="nw"]')!.style.transform)
      .toContain('scale(0.5)')
    act(() => presentation.updateTransform('controls', 0, 'layer', null))
    expect(position()).toEqual(['20%', '20%'])
  })

  it('提交后交还新文档，撤销不被遗留的瞬态矩阵覆盖', () => {
    const { view, props, presentation, position } = setup()
    act(() => presentation.updateTransform('controls', 0, 'layer', [1, 0, 0, 1, 100, 80]))
    const committed = { ...props.document, revision: 1, layers: [{ ...props.document.layers[0],
      transform: [1, 0, 0, 1, 100, 80] as [number, number, number, number, number, number] }] }
    view.rerender(<ImageEditorLayerControlsV3 {...props} document={committed} />)
    expect(position()).toEqual(['20%', '20%'])
    view.rerender(<ImageEditorLayerControlsV3 {...props} document={{ ...props.document, revision: 2 }} />)
    expect(position()).toEqual(['10%', '10%'])
  })

  it('切换文档或卸载时清除瞬态，不污染另一个同名图层', () => {
    const { view, props, presentation, position } = setup()
    act(() => presentation.updateTransform('controls', 0, 'layer', [1, 0, 0, 1, 100, 80]))
    view.rerender(<ImageEditorLayerControlsV3 {...props} document={{ ...props.document, id: 'other' }} />)
    expect(position()).toEqual(['10%', '10%'])
    act(() => presentation.updateTransform('other', 0, 'layer', [1, 0, 0, 1, 100, 80]))
    view.rerender(<div />)
    view.rerender(<ImageEditorLayerControlsV3 {...props} />)
    expect(position()).toEqual(['10%', '10%'])
  })
})
