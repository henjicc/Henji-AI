import {
  Box3,
  Color,
  MeshDepthMaterial,
  MeshNormalMaterial,
  NearestFilter,
  RGBADepthPacking,
  RGBAFormat,
  ShaderMaterial,
  UnsignedByteType,
  Vector2,
  WebGLRenderTarget,
} from 'three'
import type { Object3D, PerspectiveCamera, Scene, Texture, WebGLRenderer } from 'three'
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js'
import type { StageRenderStyle } from '../domain/renderStyles'
import { resolveStageDepthRange } from './stageDepthRange'
import {
  STAGE_STYLE_FRAGMENT_SHADER,
  STAGE_STYLE_MODE_CODES,
  STAGE_STYLE_VERTEX_SHADER,
} from './stageStyleShaders'
import { STAGE_STYLE_HIDDEN_KEY } from './stageStyleTags'

/**
 * 非彩色渲染方式的成像器：深度图、线稿图、法线图、剪影图共用一条管线。
 *
 * 两次整场覆盖材质渲染（打包深度 / 视图法线）落到离屏缓冲，再由一个全屏合成 pass 出图。
 * 用 three 自带的 MeshDepthMaterial / MeshNormalMaterial 而不是自写覆盖材质，是因为角色是
 * 蒙皮网格：自写材质要自己接骨骼变形链，内置材质直接就支持。
 *
 * 同一个实例同时服务视口预览与导出捕获（各自持有一份，尺寸不互相打架），
 * 保证"看到什么就导出什么"。
 */

export type StageStyleRenderStyle = Exclude<StageRenderStyle, 'beauty'>

export interface StageStyleRenderRequest {
  renderer: WebGLRenderer
  scene: Scene
  camera: PerspectiveCamera
  style: StageStyleRenderStyle
  /** null 表示直接画到画布 */
  target: WebGLRenderTarget | null
  width: number
  height: number
}

/** 线宽以 720p 为基准等比放大，避免同一画面在 1080p 导出时线条明显变细 */
const LINE_REFERENCE_HEIGHT = 720

export function isStageStyleRenderStyle(style: StageRenderStyle): style is StageStyleRenderStyle {
  return style !== 'beauty'
}

function createStyleTarget(width: number, height: number): WebGLRenderTarget {
  // 深度以 RGBA 打包存放，任何插值都会把打包字节混成无意义的值，因此必须最近邻采样。
  return new WebGLRenderTarget(width, height, {
    format: RGBAFormat,
    type: UnsignedByteType,
    depthBuffer: true,
    stencilBuffer: false,
    minFilter: NearestFilter,
    magFilter: NearestFilter,
    generateMipmaps: false,
  })
}

/** 隐藏编辑辅助节点并摘掉天空背景色，返回还原函数。 */
function beginStyleScene(scene: Scene): () => void {
  const hidden: Object3D[] = []
  scene.traverse((node) => {
    if (node.visible && node.userData?.[STAGE_STYLE_HIDDEN_KEY] === true) {
      node.visible = false
      hidden.push(node)
    }
  })
  const background = scene.background
  // 天空背景色会在清屏后覆盖整块画面，深度缓冲会把它解成一个随机距离。
  scene.background = null
  return () => {
    for (const node of hidden) node.visible = true
    scene.background = background
  }
}

export class StageStyleRenderer {
  private readonly depthMaterial = new MeshDepthMaterial({ depthPacking: RGBADepthPacking })

  private readonly normalMaterial = new MeshNormalMaterial()

  private readonly composite: ShaderMaterial

  private readonly quad: FullScreenQuad

  private readonly subjectBox = new Box3()

  private readonly previousClearColor = new Color()

  private depthTarget: WebGLRenderTarget | null = null

  private normalTarget: WebGLRenderTarget | null = null

  constructor() {
    this.composite = new ShaderMaterial({
      vertexShader: STAGE_STYLE_VERTEX_SHADER,
      fragmentShader: STAGE_STYLE_FRAGMENT_SHADER,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uDepthBuffer: { value: null as Texture | null },
        uNormalBuffer: { value: null as Texture | null },
        uTexel: { value: new Vector2(1, 1) },
        uCameraNear: { value: 0.05 },
        uCameraFar: { value: 1000 },
        uRangeNear: { value: 1 },
        uRangeFar: { value: 40 },
        uLineScale: { value: 1 },
        uMode: { value: STAGE_STYLE_MODE_CODES.depth },
      },
    })
    this.quad = new FullScreenQuad(this.composite)
  }

  render(request: StageStyleRenderRequest): void {
    const { renderer, scene, camera, style, target } = request
    const width = Math.max(1, Math.floor(request.width))
    const height = Math.max(1, Math.floor(request.height))
    const needsNormals = style === 'normal' || style === 'lineart'
    this.ensureTargets(width, height, needsNormals)
    const depthTarget = this.depthTarget
    if (!depthTarget) return

    const restoreScene = beginStyleScene(scene)
    const previousTarget = renderer.getRenderTarget()
    const previousClearAlpha = renderer.getClearAlpha()
    renderer.getClearColor(this.previousClearColor)
    try {
      // 清屏白 = 打包深度 1.0 = 没有几何体；合成 pass 据此区分背景与实体。
      renderer.setClearColor(0xffffff, 1)
      scene.overrideMaterial = this.depthMaterial
      renderer.setRenderTarget(depthTarget)
      renderer.clear()
      renderer.render(scene, camera)

      if (needsNormals && this.normalTarget) {
        scene.overrideMaterial = this.normalMaterial
        renderer.setRenderTarget(this.normalTarget)
        renderer.clear()
        renderer.render(scene, camera)
      }
      scene.overrideMaterial = null

      const range = resolveStageDepthRange(scene, camera, this.subjectBox)
      const uniforms = this.composite.uniforms
      uniforms.uDepthBuffer.value = depthTarget.texture
      uniforms.uNormalBuffer.value = (this.normalTarget ?? depthTarget).texture
      ;(uniforms.uTexel.value as Vector2).set(1 / width, 1 / height)
      uniforms.uCameraNear.value = camera.near
      uniforms.uCameraFar.value = camera.far
      uniforms.uRangeNear.value = range.near
      uniforms.uRangeFar.value = range.far
      uniforms.uLineScale.value = Math.max(1, height / LINE_REFERENCE_HEIGHT)
      uniforms.uMode.value = STAGE_STYLE_MODE_CODES[style]

      renderer.setRenderTarget(target)
      this.quad.render(renderer)
    } finally {
      scene.overrideMaterial = null
      restoreScene()
      renderer.setRenderTarget(previousTarget)
      renderer.setClearColor(this.previousClearColor, previousClearAlpha)
    }
  }

  dispose(): void {
    this.depthTarget?.dispose()
    this.normalTarget?.dispose()
    this.depthTarget = null
    this.normalTarget = null
    this.depthMaterial.dispose()
    this.normalMaterial.dispose()
    this.composite.dispose()
    this.quad.dispose()
  }

  private ensureTargets(width: number, height: number, needsNormals: boolean): void {
    if (!this.depthTarget || this.depthTarget.width !== width || this.depthTarget.height !== height) {
      this.depthTarget?.dispose()
      this.normalTarget?.dispose()
      this.depthTarget = createStyleTarget(width, height)
      this.normalTarget = null
    }
    if (needsNormals && !this.normalTarget) {
      this.normalTarget = createStyleTarget(width, height)
    }
  }
}
