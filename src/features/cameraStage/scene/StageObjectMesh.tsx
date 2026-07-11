import React, { Suspense, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import type { ThreeEvent } from '@react-three/fiber'
import { BufferGeometry, Vector3 } from 'three'
import type { Group, MeshStandardMaterial } from 'three'
import { registerPlaybackApplier } from '../store/playbackAppliers'
import { rotationFromPositionAndTarget } from '../domain/cameraUtils'
import type {
  StageCameraObject,
  StageCharacterObject,
  StageNameLabelSettings,
  StageObject,
  StagePrimitiveKind,
  StageVec3,
} from '../domain/sceneTypes'
import CameraModel from './CameraModel'
import CharacterModel from './CharacterModel'
import StageObjectNameLabel from './StageObjectNameLabel'
import { useCameraModelUrl, useCharacterModelUrl } from './useCharacterModelUrl'

/**
 * 单个场景对象的三维渲染：
 * - primitive 按 kind 渲染基础几何体
 * - character 渲染内置骨骼模型（加载中/加载失败/非桌面运行时回退占位模型）
 * - camera 在 2.3 之前渲染为占位模型
 */

const DEG2RAD = Math.PI / 180

interface StageObjectMeshProps {
  object: StageObject
  selected: boolean
  onSelect: (id: string) => void
  /** 挂载/卸载时向场景注册 three.js 节点，供 TransformControls 使用 */
  onRegister: (id: string, node: Group | null) => void
  /** 相机对象的实际注视点；仅 camera 类型需要 */
  cameraLookAtTarget?: StageVec3
  /** 摄像机视角下隐藏相机图标/视锥体，避免编辑辅助进入实际取景画面 */
  showCameraHelpers: boolean
  /** 场景级名称标签开关；激活后在对象上方渲染朝向摄像机的标签 */
  showNameLabel: boolean
  nameLabelSettings: StageNameLabelSettings
}

const PrimitiveGeometry: React.FC<{ kind: StagePrimitiveKind }> = ({ kind }) => {
  switch (kind) {
    case 'sphere':
      return <sphereGeometry args={[0.5, 32, 32]} />
    case 'cylinder':
      return <cylinderGeometry args={[0.5, 0.5, 1, 32]} />
    case 'cone':
      return <coneGeometry args={[0.5, 1, 32]} />
    case 'pyramid':
      return <coneGeometry args={[0.6, 1, 4]} />
    case 'torus':
      return <torusGeometry args={[0.5, 0.2, 16, 48]} />
    case 'box':
    default:
      return <boxGeometry args={[1, 1, 1]} />
  }
}

const StageMaterial: React.FC<{ color: string; selected: boolean }> = ({ color, selected }) => (
  <meshStandardMaterial
    color={color}
    emissive={color}
    emissiveIntensity={selected ? 0.35 : 0}
  />
)

/** 角色占位模型：胶囊身体 + 球形头，总高约 1.7（模型加载中/失败时的回退渲染） */
const CharacterPlaceholder: React.FC<{ color: string; selected: boolean }> = ({ color, selected }) => (
  <>
    <mesh position={[0, 0.7, 0]}>
      <capsuleGeometry args={[0.22, 0.95, 8, 16]} />
      <StageMaterial color={color} selected={selected} />
    </mesh>
    <mesh position={[0, 1.5, 0]}>
      <sphereGeometry args={[0.18, 24, 24]} />
      <StageMaterial color={color} selected={selected} />
    </mesh>
  </>
)

/** 模型加载失败时回退占位渲染，避免单个角色资源问题拖垮整个三维视图 */
class CharacterErrorBoundary extends React.Component<
  { fallback: React.ReactNode; children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  render(): React.ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

const CharacterMesh: React.FC<{ object: StageCharacterObject; selected: boolean }> = ({ object, selected }) => {
  const modelUrl = useCharacterModelUrl()
  const placeholder = <CharacterPlaceholder color={object.color} selected={selected} />

  if (!modelUrl) {
    return placeholder
  }
  return (
    <CharacterErrorBoundary fallback={placeholder}>
      <Suspense fallback={placeholder}>
        <CharacterModel object={object} selected={selected} url={modelUrl} />
      </Suspense>
    </CharacterErrorBoundary>
  )
}

const CameraHelperMesh: React.FC<{
  object: StageCameraObject
  selected: boolean
}> = ({ object, selected }) => {
  const modelUrl = useCameraModelUrl()
  const frustumGeometry = useMemo(() => {
    const distance = 1.1
    const fov = Math.min(120, Math.max(10, object.fov)) * DEG2RAD
    const halfHeight = Math.tan(fov / 2) * distance
    const halfWidth = halfHeight * object.aspectRatio.ratio
    const origin = new Vector3(0, 0, 0)
    const corners = [
      new Vector3(-halfWidth, halfHeight, distance),
      new Vector3(halfWidth, halfHeight, distance),
      new Vector3(halfWidth, -halfHeight, distance),
      new Vector3(-halfWidth, -halfHeight, distance),
    ]
    const points = [
      origin, corners[0],
      origin, corners[1],
      origin, corners[2],
      origin, corners[3],
      corners[0], corners[1],
      corners[1], corners[2],
      corners[2], corners[3],
      corners[3], corners[0],
    ]
    return new BufferGeometry().setFromPoints(points)
  }, [object.fov, object.aspectRatio.ratio])

  useEffect(() => () => frustumGeometry.dispose(), [frustumGeometry])

  const placeholder = (
    <>
      <mesh position={[0, 0, 0]}>
        <boxGeometry args={[0.82, 0.46, 0.24]} />
        <StageMaterial color={object.color} selected={selected} />
      </mesh>
      <mesh position={[-0.2, 0.41, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.2, 0.2, 0.1, 32]} />
        <StageMaterial color={object.color} selected={selected} />
      </mesh>
      <mesh position={[0.2, 0.41, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.2, 0.2, 0.1, 32]} />
        <StageMaterial color={object.color} selected={selected} />
      </mesh>
      <mesh position={[0, 0, 0.34]} rotation={[Math.PI / 2, 0, Math.PI / 4]}>
        <cylinderGeometry args={[0.27, 0.14, 0.44, 4, 1, false]} />
        <StageMaterial color={object.color} selected={selected} />
      </mesh>
    </>
  )

  return (
    <group>
      {modelUrl ? (
        <CharacterErrorBoundary fallback={placeholder}>
          <Suspense fallback={placeholder}>
            <CameraModel object={object} selected={selected} url={modelUrl} />
          </Suspense>
        </CharacterErrorBoundary>
      ) : placeholder}
      <lineSegments geometry={frustumGeometry}>
        <lineBasicMaterial
          color={object.color}
          transparent
          opacity={selected ? 1 : 0.7}
        />
      </lineSegments>
    </group>
  )
}

const StageObjectMesh: React.FC<StageObjectMeshProps> = ({
  object,
  selected,
  onSelect,
  onRegister,
  cameraLookAtTarget,
  showCameraHelpers,
  showNameLabel,
  nameLabelSettings,
}) => {
  const groupRef = useRef<Group>(null)
  const contentRef = useRef<Group>(null)
  const materialRef = useRef<MeshStandardMaterial>(null)
  const { transform } = object

  useEffect(() => {
    onRegister(object.id, groupRef.current)
    return () => onRegister(object.id, null)
  }, [object.id, onRegister])

  // 摄像机旋转数据是 YXZ 语义（与 rotationFromPositionAndTarget 一致）；改顺序后 three.js 会用
  // 现有欧拉值重算四元数，因此在首帧绘制前声明即可，后续 rotation.set / gizmo 读写都沿用该顺序
  useLayoutEffect(() => {
    const group = groupRef.current
    if (!group || object.type !== 'camera') return
    group.rotation.order = 'YXZ'
  }, [object.type])

  // 播放期命令式采样：变换直改本对象容器 group，颜色直改 primitive 材质（不写 store）
  useEffect(() => {
    const unregs: Array<() => void> = []
    unregs.push(
      registerPlaybackApplier(object.id, 'transform.position', (value) => {
        const group = groupRef.current
        if (!group) return
        const v = value as StageVec3
        group.position.set(v.x, v.y, v.z)
      }),
    )
    unregs.push(
      registerPlaybackApplier(object.id, 'transform.rotation', (value) => {
        const group = groupRef.current
        if (!group) return
        const v = value as StageVec3
        group.rotation.set(v.x * DEG2RAD, v.y * DEG2RAD, v.z * DEG2RAD)
      }),
    )
    if (object.type !== 'camera') {
      unregs.push(
        registerPlaybackApplier(object.id, 'transform.scale', (value) => {
          const group = groupRef.current
          if (!group) return
          const v = value as StageVec3
          group.scale.set(v.x, v.y, v.z)
        }),
      )
    }
    if (object.type === 'primitive') {
      unregs.push(
        registerPlaybackApplier(object.id, 'color', (value) => {
          const material = materialRef.current
          if (!material) return
          material.color.set(value as string)
          material.emissive.set(value as string)
        }),
      )
    }
    return () => unregs.forEach((unregister) => unregister())
  }, [object.id, object.type])

  const handleClick = (event: ThreeEvent<MouseEvent>): void => {
    event.stopPropagation()
    onSelect(object.id)
  }

  const renderedRotation = object.type === 'camera' && object.lookAt.mode === 'object' && cameraLookAtTarget
    ? rotationFromPositionAndTarget(transform.position, cameraLookAtTarget, transform.rotation.z)
    : transform.rotation

  return (
      <group
        ref={groupRef}
        name={object.id}
        visible={object.visible}
        position={[transform.position.x, transform.position.y, transform.position.z]}
        rotation={[
          renderedRotation.x * DEG2RAD,
          renderedRotation.y * DEG2RAD,
          renderedRotation.z * DEG2RAD,
        ]}
        scale={object.type === 'camera' ? [1, 1, 1] : [transform.scale.x, transform.scale.y, transform.scale.z]}
      >
        <group ref={contentRef}>
          {object.type === 'primitive' && (
            <mesh onClick={handleClick}>
              <PrimitiveGeometry kind={object.kind} />
              <meshStandardMaterial
                ref={materialRef}
                color={object.color}
                emissive={object.color}
                emissiveIntensity={selected ? 0.35 : 0}
              />
            </mesh>
          )}
          {object.type === 'character' && (
            <group onClick={handleClick}>
              <CharacterMesh object={object} selected={selected} />
            </group>
          )}
          {object.type === 'camera' && showCameraHelpers && cameraLookAtTarget && (
            <group onClick={handleClick}>
              <CameraHelperMesh
                object={object}
                selected={selected}
              />
            </group>
          )}
        </group>
        {showNameLabel && (
          <StageObjectNameLabel
            object={object}
            targetRef={contentRef}
            settings={nameLabelSettings}
          />
        )}
      </group>
  )
}

export default StageObjectMesh
