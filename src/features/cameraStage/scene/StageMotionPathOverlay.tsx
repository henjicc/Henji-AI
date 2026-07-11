import React, { useMemo } from 'react'
import { Line } from '@react-three/drei'
import { CAMERA_STAGE_MOTION_PATH_HEX } from '@/core/theme/colorTokens'
import { easeProgress } from '../domain/keyframeEngine'
import { createSpatialPathSampler, markSpatialPathCustom } from '../domain/spatialPath'
import type { StageVec3 } from '../domain/sceneTypes'
import type { StageShot, StageSpatialPath } from '../domain/shotTypes'
import type { StageSpeedPreset } from '../domain/shotTypes'
import { useCameraStageStore } from '../store/cameraStageStore'
import {
  useCameraStageToolStore,
  type StagePathControlSelection,
} from '../store/cameraStageToolStore'
import PathControlPoint from './PathControlPoint'

interface StageMotionPathOverlayProps {
  objectId: string
  shots: StageShot[]
}

interface PathSegment {
  shot: StageShot
  from: StageVec3
  to: StageVec3
  path?: StageSpatialPath
}

const SAMPLE_COUNT = 64
const TIME_DOT_COUNT = 28
const SPEED_EASING: Record<StageSpeedPreset, 'linear' | 'easeIn' | 'easeOut' | 'easeInOut'> = {
  uniform: 'linear',
  easeInOut: 'easeInOut',
  fastStart: 'easeOut',
  slowStart: 'easeIn',
}

function samePosition(a: StageVec3, b: StageVec3): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < 1e-6
}

const StageMotionPathOverlay: React.FC<StageMotionPathOverlayProps> = ({ objectId, shots }) => {
  const pathSelection = useCameraStageToolStore((state) => state.pathSelection)
  const controlSelection = useCameraStageToolStore((state) => state.controlSelection)
  const selectPath = useCameraStageToolStore((state) => state.selectPath)
  const selectControl = useCameraStageToolStore((state) => state.selectControl)
  const setShotSpatialPath = useCameraStageStore((state) => state.setShotSpatialPath)
  const setShotPathAnchor = useCameraStageStore((state) => state.setShotPathAnchor)
  const segments = useMemo<PathSegment[]>(() => {
    const result: PathSegment[] = []
    for (let index = 0; index < shots.length - 1; index += 1) {
      const shot = shots[index]
      const next = shots[index + 1]
      const from = shot.objectStates[objectId]?.transform.position
      const to = next.objectStates[objectId]?.transform.position
      const path = shot.transition.perObject[objectId]?.spatialPath
      if (!from || !to || (samePosition(from, to) && !path)) continue
      result.push({ shot, from, to, path })
    }
    return result
  }, [objectId, shots])

  const selectedSegment = segments.find((segment) => (
    pathSelection?.objectId === objectId && pathSelection.shotId === segment.shot.id
  ))

  const selectSegment = (segment: PathSegment): void => {
    selectPath({ shotId: segment.shot.id, objectId })
  }

  const updatePath = (segment: PathSegment, path: StageSpatialPath): void => {
    setShotSpatialPath(segment.shot.id, objectId, markSpatialPathCustom(path))
  }

  const controlMatches = (selection: StagePathControlSelection): boolean => {
    if (!controlSelection || controlSelection.kind !== selection.kind) return false
    return selection.kind !== 'knot'
      || (controlSelection.kind === 'knot' && controlSelection.knotId === selection.knotId)
  }

  return (
    <>
      {segments.map((segment) => {
        const selected = selectedSegment?.shot.id === segment.shot.id
        const samplePath = segment.path
          ? createSpatialPathSampler(segment.from, segment.to, segment.path)
          : null
        const points = segment.path
          ? Array.from({ length: SAMPLE_COUNT + 1 }, (_, index) => (
            samplePath?.(index / SAMPLE_COUNT) ?? segment.from
          ))
          : [segment.from, segment.to]
        const timeDots = selected
          ? Array.from({ length: TIME_DOT_COUNT + 1 }, (_, index) => {
            const progress = easeProgress(
              SPEED_EASING[segment.shot.transition.perObject[objectId]?.speedPreset ?? 'easeInOut'],
              index / TIME_DOT_COUNT,
            )
            return samplePath
              ? samplePath(progress)
              : {
                x: segment.from.x + (segment.to.x - segment.from.x) * progress,
                y: segment.from.y + (segment.to.y - segment.from.y) * progress,
                z: segment.from.z + (segment.to.z - segment.from.z) * progress,
              }
          })
          : []
        const dotPositions = new Float32Array(timeDots.flatMap((point) => [point.x, point.y, point.z]))
        return (
          <React.Fragment key={segment.shot.id}>
            <Line
              points={points.map((point) => [point.x, point.y, point.z])}
              color={CAMERA_STAGE_MOTION_PATH_HEX.path}
              lineWidth={selected ? 2 : 1}
              transparent
              opacity={selected ? 1 : 0.42}
              onPointerDown={(event) => {
                event.stopPropagation()
                selectSegment(segment)
              }}
            />
            {timeDots.length > 0 && (
              <points raycast={() => null}>
                <bufferGeometry>
                  <bufferAttribute attach="attributes-position" args={[dotPositions, 3]} />
                </bufferGeometry>
                <pointsMaterial
                  color={CAMERA_STAGE_MOTION_PATH_HEX.path}
                  size={2.5}
                  sizeAttenuation={false}
                  depthTest={false}
                />
              </points>
            )}
          </React.Fragment>
        )
      })}

      {selectedSegment && (
        <>
          <PathControlPoint
            position={selectedSegment.from}
            shape="anchor"
            selected={controlMatches({ kind: 'start' })}
            onSelect={() => selectControl({ kind: 'start' })}
            onDrag={(position) => setShotPathAnchor(selectedSegment.shot.id, objectId, 'start', position)}
          />
          {selectedSegment.path?.knots.map((knot) => (
            <PathControlPoint
              key={knot.id}
              position={knot.position}
              shape="anchor"
              selected={controlMatches({ kind: 'knot', knotId: knot.id })}
              onSelect={() => selectControl({ kind: 'knot', knotId: knot.id })}
              onDrag={(position) => updatePath(selectedSegment, {
                ...selectedSegment.path as StageSpatialPath,
                knots: (selectedSegment.path as StageSpatialPath).knots.map((item) => (
                  item.id === knot.id ? { ...item, position } : item
                )),
              })}
            />
          ))}
          <PathControlPoint
            position={selectedSegment.to}
            shape="anchor"
            selected={controlMatches({ kind: 'end' })}
            onSelect={() => selectControl({ kind: 'end' })}
            onDrag={(position) => setShotPathAnchor(selectedSegment.shot.id, objectId, 'end', position)}
          />
        </>
      )}

      {selectedSegment?.path && (() => {
        const path = selectedSegment.path
        const startHandle = addPosition(selectedSegment.from, path.startOutTangent)
        const endHandle = addPosition(selectedSegment.to, path.endInTangent)
        const updateKnotHandle = (knotId: string, kind: 'in' | 'out', position: StageVec3): void => {
          const knot = path.knots.find((item) => item.id === knotId)
          if (!knot) return
          updatePath(selectedSegment, {
            ...path,
            knots: path.knots.map((item) => item.id === knotId ? {
              ...item,
              ...(kind === 'in'
                ? { inTangent: subtractPosition(position, knot.position) }
                : { outTangent: subtractPosition(position, knot.position) }),
            } : item),
          })
        }
        return <>
          <Line
            points={[[selectedSegment.from.x, selectedSegment.from.y, selectedSegment.from.z], [startHandle.x, startHandle.y, startHandle.z]]}
            color={CAMERA_STAGE_MOTION_PATH_HEX.tangent}
            lineWidth={2}
          />
          <PathControlPoint
            position={startHandle}
            shape="handle"
            selected
            onSelect={() => selectControl({ kind: 'start' })}
            onDrag={(position) => updatePath(selectedSegment, {
              ...path,
              startOutTangent: subtractPosition(position, selectedSegment.from),
            })}
          />
          <Line
            points={[[selectedSegment.to.x, selectedSegment.to.y, selectedSegment.to.z], [endHandle.x, endHandle.y, endHandle.z]]}
            color={CAMERA_STAGE_MOTION_PATH_HEX.tangent}
            lineWidth={2}
          />
          <PathControlPoint
            position={endHandle}
            shape="handle"
            selected
            onSelect={() => selectControl({ kind: 'end' })}
            onDrag={(position) => updatePath(selectedSegment, {
              ...path,
              endInTangent: subtractPosition(position, selectedSegment.to),
            })}
          />
          {path.knots.map((knot) => {
            const inHandle = addPosition(knot.position, knot.inTangent)
            const outHandle = addPosition(knot.position, knot.outTangent)
            return (
              <React.Fragment key={`handles-${knot.id}`}>
                <Line
                  points={[[inHandle.x, inHandle.y, inHandle.z], [outHandle.x, outHandle.y, outHandle.z]]}
                  color={CAMERA_STAGE_MOTION_PATH_HEX.tangent}
                  lineWidth={2}
                />
                <PathControlPoint position={inHandle} shape="handle" selected
                  onSelect={() => selectControl({ kind: 'knot', knotId: knot.id })}
                  onDrag={(position) => updateKnotHandle(knot.id, 'in', position)} />
                <PathControlPoint position={outHandle} shape="handle" selected
                  onSelect={() => selectControl({ kind: 'knot', knotId: knot.id })}
                  onDrag={(position) => updateKnotHandle(knot.id, 'out', position)} />
              </React.Fragment>
            )
          })}
        </>
      })()}
    </>
  )
}

function addPosition(a: StageVec3, b: StageVec3): StageVec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }
}

function subtractPosition(a: StageVec3, b: StageVec3): StageVec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }
}

export default StageMotionPathOverlay
