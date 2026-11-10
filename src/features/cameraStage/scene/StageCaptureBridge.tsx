import React, { useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import {
  HalfFloatType,
  RGBAFormat,
  UnsignedByteType,
  Vector4,
  WebGLRenderTarget,
} from 'three'
import type { Camera, PerspectiveCamera, Scene, WebGLRenderer } from 'three'
import { updateCameraStageProjectCover } from '../projects/cameraStageProjectCover'
import { StageStyleRenderer, isStageStyleRenderStyle } from '../render/stageStyleRenderer'
import type { StageStyleRenderStyle } from '../render/stageStyleRenderer'
import { cameraStageStoreAttachment, useCameraStageStore } from '../store/cameraStageStore'
import { resolveCenteredCaptureView } from './captureFraming'
import { StageVideoFrameReader } from './stageVideoFrameReader'

/**
 * 截图桥：Canvas 内部注册三类捕获能力。
 * - 不传参数：读取视口 PNG dataURL，供截图功能沿用既有裁剪路径。
 * - 传目标尺寸：渲染至离屏 RenderTarget 后直接读取原始 RGBA，避免逐帧 PNG 压缩。
 * - captureVideoFrame：同一离屏画面在显卡上转成 yuv420p 后异步读回，供逐帧视频导出流水。
 *
 * 离屏渲染按镜头参考当前的渲染方式分流：彩色走场景渲染 + OutputPass 补色调映射与 sRGB；
 * 深度/线稿等样式画面本身就是显示态数据，直接由样式管线写出，再补一次转换会把灰度整体拉偏，
 * 视口预览与导出成片就对不上了。
 */

interface StageOffscreenCaptureOptions {
  width: number
  height: number
}

interface StageVideoFrameCaptureOptions extends StageOffscreenCaptureOptions {
  /** 写入目标，长度为 yuv420pFrameByteLength(width, height)；Promise 兑现前调用方不得复用。 */
  target: Uint8Array
}

export interface StageCaptureFn {
  (): string | null
  (options: StageOffscreenCaptureOptions): Promise<Uint8Array | null>
  /** 调用时同步提交本帧渲染，读回异步完成；可以在兑现前 seek 并提交下一帧。 */
  captureVideoFrame: (options: StageVideoFrameCaptureOptions) => Promise<Uint8Array>
  disposeOffscreen: () => void
}

interface StageCaptureBridgeProps {
  captureRef: React.MutableRefObject<StageCaptureFn | null>
  coverRefresh?: boolean
}

interface ExportRendererResources {
  sceneTarget: WebGLRenderTarget
  outputTarget: WebGLRenderTarget
  outputPass: OutputPass
  pixels: Uint8Array
  frameReader: StageVideoFrameReader | null
  width: number
  height: number
}

const StageCaptureBridge: React.FC<StageCaptureBridgeProps> = ({ captureRef, coverRefresh = false }) => {
  const gl = useThree((state) => state.gl)
  const scene = useThree((state) => state.scene)
  const camera = useThree((state) => state.camera)
  const owner = cameraStageStoreAttachment.getStore()

  useEffect(() => {
    let resources: ExportRendererResources | null = null
    let styleRenderer: StageStyleRenderer | null = null
    let coverTimer: number | null = null

    const disposeOffscreen = (): void => {
      if (resources) disposeExportRenderer(resources)
      resources = null
      styleRenderer?.dispose()
      styleRenderer = null
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

      try {
        const current = getExportRenderer(resources, options)
        resources = current
        return Promise.resolve(withOffscreenRendererState(gl, () => {
          renderOffscreen(current, options)
          gl.readRenderTargetPixels(current.outputTarget, 0, 0, options.width, options.height, current.pixels)
          return current.pixels
        }))
      } catch (error) {
        return Promise.reject(error)
      }
    }

    const renderOffscreen = (current: ExportRendererResources, options: StageOffscreenCaptureOptions): void => {
      const renderStyle = useCameraStageStore.getState().sceneSettings.render.style
      if (isStageStyleRenderStyle(renderStyle)) {
        styleRenderer = styleRenderer ?? new StageStyleRenderer()
        renderStyledOffscreen(current, styleRenderer, renderStyle, gl, scene, camera, options)
      } else {
        renderColorOffscreen(current, gl, scene, camera, options)
      }
    }

    captureFrame.captureVideoFrame = (options: StageVideoFrameCaptureOptions): Promise<Uint8Array> => {
      try {
        const current = getExportRenderer(resources, options)
        resources = current
        const reader = current.frameReader ?? new StageVideoFrameReader(options.width, options.height)
        current.frameReader = reader
        return withOffscreenRendererState(gl, () => {
          renderOffscreen(current, options)
          return reader.read(gl, current.outputTarget.texture, options.target)
        })
      } catch (error) {
        return Promise.reject(error)
      }
    }
    captureFrame.disposeOffscreen = disposeOffscreen
    captureRef.current = captureFrame

    const clearCoverTimer = (): void => {
      if (coverTimer === null) return
      window.clearTimeout(coverTimer)
      coverTimer = null
    }
    const refreshCover = (): void => {
      clearCoverTimer()
      if (cameraStageStoreAttachment.getStore() !== owner) return
      const projectId = owner.getState().currentProjectId
      if (projectId) void updateCameraStageProjectCover(projectId, () => captureFrame())
    }
    const scheduleCoverRefresh = (): void => {
      clearCoverTimer()
      coverTimer = window.setTimeout(refreshCover, 1_200)
    }
    const unsubscribe = coverRefresh ? owner.subscribe((state, previous) => {
      const contentChanged = state.currentProjectId !== previous.currentProjectId
        || state.objects !== previous.objects
        || state.stateKeyframes !== previous.stateKeyframes
        || state.sceneSettings !== previous.sceneSettings
        || state.activeCameraId !== previous.activeCameraId
      if (state.currentProjectId && contentChanged) scheduleCoverRefresh()
    }) : () => undefined
    if (coverRefresh && owner.getState().currentProjectId) scheduleCoverRefresh()
    const flushWhenHidden = (): void => {
      if (document.visibilityState === 'hidden') refreshCover()
    }
    if (coverRefresh) {
      document.addEventListener('visibilitychange', flushWhenHidden)
      window.addEventListener('pagehide', refreshCover)
    }

    // 这里只服务导出；助手的视口观察统一走 observe_application_surface 截取
    // StageViewportWorkspace 上标注的 camera_stage.viewport_observer 区域。
    return () => {
      clearCoverTimer()
      unsubscribe()
      document.removeEventListener('visibilitychange', flushWhenHidden)
      window.removeEventListener('pagehide', refreshCover)
      // 四视口切换 primary 时，新桥可能已经先接管 ref；旧桥卸载不能把新桥清空。
      if (captureRef.current === captureFrame) captureRef.current = null
      disposeOffscreen()
    }
  }, [camera, captureRef, coverRefresh, gl, owner, scene])

  return null
}

function getExportRenderer(
  current: ExportRendererResources | null,
  options: StageOffscreenCaptureOptions,
): ExportRendererResources {
  const sizeChanged = !current || current.width !== options.width || current.height !== options.height
  if (current && !sizeChanged) return current

  if (current) disposeExportRenderer(current)
  const targetOptions = {
    format: RGBAFormat,
    type: UnsignedByteType,
    depthBuffer: true,
    stencilBuffer: false,
  } as const
  return {
    // Three.js 对普通 RenderTarget 固定输出线性工作色彩空间；先保留线性场景结果，
    // 再由 OutputPass 显式补齐与主画布相同的 tone mapping 和 sRGB 输出转换。
    // 线性场景结果用半浮点保存：8 位线性缓冲会把暗部量化成台阶，sRGB 转换后暗部偏亮（与全景冻结帧同源，4.1）。
    sceneTarget: new WebGLRenderTarget(options.width, options.height, { ...targetOptions, type: HalfFloatType }),
    outputTarget: new WebGLRenderTarget(options.width, options.height, targetOptions),
    outputPass: new OutputPass(),
    pixels: new Uint8Array(options.width * options.height * 4),
    frameReader: null,
    width: options.width,
    height: options.height,
  }
}

function disposeExportRenderer(resources: ExportRendererResources): void {
  resources.sceneTarget.dispose()
  resources.outputTarget.dispose()
  resources.outputPass.dispose()
  resources.frameReader?.dispose()
}

/** 导出画幅与视口画幅不一致时，用视图偏移在原始取景里居中裁出目标画幅。 */
function createExportCamera(
  camera: Camera,
  options: StageOffscreenCaptureOptions,
): PerspectiveCamera {
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
  return exportCamera
}

/**
 * 离屏渲染前后收好渲染器的全局状态。
 *
 * setRenderTarget 会直接采用 RenderTarget 自带的物理像素 viewport（0,0,width,height）。
 * 这里不能再调用 renderer.setViewport：它会额外乘上主视图的 devicePixelRatio，
 * 在高 DPI 屏幕上造成离屏画面只截取左下区域并被放大。
 */
function withOffscreenRendererState<T>(renderer: WebGLRenderer, run: () => T): T {
  const previousTarget = renderer.getRenderTarget()
  const previousViewport = renderer.getViewport(new Vector4())
  const previousScissor = renderer.getScissor(new Vector4())
  const previousScissorTest = renderer.getScissorTest()
  try {
    renderer.setScissorTest(false)
    return run()
  } finally {
    renderer.setRenderTarget(previousTarget)
    renderer.setViewport(previousViewport)
    renderer.setScissor(previousScissor)
    renderer.setScissorTest(previousScissorTest)
  }
}

/** 彩色画面：场景渲染进线性半浮点目标，再由 OutputPass 写出与主画布一致的显示态结果到 outputTarget。 */
function renderColorOffscreen(
  resources: ExportRendererResources,
  renderer: WebGLRenderer,
  scene: Scene,
  camera: Camera,
  options: StageOffscreenCaptureOptions,
): void {
  const exportCamera = createExportCamera(camera, options)
  const { sceneTarget, outputTarget, outputPass } = resources
  renderer.setRenderTarget(sceneTarget)
  renderer.clear()
  renderer.render(scene, exportCamera)
  outputPass.render(renderer, outputTarget, sceneTarget, 0, false)
}

function renderStyledOffscreen(
  resources: ExportRendererResources,
  styleRenderer: StageStyleRenderer,
  style: StageStyleRenderStyle,
  renderer: WebGLRenderer,
  scene: Scene,
  camera: Camera,
  options: StageOffscreenCaptureOptions,
): void {
  styleRenderer.render({
    renderer,
    scene,
    camera: createExportCamera(camera, options),
    style,
    target: resources.outputTarget,
    width: options.width,
    height: options.height,
  })
}

function isPerspectiveCamera(camera: Camera): camera is PerspectiveCamera {
  return (camera as PerspectiveCamera).isPerspectiveCamera
}

export default StageCaptureBridge
