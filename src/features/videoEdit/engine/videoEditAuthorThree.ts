import type * as Three from 'three'
import type { SpatialBounds, SpatialFrame, SpatialMat4, SpatialVec3 } from '@/core/videoEdit/spatialTypes'
import type { GpuDevice, GpuTexture } from '@/core/imageEdit/worker/webgpuRuntimeSupport'
import type { AuthorLibraryVersions } from '@/core/videoEdit/codeMaterial/authorLibraries'
import type { AuthorAssets, AuthorFrameInfo, AuthorParameters } from './videoEditAuthorModule'
import { loadAuthorThreeLibrary, VideoEditAuthorThreeWebGpu, type AuthorThreeBackend } from './videoEditAuthorThreeWebGpu'

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
}
export interface AuthorThreeScene {
  scene: Three.Scene
  update(params: AuthorParameters, assets: AuthorAssets, info: AuthorFrameInfo & { space: AuthorSpaceInfo }): void
  dispose?(): void | Promise<void>
}
export async function authorSpaceInfo(frame: SpatialFrame, clipId: string, sourceTime: number, centerSourceTime: number,
  centerSequenceTime = frame.sequenceTime): Promise<AuthorSpaceInfo> {
  const math = await import('@/core/videoEdit/spatialMatrices')
  const card = frame.cards.find(value => value.clipId === clipId)
  // 卡片矩阵的输入是左上角 UV；three 作者使用居中、Y 向上的世界坐标。
  const root = card ? math.spatialMultiply(card.uvToWorld, math.spatialTranslation(.5, .5, 0), math.spatialScale(frame.output.displayHeight / frame.output.displayWidth, -1, 1)) : math.spatialIdentityMatrix()
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

/** 更新、渲染与提交由作者实例队列串行；初始化与 compileAsync 预热另外独占设备根队列。 */
export class VideoEditAuthorThree {
  private compiled = false
  private closed = false
  private bounds: SpatialBounds | null = null
  private resources = new Set<ThreeResource>()
  private constructor(private readonly bridge: VideoEditAuthorThreeWebGpu, private readonly author: AuthorThreeScene,
    private readonly host: AuthorThreeHost, private readonly root: Three.Group, private readonly scene: Three.Scene) {}
  static async create(device: GpuDevice, factory: (host: AuthorThreeHost) => AuthorThreeScene | Promise<AuthorThreeScene>,
    width: number, height: number, libraries?: AuthorLibraryVersions, backend?: AuthorThreeBackend): Promise<VideoEditAuthorThree> {
    const library = await loadAuthorThreeLibrary(libraries)
    const camera = new library.PerspectiveCamera()
    const host = { camera, width, height }
    const author = await factory(host)
    if (!(author?.scene instanceof library.Scene) || typeof author.update !== 'function') {
      await author?.dispose?.()
      throw new Error('createThree 必须返回同一作者库的 Scene 和 update。')
    }
    let bridge: VideoEditAuthorThreeWebGpu | undefined
    try {
      assertThreeMaterials(author.scene)
      bridge = await VideoEditAuthorThreeWebGpu.create(library, device, backend)
      const root = new library.Group()
      root.matrixAutoUpdate = false; root.add(author.scene)
      const managed = new VideoEditAuthorThree(bridge, author, host, root, author.scene)
      managed.retainResources()
      return managed
    } catch (error) { await bridge?.dispose(); await author.dispose?.(); throw error }
  }
  get worldBounds(): SpatialBounds | null { return this.bounds }
  get allocationBytes(): number { return this.bridge.allocationBytes }
  private retainResources(): void {
    const next = new Set<ThreeResource>(), pending: unknown[] = [this.author.scene.background, this.author.scene.environment], seen = new WeakSet<object>()
    this.author.scene.traverse(object => {
      const mesh = object as Three.Mesh
      if (mesh.geometry) next.add(mesh.geometry)
      if (mesh.material) pending.push(...Array.isArray(mesh.material) ? mesh.material : [mesh.material])
    })
    while (pending.length) {
      const value = pending.pop()
      if (!value || typeof value !== 'object' || seen.has(value)) continue
      seen.add(value)
      const resource = value as { isTexture?: boolean; isMaterial?: boolean; isNode?: boolean; dispose?: () => void }
      if ((resource.isTexture || resource.isMaterial) && resource.dispose) next.add(resource as ThreeResource)
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
    const { camera } = this.host, library = this.bridge.library
    camera.matrixAutoUpdate = false
    camera.matrixWorldAutoUpdate = false
    camera.coordinateSystem = this.bridge.backend === 'webgpu' ? library.WebGPUCoordinateSystem : library.WebGLCoordinateSystem
    camera.matrixWorldInverse.fromArray(space.camera.view)
    camera.matrixWorld.copy(camera.matrixWorldInverse).invert()
    camera.matrix.copy(camera.matrixWorld)
    camera.matrix.decompose(camera.position, camera.quaternion, camera.scale)
    camera.up.fromArray(space.camera.up)
    camera.projectionMatrix.fromArray(this.bridge.backend === 'webgpu' ? space.camera.projectionWebGpu : space.camera.projectionWebGl)
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert()
    camera.near = space.camera.near; camera.far = space.camera.far
    camera.fov = space.camera.fovYRadians * 180 / Math.PI
    camera.aspect = space.output.displayWidth / space.output.displayHeight
    this.root.matrix.fromArray(space.root)
  }
  update(params: AuthorParameters, assets: AuthorAssets, info: AuthorFrameInfo & { space: AuthorSpaceInfo }): SpatialBounds | null {
    if (this.closed) throw new Error('three 场景已释放。')
    this.synchronize(info.space)
    this.author.update(params, assets, info)
    assertThreeMaterials(this.author.scene)
    this.retainResources()
    this.synchronize(info.space)
    this.root.updateMatrixWorld(true)
    const bounds = new this.bridge.library.Box3().setFromObject(this.root)
    this.bounds = bounds.isEmpty() ? null : { min: bounds.min.toArray() as [number, number, number], max: bounds.max.toArray() as [number, number, number] }
    return this.bounds
  }
  async render(target: GpuTexture, width: number, height: number, params: AuthorParameters, assets: AuthorAssets,
    info: AuthorFrameInfo & { space: AuthorSpaceInfo }, assertCurrent: () => void): Promise<void> {
    this.update(params, assets, info)
    await this.bridge.render(this.scene, this.host.camera, target, width, height, info.time, assertCurrent, !this.compiled)
    this.compiled = true
  }
  async dispose(): Promise<void> {
    if (this.closed) return
    this.closed = true
    const failures: unknown[] = []
    try { await this.author.dispose?.() } catch (error) { failures.push(error) }
    this.root.remove(this.author.scene)
    for (const resource of this.resources) {
      try { this.releaseResource(resource) } catch (error) { failures.push(error) }
    }
    this.resources.clear()
    try { await this.bridge.dispose() } catch (error) { failures.push(error) }
    if (failures.length) throw new AggregateError(failures, 'three 场景资源释放失败。')
  }
}
