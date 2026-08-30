export type SourceExifOrientation = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8

export interface SourcePixelDimensions {
  width: number
  height: number
}

export interface SourcePixelRect extends SourcePixelDimensions {
  left: number
  top: number
}

function positiveDimension(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`Invalid ${label}: ${value}`)
  return value
}

export function normalizeSourceExifOrientation(value: number | undefined): SourceExifOrientation {
  return Number.isSafeInteger(value) && (value ?? 0) >= 1 && (value ?? 0) <= 8
    ? value as SourceExifOrientation
    : 1
}

export function orientedSourceDimensions(
  encoded: SourcePixelDimensions,
  orientation: SourceExifOrientation,
): SourcePixelDimensions {
  const width = positiveDimension(encoded.width, 'encoded source width')
  const height = positiveDimension(encoded.height, 'encoded source height')
  return orientation >= 5
    ? { width: height, height: width }
    : { width, height }
}

function validateOrientedRect(
  rect: SourcePixelRect,
  oriented: SourcePixelDimensions,
): SourcePixelRect {
  if (
    !Number.isSafeInteger(rect.left)
    || rect.left < 0
    || !Number.isSafeInteger(rect.top)
    || rect.top < 0
    || !Number.isSafeInteger(rect.width)
    || rect.width < 1
    || !Number.isSafeInteger(rect.height)
    || rect.height < 1
    || rect.left + rect.width > oriented.width
    || rect.top + rect.height > oriented.height
  ) {
    throw new Error('Oriented source region is outside the source bounds')
  }
  return rect
}

/**
 * 将已经应用 EXIF 方向后的逻辑矩形反算到编码文件坐标。变换只包含 90° 旋转和镜像，
 * 所以矩形仍是矩形。调用方可以先解码这个有界区域，再对小区域执行同一 EXIF 变换，
 * 无需为了读取一个瓦片建立完整的归一化原图。
 */
export function mapOrientedSourceRectToEncoded(
  rect: SourcePixelRect,
  encoded: SourcePixelDimensions,
  orientation: SourceExifOrientation,
): SourcePixelRect {
  const width = positiveDimension(encoded.width, 'encoded source width')
  const height = positiveDimension(encoded.height, 'encoded source height')
  const current = validateOrientedRect(rect, orientedSourceDimensions({ width, height }, orientation))
  const right = current.left + current.width
  const bottom = current.top + current.height

  switch (orientation) {
    case 1:
      return { ...current }
    case 2:
      return { left: width - right, top: current.top, width: current.width, height: current.height }
    case 3:
      return {
        left: width - right,
        top: height - bottom,
        width: current.width,
        height: current.height,
      }
    case 4:
      return {
        left: current.left,
        top: height - bottom,
        width: current.width,
        height: current.height,
      }
    case 5:
      return { left: current.top, top: current.left, width: current.height, height: current.width }
    case 6:
      return {
        left: current.top,
        top: height - right,
        width: current.height,
        height: current.width,
      }
    case 7:
      return {
        left: width - bottom,
        top: height - right,
        width: current.height,
        height: current.width,
      }
    case 8:
      return {
        left: width - bottom,
        top: current.left,
        width: current.height,
        height: current.width,
      }
  }
}
