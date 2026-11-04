import React, { Suspense, useEffect, useMemo } from 'react'
import { useGLTF } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import {
  Color,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  MeshStandardMaterial,
  type BufferGeometry,
  type Material,
  type Mesh,
  type WebGLProgramParametersWithUniforms,
} from 'three'

import {
  CAMERA_STAGE_SET_CANOPY_PALETTE_HEX,
  CAMERA_STAGE_SET_DECOR_HEX,
  CAMERA_STAGE_SET_VEHICLE_PALETTE_HEX,
} from '@/core/theme/colorTokens'
import { createLogger } from '@/core/logging'

import { STAGE_SET_DECOR_STRIDE, STAGE_SET_MARKING_KINDS, STAGE_SET_SURFACE_KINDS, type StageSet, type StageSetMarkingKind, type StageSetSurfaceKind } from '../domain/sceneTypes'
import { STREET_TREE_VARIANTS, VEHICLE_TYPES } from '../domain/stageSetProps'
import { STAGE_STYLE_HIDDEN_KEY, STAGE_STYLE_SUBJECT_KEY } from '../render/stageStyleTags'
import {
  MARKING_STYLES,
  lampHeadGeometry,
  lampPoleGeometry,
  markingGeometry,
  markingInstances,
  propInstances,
  surfaceGeometry,
  surfaceInstances,
  vehicleGeometry,
  type InstanceList,
} from './stageSetDecorGeometry'
import { STREET_TREE_ASSET_ID, useStreetTreeModel } from './useCharacterModelUrl'

/*
 * 布景装饰层：地面铺装、标线、行道树、路灯与车辆。每一类东西不论几片布景都只建一个实例网格，
 * 一座上万栋楼的城市连同几万个参照物也只有几十次绘制。装饰不是场景对象，点不中、不挡点选；
 * 只在布景生成、删除、撤销时整体重建。
 */

const logger = createLogger('features.cameraStage.setDecor')

const SURFACE_COLORS: Record<StageSetSurfaceKind, string> = {
  road: CAMERA_STAGE_SET_DECOR_HEX.road,
  sidewalk: CAMERA_STAGE_SET_DECOR_HEX.sidewalk,
  curb: CAMERA_STAGE_SET_DECOR_HEX.curb,
  median: CAMERA_STAGE_SET_DECOR_HEX.median,
  lawn: CAMERA_STAGE_SET_DECOR_HEX.lawn,
  plaza: CAMERA_STAGE_SET_DECOR_HEX.plaza,
}

/** 铺装层层相叠、彼此只差几厘米；远处深度精度不够时靠多边形偏移决定谁在上面。 */
const SURFACE_OFFSET: Record<StageSetSurfaceKind, number> = { road: -1, sidewalk: -2, plaza: -2, curb: -3, lawn: -3, median: -2 }

function decorMesh(geometry: BufferGeometry, material: Material, list: InstanceList, options: { subject?: boolean; hidden?: boolean; palette?: readonly string[] } = {}): InstancedMesh | null {
  if (list.count === 0) return null
  const mesh = new InstancedMesh(geometry, material, list.count)
  mesh.instanceMatrix.array.set(list.matrices.subarray(0, list.count * 16))
  mesh.instanceMatrix.needsUpdate = true
  if (options.palette && list.colors) {
    const colors = new Float32Array(list.count * 3)
    const color = new Color()
    for (let index = 0; index < list.count; index += 1) {
      color.set(options.palette[list.colors[index] % options.palette.length]).toArray(colors, index * 3)
    }
    mesh.instanceColor = new InstancedBufferAttribute(colors, 3)
  }
  mesh.computeBoundingSphere()
  mesh.computeBoundingBox()
  if (options.subject) mesh.userData[STAGE_STYLE_SUBJECT_KEY] = true
  // 标线是涂在路面上的漆，深度、法线、线稿画面里不该成为几何。
  if (options.hidden) mesh.userData[STAGE_STYLE_HIDDEN_KEY] = true
  // 不参与点选：射线会先打中树冠与路面，点不到后面的楼与角色。
  mesh.raycast = () => {}
  return mesh
}

/** 虚线与斑马纹：按实例 Z 向缩放（线长）算出沿线位置，落在间隔里的片元丢掉。 */
function markingMaterial(kind: StageSetMarkingKind): MeshStandardMaterial {
  const style = MARKING_STYLES[kind]
  const material = new MeshStandardMaterial({
    color: kind === 'centerLine' ? CAMERA_STAGE_SET_DECOR_HEX.centerLine : CAMERA_STAGE_SET_DECOR_HEX.marking,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  })
  if (style.period > 0) {
    material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
      shader.uniforms.uDashPeriod = { value: style.period }
      shader.uniforms.uDashOn = { value: style.on }
      shader.vertexShader = `varying float vDash;\n${shader.vertexShader}`.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vDash = (position.z + 0.5) * length(instanceMatrix[2].xyz);
        #else
          vDash = 0.0;
        #endif`,
      )
      shader.fragmentShader = `varying float vDash;\nuniform float uDashPeriod;\nuniform float uDashOn;\n${shader.fragmentShader}`.replace(
        '#include <clipping_planes_fragment>',
        '#include <clipping_planes_fragment>\n  if (mod(vDash, uDashPeriod) > uDashOn) discard;',
      )
    }
    material.customProgramCacheKey = () => 'camera-stage-dashed-marking'
  }
  return material
}

interface BuiltDecor { group: Group; dispose: () => void }

/** 铺装、标线、路灯、车辆：几何体都是现算的，跟着这一组网格一起释放。 */
function buildStaticDecor(sets: readonly StageSet[]): BuiltDecor {
  const group = new Group()
  const geometries: BufferGeometry[] = []
  const materials: Material[] = []
  const add = (mesh: InstancedMesh | null): void => { if (mesh) group.add(mesh) }
  const own = <T extends BufferGeometry | Material>(value: T): T => {
    if ((value as BufferGeometry).isBufferGeometry) geometries.push(value as BufferGeometry)
    else materials.push(value as Material)
    return value
  }

  const box = own(surfaceGeometry())
  for (const kind of STAGE_SET_SURFACE_KINDS) {
    const material = own(new MeshStandardMaterial({ color: SURFACE_COLORS[kind], polygonOffset: true, polygonOffsetFactor: SURFACE_OFFSET[kind], polygonOffsetUnits: SURFACE_OFFSET[kind] * 2 }))
    add(decorMesh(box, material, surfaceInstances(sets, kind)))
  }
  const plane = own(markingGeometry())
  for (const kind of STAGE_SET_MARKING_KINDS) add(decorMesh(plane, own(markingMaterial(kind)), markingInstances(sets, kind), { hidden: true }))

  const lampStride = STAGE_SET_DECOR_STRIDE.lamp
  // 杆按杆高纵向拉伸；灯头不拉伸，挂到杆顶。
  const [poles] = propInstances(sets, set => set.decor?.lamps, lampStride, null, 1, (values, offset) => ({ yaw: values[offset + 2], scale: 1, scaleY: values[offset + 3] }), null)
  const [heads] = propInstances(sets, set => set.decor?.lamps, lampStride, null, 1, (values, offset) => ({ yaw: values[offset + 2], scale: 1, y: values[offset + 3] }), null)
  add(decorMesh(own(lampPoleGeometry()), own(new MeshStandardMaterial({ color: CAMERA_STAGE_SET_DECOR_HEX.lampPole })), poles, { subject: true }))
  add(decorMesh(own(lampHeadGeometry()), own(new MeshStandardMaterial({ color: CAMERA_STAGE_SET_DECOR_HEX.lampHead })), heads, { subject: true }))

  const vehicleStride = STAGE_SET_DECOR_STRIDE.vehicle
  const vehicles = propInstances(sets, set => set.decor?.vehicles, vehicleStride, 3, VEHICLE_TYPES.length, (values, offset) => ({ yaw: values[offset + 2], scale: 1 }), 4)
  const bodyMaterial = own(new MeshStandardMaterial({ color: 0xffffff }))
  const glassMaterial = own(new MeshStandardMaterial({ color: CAMERA_STAGE_SET_DECOR_HEX.vehicleGlass, roughness: 0.35 }))
  const tireMaterial = own(new MeshStandardMaterial({ color: CAMERA_STAGE_SET_DECOR_HEX.vehicleTire }))
  VEHICLE_TYPES.forEach((type, index) => {
    const list = vehicles[index]
    if (list.count === 0) return
    const geometry = vehicleGeometry(type)
    add(decorMesh(own(geometry.body), bodyMaterial, list, { subject: true, palette: CAMERA_STAGE_SET_VEHICLE_PALETTE_HEX }))
    add(decorMesh(own(geometry.glass), glassMaterial, list, { subject: true }))
    add(decorMesh(own(geometry.wheels), tireMaterial, list, { subject: true }))
  })

  return {
    group,
    dispose: () => {
      for (const child of group.children) (child as InstancedMesh).dispose()
      for (const geometry of geometries) geometry.dispose()
      for (const material of materials) material.dispose()
    },
  }
}

/** 行道树：树干与树冠两个网格一种树，模型来自预生成的 GLB（几何体随 useGLTF 缓存，不在这里释放）。 */
function StreetTrees({ sets, url, onReady }: { sets: readonly StageSet[]; url: string; onReady?: (id: string, error?: unknown) => void }): React.ReactElement {
  const gltf = useGLTF(url)
  const invalidate = useThree(state => state.invalidate)
  const built = useMemo<BuiltDecor>(() => {
    const group = new Group()
    const trunkMaterial = new MeshStandardMaterial({ color: CAMERA_STAGE_SET_DECOR_HEX.trunk })
    const canopyMaterial = new MeshStandardMaterial({ color: 0xffffff, flatShading: true })
    const stride = STAGE_SET_DECOR_STRIDE.tree
    const lists = propInstances(sets, set => set.decor?.trees, stride, 4, STREET_TREE_VARIANTS.length, (values, offset) => ({ yaw: values[offset + 2], scale: values[offset + 3] }), null)
    STREET_TREE_VARIANTS.forEach((variant, index) => {
      const list = lists[index]
      const trunk = gltf.scene.getObjectByName(`tree-${variant}-trunk`) as Mesh | undefined
      const canopy = gltf.scene.getObjectByName(`tree-${variant}-canopy`) as Mesh | undefined
      if (!trunk || !canopy || list.count === 0) return
      // 树冠逐棵轮换几档绿
      list.colors = Uint8Array.from({ length: list.count }, (_, tree) => (tree * 7 + index) % CAMERA_STAGE_SET_CANOPY_PALETTE_HEX.length)
      const trunkMesh = decorMesh(trunk.geometry, trunkMaterial, list, { subject: true })
      const canopyMesh = decorMesh(canopy.geometry, canopyMaterial, list, { subject: true, palette: CAMERA_STAGE_SET_CANOPY_PALETTE_HEX })
      if (trunkMesh) group.add(trunkMesh)
      if (canopyMesh) group.add(canopyMesh)
    })
    return {
      group,
      dispose: () => {
        for (const child of group.children) (child as InstancedMesh).dispose()
        trunkMaterial.dispose()
        canopyMaterial.dispose()
      },
    }
  }, [gltf, sets])
  useEffect(() => () => built.dispose(), [built])
  useEffect(() => {
    invalidate()
    onReady?.(STREET_TREE_ASSET_ID)
  }, [built, invalidate, onReady])
  return <primitive object={built.group} />
}

class TreeErrorBoundary extends React.Component<{ children: React.ReactNode; onError: (error: unknown) => void }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  componentDidCatch(error: unknown): void {
    this.props.onError(error)
  }

  render(): React.ReactNode {
    return this.state.failed ? null : this.props.children
  }
}

const StageSetDecorLayer: React.FC<{ sets: readonly StageSet[]; onAssetReady?: (id: string, error?: unknown) => void }> = ({ sets, onAssetReady }) => {
  const invalidate = useThree(state => state.invalidate)
  const decorated = useMemo(() => sets.filter(set => set.decor), [sets])
  const built = useMemo(() => buildStaticDecor(decorated), [decorated])
  useEffect(() => () => built.dispose(), [built])
  useEffect(() => { invalidate() }, [built, invalidate])
  const tree = useStreetTreeModel()
  const hasTrees = decorated.some(set => (set.decor?.trees.length ?? 0) > 0)
  useEffect(() => {
    // 资源解析失败时没有树可画，照常出图，不让后台渲染一直等下去。
    if (hasTrees && tree.settled && !tree.url) onAssetReady?.(STREET_TREE_ASSET_ID)
  }, [hasTrees, onAssetReady, tree.settled, tree.url])
  return (
    <>
      <primitive object={built.group} />
      {hasTrees && tree.url && (
        <TreeErrorBoundary onError={(error) => {
          // 树只是比例参照：模型坏了照常出图（与地址解析失败一致），不让整次导出失败。
          logger.warn('行道树模型加载失败，布景照常显示其余部分', { event: 'camera_stage.set_decor.trees.failed', context: { reason: error instanceof Error ? error.message : String(error) } })
          onAssetReady?.(STREET_TREE_ASSET_ID)
        }}>
          <Suspense fallback={null}>
            <StreetTrees sets={decorated} url={tree.url} onReady={onAssetReady} />
          </Suspense>
        </TreeErrorBoundary>
      )}
    </>
  )
}

export default StageSetDecorLayer
