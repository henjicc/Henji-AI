import { useState, useCallback } from 'react'

/**
 * 图片变换 Hook
 * 职责：管理图片的变换操作（旋转、缩放、翻转等）
 */

interface Transform {
  scale: number
  rotation: number
  translateX: number
  translateY: number
  flipHorizontal: boolean
  flipVertical: boolean
}

const DEFAULT_TRANSFORM: Transform = {
  scale: 1,
  rotation: 0,
  translateX: 0,
  translateY: 0,
  flipHorizontal: false,
  flipVertical: false
}

export const useImageTransform = () => {
  const [transform, setTransform] = useState<Transform>(DEFAULT_TRANSFORM)

  const setScale = useCallback((scale: number) => {
    setTransform(prev => ({ ...prev, scale }))
  }, [])

  const setRotation = useCallback((rotation: number) => {
    setTransform(prev => ({ ...prev, rotation }))
  }, [])

  const setTranslate = useCallback((x: number, y: number) => {
    setTransform(prev => ({ ...prev, translateX: x, translateY: y }))
  }, [])

  const flipHorizontal = useCallback(() => {
    setTransform(prev => ({ ...prev, flipHorizontal: !prev.flipHorizontal }))
  }, [])

  const flipVertical = useCallback(() => {
    setTransform(prev => ({ ...prev, flipVertical: !prev.flipVertical }))
  }, [])

  const resetTransform = useCallback(() => {
    setTransform(DEFAULT_TRANSFORM)
  }, [])

  const applyTransform = useCallback((ctx: CanvasRenderingContext2D, width: number, height: number) => {
    ctx.save()
    ctx.translate(width / 2, height / 2)
    ctx.scale(transform.scale, transform.scale)
    ctx.rotate((transform.rotation * Math.PI) / 180)
    if (transform.flipHorizontal) ctx.scale(-1, 1)
    if (transform.flipVertical) ctx.scale(1, -1)
    ctx.translate(-width / 2, -height / 2)
    ctx.translate(transform.translateX, transform.translateY)
  }, [transform])

  return {
    transform,
    setScale,
    setRotation,
    setTranslate,
    flipHorizontal,
    flipVertical,
    resetTransform,
    applyTransform
  }
}
