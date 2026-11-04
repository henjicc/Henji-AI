import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState } from 'react'
import { useThree, type ThreeEvent } from '@react-three/fiber'
import {
  Box3,
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Euler,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  type BufferGeometry,
  type Object3D,
  type Scene,
} from 'three'
import type { StagePrimitiveKind, StageTransform } from '../domain/sceneTypes'
import { STAGE_STYLE_SUBJECT_KEY } from '../render/stageStyleTags'

/**
 * 基础几何体的共享资源：同一个 Canvas 里同种几何体只建一份，同色同选中态的材质只建一份。
 *
 * 城市群这类上千个方块的场景，逐物体各建一份几何与材质时，渲染器每次绘制都要切换缓冲和材质
 * 状态，CPU 先成为瓶颈。资源按 Canvas 划分而不是全局共享：three 会在几何体、材质上挂各渲染器的
 * 释放监听，跨渲染器共享时，切换窗格重建 Canvas 后旧渲染器会一直被监听引用着。
 *
 * 没选中的可见几何体合批成每种形状一个 InstancedMesh：上万个物体逐个绘制就是每帧上万次
 * draw call，四个窗格直接卡死。合批物体不再挂自己的组件与节点（上万个组件光挂载就要好几秒），
 * 变换和颜色只记在合批位置里；点选按实例号反查物体，名称标签与深度范围按位置的矩阵算包围盒。
 * 选中的那个改回自己的组件绘制，gizmo 与选中高亮因此不用进合批。
 */

interface MaterialEntry {
  key: string
  material: MeshStandardMaterial
  users: number
}

/** 合批实例数组的起始容量；满了翻倍，摊下来每加一个物体是常数开销。 */
const INITIAL_BATCH_CAPACITY = 64

const DEG2RAD = Math.PI / 180

/** 合批里一个物体占的位置。index 会因别的物体移出而变（末位补洞）。 */
export interface StagePrimitiveSlot {
  readonly id: string
  readonly kind: StagePrimitiveKind
  index: number
  /** 当前所在的批次；镜像与否变化时会换批 */
  batch: PrimitiveInstanceBatch | null
  /** 换批时要把颜色带过去 */
  color: string
  /** 物体直接挂在场景根下，这组局部变换就是世界变换；旋转为弧度 */
  readonly position: Vector3
  readonly rotation: Euler
  readonly scale: Vector3
  /** 由上面三项合成，与 Object3D.updateMatrix 同一算法；matrixStale 时用前重算 */
  readonly matrix: Matrix4
  matrixStale: boolean
}

const scratchColor = new Color()
const scratchMatrix = new Matrix4()
const scratchQuaternion = new Quaternion()
/** 镜像批次网格自身的变换，也是它的逆：实例矩阵先乘它，叠上网格变换后还原成物体的世界矩阵。 */
const MIRROR = new Matrix4().makeScale(-1, 1, 1)

function createPrimitiveGeometry(kind: StagePrimitiveKind): BufferGeometry {
  switch (kind) {
    case 'sphere':
      return new SphereGeometry(0.5, 32, 32)
    case 'cylinder':
      return new CylinderGeometry(0.5, 0.5, 1, 32)
    case 'cone':
      return new ConeGeometry(0.5, 1, 32)
    case 'pyramid':
      return new ConeGeometry(0.6, 1, 4)
    case 'torus':
      return new TorusGeometry(0.5, 0.2, 16, 48)
    case 'box':
    default:
      return new BoxGeometry(1, 1, 1)
  }
}

function slotMatrix(slot: StagePrimitiveSlot): Matrix4 {
  if (slot.matrixStale) {
    slot.matrix.compose(slot.position, scratchQuaternion.setFromEuler(slot.rotation), slot.scale)
    slot.matrixStale = false
  }
  return slot.matrix
}

/**
 * 一种形状的一批实例。three 按网格自身世界矩阵的行列式决定正反面，实例矩阵带镜像（负缩放）
 * 时不会翻转，外表面会被剔除；所以镜像物体单独一批，批次网格自身做一次镜像，让 three 翻转正面。
 */
class PrimitiveInstanceBatch {
  mesh: InstancedMesh

  readonly slots: StagePrimitiveSlot[] = []

  constructor(
    private readonly geometry: BufferGeometry,
    private readonly material: MeshStandardMaterial,
    private readonly root: Group,
    readonly mirrored: boolean,
  ) {
    this.mesh = this.createMesh(INITIAL_BATCH_CAPACITY)
    root.add(this.mesh)
  }

  add(slot: StagePrimitiveSlot): void {
    if (this.slots.length === this.mesh.instanceMatrix.count) this.grow()
    slot.index = this.slots.length
    slot.batch = this
    this.slots.push(slot)
    this.syncCount()
  }

  /** 末位补洞：只搬一个实例的数据，不重建整批。 */
  remove(slot: StagePrimitiveSlot): void {
    const index = slot.index
    const last = this.slots.pop()
    slot.index = -1
    slot.batch = null
    if (last && last !== slot) {
      const matrices = this.mesh.instanceMatrix.array as Float32Array
      const colors = this.colors().array as Float32Array
      matrices.copyWithin(index * 16, last.index * 16, last.index * 16 + 16)
      colors.copyWithin(index * 3, last.index * 3, last.index * 3 + 3)
      last.index = index
      this.slots[index] = last
      this.mesh.instanceMatrix.needsUpdate = true
      this.colors().needsUpdate = true
    }
    this.syncCount()
  }

  writeMatrix(slot: StagePrimitiveSlot): void {
    const matrix = this.mirrored
      ? scratchMatrix.multiplyMatrices(MIRROR, slotMatrix(slot))
      : slotMatrix(slot)
    matrix.toArray(this.mesh.instanceMatrix.array, slot.index * 16)
    this.mesh.instanceMatrix.needsUpdate = true
    this.invalidateBounds()
  }

  writeColor(slot: StagePrimitiveSlot, color: string): void {
    scratchColor.set(color).toArray(this.colors().array, slot.index * 3)
    this.colors().needsUpdate = true
  }

  dispose(): void {
    this.root.remove(this.mesh)
    this.mesh.dispose()
  }

  private colors(): InstancedBufferAttribute {
    return this.mesh.instanceColor as InstancedBufferAttribute
  }

  /** 点选的包围球与深度范围的包围盒都缓存在网格上，实例一变就要作废，用到时按当前实例重算。 */
  private invalidateBounds(): void {
    this.mesh.boundingBox = null
    this.mesh.boundingSphere = null
  }

  private syncCount(): void {
    this.mesh.count = this.slots.length
    this.mesh.visible = this.slots.length > 0
    this.invalidateBounds()
  }

  private createMesh(capacity: number): InstancedMesh {
    const mesh = new InstancedMesh(this.geometry, this.material, capacity)
    mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3)
    // 深度图的归一化区间按场景对象统计，合批物体由批次网格代表
    mesh.userData[STAGE_STYLE_SUBJECT_KEY] = true
    // 实例随动画到处移动，缓存的包围球很快失效；每种形状只一次绘制，交给 GPU 裁剪
    mesh.frustumCulled = false
    mesh.count = 0
    mesh.visible = false
    if (this.mirrored) {
      mesh.scale.x = -1
      // 批次可能在 flushSlots 里新建或扩容，那时这一帧的场景矩阵已经算过；挂载点是单位阵，
      // 这里直接算好世界矩阵，当帧就按镜像绘制
      mesh.updateMatrixWorld()
    }
    return mesh
  }

  private grow(): void {
    const previous = this.mesh
    const next = this.createMesh(previous.instanceMatrix.count * 2)
    ;(next.instanceMatrix.array as Float32Array).set(previous.instanceMatrix.array)
    ;(next.instanceColor as InstancedBufferAttribute).array.set(this.colors().array)
    this.mesh = next
    this.root.remove(previous)
    this.root.add(next)
    previous.dispose()
  }
}

export class StagePrimitiveResources {
  private readonly geometries = new Map<StagePrimitiveKind, BufferGeometry>()
  private readonly materials = new Map<string, MaterialEntry>()
  private sweepTimer: ReturnType<typeof setTimeout> | null = null
  private readonly batches = new Map<string, PrimitiveInstanceBatch>()
  private readonly slotsById = new Map<string, StagePrimitiveSlot>()
  private readonly dirtySlots = new Set<StagePrimitiveSlot>()
  // 底色由实例颜色给出；与逐物体材质一样，未选中时没有自发光
  private readonly batchMaterial = new MeshStandardMaterial({ color: 0xffffff })
  /** 所有合批网格的挂载点，由 Provider 放进场景。 */
  readonly batchRoot = new Group()

  geometry(kind: StagePrimitiveKind): BufferGeometry {
    let geometry = this.geometries.get(kind)
    if (!geometry) {
      geometry = createPrimitiveGeometry(kind)
      this.geometries.set(kind, geometry)
    }
    return geometry
  }

  /** 渲染期只取不计数：被丢弃的渲染不会留下引用，计数在提交后的 effect 里加减。 */
  material(color: string, selected: boolean): MaterialEntry {
    const key = `${color}|${selected ? 1 : 0}`
    let entry = this.materials.get(key)
    if (!entry) {
      entry = {
        key,
        material: new MeshStandardMaterial({ color, emissive: color, emissiveIntensity: selected ? 0.35 : 0 }),
        users: 0,
      }
      this.materials.set(key, entry)
    }
    return entry
  }

  retain(entry: MaterialEntry): void {
    entry.users += 1
    if (!this.materials.has(entry.key)) this.materials.set(entry.key, entry)
  }

  /** 拖动取色器会连续产生新颜色；没人用的材质延后统一释放，同一次提交里换用的材质不会被误删。 */
  release(entry: MaterialEntry): void {
    entry.users = Math.max(0, entry.users - 1)
    if (entry.users > 0 || this.sweepTimer !== null) return
    this.sweepTimer = setTimeout(() => {
      this.sweepTimer = null
      for (const [key, candidate] of this.materials) {
        if (candidate.users > 0) continue
        this.materials.delete(key)
        candidate.material.dispose()
      }
    }, 0)
  }

  /** 物体进入合批；变换随后用 setSlotTransform 写入。 */
  acquireSlot(id: string, kind: StagePrimitiveKind, color: string): StagePrimitiveSlot {
    const slot: StagePrimitiveSlot = {
      id,
      kind,
      index: -1,
      batch: null,
      color,
      position: new Vector3(),
      rotation: new Euler(),
      scale: new Vector3(1, 1, 1),
      matrix: new Matrix4(),
      matrixStale: false,
    }
    // 先进正向批次；是否镜像要等 flushSlots 合成矩阵后才知道，同一次出帧里就会换过去
    this.batchFor(kind, false).add(slot)
    slot.batch?.writeColor(slot, color)
    this.slotsById.set(id, slot)
    this.dirtySlots.add(slot)
    return slot
  }

  /** 退出合批（选中、隐藏、删除、换形状）。 */
  releaseSlot(slot: StagePrimitiveSlot): void {
    if (!slot.batch) return
    slot.batch.remove(slot)
    this.dirtySlots.delete(slot)
    if (this.slotsById.get(slot.id) === slot) this.slotsById.delete(slot.id)
  }

  slot(id: string): StagePrimitiveSlot | undefined {
    return this.slotsById.get(id)
  }

  /** 写入变换（角度制旋转）；只记脏，出帧前统一合成并写进实例。播放时三项各写一次，不必合成三遍。 */
  setSlotTransform(slot: StagePrimitiveSlot, transform: Partial<StageTransform>): void {
    const { position, rotation, scale } = transform
    if (position) slot.position.set(position.x, position.y, position.z)
    if (rotation) slot.rotation.set(rotation.x * DEG2RAD, rotation.y * DEG2RAD, rotation.z * DEG2RAD)
    if (scale) slot.scale.set(scale.x, scale.y, scale.z)
    slot.matrixStale = true
    if (slot.batch) this.dirtySlots.add(slot)
  }

  setSlotColor(slot: StagePrimitiveSlot, color: string): void {
    slot.color = color
    slot.batch?.writeColor(slot, color)
  }

  /** 物体的世界包围盒：与对自有网格做 Box3.setFromObject 的结果一致。 */
  slotBounds(slot: StagePrimitiveSlot, target: Box3): Box3 {
    const geometry = this.geometry(slot.kind)
    if (!geometry.boundingBox) geometry.computeBoundingBox()
    return target.copy(geometry.boundingBox as Box3).applyMatrix4(slotMatrix(slot))
  }

  /** 点选命中的实例反查物体 id。 */
  objectIdAt(mesh: Object3D, instanceId: number | undefined): string | undefined {
    if (instanceId === undefined) return undefined
    for (const batch of this.batches.values()) {
      if (batch.mesh === mesh) return batch.slots[instanceId]?.id
    }
    return undefined
  }

  /** 在场景矩阵更新之后、裁剪与上传之前调用（Scene.onBeforeRender）。 */
  flushSlots(): void {
    if (this.dirtySlots.size === 0) return
    for (const slot of this.dirtySlots) {
      if (!slot.batch) continue
      // 缩放过零（gizmo 拖过中心、助手写负值、关键帧插值）会让物体在正向与镜像之间切换
      const mirrored = slotMatrix(slot).determinant() < 0
      if (mirrored !== slot.batch.mirrored) {
        slot.batch.remove(slot)
        this.batchFor(slot.kind, mirrored).add(slot)
        slot.batch?.writeColor(slot, slot.color)
      }
      slot.batch?.writeMatrix(slot)
    }
    this.dirtySlots.clear()
  }

  batchMesh(kind: StagePrimitiveKind, mirrored = false): InstancedMesh | undefined {
    return this.batches.get(`${kind}|${mirrored ? 1 : 0}`)?.mesh
  }

  private batchFor(kind: StagePrimitiveKind, mirrored: boolean): PrimitiveInstanceBatch {
    const key = `${kind}|${mirrored ? 1 : 0}`
    let batch = this.batches.get(key)
    if (!batch) {
      batch = new PrimitiveInstanceBatch(this.geometry(kind), this.batchMaterial, this.batchRoot, mirrored)
      this.batches.set(key, batch)
    }
    return batch
  }

  dispose(): void {
    if (this.sweepTimer !== null) clearTimeout(this.sweepTimer)
    this.sweepTimer = null
    for (const batch of this.batches.values()) batch.dispose()
    this.batches.clear()
    this.slotsById.clear()
    this.dirtySlots.clear()
    this.batchMaterial.dispose()
    for (const geometry of this.geometries.values()) geometry.dispose()
    for (const entry of this.materials.values()) entry.material.dispose()
    this.geometries.clear()
    this.materials.clear()
  }
}

const StagePrimitiveResourcesContext = createContext<StagePrimitiveResources | null>(null)

/** 放在 Canvas 内部：资源随这个 Canvas 的渲染器一起创建、一起释放。 */
export const StagePrimitiveResourcesProvider: React.FC<{
  children: React.ReactNode
  /** 点中合批物体时回调其 id */
  onSelect: (id: string) => void
}> = ({ children, onSelect }) => {
  const [resources] = useState(() => new StagePrimitiveResources())
  const scene = useThree((state) => state.scene)
  useEffect(() => () => resources.dispose(), [resources])
  // 视口出帧、离屏抓图、成像方式的多遍渲染都经 renderer.render(scene)，统一在这里落脏矩阵
  useLayoutEffect(() => {
    const previous = scene.onBeforeRender
    scene.onBeforeRender = (...args: Parameters<Scene['onBeforeRender']>) => {
      resources.flushSlots()
      previous.apply(scene, args)
    }
    return () => { scene.onBeforeRender = previous }
  }, [resources, scene])
  const handleClick = useCallback((event: ThreeEvent<MouseEvent>): void => {
    const id = resources.objectIdAt(event.object, event.instanceId)
    if (!id) return
    event.stopPropagation()
    onSelect(id)
  }, [onSelect, resources])
  return React.createElement(
    StagePrimitiveResourcesContext.Provider,
    { value: resources },
    React.createElement('primitive', { object: resources.batchRoot, onClick: handleClick }),
    children,
  )
}

export function useStagePrimitiveResources(): StagePrimitiveResources {
  const resources = useContext(StagePrimitiveResourcesContext)
  if (!resources) throw new Error('[cameraStage] 基础几何体必须渲染在 StagePrimitiveResourcesProvider 内')
  return resources
}

export function useStagePrimitiveMaterial(color: string, selected: boolean): MeshStandardMaterial {
  const resources = useStagePrimitiveResources()
  const entry = useMemo(() => resources.material(color, selected), [resources, color, selected])
  useEffect(() => {
    resources.retain(entry)
    return () => resources.release(entry)
  }, [resources, entry])
  return entry.material
}
