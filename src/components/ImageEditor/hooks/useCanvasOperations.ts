import { useState, useCallback, useRef, useEffect } from 'react'

/**
 * 画布操作 Hook
 * 职责：管理画布的绘制和操作
 */

export const useCanvasOperations = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [context, setContext] = useState<CanvasRenderingContext2D | null>(null)

  useEffect(() => {
    if (canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d')
      setContext(ctx)
    }
  }, [])

  const clearCanvas = useCallback(() => {
    if (!context || !canvasRef.current) return
    context.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height)
  }, [context])

  const drawImage = useCallback((image: HTMLImageElement, x: number = 0, y: number = 0) => {
    if (!context || !canvasRef.current) return
    context.drawImage(image, x, y)
  }, [context])

  const getImageData = useCallback(() => {
    if (!context || !canvasRef.current) return null
    return context.getImageData(0, 0, canvasRef.current.width, canvasRef.current.height)
  }, [context])

  const putImageData = useCallback((imageData: ImageData, x: number = 0, y: number = 0) => {
    if (!context) return
    context.putImageData(imageData, x, y)
  }, [context])

  const toDataURL = useCallback((type: string = 'image/png', quality: number = 1) => {
    if (!canvasRef.current) return null
    return canvasRef.current.toDataURL(type, quality)
  }, [])

  return {
    canvasRef,
    context,
    clearCanvas,
    drawImage,
    getImageData,
    putImageData,
    toDataURL
  }
}
