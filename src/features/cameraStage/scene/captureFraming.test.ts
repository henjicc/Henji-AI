import { describe, expect, it } from 'vitest'
import { PerspectiveCamera, Vector3 } from 'three'
import { resolveCenteredCaptureView } from './captureFraming'

describe('resolveCenteredCaptureView', () => {
  it('宽视口导出时复刻预览的左右居中裁切', () => {
    expect(resolveCenteredCaptureView(2, { width: 1280, height: 720 })).toEqual({
      fullWidth: 1440,
      fullHeight: 720,
      offsetX: 80,
      offsetY: 0,
      width: 1280,
      height: 720,
    })
  })

  it('窄视口导出时复刻预览的上下居中裁切', () => {
    expect(resolveCenteredCaptureView(4 / 3, { width: 1280, height: 720 })).toEqual({
      fullWidth: 1280,
      fullHeight: 960,
      offsetX: 0,
      offsetY: 120,
      width: 1280,
      height: 720,
    })
  })

  it('视口与输出同画幅时使用完整画面', () => {
    expect(resolveCenteredCaptureView(16 / 9, { width: 1280, height: 720 })).toEqual({
      fullWidth: 1280,
      fullHeight: 720,
      offsetX: 0,
      offsetY: 0,
      width: 1280,
      height: 720,
    })
  })

  it('异常视口比例回退到输出画幅', () => {
    expect(resolveCenteredCaptureView(Number.NaN, { width: 720, height: 1280 })).toEqual({
      fullWidth: 720,
      fullHeight: 1280,
      offsetX: 0,
      offsetY: 0,
      width: 720,
      height: 1280,
    })
  })

  it.each([
    { previewAspect: 2, outputAspect: 16 / 9 },
    { previewAspect: 4 / 3, outputAspect: 16 / 9 },
  ])('离屏投影与预览遮罩内的中心取景一致：$previewAspect', ({ previewAspect, outputAspect }) => {
    const outputSize = { width: 1280, height: 720 }
    const previewCamera = new PerspectiveCamera(50, previewAspect, 0.05, 1000)
    previewCamera.position.set(0, 0, 5)
    previewCamera.updateProjectionMatrix()
    previewCamera.updateMatrixWorld(true)

    const exportCamera = previewCamera.clone()
    const view = resolveCenteredCaptureView(previewAspect, outputSize)
    exportCamera.setViewOffset(
      view.fullWidth,
      view.fullHeight,
      view.offsetX,
      view.offsetY,
      view.width,
      view.height,
    )

    const point = new Vector3(0.7, 0.4, 0)
    const previewNdc = point.clone().project(previewCamera)
    const exportNdc = point.clone().project(exportCamera)
    const horizontalCropScale = previewAspect >= outputAspect ? outputAspect / previewAspect : 1
    const verticalCropScale = previewAspect < outputAspect ? previewAspect / outputAspect : 1

    expect(exportNdc.x).toBeCloseTo(previewNdc.x / horizontalCropScale, 10)
    expect(exportNdc.y).toBeCloseTo(previewNdc.y / verticalCropScale, 10)
  })
})
