import React, { useEffect } from 'react'
import { useThree } from '@react-three/fiber'

/**
 * 截图桥：在 Canvas 内部拿到 WebGL renderer，向外注册一个"读取当前帧为 PNG dataURL"的函数，
 * 供编辑器的截图按钮调用。依赖 Canvas 开启 preserveDrawingBuffer，否则读到空帧。
 */

export type StageCaptureFn = () => string | null

interface StageCaptureBridgeProps {
  captureRef: React.MutableRefObject<StageCaptureFn | null>
}

const StageCaptureBridge: React.FC<StageCaptureBridgeProps> = ({ captureRef }) => {
  const gl = useThree((state) => state.gl)

  useEffect(() => {
    captureRef.current = () => {
      try {
        return gl.domElement.toDataURL('image/png')
      } catch {
        return null
      }
    }
    return () => {
      captureRef.current = null
    }
  }, [gl, captureRef])

  return null
}

export default StageCaptureBridge
