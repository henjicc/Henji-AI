import React, { useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import { Vector4, WebGLRenderTarget } from 'three'
import type { Camera, PerspectiveCamera, Scene, WebGLRenderer } from 'three'
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

interface OffscreenCaptureResources {
  target: WebGLRenderTarget
  pixels: Uint8Array
  flippedPixels: Uint8ClampedArray
  imageData: ImageData
  canvas: HTMLCanvasElement
  context: CanvasRenderingContext2D
  width: number
  height: number
}

const PIXEL_CHANNELS = 4

const StageCaptureBridge: React.FC<StageCaptureBridgeProps> = ({ captureRef }) => {
  const gl = useThree((state) => state.gl)
  const scene = useThree((state) => state.scene)
  const camera = useThree((state) => state.camera)

  useEffect(() => {
    let resources: OffscreenCaptureResources | null = null

    const disposeOffscreen = (): void => {
      resources?.target.dispose()
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

      return captureOffscreenPng(gl, scene, camera, options, () => {
        resources = getOffscreenResources(resources, gl, options)
        return resources
      })
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

function getOffscreenResources(
  current: OffscreenCaptureResources | null,
  gl: WebGLRenderer,
  options: StageOffscreenCaptureOptions,
): OffscreenCaptureResources {
  if (current && current.width === options.width && current.height === options.height) {
    return current
  }

  current?.target.dispose()
  const target = new WebGLRenderTarget(options.width, options.height)
  target.texture.colorSpace = gl.outputColorSpace
  const canvas = document.createElement('canvas')
  canvas.width = options.width
  canvas.height = options.height
  const context = canvas.getContext('2d')
  if (!context) {
    target.dispose()
    throw new Error('[cameraStage] 离屏视频帧编码失败：无法创建 2D 画布')
  }

  const length = options.width * options.height * PIXEL_CHANNELS
  const flippedPixels = new Uint8ClampedArray(length)
  return {
    target,
    pixels: new Uint8Array(length),
    flippedPixels,
    imageData: new ImageData(flippedPixels, options.width, options.height),
    canvas,
    context,
    width: options.width,
    height: options.height,
  }
}

async function captureOffscreenPng(
  gl: WebGLRenderer,
  scene: Scene,
  camera: Camera,
  options: StageOffscreenCaptureOptions,
  getResources: () => OffscreenCaptureResources,
): Promise<Uint8Array | null> {
  if (!isPerspectiveCamera(camera)) {
    throw new Error('[cameraStage] 离屏视频帧导出仅支持透视相机')
  }

  const resources = getResources()
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

  const previousTarget = gl.getRenderTarget()
  const previousAutoClear = gl.autoClear
  const previousViewport = gl.getViewport(new Vector4())
  const previousScissor = gl.getScissor(new Vector4())
  const previousScissorTest = gl.getScissorTest()

  try {
    gl.autoClear = true
    gl.setRenderTarget(resources.target)
    gl.setViewport(0, 0, options.width, options.height)
    gl.setScissor(0, 0, options.width, options.height)
    gl.setScissorTest(false)
    gl.render(scene, exportCamera)
    gl.readRenderTargetPixels(resources.target, 0, 0, options.width, options.height, resources.pixels)
    flipPixelsVertically(resources.pixels, resources.flippedPixels, options.width, options.height)
    resources.context.putImageData(resources.imageData, 0, 0)
  } finally {
    gl.setRenderTarget(previousTarget)
    gl.setViewport(previousViewport)
    gl.setScissor(previousScissor)
    gl.setScissorTest(previousScissorTest)
    gl.autoClear = previousAutoClear
  }

  return canvasToPngBytes(resources.canvas)
}

function isPerspectiveCamera(camera: Camera): camera is PerspectiveCamera {
  return (camera as PerspectiveCamera).isPerspectiveCamera
}

function flipPixelsVertically(
  source: Uint8Array,
  target: Uint8ClampedArray,
  width: number,
  height: number,
): void {
  const rowLength = width * PIXEL_CHANNELS
  for (let row = 0; row < height; row += 1) {
    const sourceStart = (height - row - 1) * rowLength
    target.set(source.subarray(sourceStart, sourceStart + rowLength), row * rowLength)
  }
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
