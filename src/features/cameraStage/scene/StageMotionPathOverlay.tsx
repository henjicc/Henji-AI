import React, { useMemo } from 'react'
import { Line } from '@react-three/drei'
import { CAMERA_STAGE_MOTION_PATH_HEX } from '@/core/theme/colorTokens'
import { markSpatialPathCustom } from '../domain/spatialPath'
import type { StageVec3 } from '../domain/sceneTypes'
import type { StageStateKeyframe, StageSpatialPath } from '../domain/stateKeyframeTypes'
import { useCameraStageStore } from '../store/cameraStageStore'
import { sampleObjectTrajectory } from '../store/playbackSampling'
import {
  useCameraStageToolStore,
  type StagePathControlSelection,
} from '../store/cameraStageToolStore'
import PathControlPoint from './PathControlPoint'

interface StageMotionPathOverlayProps {
  objectId: string
  stateKeyframes: StageStateKeyframe[]
  editable?: boolean
}

interface PathSegment {
  stateKeyframe: StageStateKeyframe
  from: StageVec3
  to: StageVec3
  path?: StageSpatialPath
  /** 这一段时间里对象实际走过的位置（与播放同一条采样链） */
  points: StageVec3[]
}

const SAMPLE_COUNT = 64
const TIME_DOT_COUNT = 28

function evenTimes(start: number, end: number, count: number): number[] {
  return Array.from({ length: count + 1 }, (_, index) => start + ((end - start) * index) / count)
}

function samePosition(a: StageVec3, b: StageVec3): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < 1e-6
}

const StageMotionPathOverlay: React.FC<StageMotionPathOverlayProps> = ({ objectId, stateKeyframes, editable = true }) => {
  const pathSelection = useCameraStageToolStore((state) => state.pathSelection)
  const controlSelection = useCameraStageToolStore((state) => state.controlSelection)
  const selectPath = useCameraStageToolStore((state) => state.selectPath)
  const selectControl = useCameraStageToolStore((state) => state.selectControl)
  const setStateKeyframeSpatialPath = useCameraStageStore((state) => state.setStateKeyframeSpatialPath)
  const setStateKeyframePathAnchor = useCameraStageStore((state) => state.setStateKeyframePathAnchor)
  const animation = useCameraStageStore((state) => state.animation)
  // 路线画实际轨迹：平滑衔接的拐角被切圆、设备时间律与跟拍都由编译产物决定，作者折线不是镜头真正走的路。
  // 位置全由编译产物驱动，对象只取作采样底稿；增删对象与改卡都会重编译，不必跟着播放头逐帧重算。
  const segments = useMemo<PathSegment[]>(() => {
    const objects = useCameraStageStore.getState().objects
    const result: PathSegment[] = []
    for (let index = 0; index < stateKeyframes.length - 1; index += 1) {
      const stateKeyframe = stateKeyframes[index]
      const next = stateKeyframes[index + 1]
      const from = stateKeyframe.objectStates[objectId]?.transform.position
      const to = next.objectStates[objectId]?.transform.position
      const path = stateKeyframe.transition.perObject[objectId]?.spatialPath
      if (!from || !to || (samePosition(from, to) && !path)) continue
      result.push({
        stateKeyframe, from, to, path,
        points: sampleObjectTrajectory(objects, animation, objectId, evenTimes(stateKeyframe.time, next.time, SAMPLE_COUNT)),
      })
    }
    return result
  }, [animation, objectId, stateKeyframes])

  const selectedSegment = segments.find((segment) => (
    pathSelection?.objectId === objectId && pathSelection.stateKeyframeId === segment.stateKeyframe.id
  ))
  // 等时间间隔的位置只画在选中的那段上：点越疏走得越快。
  const selectedTimeDots = useMemo(() => {
    if (!selectedSegment) return []
    const index = stateKeyframes.indexOf(selectedSegment.stateKeyframe)
    const next = stateKeyframes[index + 1]
    return next
      ? sampleObjectTrajectory(useCameraStageStore.getState().objects, animation, objectId, evenTimes(selectedSegment.stateKeyframe.time, next.time, TIME_DOT_COUNT))
      : []
  }, [animation, objectId, selectedSegment, stateKeyframes])

  const selectSegment = (segment: PathSegment): void => {
    selectPath({ stateKeyframeId: segment.stateKeyframe.id, objectId })
  }

  const updatePath = (segment: PathSegment, path: StageSpatialPath): void => {
    setStateKeyframeSpatialPath(segment.stateKeyframe.id, objectId, markSpatialPathCustom(path))
  }

  const controlMatches = (selection: StagePathControlSelection): boolean => {
    if (!controlSelection || controlSelection.kind !== selection.kind) return false
    return selection.kind !== 'knot'
      || (controlSelection.kind === 'knot' && controlSelection.knotId === selection.knotId)
  }

  return (
    <>
      {segments.map((segment) => {
        const selected = selectedSegment?.stateKeyframe.id === segment.stateKeyframe.id
        const timeDots = selected ? selectedTimeDots : []
        const dotPositions = new Float32Array(timeDots.flatMap((point) => [point.x, point.y, point.z]))
        return (
          <React.Fragment key={segment.stateKeyframe.id}>
            <Line
              points={segment.points.map((point) => [point.x, point.y, point.z])}
              color={CAMERA_STAGE_MOTION_PATH_HEX.path}
              lineWidth={selected ? 2 : 1}
              transparent
              opacity={selected ? 1 : 0.42}
              onPointerDown={(event) => {
                if (!editable) return
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

      {editable && selectedSegment && (
        <>
          <PathControlPoint
            position={selectedSegment.from}
            shape="anchor"
            selected={controlMatches({ kind: 'start' })}
            onSelect={() => selectControl({ kind: 'start' })}
            onDrag={(position) => setStateKeyframePathAnchor(selectedSegment.stateKeyframe.id, objectId, 'start', position)}
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
            onDrag={(position) => setStateKeyframePathAnchor(selectedSegment.stateKeyframe.id, objectId, 'end', position)}
          />
        </>
      )}

      {editable && selectedSegment?.path && (() => {
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
