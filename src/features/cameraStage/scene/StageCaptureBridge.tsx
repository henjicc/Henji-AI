import React, { useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import { WebGLRenderer } from 'three'
import type { Camera, PerspectiveCamera, Scene } from 'three'
import { resolveCenteredCaptureView } from './captureFraming'

/**
 * 截图桥：Canvas 内部注册两类捕获能力。
 * - 不传参数：读取视口 PNG dataURL，供截图功能沿用既有裁剪路径。
 * - 传目标尺寸：将当前场景渲染至离屏 RenderTarget，供视频导出取得原生分辨率 PNG bytes。
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
  renderer: WebGLRenderer
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
      resources?.renderer.dispose()
      resources?.renderer.forceContextLoss()
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

      resources = getExportRenderer(resources, gl, options)
      return captureOffscreenPng(resources.renderer, scene, camera, options)
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
  source: WebGLRenderer,
  options: StageOffscreenCaptureOptions,
): ExportRendererResources {
  const renderer = current?.renderer ?? new WebGLRenderer({
    alpha: false,
    antialias: true,
    preserveDrawingBuffer: true,
  })

  // 导出 renderer 不挂进 DOM，因此调整其 drawing buffer 不会引起预览闪烁或触发 R3F resize。
  if (!current || current.width !== options.width || current.height !== options.height) {
    renderer.setPixelRatio(1)
    renderer.setSize(options.width, options.height, false)
  }
  renderer.outputColorSpace = source.outputColorSpace
  renderer.toneMapping = source.toneMapping
  renderer.toneMappingExposure = source.toneMappingExposure
  renderer.shadowMap.enabled = source.shadowMap.enabled
  renderer.shadowMap.type = source.shadowMap.type
  renderer.localClippingEnabled = source.localClippingEnabled
  renderer.sortObjects = source.sortObjects

  return { renderer, width: options.width, height: options.height }
}

async function captureOffscreenPng(
  gl: WebGLRenderer,
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

  gl.setRenderTarget(null)
  gl.setViewport(0, 0, options.width, options.height)
  gl.setScissorTest(false)
  gl.render(scene, exportCamera)
  return await canvasToPngBytes(gl.domElement)
}

function isPerspectiveCamera(camera: Camera): camera is PerspectiveCamera {
  return (camera as PerspectiveCamera).isPerspectiveCamera
}

function canvasToPngBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('[cameraStage] 离屏视频帧编码失败：无法生成 PNG'))
        return
      }
      void blob.arrayBuffer().then(
        (buffer) => resolve(new Uint8Array(buffer)),
        (error: unknown) => reject(error),
      )
    }, 'image/png')
  })
}

export default StageCaptureBridge
