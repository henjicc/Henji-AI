/**
 * 截图裁剪：按摄像机当前画幅比例（宽/高）居中裁剪原始 PNG dataURL，
 * 比目标更宽裁左右、更高裁上下，效果与视口画幅遮罩看到的取景框一致。
 */

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('[cameraStage] 截图裁剪失败：图片加载出错'))
    image.src = dataUrl
  })
}

export async function cropDataUrlToAspectRatio(dataUrl: string, ratio: number): Promise<string> {
  const image = await loadImage(dataUrl)
  const sourceRatio = image.width / image.height

  let cropWidth = image.width
  let cropHeight = image.height
  if (sourceRatio > ratio) {
    cropWidth = image.height * ratio
  } else {
    cropHeight = image.width / ratio
  }
  const offsetX = (image.width - cropWidth) / 2
  const offsetY = (image.height - cropHeight) / 2

  const canvas = document.createElement('canvas')
  canvas.width = Math.round(cropWidth)
  canvas.height = Math.round(cropHeight)
  const ctx = canvas.getContext('2d')
  if (!ctx) return dataUrl
  ctx.drawImage(image, offsetX, offsetY, cropWidth, cropHeight, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/png')
}
