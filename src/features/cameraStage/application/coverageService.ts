import { Vector3 } from 'three'
import type { z } from 'zod'

import { createLogger } from '@/core/logging'
import { notExecutedFailure } from '@/core/application-control/execution/writeExecution'
import {
  CAMERA_STAGE_COVERAGE_ROLE_LABELS,
  type CameraStageCoverageLine,
  type CameraStageCoverageRole,
  type CameraStageCoverageSetupResult,
  type cameraStageCoverageIntentShape,
} from '@/core/application-control/domains/cameraStage/cameraStageCoverageSchemas'
import type { CameraStageShotAngle, CameraStageShotLens, CameraStageShotSize } from '@/core/application-control/domains/cameraStage/cameraStageShotSchemas'
import { v4 as uuidv4 } from 'uuid'

import type { StageCoverage, StageCoverageSetup } from '../domain/coverage'
import type { StageCameraObject, StageObject, StageVec3 } from '../domain/sceneTypes'
import { applyAnimationAtTime } from '../store/playbackSampling'
import { bindCameraStageProjectOperation, cameraStageProjectStore, ensureCameraStageProjectRuntime, saveCameraStageProjectRuntime } from './cameraStageProjectRuntime'
import { afterCameraStageWrite, captureCameraStageUndo } from './cameraStageUndo'
import { resolveUniqueCameraStageObjectName } from './cameraStageApplicationService'
import { axisSideAt, inferredLines, sampleEditFrames, sampleTimes, setupSubjects, setupUsable, subjectOf, usableSpans } from './editMeasure'
import { axisNormalFor, axisSideOf, composeShot, ShotCompositionError, type ShotKind } from './shotComposition'
import { readShot, shotCameraOf, shotObstacles, shotSubjectFromPoint, type StageShotSubject } from './shotGeometry'

const logger = createLogger('features.cameraStage.coverage')

export type CameraStageCoverageInput = { projectId: string } & z.output<z.ZodObject<typeof cameraStageCoverageIntentShape>>

export interface CameraStageCoverageResult {
  projectId: string
  coverageId: string
  name: string
  startTime: number
  endTime: number
  axis: { screenLeft: string; screenRight: string } | null
  lines: CameraStageCoverageLine[]
  setups: CameraStageCoverageSetupResult[]
  coverageHint?: string
  createdCameraIds: string[]
  undoToken: string
}

/** 一台机位的求解意图：拍谁、什么关系、在哪一刻按主体位置摆。 */
interface SetupSpec {
  role: CameraStageCoverageRole
  subjectIds: string[]
  point?: StageVec3
  height?: number
  kind: ShotKind
  size: CameraStageShotSize
  angle: CameraStageShotAngle
  lens: CameraStageShotLens
  time: number
  /** 单人与插入镜头 3/4 面落在这一侧（覆盖一侧的一个点） */
  hint: 'coverage_side' | 'active_camera'
}

const DEFAULT_SHOTS: Record<1 | 2, CameraStageCoverageRole[]> = {
  1: ['establishing', 'master', 'single'],
  2: ['establishing', 'master', 'over_shoulder', 'single'],
}
const WIDE_SAMPLE_STEP = 0.5
const INSERT_HEIGHT = 0.3
const round = (value: number): number => Math.round(value * 100) / 100
const vec = (value: Vector3): StageVec3 => ({ x: Math.round(value.x * 1000) / 1000, y: Math.round(value.y * 1000) / 1000, z: Math.round(value.z * 1000) / 1000 })

function rejected(message: string): Error {
  return notExecutedFailure(new Error(message))
}

function requireSubjects(objects: readonly StageObject[], ids: readonly string[], field: string): void {
  const missing = ids.filter((id) => !objects.some((object) => object.id === id && object.type !== 'camera'))
  if (missing.length === 0) return
  const available = objects.filter((object) => object.type === 'character' && !object.setId).map((object) => `${object.id}（${object.name}）`)
  throw rejected(`COVERAGE_SUBJECT_NOT_FOUND：${field} 里的 ${missing.join('、')} 不是本场景的角色或对象。场景里的角色：${available.join('、') || '没有'}。`)
}

/** 整段里两人离得最远的时刻：建立镜头按它摆，走位都框得住。 */
function widestTime(objects: StageObject[], state: ReturnType<ReturnType<typeof cameraStageProjectStore>['getState']>, subjectIds: readonly string[], start: number, end: number): number {
  if (subjectIds.length < 2) return start
  let best = { time: start, distance: -1 }
  for (const time of sampleTimes(start, end + 1e-3, WIDE_SAMPLE_STEP)) {
    const frame = applyAnimationAtTime(objects, state.animation, time)
    const [a, b] = subjectIds.map((id) => subjectOf(frame, id))
    if (!a || !b) continue
    const distance = a.base.distanceTo(b.base)
    if (distance > best.distance + 1e-3) best = { time, distance }
  }
  return best.time
}

function specsFor(roles: readonly CameraStageCoverageRole[], subjectIds: readonly string[], insert: CameraStageCoverageInput['insert'], referenceTime: number, wideTime: number): SetupSpec[] {
  const [a, b] = subjectIds
  const specs: SetupSpec[] = []
  for (const role of roles) {
    if (role === 'establishing') specs.push({ role, subjectIds: [...subjectIds], kind: 'single', size: 'extreme_long', angle: 'high', lens: 'wide', time: wideTime, hint: 'coverage_side' })
    if (role === 'master') {
      specs.push(b
        ? { role, subjectIds: [a, b], kind: 'two_shot', size: 'full', angle: 'eye_level', lens: 'standard', time: referenceTime, hint: 'coverage_side' }
        : { role, subjectIds: [a], kind: 'single', size: 'full', angle: 'eye_level', lens: 'standard', time: referenceTime, hint: 'active_camera' })
    }
    if (role === 'over_shoulder' && b) {
      specs.push({ role, subjectIds: [a, b], kind: 'over_shoulder', size: 'close', angle: 'eye_level', lens: 'telephoto', time: referenceTime, hint: 'coverage_side' })
      specs.push({ role, subjectIds: [b, a], kind: 'over_shoulder', size: 'close', angle: 'eye_level', lens: 'telephoto', time: referenceTime, hint: 'coverage_side' })
    }
    if (role === 'single' || role === 'reaction') {
      for (const id of subjectIds) {
        specs.push({
          role, subjectIds: [id], kind: 'single', size: role === 'single' ? 'close' : 'closeup', angle: 'eye_level',
          lens: role === 'single' ? 'standard' : 'telephoto', time: referenceTime, hint: b ? 'coverage_side' : 'active_camera',
        })
      }
    }
    if (role === 'insert' && insert) {
      specs.push('objectId' in insert
        ? { role, subjectIds: [insert.objectId], kind: 'single', size: 'closeup', angle: 'high', lens: 'standard', time: referenceTime, hint: 'coverage_side' }
        : { role, subjectIds: [], point: insert.point, height: insert.height ?? INSERT_HEIGHT, kind: 'single', size: 'closeup', angle: 'high', lens: 'standard', time: referenceTime, hint: 'coverage_side' })
    }
  }
  return specs
}

const setupKey = (setup: Pick<StageCoverageSetup, 'role' | 'subjectIds'>): string => `${setup.role}:${setup.subjectIds.join('>')}`

function cameraNameFor(base: string, spec: SetupSpec, objects: readonly StageObject[]): string {
  const name = (id: string): string => objects.find((object) => object.id === id)?.name ?? id
  const label = CAMERA_STAGE_COVERAGE_ROLE_LABELS[spec.role]
  if (spec.role === 'over_shoulder') return `${base}·${label} ${name(spec.subjectIds[0])}→${name(spec.subjectIds[1])}`
  if ((spec.role === 'single' || spec.role === 'reaction' || spec.role === 'insert') && spec.subjectIds[0]) return `${base}·${label} ${name(spec.subjectIds[0])}`
  return `${base}·${label}`
}

interface SolvedSetup {
  spec: SetupSpec
  position: Vector3
  rotation: StageVec3
  fov: number
  lookAtTarget: Vector3
  adjusted: string | null
}

async function coverCameraStageSceneInternal(input: CameraStageCoverageInput): Promise<CameraStageCoverageResult> {
  logger.info('多机位覆盖布置开始', { event: 'camera_stage.coverage.start', projectId: input.projectId, subjectCount: input.subjects.length, replace: input.replaceCoverageId ?? null })
  try {
    await ensureCameraStageProjectRuntime(input.projectId)
    const store = cameraStageProjectStore(input.projectId)
    const state = store.getState()
    const previous = input.replaceCoverageId ? state.coverages.find((coverage) => coverage.id === input.replaceCoverageId) : undefined
    if (input.replaceCoverageId && !previous) {
      throw rejected(`COVERAGE_NOT_FOUND：«${input.replaceCoverageId}» 不是本场景的覆盖。当前：${state.coverages.map((coverage) => `${coverage.id}（${coverage.name}）`).join('、') || '没有'}。`)
    }
    const subjectIds = input.subjects
    requireSubjects(state.objects, subjectIds, 'subjects')
    if (input.insert && 'objectId' in input.insert) requireSubjects(state.objects, [input.insert.objectId], 'insert')
    const startTime = input.startTime ?? previous?.startTime ?? 0
    const endTime = input.endTime ?? previous?.endTime ?? (state.animation.duration > startTime + 0.5 ? state.animation.duration : startTime + 10)
    if (endTime <= startTime) throw rejected(`COVERAGE_RANGE_INVALID：结束时刻 ${endTime} 秒不晚于开始时刻 ${startTime} 秒；给 endTime。`)
    const lines = (input.lines ?? previous?.lines ?? inferredLines(state.animation, subjectIds, startTime, endTime))
      .filter((line) => line.endTime > startTime && line.startTime < endTime)
    const strangers = [...new Set(lines.map((line) => line.speakerId))].filter((id) => !subjectIds.includes(id))
    if (strangers.length > 0) throw rejected(`COVERAGE_SPEAKER_NOT_SUBJECT：台词的 speakerId ${strangers.join('、')} 不在 subjects 里；说话的人要是这段戏的主体。`)
    const roles = input.shots ?? (previous ? [...new Set(previous.setups.map((setup) => setup.role))] : DEFAULT_SHOTS[subjectIds.length as 1 | 2])
    const referenceTime = Math.min(endTime, Math.max(startTime, input.referenceTime ?? lines[0]?.startTime ?? startTime))
    const wideTime = widestTime(state.objects, state, subjectIds, startTime, endTime)
    const previousInsert = previous?.setups.find((setup) => setup.role === 'insert')
    const insert = input.insert ?? (previousInsert?.point
      ? { point: previousInsert.point, ...(previousInsert.height ? { height: previousInsert.height } : {}) }
      : previousInsert?.subjectIds[0] ? { objectId: previousInsert.subjectIds[0] } : undefined)
    const specs = specsFor(roles, subjectIds, insert, referenceTime, wideTime)
    if (specs.length === 0) throw rejected('COVERAGE_EMPTY：没有可布置的镜头；两个主体才能用 over_shoulder，insert 要给拍什么。')

    // 先全部求解再写入：任何一台求不出来都在写入之前知道。
    const cameras = state.objects.filter((object): object is StageCameraObject => object.type === 'camera')
    const aspect = cameras[0]?.aspectRatio.ratio ?? 16 / 9
    const active = cameras.find((camera) => camera.id === state.activeCameraId) ?? cameras[0]
    const atReference = applyAnimationAtTime(state.objects, state.animation, referenceTime)
    const pair = subjectIds.length === 2 ? subjectIds.map((id) => subjectOf(atReference, id)!) as [StageShotSubject, StageShotSubject] : null
    const activeAt = active ? atReference.find((object) => object.id === active.id) as StageCameraObject : undefined
    const side: 1 | -1 = previous?.axisSide ?? (pair && activeAt ? axisSideOf(new Vector3(activeAt.transform.position.x, activeAt.transform.position.y, activeAt.transform.position.z), pair) : 1)
    const skipped: string[] = []
    const solved: SolvedSetup[] = []
    for (const spec of specs) {
      const objects = applyAnimationAtTime(state.objects, state.animation, spec.time)
      const subjects = spec.point ? [shotSubjectFromPoint(spec.point, spec.height)] : spec.subjectIds.map((id) => subjectOf(objects, id)!)
      const people = subjectIds.map((id) => subjectOf(objects, id)!)
      const middle = people.reduce((sum, subject) => sum.add(subject.base), new Vector3()).multiplyScalar(1 / people.length)
      const normal = people.length === 2 ? axisNormalFor(people, side) : null
      const activePosition = activeAt ? new Vector3(activeAt.transform.position.x, activeAt.transform.position.y, activeAt.transform.position.z) : middle.clone().add(new Vector3(0, 1.6, 6))
      const hint = spec.hint === 'coverage_side' && normal ? middle.clone().addScaledVector(normal, 6) : activePosition
      // 建立镜头拍两人站位的中心，景别按一个人的高度算，主体离得再远也框得住。
      const target = spec.role === 'establishing'
        ? [shotSubjectFromPoint({ x: middle.x, y: middle.y + 0.9, z: middle.z }, 1.8)]
        : subjects
      try {
        // 过肩两人离得远时求解自己会换长焦、必要时放宽景别，实际景别以结果为准。
        const solution = composeShot({
          kind: spec.kind, subjects: target, size: spec.size, position: 'auto', angle: spec.angle, lens: spec.lens, aspect,
          currentPosition: hint, axisNormal: normal, avoidOcclusion: true, obstacles: shotObstacles(objects),
        })
        solved.push({
          spec: { ...spec, size: solution.size }, position: solution.camera.position, rotation: solution.camera.rotation, fov: solution.camera.fov, lookAtTarget: solution.lookAtTarget,
          adjusted: solution.adjusted?.summary.replace(/。$/, '') ?? null,
        })
      } catch (error) {
        if (!(error instanceof ShotCompositionError)) throw error
        skipped.push(`${CAMERA_STAGE_COVERAGE_ROLE_LABELS[spec.role]}${spec.subjectIds.length === 1 ? `「${objects.find((object) => object.id === spec.subjectIds[0])?.name}」` : ''}：${error.message}`)
      }
    }
    if (solved.length === 0) throw rejected(`SHOT_NOT_REACHABLE：一台机位都求不出来。${skipped.join('；')}`)

    const name = input.name ?? previous?.name ?? `覆盖${state.coverages.length + 1}`
    const reused = new Map((previous?.setups ?? []).filter((setup) => cameras.some((camera) => camera.id === setup.cameraId)).map((setup) => [setupKey(setup), setup.cameraId]))
    const undoToken = captureCameraStageUndo(input.projectId)
    const written = await afterCameraStageWrite(input.projectId, undoToken, async () => {
      const before = store.getState()
      const keepActive = before.activeCameraId
      const keepView = before.viewMode
      const created: string[] = []
      const setups: StageCoverageSetup[] = []
      for (const item of solved) {
        let cameraId = reused.get(setupKey(item.spec))
        if (!cameraId) {
          store.getState().addCamera()
          cameraId = store.getState().selectedId ?? undefined
          if (!cameraId) throw new Error('CAPABILITY_REJECTED')
          created.push(cameraId)
        }
        const current = store.getState().objects.find((object) => object.id === cameraId) as StageCameraObject
        store.getState().updateObjectAcrossStateKeyframes(cameraId, {
          name: resolveUniqueCameraStageObjectName(store.getState().objects, cameraNameFor(name, item.spec, before.objects), cameraId),
          transform: { position: vec(item.position), rotation: { ...item.rotation }, scale: { ...current.transform.scale } },
          fov: item.fov,
          lookAt: { mode: 'manual', target: vec(item.lookAtTarget) },
        })
        setups.push({ cameraId, role: item.spec.role, subjectIds: item.spec.subjectIds, size: item.spec.size, ...(item.spec.point ? { point: item.spec.point, height: item.spec.height } : {}) })
      }
      // 新建摄像机会切过去当活动摄像机；布置覆盖不改用户正在看的机位。
      if (store.getState().activeCameraId !== keepActive) store.getState().setActiveCameraId(keepActive)
      if (store.getState().viewMode !== keepView) store.getState().setViewMode(keepView)
      const coverage: StageCoverage = {
        id: previous?.id ?? `coverage-${uuidv4()}`, name, subjectIds: [...subjectIds], startTime, endTime, axisSide: subjectIds.length === 2 ? side : null, lines, setups,
      }
      store.getState().setCoverage(coverage)
      const after = store.getState()
      const missing = setups.filter((setup) => !after.objects.some((object) => object.id === setup.cameraId))
      if (missing.length > 0) throw new Error('布置覆盖后正式场景里缺少摄像机，已恢复到写入前。')
      await saveCameraStageProjectRuntime(input.projectId)
      return { coverage, created }
    })

    // 读回：参照时刻的实际构图、轴线一侧与整段里拍得到主体的时段，都按写入后的场景量。
    const after = store.getState()
    const frames = sampleEditFrames(after.objects, after.animation, sampleTimes(startTime, endTime))
    const results: CameraStageCoverageSetupResult[] = written.coverage.setups.map((setup, index) => {
      const spec = solved[index].spec
      const objects = applyAnimationAtTime(after.objects, after.animation, spec.time)
      const camera = objects.find((object) => object.id === setup.cameraId) as StageCameraObject
      const frame = { time: spec.time, objects, obstacles: shotObstacles(objects) }
      const subjects = setup.role === 'insert' ? setupSubjects(frame, setup) : subjectIds.map((id) => subjectOf(objects, id)!)
      const ignore = setup.role === 'over_shoulder' ? new Set([setup.subjectIds[0]]) : undefined
      const composition = readShot(shotCameraOf(camera), subjects, frame.obstacles, ignore)
      const people = subjectIds.map((id) => subjectOf(objects, id)!)
      const sideNow = people.length === 2 ? axisSideAt(new Vector3(camera.transform.position.x, camera.transform.position.y, camera.transform.position.z), people[0], people[1]) : null
      return {
        cameraId: setup.cameraId,
        name: camera.name,
        role: setup.role,
        subjectIds: setup.subjectIds,
        size: spec.size,
        referenceTime: round(spec.time),
        created: written.created.includes(setup.cameraId),
        axisSide: sideNow === null ? null : sideNow === 0 ? 'on_axis' : sideNow === side ? 'coverage_side' : 'crossed',
        visibleSpans: usableSpans(frames, setupUsable(frames, setup), endTime),
        adjusted: solved[index].adjusted,
        composition,
      }
    })
    const axis = (() => {
      if (subjectIds.length < 2) return null
      const master = results.find((result) => result.role === 'master') ?? results[0]
      const ordered = [...master.composition.subjects].filter((subject) => subject.center).sort((left, right) => (left.center!.x - right.center!.x))
      return ordered.length === 2 ? { screenLeft: ordered[0].name, screenRight: ordered[1].name } : null
    })()
    const hints = [
      ...skipped.map((item) => `没布置${item}`),
      ...results.filter((result) => result.adjusted).map((result) => `「${result.name}」${result.adjusted!.replace(/。$/, '')}`),
      ...results.filter((result) => result.visibleSpans.length === 0).map((result) => `「${result.name}」整段都拍不到主要主体`),
      ...(!input.lines && !previous && lines.length === 0 && subjectIds.length === 2 ? ['没给 lines，角色也没有“说话”动作：剪辑时说话人规则无从判断，可在 cut_camera_stage_coverage 里补 lines'] : []),
    ]
    logger.info('多机位覆盖布置完成', {
      event: 'camera_stage.coverage.completed', projectId: input.projectId, coverageId: written.coverage.id,
      setupCount: results.length, createdCount: written.created.length, skippedCount: skipped.length, lineCount: lines.length,
    })
    return {
      projectId: input.projectId,
      coverageId: written.coverage.id,
      name,
      startTime: round(startTime),
      endTime: round(endTime),
      axis,
      lines,
      setups: results,
      ...(hints.length > 0 ? { coverageHint: `${hints.join('；')}。` } : {}),
      createdCameraIds: written.created,
      undoToken,
    }
  } catch (error) {
    logger.error('多机位覆盖布置失败', error, { event: 'camera_stage.coverage.failed', projectId: input.projectId })
    throw error
  }
}

export const coverCameraStageScene = bindCameraStageProjectOperation(coverCameraStageSceneInternal, (input) => input.projectId)

