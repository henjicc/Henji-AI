import React, { Suspense, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import type { ThreeEvent } from '@react-three/fiber'
import { BufferGeometry, Vector3 } from 'three'
import type { Group } from 'three'
import type {
  StageCameraObject,
  StageCharacterObject,
  StageObject,
  StagePrimitiveKind,
  StageVec3,
} from '../domain/sceneTypes'
import CameraModel from './CameraModel'
import CharacterModel from './CharacterModel'
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
  /** 机位视角下隐藏相机图标/视锥体，避免编辑辅助进入实际取景画面 */
  showCameraHelpers: boolean
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
  lookAtTarget: StageVec3
}> = ({ object, selected, lookAtTarget }) => {
  const helperRef = useRef<Group>(null)
  const modelUrl = useCameraModelUrl()
  const target = useMemo(
    () => new Vector3(lookAtTarget.x, lookAtTarget.y, lookAtTarget.z),
    [lookAtTarget.x, lookAtTarget.y, lookAtTarget.z],
  )
  const frustumGeometry = useMemo(() => {
    const distance = 1.1
    const fov = Math.min(120, Math.max(10, object.fov)) * DEG2RAD
    const halfHeight = Math.tan(fov / 2) * distance
    const halfWidth = halfHeight * 1.55
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
  }, [object.fov])

  useEffect(() => () => frustumGeometry.dispose(), [frustumGeometry])

  useLayoutEffect(() => {
    helperRef.current?.lookAt(target)
  }, [target])

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
    <group ref={helperRef}>
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
}) => {
  const groupRef = useRef<Group>(null)
  const { transform } = object

  useEffect(() => {
    onRegister(object.id, groupRef.current)
    return () => onRegister(object.id, null)
  }, [object.id, onRegister])

  const handleClick = (event: ThreeEvent<MouseEvent>): void => {
    event.stopPropagation()
    onSelect(object.id)
  }

  return (
      <group
        ref={groupRef}
        name={object.id}
        visible={object.visible}
        position={[transform.position.x, transform.position.y, transform.position.z]}
        rotation={object.type === 'camera'
          ? [0, 0, 0]
          : [
              transform.rotation.x * DEG2RAD,
              transform.rotation.y * DEG2RAD,
              transform.rotation.z * DEG2RAD,
            ]}
        scale={object.type === 'camera' ? [1, 1, 1] : [transform.scale.x, transform.scale.y, transform.scale.z]}
      >
        {object.type === 'primitive' && (
          <mesh onClick={handleClick}>
            <PrimitiveGeometry kind={object.kind} />
            <StageMaterial color={object.color} selected={selected} />
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
              lookAtTarget={cameraLookAtTarget}
            />
          </group>
        )}
      </group>
  )
}

export default StageObjectMesh
