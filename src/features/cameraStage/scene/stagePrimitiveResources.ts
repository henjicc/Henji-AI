import React, { createContext, useContext, useEffect, useLayoutEffect, useMemo, useState } from 'react'
import { useThree } from '@react-three/fiber'
import {
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Object3D,
  SphereGeometry,
  TorusGeometry,
  type BufferGeometry,
  type Scene,
} from 'three'
import type { StagePrimitiveKind } from '../domain/sceneTypes'

/**
 * 基础几何体的共享资源：同一个 Canvas 里同种几何体只建一份，同色同选中态的材质只建一份。
 *
 * 城市群这类上千个方块的场景，逐物体各建一份几何与材质时，渲染器每次绘制都要切换缓冲和材质
 * 状态，CPU 先成为瓶颈。资源按 Canvas 划分而不是全局共享：three 会在几何体、材质上挂各渲染器的
 * 释放监听，跨渲染器共享时，切换窗格重建 Canvas 后旧渲染器会一直被监听引用着。
 *
 * 没选中的可见几何体再合批成每种形状一个 InstancedMesh：上万个物体逐个绘制就是每帧上万次
 * draw call，四个窗格直接卡死。物体自己的网格仍留在场景里但不可见，点选、gizmo、名称标签、
 * 包围盒统计照旧以它为准；选中的那个改回自己绘制，选中高亮因此不用进合批材质。
 */

interface MaterialEntry {
  key: string
  material: MeshStandardMaterial
  users: number
}

/** 合批实例数组的起始容量；满了翻倍，摊下来每加一个物体是常数开销。 */
const INITIAL_BATCH_CAPACITY = 64

/** 合批里一个物体占的位置。index 会因别的物体移出而变（末位补洞）。 */
export interface StagePrimitiveSlot {
  readonly kind: StagePrimitiveKind
  index: number
  /** 当前所在的批次；镜像与否变化时会换批 */
  batch: PrimitiveInstanceBatch | null
  /** 换批时要把颜色带过去 */
  color: string
  /** 该物体不可见的自有网格：实例按它的世界矩阵摆放 */
  readonly source: Object3D
  /** 物体根 group，合批期间由合批负责更新它的矩阵 */
  readonly root: Object3D
}

const scratchColor = new Color()
const scratchMatrix = new Matrix4()
/** 镜像批次网格自身的变换，也是它的逆：实例矩阵先乘它，叠上网格变换后还原成物体的世界矩阵。 */
const MIRROR = new Matrix4().makeScale(-1, 1, 1)

function skipWorldMatrixUpdate(): void {}

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
      ? scratchMatrix.multiplyMatrices(MIRROR, slot.source.matrixWorld)
      : slot.source.matrixWorld
    matrix.toArray(this.mesh.instanceMatrix.array, slot.index * 16)
    this.mesh.instanceMatrix.needsUpdate = true
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

  private syncCount(): void {
    this.mesh.count = this.slots.length
    this.mesh.visible = this.slots.length > 0
  }

  private createMesh(capacity: number): InstancedMesh {
    const mesh = new InstancedMesh(this.geometry, this.material, capacity)
    mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3)
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

  /**
   * 物体进入合批：three 每次出帧都把整棵场景的矩阵重算一遍，上万个物体的容器节点光这一步
   * 每个窗格就要十几毫秒。合批物体只会经 React 提交或播放写入移动，两条路都会记脏，
   * 所以容器节点跳过逐帧更新，改由 flushSlots 只重算记脏的那些。
   */
  acquireSlot(kind: StagePrimitiveKind, source: Object3D, root: Object3D): StagePrimitiveSlot {
    const slot: StagePrimitiveSlot = { kind, index: -1, batch: null, color: 'white', source, root }
    // 先进正向批次；是否镜像要等 flushSlots 算出世界矩阵才知道，同一次出帧里就会换过去
    this.batchFor(kind, false).add(slot)
    root.updateMatrixWorld = skipWorldMatrixUpdate
    this.dirtySlots.add(slot)
    return slot
  }

  /** 退出合批（选中、隐藏、删除）：容器节点恢复逐帧矩阵更新，gizmo 拖动照常生效。 */
  releaseSlot(slot: StagePrimitiveSlot): void {
    if (!slot.batch) return
    slot.batch.remove(slot)
    this.dirtySlots.delete(slot)
    if (slot.root.updateMatrixWorld === skipWorldMatrixUpdate) {
      delete (slot.root as Partial<Pick<Object3D, 'updateMatrixWorld'>>).updateMatrixWorld
    }
  }

  /** 变换只记脏，出帧前统一重算：播放时位置、旋转、缩放各写一次，立即重算会算三遍。 */
  markSlotDirty(slot: StagePrimitiveSlot): void {
    if (slot.batch) this.dirtySlots.add(slot)
  }

  setSlotColor(slot: StagePrimitiveSlot, color: string): void {
    slot.color = color
    slot.batch?.writeColor(slot, color)
  }

  /** 在场景矩阵更新之后、裁剪与上传之前调用（Scene.onBeforeRender）。 */
  flushSlots(): void {
    if (this.dirtySlots.size === 0) return
    for (const slot of this.dirtySlots) {
      if (!slot.batch) continue
      Object3D.prototype.updateMatrixWorld.call(slot.root, true)
      // 缩放过零（gizmo 拖过中心、助手写负值、关键帧插值）会让物体在正向与镜像之间切换
      const mirrored = slot.source.matrixWorld.determinant() < 0
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
export const StagePrimitiveResourcesProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
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
  return React.createElement(
    StagePrimitiveResourcesContext.Provider,
    { value: resources },
    React.createElement('primitive', { object: resources.batchRoot }),
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
