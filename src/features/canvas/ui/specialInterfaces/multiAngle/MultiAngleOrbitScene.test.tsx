// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MultiAngleOrbitScene } from './MultiAngleOrbitScene'
import { imageBlockGeometry, multiAngleOrientation, orientationVector, rotateImageBlock } from './multiAngleOrbitGeometry'
import { MULTI_ANGLE_DISCRETE_VIEW_PRESETS } from '@/features/canvas/capabilities/multiAnglePolicy'
import { bakeImageBlockTextures } from './imageBlockTextures'

vi.mock('./imageBlockTextures', () => ({ bakeImageBlockTextures: vi.fn(() => ({
  top: 'top.png', bottom: 'bottom.png', left: 'left.png', right: 'right.png', back: 'back.png',
})) }))

afterEach(cleanup)
describe('多角度图片块', () => {
  it('视角与图片块可见面一致，旋转保留比例且不越过工作面', () => {
    const expected: Record<string, string[]> = { front: ['front'], back: ['back'], left_side: ['left'], right_side: ['right'], top_down: ['top'], bottom_up: ['bottom'], birds_eye: ['left', 'top', 'front'], three_quarter_left: ['left', 'front'], three_quarter_right: ['right', 'front'] }
    for (const { view } of MULTI_ANGLE_DISCRETE_VIEW_PRESETS) {
      const pose = multiAngleOrientation(view)
      const normal = rotateImageBlock(orientationVector(pose), pose)
      expect(normal[2]).toBeCloseTo(1)
      for (const aspect of [0.5, 1, 2]) {
        const block = imageBlockGeometry(aspect, pose)
        expect(block.width / block.height).toBeCloseTo(aspect)
        expect(Math.max(block.width, block.height)).toBeGreaterThan(60)
        expect(block.faces.filter(face => face.visible).map(face => face.name).sort()).toEqual(expected[view.preset].sort())
        for (const face of block.faces) for (const coordinate of face.points.split(/[ ,]/).map(Number)) {
          expect(coordinate).toBeGreaterThan(0)
          expect(coordinate).toBeLessThan(100)
        }
      }
    }
  })
  it('旋转到背面保留同一图片实例与真实宽高比，不显示镜像正面', () => {
    vi.mocked(bakeImageBlockTextures).mockClear()
    const views = MULTI_ANGLE_DISCRETE_VIEW_PRESETS.map(p => p.view)
    const { container, rerender } = render(<MultiAngleOrbitScene views={views} selectedViewId={views[0].viewId} sourceImage="test.png" />)
    const image = container.querySelector('img')!
    Object.defineProperties(image, { naturalWidth: { value: 300 }, naturalHeight: { value: 600 } })
    fireEvent.load(image)
    expect(bakeImageBlockTextures).toHaveBeenCalledTimes(1)
    expect(container.querySelectorAll('[data-block-texture]')).toHaveLength(5)
    const back = views.find(view => view.preset === 'back')!
    rerender(<MultiAngleOrbitScene views={views} selectedViewId={back.viewId} sourceImage="test.png" />)
    expect(container.querySelector('img')).toBe(image)
    expect(container.querySelector('svg')!.getAttribute('data-image-aspect')).toBe('0.5')
    expect(container.querySelector('[data-block-face="front"]')!.getAttribute('visibility')).toBe('hidden')
    expect(container.querySelector('[data-block-face="back"]')!.getAttribute('visibility')).toBe('visible')
    for (let angle = 0; angle < 60; angle++) rerender(<MultiAngleOrbitScene views={views} selectedViewId={back.viewId} sourceImage="test.png" previewOrientation={{ azimuth: angle, elevation: angle / 2 }} />)
    fireEvent.load(image)
    expect(bakeImageBlockTextures).toHaveBeenCalledTimes(1)
    rerender(<MultiAngleOrbitScene views={views} selectedViewId={back.viewId} sourceImage="replacement.png" />)
    expect(container.querySelectorAll('[data-block-texture]')).toHaveLength(0)
    fireEvent.load(image)
    expect(bakeImageBlockTextures).toHaveBeenCalledTimes(2)
  })
  it('多节点静态展示只保留六个面，不创建 GPU 上下文或启动刷新循环', () => {
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
    const raf = vi.spyOn(window, 'requestAnimationFrame')
    const views = MULTI_ANGLE_DISCRETE_VIEW_PRESETS.map(preset => preset.view)
    const { container } = render(<>{Array.from({ length: 24 }, (_, index) => <MultiAngleOrbitScene key={index} views={views} selectedViewId={views[0].viewId} />)}</>)
    expect(container.querySelectorAll('[data-block-face]')).toHaveLength(24 * 6)
    expect(container.querySelectorAll('circle, text, path, canvas')).toHaveLength(0)
    expect(getContext).not.toHaveBeenCalled()
    expect(raf).not.toHaveBeenCalled()
    getContext.mockRestore(); raf.mockRestore()
  })
})
