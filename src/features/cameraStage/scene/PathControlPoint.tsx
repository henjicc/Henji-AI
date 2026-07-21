import React, { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import type { ThreeEvent } from '@react-three/fiber'
import { Plane, Vector3 } from 'three'
import type { Group, Ray } from 'three'
import { CAMERA_STAGE_MOTION_PATH_HEX } from '@/core/theme/colorTokens'
import type { StageVec3 } from '../domain/sceneTypes'
import { beginHistorySession, endHistorySession, useCameraStageStore } from '../store/cameraStageStore'

interface DefaultControls {
  enabled: boolean
}

interface DragState {
  origin: Vector3
  pointerOrigin: Vector3
  plane: Plane
  axis: Vector3 | null
  cameraRight: Vector3
  cameraUp: Vector3
}

interface PointerCaptureTarget extends EventTarget {
  setPointerCapture?: (pointerId: number) => void
  releasePointerCapture?: (pointerId: number) => void
}

interface PathControlPointProps {
  position: StageVec3
  shape: 'anchor' | 'handle'
  selected: boolean
  onSelect: () => void
  onDrag: (position: StageVec3) => void
}

function closestPointOnAxis(ray: Ray, origin: Vector3, axis: Vector3): Vector3 {
  const rayDirection = ray.direction
  const difference = ray.origin.clone().sub(origin)
  const cross = rayDirection.dot(axis)
  const denominator = Math.max(1e-8, 1 - cross * cross)
  const rayProjection = rayDirection.dot(difference)
  const axisProjection = axis.dot(difference)
  const parameter = (cross * rayProjection - axisProjection) / denominator
  return origin.clone().addScaledVector(axis, parameter)
}

const PathControlPoint: React.FC<PathControlPointProps> = ({
  position,
  shape,
  selected,
  onSelect,
  onDrag,
}) => {
  const groupRef = useRef<Group>(null)
  const dragRef = useRef<DragState | null>(null)
  const pressedAxisRef = useRef<'x' | 'y' | 'z' | null>(null)
  const defaultControls = useThree((state) => (
    (state as unknown as { controls?: DefaultControls }).controls
  ))
  const camera = useThree((state) => state.camera)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const key = event.key.toLowerCase()
      if (key === 'x' || key === 'y' || key === 'z') pressedAxisRef.current = key
    }
    const onKeyUp = (event: KeyboardEvent): void => {
      if (event.key.toLowerCase() === pressedAxisRef.current) pressedAxisRef.current = null
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [])

  useFrame(() => {
    const group = groupRef.current
    if (!group) return
    const worldPosition = new Vector3(position.x, position.y, position.z)
    const scale = Math.max(0.08, camera.position.distanceTo(worldPosition) * 0.03)
    group.scale.setScalar(scale)
  })

  const handlePointerDown = (event: ThreeEvent<PointerEvent>): void => {
    event.stopPropagation()
    onSelect()
    useCameraStageStore.getState().pause()
    beginHistorySession()
    if (defaultControls) defaultControls.enabled = false
    ;(event.target as PointerCaptureTarget | null)?.setPointerCapture?.(event.pointerId)

    const origin = new Vector3(position.x, position.y, position.z)
    const cameraDirection = new Vector3()
    camera.getWorldDirection(cameraDirection)
    const plane = new Plane().setFromNormalAndCoplanarPoint(cameraDirection, origin)
    const planeHit = event.ray.intersectPlane(plane, new Vector3()) ?? origin.clone()
    const axisKey = pressedAxisRef.current
    const axis = axisKey
      ? new Vector3(axisKey === 'x' ? 1 : 0, axisKey === 'y' ? 1 : 0, axisKey === 'z' ? 1 : 0)
      : null
    dragRef.current = {
      origin,
      pointerOrigin: axis ? closestPointOnAxis(event.ray, origin, axis) : planeHit,
      plane,
      axis,
      cameraRight: new Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize(),
      cameraUp: new Vector3().setFromMatrixColumn(camera.matrixWorld, 1).normalize(),
    }
  }

  const handlePointerMove = (event: ThreeEvent<PointerEvent>): void => {
    const drag = dragRef.current
    if (!drag) return
    event.stopPropagation()
    let point: Vector3
    if (drag.axis) {
      const current = closestPointOnAxis(event.ray, drag.origin, drag.axis)
      point = drag.origin.clone().add(current.sub(drag.pointerOrigin))
    } else {
      const current = event.ray.intersectPlane(drag.plane, new Vector3())
      if (!current) return
      const delta = current.sub(drag.pointerOrigin)
      if (event.shiftKey) {
        const horizontal = delta.dot(drag.cameraRight)
        const vertical = delta.dot(drag.cameraUp)
        delta.copy(Math.abs(horizontal) >= Math.abs(vertical)
          ? drag.cameraRight.clone().multiplyScalar(horizontal)
          : drag.cameraUp.clone().multiplyScalar(vertical))
      }
      point = drag.origin.clone().add(delta)
    }
    onDrag({ x: point.x, y: point.y, z: point.z })
  }

  const finishDrag = (event: ThreeEvent<PointerEvent>): void => {
    if (!dragRef.current) return
    event.stopPropagation()
    dragRef.current = null
    ;(event.target as PointerCaptureTarget | null)?.releasePointerCapture?.(event.pointerId)
    if (defaultControls) defaultControls.enabled = true
    endHistorySession()
  }

  return (
    <group ref={groupRef} position={[position.x, position.y, position.z]}>
      <mesh
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
      >
        <sphereGeometry args={[0.52, 12, 12]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      {shape === 'handle' && (
        <mesh raycast={() => null}>
          <sphereGeometry args={[0.24, 18, 18]} />
          <meshBasicMaterial color={CAMERA_STAGE_MOTION_PATH_HEX.handleOutline} depthTest={false} />
        </mesh>
      )}
      <mesh raycast={() => null}>
        {shape === 'anchor'
          ? <boxGeometry args={[0.28, 0.28, 0.28]} />
          : <sphereGeometry args={[0.16, 18, 18]} />}
        <meshBasicMaterial
          color={selected ? CAMERA_STAGE_MOTION_PATH_HEX.handleSelected : CAMERA_STAGE_MOTION_PATH_HEX.handle}
          depthTest={false}
        />
      </mesh>
    </group>
  )
}

export default PathControlPoint
