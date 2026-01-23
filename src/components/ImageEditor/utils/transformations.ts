/**
 * 变换计算工具
 * 职责：提供图像变换的数学计算
 */

/**
 * 计算旋转后的边界框
 */
export function calculateRotatedBounds(
  width: number,
  height: number,
  rotation: number
): { width: number; height: number } {
  const rad = (rotation * Math.PI) / 180
  const cos = Math.abs(Math.cos(rad))
  const sin = Math.abs(Math.sin(rad))

  return {
    width: width * cos + height * sin,
    height: width * sin + height * cos
  }
}

/**
 * 计算缩放后的尺寸
 */
export function calculateScaledSize(
  width: number,
  height: number,
  scale: number
): { width: number; height: number } {
  return {
    width: width * scale,
    height: height * scale
  }
}

/**
 * 限制值在范围内
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/**
 * 计算适应容器的缩放比例
 */
export function calculateFitScale(
  imageWidth: number,
  imageHeight: number,
  containerWidth: number,
  containerHeight: number
): number {
  const scaleX = containerWidth / imageWidth
  const scaleY = containerHeight / imageHeight
  return Math.min(scaleX, scaleY)
}

/**
 * 角度转弧度
 */
export function degToRad(degrees: number): number {
  return (degrees * Math.PI) / 180
}

/**
 * 弧度转角度
 */
export function radToDeg(radians: number): number {
  return (radians * 180) / Math.PI
}
