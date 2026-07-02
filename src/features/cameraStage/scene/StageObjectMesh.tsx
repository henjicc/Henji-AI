import React, { useEffect, useRef } from 'react'
import type { ThreeEvent } from '@react-three/fiber'
import type { Group } from 'three'
import type { StageObject, StagePrimitiveKind } from '../domain/sceneTypes'

/**
 * 单个场景对象的三维渲染：
 * - primitive 按 kind 渲染基础几何体
 * - character/camera 在 2.1 阶段渲染为占位模型，分别由 2.2/2.3 替换为真实实现
 */

const DEG2RAD = Math.PI / 180

interface StageObjectMeshProps {
  object: StageObject
  selected: boolean
  onSelect: (id: string) => void
  /** 挂载/卸载时向场景注册 three.js 节点，供 TransformControls 使用 */
  onRegister: (id: string, node: Group | null) => void
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

const StageObjectMesh: React.FC<StageObjectMeshProps> = ({ object, selected, onSelect, onRegister }) => {
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
        rotation={[
          transform.rotation.x * DEG2RAD,
          transform.rotation.y * DEG2RAD,
          transform.rotation.z * DEG2RAD,
        ]}
        scale={[transform.scale.x, transform.scale.y, transform.scale.z]}
      >
        {object.type === 'primitive' && (
          <mesh onClick={handleClick}>
            <PrimitiveGeometry kind={object.kind} />
            <StageMaterial color={object.color} selected={selected} />
          </mesh>
        )}
        {object.type === 'character' && (
          // 2.2 之前的角色占位：胶囊身体 + 球形头，总高约 1.7（贴近真人比例）
          <group onClick={handleClick}>
            <mesh position={[0, 0.7, 0]}>
              <capsuleGeometry args={[0.22, 0.95, 8, 16]} />
              <StageMaterial color={object.color} selected={selected} />
            </mesh>
            <mesh position={[0, 1.5, 0]}>
              <sphereGeometry args={[0.18, 24, 24]} />
              <StageMaterial color={object.color} selected={selected} />
            </mesh>
          </group>
        )}
        {object.type === 'camera' && (
          // 2.3 之前的机位占位：机身 + 指向 -Z（three.js 相机朝向约定）的镜头锥
          <group onClick={handleClick}>
            <mesh>
              <boxGeometry args={[0.45, 0.32, 0.5]} />
              <StageMaterial color={object.color} selected={selected} />
            </mesh>
            <mesh position={[0, 0, -0.42]} rotation={[-Math.PI / 2, 0, 0]}>
              <coneGeometry args={[0.16, 0.35, 24]} />
              <StageMaterial color={object.color} selected={selected} />
            </mesh>
          </group>
        )}
      </group>
  )
}

export default StageObjectMesh
