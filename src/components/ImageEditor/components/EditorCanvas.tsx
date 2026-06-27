/**
 * 编辑器画布组件
 * 职责：显示和操作图片画布
 */

import React, { useRef, useEffect } from 'react'

interface EditorCanvasProps {
  imageUrl: string | null
  width: number
  height: number
  scale: number
  rotation: number
  onCanvasReady: (canvas: HTMLCanvasElement) => void
  onImageLoad?: (img: HTMLImageElement) => void
}

export const EditorCanvas: React.FC<EditorCanvasProps> = ({
  imageUrl,
  width: _width,
  height: _height,
  scale,
  rotation,
  onCanvasReady,
  onImageLoad
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (canvasRef.current) {
      onCanvasReady(canvasRef.current)
    }
  }, [onCanvasReady])

  useEffect(() => {
    if (!imageUrl || !canvasRef.current) return

    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const img = new Image()
    img.crossOrigin = 'anonymous'

    img.onload = () => {
      canvas.width = img.width
      canvas.height = img.height

      ctx.save()
      ctx.clearRect(0, 0, canvas.width, canvas.height)

      // Apply transformations
      ctx.translate(canvas.width / 2, canvas.height / 2)
      ctx.scale(scale, scale)
      ctx.rotate((rotation * Math.PI) / 180)
      ctx.translate(-img.width / 2, -img.height / 2)

      ctx.drawImage(img, 0, 0)
      ctx.restore()

      if (onImageLoad) {
        onImageLoad(img)
      }
    }

    img.src = imageUrl
  }, [imageUrl, scale, rotation, onImageLoad])

  return (
    <div ref={containerRef} className="editor-canvas-container">
      <canvas
        ref={canvasRef}
        className="editor-canvas"
        style={{
          maxWidth: '100%',
          maxHeight: '100%'
        }}
      />
    </div>
  )
}
