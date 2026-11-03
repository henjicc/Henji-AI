import type * as Three from 'three'
import type { SpatialBounds, SpatialFrame, SpatialMat4, SpatialVec3 } from '@/core/videoEdit/spatialTypes'
import type { GpuDevice, GpuTexture } from '@/core/imageEdit/worker/webgpuRuntimeSupport'
import type { AuthorLibraryVersions } from '@/core/videoEdit/codeMaterial/authorLibraries'
import type { AuthorAssets, AuthorFrameInfo, AuthorParameters } from './videoEditAuthorModule'
import { loadAuthorThreeLibrary, loadAuthorThreeModule, VideoEditAuthorThreeWebGpu, type AuthorThreeBackend, type AuthorThreeLibrary } from './videoEditAuthorThreeWebGpu'
import { isSpaceSharedTexture, type SpaceMaterialParams, type SpaceMaterialPreset } from './videoEditSpaceMaterials'
import type { VideoEditSpaceEnvironment } from '@/core/videoEdit/document'
import { CODE_AUTHOR_SPACE_MIN_API_VERSION } from '@/core/videoEdit/codeAuthorVersions'

export interface AuthorSpaceInfo {
  readonly camera: SpatialFrame['camera']
  readonly sequenceTime: number
  readonly sampleTime: number
  readonly sourceTime: number
  readonly centerSourceTime: number
  readonly root: SpatialMat4
  readonly output: SpatialFrame['output']
  project(point: SpatialVec3): SpatialVec3
}
export interface AuthorThreeHost {
  readonly camera: Three.PerspectiveCamera
  readonly width: number
  readonly height: number
  /**
   * 作者接口 17 起：本场景的源时间（秒）的 TSL 均匀量。TSL 自带的 `time` 按渲染次数推进，一组里多个作者场景共用一个时钟；
   * 节点材质里的动画用它才与片段时间、预览与导出一致。
   */
  readonly time?: { readonly value: number }
  /** 作者接口 17 起：与时间线物体同一实现的标准材质与环境（实时与路径追踪读同一份参数）。 */
  readonly space?: AuthorSpaceHost
}
export interface AuthorSpaceHost {
  /** 标准材质：matte 磨砂、metal 金属、thin-film 薄膜金属、acrylic 亚克力、glass 实心玻璃、emissive 发光体；参数见 SpaceMaterialParams。 */
  material(preset: SpaceMaterialPreset, params?: SpaceMaterialParams): Three.Material
  /** 预设环境图（等距柱状、线性半精度）：宿主所有，作者不必也不能释放；none 返回 null。 */
  environment(preset: VideoEditSpaceEnvironment): Three.Texture | null
}
export interface AuthorThreeScene {
  scene: Three.Scene
  update(params: AuthorParameters, assets: AuthorAssets, info: AuthorFrameInfo & { space: AuthorSpaceInfo }): void
  dispose?(): void | Promise<void>
}
export async function authorSpaceInfo(frame: SpatialFrame, clipId: string, sourceTime: number, centerSourceTime: number,
  centerSequenceTime = frame.sequenceTime): Promise<AuthorSpaceInfo> {
  const [math, { spatialAuthorRoot }] = await Promise.all([import('@/core/videoEdit/spatialMatrices'), import('@/core/videoEdit/spatialElements')])
  const root = spatialAuthorRoot(frame, clipId)
  const projection = math.spatialMultiply(frame.camera.projectionWebGpu, frame.camera.view)
  const data = { camera: structuredClone(frame.camera), output: { ...frame.output }, root }
  const freeze = (value: object): void => { for (const child of Object.values(value)) if (child && typeof child === 'object') freeze(child); Object.freeze(value) }
  freeze(data)
  return Object.freeze({ ...data,
    sequenceTime: centerSequenceTime, sampleTime: frame.sequenceTime, sourceTime, centerSourceTime,
    project(point: SpatialVec3): SpatialVec3 {
      const p = math.spatialHomogeneous(projection, point)
      if (p[3] === 0) throw new Error('投影点位于摄像机平面。')
      return [(p[0] / p[3] + 1) * .5, (1 - p[1] / p[3]) * .5, p[2] / p[3]]
    } })
}
export function assertThreeMaterials(scene: Three.Scene): void {
  scene.traverse(object => {
    const material = (object as Three.Mesh).material
    for (const item of material ? Array.isArray(material) ? material : [material] : []) {
      if ((item as Three.ShaderMaterial).isShaderMaterial || item.type === 'RawShaderMaterial') {
        throw new Error(`createThree 不支持 GLSL 材质「${item.name || item.type}」；请使用节点材质或标准材质。`)
      }
    }
  })
}
type ThreeResource = { dispose(): void }
const resourceOwners = new WeakMap<ThreeResource, number>()
/**
 * 宿主所有、只借给作者场景用的 three 资源：作者场景释放时不能连带释放它们，否则别的场景再用就会提交到已销毁的缓冲区。
 * three 模块级的共用资源：所有 Sprite 共用的几何体、后处理全屏四边形的几何体、纹理节点缺省的空纹理（create 时登记）。
 */
const hostOwned = new WeakSet<object>()

/**
 * 更新、渲染与提交由作者实例队列串行；初始化与 compileAsync 预热另外独占设备根队列。
 * 场景可以只被更新、由宿主的统一三维渲染器挂进同一场景绘制；自带的渲染桥只在单独渲染成一层时才创建。
 */
export class VideoEditAuthorThree {
  private compiled = false
  private closed = false
  private bounds: SpatialBounds | null = null
  private resources = new Set<ThreeResource>()
  private bridge?: VideoEditAuthorThreeWebGpu
  private constructor(private readonly library: AuthorThreeLibrary, private readonly device: GpuDevice, private readonly backend: AuthorThreeBackend,
    private readonly author: AuthorThreeScene, private readonly host: AuthorThreeHost, private readonly sceneRoot: Three.Group, private readonly scene: Three.Scene) {}
  static async create(device: GpuDevice, factory: (host: AuthorThreeHost) => AuthorThreeScene | Promise<AuthorThreeScene>,
    width: number, height: number, libraries?: AuthorLibraryVersions, backend?: AuthorThreeBackend, apiVersion = 0): Promise<VideoEditAuthorThree> {
    const library = await loadAuthorThreeLibrary(libraries)
    // 各新建一个，取到模块共用的那一份（第一次时由 three 创建）。
    const nodes = (library as unknown as { TSL?: { texture(): { value: object }; cubeTexture(): { value: object } } }).TSL
    for (const resource of [new library.Sprite().geometry, (library as unknown as { QuadMesh?: new () => { geometry: object } }).QuadMesh ? new (library as unknown as { QuadMesh: new () => { geometry: object } }).QuadMesh().geometry : undefined, nodes?.texture().value, nodes?.cubeTexture().value]) if (resource) hostOwned.add(resource)
    const camera = new library.PerspectiveCamera()
    let host: AuthorThreeHost = { camera, width, height }
    if (apiVersion >= CODE_AUTHOR_SPACE_MIN_API_VERSION) {
      const [tsl, materials, environments] = await Promise.all([loadAuthorThreeModule<{ uniform(value: number): { value: number } }>('three/tsl', libraries), import('./videoEditSpaceMaterials'), import('./videoEditSpaceEnvironment')])
      host = { camera, width, height, time: tsl.uniform(0), space: {
        material: (preset, params) => materials.createSpaceMaterial(library, tsl as never, preset, params),
        environment: preset => {
          const texture = environments.videoEditSpaceEnvironment(library, preset)
          // 预设环境图全 Worker 共用一份：登记为宿主所有，作者场景释放时不连带释放。
          if (texture) hostOwned.add(texture)
          return texture
        },
      } }
    }
    const author = await factory(host)
    if (!(author?.scene instanceof library.Scene) || typeof author.update !== 'function') {
      await author?.dispose?.()
      throw new Error('createThree 必须返回同一作者库的 Scene 和 update。')
    }
    try {
      assertThreeMaterials(author.scene)
      const root = new library.Group()
      root.matrixAutoUpdate = false; root.add(author.scene)
      const managed = new VideoEditAuthorThree(library, device, backend ?? 'webgpu', author, host, root, author.scene)
      managed.retainResources()
      return managed
    } catch (error) { await author.dispose?.(); throw error }
  }
  get worldBounds(): SpatialBounds | null { return this.bounds }
  get allocationBytes(): number { return this.bridge?.allocationBytes ?? 0 }
  /** 已按本帧求值放好位置的场景根节点（世界坐标），供统一三维渲染器挂进同一场景。 */
  get root(): Three.Group { return this.sceneRoot }
  private retainResources(): void {
    const next = new Set<ThreeResource>(), pending: unknown[] = [this.author.scene.background, this.author.scene.environment], seen = new WeakSet<object>()
    this.author.scene.traverse(object => {
      const mesh = object as Three.Mesh
      if (mesh.geometry && !hostOwned.has(mesh.geometry)) next.add(mesh.geometry)
      if (mesh.material) pending.push(...Array.isArray(mesh.material) ? mesh.material : [mesh.material])
    })
    while (pending.length) {
      const value = pending.pop()
      if (!value || typeof value !== 'object' || seen.has(value)) continue
      seen.add(value)
      const resource = value as { isTexture?: boolean; isMaterial?: boolean; isNode?: boolean; dispose?: () => void }
      if ((resource.isTexture || resource.isMaterial) && resource.dispose && !hostOwned.has(resource) && !isSpaceSharedTexture(resource)) next.add(resource as ThreeResource)
      if (resource.isMaterial || resource.isNode || Array.isArray(value)) pending.push(...Object.values(value))
    }
    for (const resource of next) if (!this.resources.has(resource)) resourceOwners.set(resource, (resourceOwners.get(resource) ?? 0) + 1)
    for (const resource of this.resources) if (!next.has(resource)) this.releaseResource(resource)
    this.resources = next
  }
  private releaseResource(resource: ThreeResource): void {
    const count = (resourceOwners.get(resource) ?? 1) - 1
    if (count > 0) resourceOwners.set(resource, count)
    else { resourceOwners.delete(resource); resource.dispose() }
  }
  private synchronize(space: AuthorSpaceInfo): void {
    const { camera } = this.host, library = this.library
    camera.matrixAutoUpdate = false
    camera.matrixWorldAutoUpdate = false
    camera.coordinateSystem = this.backend === 'webgpu' ? library.WebGPUCoordinateSystem : library.WebGLCoordinateSystem
    camera.matrixWorldInverse.fromArray(space.camera.view)
    camera.matrixWorld.copy(camera.matrixWorldInverse).invert()
    camera.matrix.copy(camera.matrixWorld)
    camera.matrix.decompose(camera.position, camera.quaternion, camera.scale)
    camera.up.fromArray(space.camera.up)
    camera.projectionMatrix.fromArray(this.backend === 'webgpu' ? space.camera.projectionWebGpu : space.camera.projectionWebGl)
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert()
    camera.near = space.camera.near; camera.far = space.camera.far
    camera.fov = space.camera.fovYRadians * 180 / Math.PI
    camera.aspect = space.output.displayWidth / space.output.displayHeight
    this.sceneRoot.matrix.fromArray(space.root)
  }
  update(params: AuthorParameters, assets: AuthorAssets, info: AuthorFrameInfo & { space: AuthorSpaceInfo }): SpatialBounds | null {
    if (this.closed) throw new Error('three 场景已释放。')
    this.synchronize(info.space)
    if (this.host.time) (this.host.time as { value: number }).value = info.time
    this.author.update(params, assets, info)
    assertThreeMaterials(this.author.scene)
    this.retainResources()
    this.synchronize(info.space)
    this.sceneRoot.updateMatrixWorld(true)
    const bounds = new this.library.Box3().setFromObject(this.sceneRoot)
    this.bounds = bounds.isEmpty() ? null : { min: bounds.min.toArray() as [number, number, number], max: bounds.max.toArray() as [number, number, number] }
    return this.bounds
  }
  async render(target: GpuTexture, width: number, height: number, params: AuthorParameters, assets: AuthorAssets,
    info: AuthorFrameInfo & { space: AuthorSpaceInfo }, assertCurrent: () => void): Promise<void> {
    this.update(params, assets, info)
    this.bridge ??= await VideoEditAuthorThreeWebGpu.create(this.library, this.device, this.backend)
    await this.bridge.render(this.scene, this.host.camera, target, width, height, info.time, assertCurrent, !this.compiled)
    this.compiled = true
  }
  async dispose(): Promise<void> {
    if (this.closed) return
    this.closed = true
    const failures: unknown[] = []
    try { await this.author.dispose?.() } catch (error) { failures.push(error) }
    this.sceneRoot.remove(this.author.scene)
    for (const resource of this.resources) {
      try { this.releaseResource(resource) } catch (error) { failures.push(error) }
    }
    this.resources.clear()
    try { await this.bridge?.dispose() } catch (error) { failures.push(error) }
    if (failures.length) throw new AggregateError(failures, 'three 场景资源释放失败。')
  }
}
