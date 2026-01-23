/**
 * 画布辅助函数
 * 职责：提供画布操作的辅助功能
 */

/**
 * 创建画布
 */
export function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

/**
 * 加载图片
 */
export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = url
  })
}

/**
 * 调整画布大小
 */
export function resizeCanvas(canvas: HTMLCanvasElement, width: number, height: number) {
  const tempCanvas = createCanvas(canvas.width, canvas.height)
  const tempCtx = tempCanvas.getContext('2d')
  if (tempCtx) {
    tempCtx.drawImage(canvas, 0, 0)
  }

  canvas.width = width
  canvas.height = height

  const ctx = canvas.getContext('2d')
  if (ctx && tempCtx) {
    ctx.drawImage(tempCanvas, 0, 0, width, height)
  }
}

/**
 * 获取图片尺寸
 */
export function getImageDimensions(url: string): Promise<{ width: number; height: number }> {
  return loadImage(url).then(img => ({
    width: img.width,
    height: img.height
  }))
}

/**
 * 裁剪画布
 */
export function cropCanvas(
  canvas: HTMLCanvasElement,
  x: number,
  y: number,
  width: number,
  height: number
): HTMLCanvasElement {
  const croppedCanvas = createCanvas(width, height)
  const ctx = croppedCanvas.getContext('2d')
  if (ctx) {
    ctx.drawImage(canvas, x, y, width, height, 0, 0, width, height)
  }
  return croppedCanvas
}
