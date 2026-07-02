import React, { useCallback, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { Grid, OrbitControls, TransformControls } from '@react-three/drei'
import type { Group } from 'three'
import { CAMERA_STAGE_COLOR_HEX } from '@/core/theme/colorTokens'
import { useCameraStageStore } from '../store/cameraStageStore'
import StageObjectMesh from './StageObjectMesh'

/**
 * 场景三维视图：数据驱动渲染 store 中的对象列表，
 * 选中对象挂 TransformControls，拖拽 gizmo 后把变换写回 store。
 */

const RAD2DEG = 180 / Math.PI

const StageScene: React.FC = () => {
  const objects = useCameraStageStore((state) => state.objects)
  const selectedId = useCameraStageStore((state) => state.selectedId)
  const gizmoMode = useCameraStageStore((state) => state.gizmoMode)
  const setSelected = useCameraStageStore((state) => state.setSelected)
  const updateTransform = useCameraStageStore((state) => state.updateTransform)

  // 节点注册表用 state 而不是 ref：新对象"添加即选中"时，必须等它挂载注册后
  // 触发一次重渲染，TransformControls 才能立刻拿到节点（ref 版本不会重渲染，
  // 表现为刚添加的对象要点别处再点回来 gizmo 才出现）
  const [objectNodes, setObjectNodes] = useState<ReadonlyMap<string, Group>>(new Map())
  const objectNodesRef = useRef(objectNodes)
  objectNodesRef.current = objectNodes

  const registerNode = useCallback((id: string, node: Group | null): void => {
    setObjectNodes((prev) => {
      if (node ? prev.get(id) === node : !prev.has(id)) return prev
      const next = new Map(prev)
      if (node) {
        next.set(id, node)
      } else {
        next.delete(id)
      }
      return next
    })
  }, [])

  const handleGizmoChange = useCallback((): void => {
    const id = useCameraStageStore.getState().selectedId
    if (!id) return
    const node = objectNodesRef.current.get(id)
    if (!node) return
    updateTransform(id, {
      position: { x: node.position.x, y: node.position.y, z: node.position.z },
      rotation: {
        x: node.rotation.x * RAD2DEG,
        y: node.rotation.y * RAD2DEG,
        z: node.rotation.z * RAD2DEG,
      },
      scale: { x: node.scale.x, y: node.scale.y, z: node.scale.z },
    })
  }, [updateTransform])

  const selectedNode = selectedId ? objectNodes.get(selectedId) : undefined

  return (
    <Canvas
      camera={{ position: [5, 4, 7], fov: 50 }}
      style={{ background: CAMERA_STAGE_COLOR_HEX.stageBg }}
      onPointerMissed={() => setSelected(null)}
    >
      <ambientLight intensity={0.6} />
      <directionalLight position={[5, 8, 4]} intensity={1.2} />
      <Grid
        infiniteGrid
        cellSize={0.5}
        sectionSize={2.5}
        cellColor={CAMERA_STAGE_COLOR_HEX.gridCell}
        sectionColor={CAMERA_STAGE_COLOR_HEX.gridSection}
        fadeDistance={40}
      />
      {objects.map((object) => (
        <StageObjectMesh
          key={object.id}
          object={object}
          selected={object.id === selectedId}
          onSelect={setSelected}
          onRegister={registerNode}
        />
      ))}
      {selectedNode && (
        <TransformControls
          object={selectedNode}
          mode={gizmoMode}
          onObjectChange={handleGizmoChange}
        />
      )}
      <OrbitControls makeDefault />
    </Canvas>
  )
}

export default StageScene
