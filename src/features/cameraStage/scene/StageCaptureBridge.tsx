import React, { useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import {
  RGBAFormat,
  UnsignedByteType,
  Vector4,
  WebGLRenderTarget,
} from 'three'
import type { Camera, PerspectiveCamera, Scene, WebGLRenderer } from 'three'
import { resolveCenteredCaptureView } from './captureFraming'

/**
 * 截图桥：Canvas 内部注册两类捕获能力。
 * - 不传参数：读取视口 PNG dataURL，供截图功能沿用既有裁剪路径。
 * - 传目标尺寸：渲染至离屏 RenderTarget 后直接读取原始 RGBA，避免逐帧 PNG 压缩。
 */

export interface StageOffscreenCaptureOptions {
  width: number
  height: number
}

export interface StageCaptureFn {
  (): string | null
  (options: StageOffscreenCaptureOptions): Promise<Uint8Array | null>
  disposeOffscreen: () => void
}

interface StageCaptureBridgeProps {
  captureRef: React.MutableRefObject<StageCaptureFn | null>
}

interface ExportRendererResources {
  sceneTarget: WebGLRenderTarget
  outputTarget: WebGLRenderTarget
  outputPass: OutputPass
  pixels: Uint8Array
  width: number
  height: number
}

const StageCaptureBridge: React.FC<StageCaptureBridgeProps> = ({ captureRef }) => {
  const gl = useThree((state) => state.gl)
  const scene = useThree((state) => state.scene)
  const camera = useThree((state) => state.camera)

  useEffect(() => {
    let resources: ExportRendererResources | null = null

    const disposeOffscreen = (): void => {
      resources?.sceneTarget.dispose()
      resources?.outputTarget.dispose()
      resources?.outputPass.dispose()
      resources = null
    }

    function captureFrame(): string | null
    function captureFrame(options: StageOffscreenCaptureOptions): Promise<Uint8Array | null>
    function captureFrame(
      options?: StageOffscreenCaptureOptions,
    ): string | null | Promise<Uint8Array | null> {
      if (!options) {
        try {
          return gl.domElement.toDataURL('image/png')
        } catch {
          return null
        }
      }

      resources = getExportRenderer(resources, options)
      return captureOffscreenRgba(resources, gl, scene, camera, options)
    }

    captureFrame.disposeOffscreen = disposeOffscreen
    captureRef.current = captureFrame
    return () => {
      captureRef.current = null
      disposeOffscreen()
    }
  }, [camera, captureRef, gl, scene])

  return null
}

function getExportRenderer(
  current: ExportRendererResources | null,
  options: StageOffscreenCaptureOptions,
): ExportRendererResources {
  const sizeChanged = !current || current.width !== options.width || current.height !== options.height
  if (current && !sizeChanged) return current

  current?.sceneTarget.dispose()
  current?.outputTarget.dispose()
  current?.outputPass.dispose()
  const targetOptions = {
    format: RGBAFormat,
    type: UnsignedByteType,
    depthBuffer: true,
    stencilBuffer: false,
  } as const
  return {
    // Three.js 对普通 RenderTarget 固定输出线性工作色彩空间；先保留线性场景结果，
    // 再由 OutputPass 显式补齐与主画布相同的 tone mapping 和 sRGB 输出转换。
    sceneTarget: new WebGLRenderTarget(options.width, options.height, targetOptions),
    outputTarget: new WebGLRenderTarget(options.width, options.height, targetOptions),
    outputPass: new OutputPass(),
    pixels: new Uint8Array(options.width * options.height * 4),
    width: options.width,
    height: options.height,
  }
}

async function captureOffscreenRgba(
  resources: ExportRendererResources,
  renderer: WebGLRenderer,
  scene: Scene,
  camera: Camera,
  options: StageOffscreenCaptureOptions,
): Promise<Uint8Array | null> {
  if (!isPerspectiveCamera(camera)) {
    throw new Error('[cameraStage] 离屏视频帧导出仅支持透视相机')
  }

  const exportCamera = camera.clone()
  const captureView = resolveCenteredCaptureView(camera.aspect, options)
  exportCamera.setViewOffset(
    captureView.fullWidth,
    captureView.fullHeight,
    captureView.offsetX,
    captureView.offsetY,
    captureView.width,
    captureView.height,
  )

  const { sceneTarget, outputTarget, outputPass, pixels } = resources
  const previousTarget = renderer.getRenderTarget()
  const previousViewport = renderer.getViewport(new Vector4())
  const previousScissor = renderer.getScissor(new Vector4())
  const previousScissorTest = renderer.getScissorTest()
  try {
    // setRenderTarget 会直接采用 RenderTarget 自带的物理像素 viewport（0,0,width,height）。
    // 这里不能再调用 renderer.setViewport：它会额外乘上主视图的 devicePixelRatio，
    // 在高 DPI 屏幕上造成离屏画面只截取左下区域并被放大。
    renderer.setRenderTarget(sceneTarget)
    renderer.setScissorTest(false)
    renderer.clear()
    renderer.render(scene, exportCamera)
    outputPass.render(renderer, outputTarget, sceneTarget, 0, false)
    renderer.readRenderTargetPixels(outputTarget, 0, 0, options.width, options.height, pixels)
  } finally {
    renderer.setRenderTarget(previousTarget)
    renderer.setViewport(previousViewport)
    renderer.setScissor(previousScissor)
    renderer.setScissorTest(previousScissorTest)
  }
  return pixels
}

function isPerspectiveCamera(camera: Camera): camera is PerspectiveCamera {
  return (camera as PerspectiveCamera).isPerspectiveCamera
}

export default StageCaptureBridge
