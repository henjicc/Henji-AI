import React, { useState } from 'react'
import { Canvas } from '@react-three/fiber'
import type { ThreeEvent } from '@react-three/fiber'
import { Grid, OrbitControls, TransformControls } from '@react-three/drei'
import type { Object3D } from 'three'
import { UiOptionButton } from '@/components/ui'
import { CAMERA_STAGE_COLOR_HEX } from '@/core/theme/colorTokens'

/**
 * 运镜控制 1.1 技术验证组件（临时代码）
 *
 * 只用于验证 three.js + @react-three/fiber + @react-three/drei 在
 * Electron sandbox 环境下的渲染与交互可行性，验证通过后按 2.1 的
 * 正式数据模型重写，不保留本文件结构。
 */

type GizmoMode = 'translate' | 'rotate' | 'scale'

const GIZMO_MODES: Array<{ id: GizmoMode; label: string }> = [
  { id: 'translate', label: '移动' },
  { id: 'rotate', label: '旋转' },
  { id: 'scale', label: '缩放' },
]

const CameraStageVerify: React.FC = () => {
  const [selected, setSelected] = useState<Object3D | null>(null)
  const [mode, setMode] = useState<GizmoMode>('translate')

  const handleSelect = (event: ThreeEvent<MouseEvent>): void => {
    event.stopPropagation()
    setSelected(event.eventObject)
  }

  return (
    <div className="relative flex-1 h-full bg-app">
      <Canvas
        camera={{ position: [4, 3, 6], fov: 50 }}
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
          fadeDistance={30}
        />
        <mesh name="验证立方体" position={[-1.2, 0.5, 0]} onClick={handleSelect}>
          <boxGeometry args={[1, 1, 1]} />
          <meshStandardMaterial color={CAMERA_STAGE_COLOR_HEX.objectWarm} />
        </mesh>
        <mesh name="验证球体" position={[1.2, 0.75, 0]} onClick={handleSelect}>
          <sphereGeometry args={[0.75, 32, 32]} />
          <meshStandardMaterial color={CAMERA_STAGE_COLOR_HEX.objectCool} />
        </mesh>
        {selected && <TransformControls object={selected} mode={mode} />}
        <OrbitControls makeDefault />
      </Canvas>
      <div className="absolute left-4 top-4 flex flex-col gap-2">
        <div className="flex gap-2">
          {GIZMO_MODES.map((item) => (
            <UiOptionButton
              key={item.id}
              active={mode === item.id}
              onClick={() => setMode(item.id)}
            >
              {item.label}
            </UiOptionButton>
          ))}
        </div>
        <div className="text-xs text-text-muted">
          {selected
            ? `已选中：${selected.name}（拖拽 gizmo 变换，点空白处取消选中）`
            : '左键点击物体选中，左键拖拽环绕，滚轮缩放，右键拖拽平移'}
        </div>
      </div>
    </div>
  )
}

export default CameraStageVerify
