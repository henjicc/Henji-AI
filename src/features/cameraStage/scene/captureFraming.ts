export interface CenteredCaptureView {
  fullWidth: number
  fullHeight: number
  offsetX: number
  offsetY: number
  width: number
  height: number
}

/**
 * 把摄像机视口中由画幅遮罩圈出的中心区域映射为离屏相机 view offset。
 *
 * 预览相机的投影比例跟随可见 Canvas，画幅遮罩只负责压暗超出最终画幅的部分；
 * 因此离屏导出不能直接把相机 aspect 改为输出比例，否则当视口比最终画幅更窄时，
 * 垂直视野会发生变化。这里用 PerspectiveCamera.setViewOffset 所需的虚拟完整画布
 * 描述同一个中心裁切区域，让目标分辨率导出与遮罩内预览保持同一构图。
 */
export function resolveCenteredCaptureView(
  previewAspect: number,
  outputSize: { width: number; height: number },
): CenteredCaptureView {
  const width = Math.max(1, outputSize.width)
  const height = Math.max(1, outputSize.height)
  const outputAspect = width / height
  const safePreviewAspect = Number.isFinite(previewAspect) && previewAspect > 0
    ? previewAspect
    : outputAspect

  if (safePreviewAspect >= outputAspect) {
    const fullWidth = height * safePreviewAspect
    return {
      fullWidth,
      fullHeight: height,
      offsetX: (fullWidth - width) / 2,
      offsetY: 0,
      width,
      height,
    }
  }

  const fullHeight = width / safePreviewAspect
  return {
    fullWidth: width,
    fullHeight,
    offsetX: 0,
    offsetY: (fullHeight - height) / 2,
    width,
    height,
  }
}
