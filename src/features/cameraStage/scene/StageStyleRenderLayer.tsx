import React, { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Vector2 } from 'three'
import type { Camera, PerspectiveCamera } from 'three'
import { StageStyleRenderer, type StageStyleRenderStyle } from '../render/stageStyleRenderer'

/**
 * 视口内的样式渲染接管层：挂载后 R3F 默认渲染循环让位（useFrame 优先级 > 0），
 * 由样式管线画出深度/线稿等画面。卸载即恢复默认彩色渲染。
 *
 * 视口预览与导出捕获走的是同一个 StageStyleRenderer，所见即所得。
 */

interface StageStyleRenderLayerProps {
  style: StageStyleRenderStyle
}

function isPerspectiveCamera(camera: Camera): camera is PerspectiveCamera {
  return (camera as PerspectiveCamera).isPerspectiveCamera === true
}

const StageStyleRenderLayer: React.FC<StageStyleRenderLayerProps> = ({ style }) => {
  /*
   * 渲染器由 ref 持有而不是 useMemo：React 18 严格模式下开发环境会「挂载→清理→再挂载」，
   * useMemo 的实例不会跟着重建，清理里 dispose 过的那个会被第二次挂载继续拿去渲染。
   * 放 ref 里、卸载时置空，下一帧按需重建。
   */
  const styleRendererRef = useRef<StageStyleRenderer | null>(null)
  const drawingBufferSize = useMemo(() => new Vector2(), [])

  useEffect(() => () => {
    styleRendererRef.current?.dispose()
    styleRendererRef.current = null
  }, [])

  useFrame(({ gl, scene, camera }) => {
    if (!isPerspectiveCamera(camera)) {
      gl.render(scene, camera)
      return
    }
    const styleRenderer = styleRendererRef.current ?? new StageStyleRenderer()
    styleRendererRef.current = styleRenderer
    const size = gl.getDrawingBufferSize(drawingBufferSize)
    styleRenderer.render({
      renderer: gl,
      scene,
      camera,
      style,
      target: null,
      width: size.x,
      height: size.y,
    })
  }, 1)

  return null
}

export default StageStyleRenderLayer
