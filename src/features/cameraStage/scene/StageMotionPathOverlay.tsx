import React, { useMemo, useRef } from 'react'
import { Line, TransformControls } from '@react-three/drei'
import type { Group } from 'three'
import { CAMERA_STAGE_MOTION_PATH_HEX } from '@/core/theme/colorTokens'
import { cubicSpatialPoint } from '../domain/spatialPath'
import type { StageVec3 } from '../domain/sceneTypes'
import type { StageShot, StageSpatialPath } from '../domain/shotTypes'
import { beginHistorySession, endHistorySession, useCameraStageStore } from '../store/cameraStageStore'

interface StageMotionPathOverlayProps {
  objectId: string
  shots: StageShot[]
  currentTime: number
}

interface PathSegment {
  shot: StageShot
  from: StageVec3
  to: StageVec3
  path?: StageSpatialPath
  active: boolean
}

const SAMPLE_COUNT = 32

function samePosition(a: StageVec3, b: StageVec3): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < 1e-6
}

const StageMotionPathOverlay: React.FC<StageMotionPathOverlayProps> = ({ objectId, shots, currentTime }) => {
  const updateShotTransition = useCameraStageStore((state) => state.updateShotTransition)
  const outHandleRef = useRef<Group>(null)
  const inHandleRef = useRef<Group>(null)
  const segments = useMemo<PathSegment[]>(() => {
    const result: PathSegment[] = []
    for (let index = 0; index < shots.length - 1; index += 1) {
      const shot = shots[index]
      const next = shots[index + 1]
      const from = shot.objectStates[objectId]?.transform.position
      const to = next.objectStates[objectId]?.transform.position
      if (!from || !to || samePosition(from, to)) continue
      result.push({
        shot,
        from,
        to,
        path: shot.transition.perObject[objectId]?.spatialPath,
        active: currentTime >= shot.time && currentTime <= next.time,
      })
    }
    return result
  }, [currentTime, objectId, shots])

  const activeSegment = segments.find((segment) => segment.active && segment.path)
  const updateHandle = (kind: 'out' | 'in'): void => {
    if (!activeSegment?.path) return
    const node = kind === 'out' ? outHandleRef.current : inHandleRef.current
    if (!node) return
    const endpoint = kind === 'out' ? activeSegment.from : activeSegment.to
    const tangent = { x: node.position.x - endpoint.x, y: node.position.y - endpoint.y, z: node.position.z - endpoint.z }
    const detail = activeSegment.shot.transition.perObject[objectId] ?? {}
    updateShotTransition(activeSegment.shot.id, {
      perObject: {
        [objectId]: {
          ...detail,
          spatialPath: {
            ...activeSegment.path,
            ...(kind === 'out' ? { outTangent: tangent } : { inTangent: tangent }),
          },
        },
      },
    })
  }

  return (
    <>
      {segments.map((segment) => {
        const points = segment.path
          ? Array.from({ length: SAMPLE_COUNT + 1 }, (_, index) => cubicSpatialPoint(
            segment.from,
            segment.to,
            segment.path as StageSpatialPath,
            index / SAMPLE_COUNT,
          ))
          : [segment.from, segment.to]
        return (
          <Line
            key={segment.shot.id}
            points={points.map((point) => [point.x, point.y, point.z])}
            color={CAMERA_STAGE_MOTION_PATH_HEX.path}
            lineWidth={segment.active ? 2 : 1}
            transparent
            opacity={segment.active ? 1 : 0.45}
          />
        )
      })}
      {activeSegment?.path && (() => {
        const outPoint = {
          x: activeSegment.from.x + activeSegment.path.outTangent.x,
          y: activeSegment.from.y + activeSegment.path.outTangent.y,
          z: activeSegment.from.z + activeSegment.path.outTangent.z,
        }
        const inPoint = {
          x: activeSegment.to.x + activeSegment.path.inTangent.x,
          y: activeSegment.to.y + activeSegment.path.inTangent.y,
          z: activeSegment.to.z + activeSegment.path.inTangent.z,
        }
        return (
          <>
            <Line points={[[activeSegment.from.x, activeSegment.from.y, activeSegment.from.z], [outPoint.x, outPoint.y, outPoint.z]]}
              color={CAMERA_STAGE_MOTION_PATH_HEX.tangent} lineWidth={1} />
            <Line points={[[activeSegment.to.x, activeSegment.to.y, activeSegment.to.z], [inPoint.x, inPoint.y, inPoint.z]]}
              color={CAMERA_STAGE_MOTION_PATH_HEX.tangent} lineWidth={1} />
            <TransformControls mode="translate" onMouseDown={beginHistorySession} onMouseUp={endHistorySession}
              onObjectChange={() => updateHandle('out')}>
              <group ref={outHandleRef} position={[outPoint.x, outPoint.y, outPoint.z]}>
                <mesh><sphereGeometry args={[0.08, 16, 16]} /><meshBasicMaterial color={CAMERA_STAGE_MOTION_PATH_HEX.handle} /></mesh>
              </group>
            </TransformControls>
            <TransformControls mode="translate" onMouseDown={beginHistorySession} onMouseUp={endHistorySession}
              onObjectChange={() => updateHandle('in')}>
              <group ref={inHandleRef} position={[inPoint.x, inPoint.y, inPoint.z]}>
                <mesh><sphereGeometry args={[0.08, 16, 16]} /><meshBasicMaterial color={CAMERA_STAGE_MOTION_PATH_HEX.handle} /></mesh>
              </group>
            </TransformControls>
          </>
        )
      })()}
    </>
  )
}

export default StageMotionPathOverlay
