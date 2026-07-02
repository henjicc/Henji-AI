import React, { useCallback, useRef } from 'react'
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

  const objectNodesRef = useRef(new Map<string, Group>())

  const registerNode = useCallback((id: string, node: Group | null): void => {
    if (node) {
      objectNodesRef.current.set(id, node)
    } else {
      objectNodesRef.current.delete(id)
    }
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

  const selectedNode = selectedId ? objectNodesRef.current.get(selectedId) : undefined

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
          ref={(node) => registerNode(object.id, node)}
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
