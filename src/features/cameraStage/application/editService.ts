import type { z } from 'zod'

import { createLogger } from '@/core/logging'
import { notExecutedFailure } from '@/core/application-control/execution/writeExecution'
import {
  CAMERA_STAGE_COVERAGE_ROLE_LABELS,
  CAMERA_STAGE_EDIT_PACES,
  type CameraStageCoverageLine,
  type CameraStageEditPace,
  type cameraStageCheckIntentShape,
  type cameraStageCutIntentShape,
} from '@/core/application-control/domains/cameraStage/cameraStageCoverageSchemas'

import type { CameraStageShotSize } from '@/core/application-control/domains/cameraStage/cameraStageShotSchemas'
import { liveCoverages, type StageCoverage, type StageCoverageSetup } from '../domain/coverage'
import type { StageCameraCut } from '../domain/renderCameraSchedule'
import { cameraLiveAt } from '../store/cameraCutSlice'
import { bindCameraStageProjectOperation, cameraStageProjectStore, ensureCameraStageProjectRuntime, saveCameraStageProjectRuntime } from './cameraStageProjectRuntime'
import { afterCameraStageWrite, captureCameraStageUndo } from './cameraStageUndo'
import {
  axisSideAt,
  coverageSetupFor,
  inferredLines,
  primarySubjectIds,
  sampleEditFrames,
  sampleTimes,
  sizeIndexOf,
  subjectActions,
  viewAngleBetween,
  type EditAction,
  type EditFrame,
} from './editMeasure'
import { checkEdit, EditViewCache, type EditCheckResult, type EditSegment } from './editRules'

const logger = createLogger('features.cameraStage.edit')

type State = ReturnType<ReturnType<typeof cameraStageProjectStore>['getState']>
export type CameraStageCutInput = { projectId: string } & z.output<z.ZodObject<typeof cameraStageCutIntentShape>>
export type CameraStageCheckInput = { projectId: string } & z.output<z.ZodObject<typeof cameraStageCheckIntentShape>>

const round = (value: number): number => Math.round(value * 100) / 100

/*
 * 剪辑：把候选切点（段落开头、每句台词开口、每个动作中段、按节奏铺的格点）和覆盖里的镜头排成一张图，
 * 动态规划找总代价最低的切镜序列（Leake 等 2017 对话剪辑的“成本 + 维特比”做法，惯用法写成代价项）：
 * 段代价 = 时长偏离节奏 + 拍不到主体 + 说话时没拍说话人（反应镜头代价较低，长句后半段反而鼓励切听的人）
 * + 没人说话时用近景 + 对话里景别偏离“从中近景逐步推到特写”的目标；
 * 换镜代价 = 越轴、跳切、景别跳变；切点代价 = 动作中段奖励、紧挨动作起止惩罚、开口处奖励、无理由切惩罚。
 * 写完按 editRules 的同一套规则再检查一遍，结果如实返回。
 */

const COST = {
  shortBase: 40, shortSlope: 40, longBase: 20, longSlope: 8, targetWeight: 2,
  unusableFrame: 3,
  speakerWideFrame: 0.35, speakerReactionFrame: 0.25, speakerInsertFrame: 0.6, speakerMissingFrame: 1,
  establishingLateFrame: 0.3, quietMasterFrame: 0.05, quietCloseFrame: 0.3, quietInsertFrame: 0.4,
  actorHiddenFrame: 0.8, insertBiasFrame: 0.2,
  longLineSpeakerLateFrame: 0.25, tighteningFrame: 0.15,
  axis: 100, jumpCut: 80, sizeJump: 6,
  actionMid: -4, actionEdge: 6, nearActionEdge: 4, speakerChange: -3, unmotivated: 1.5,
  notEstablishing: 50,
  establishingSeconds: 3,
}

interface Candidate { time: number; priority: number }

function candidateTimes(start: number, end: number, lines: readonly CameraStageCoverageLine[], actions: readonly EditAction[], pace: CameraStageEditPace, fps: number): number[] {
  const step = 1 / fps
  const quantize = (time: number): number => Math.round(time / step) * step
  const candidates: Candidate[] = [{ time: start, priority: 3 }]
  lines.forEach((line, index) => {
    const changed = index === 0 || lines[index - 1].speakerId !== line.speakerId
    if (line.startTime > start && line.startTime < end) candidates.push({ time: line.startTime, priority: changed ? 2 : 1 })
  })
  for (const action of actions) {
    const mid = (action.startTime + action.endTime) / 2
    if (mid > start && mid < end && action.endTime - action.startTime >= 0.4) candidates.push({ time: mid, priority: 2 })
  }
  for (const time of reactionPoints(lines, pace)) if (time > start && time < end) candidates.push({ time, priority: 2 })
  const grid = CAMERA_STAGE_EDIT_PACES[pace].target / 2
  for (let time = start + grid; time < end - 0.3; time += grid) candidates.push({ time, priority: 0 })
  const sorted = candidates.map((item) => ({ ...item, time: quantize(item.time) })).sort((left, right) => left.time - right.time || right.priority - left.priority)
  const kept: Candidate[] = []
  for (const item of sorted) {
    const last = kept[kept.length - 1]
    if (last && item.time - last.time < 0.25) { if (item.priority > last.priority && last.time !== start) kept[kept.length - 1] = item; continue }
    kept.push(item)
  }
  return kept.map((item) => item.time)
}

interface Plan {
  setups: StageCoverageSetup[]
  frames: readonly EditFrame[]
  cache: EditViewCache
  usable: boolean[][]
  lines: readonly CameraStageCoverageLine[]
  actions: readonly EditAction[]
  subjectIds: readonly string[]
  pace: CameraStageEditPace
  start: number
  establish: boolean
}

function lineAt(lines: readonly CameraStageCoverageLine[], time: number): CameraStageCoverageLine | undefined {
  return lines.find((line) => time >= line.startTime - 1e-6 && time < line.endTime - 1e-6)
}

/** 对话里想要的景别档：第一句开口时中近景，到最后一句推到近景与特写之间（逐步推近）。 */
function desiredSizeIndex(plan: Plan, time: number): number {
  const first = plan.lines[0]?.startTime ?? plan.start
  const last = plan.lines[plan.lines.length - 1]?.endTime ?? first
  const progress = last > first ? Math.min(1, Math.max(0, (time - first) / (last - first))) : 0
  return 4 + 1.5 * progress
}

/** 长句里切反应镜头的时刻：说到六成。 */
const REACTION_POINT = 0.6

function reactionPoints(lines: readonly CameraStageCoverageLine[], pace: CameraStageEditPace): number[] {
  return lines.filter((line) => line.endTime - line.startTime > CAMERA_STAGE_EDIT_PACES[pace].target)
    .map((line) => line.startTime + REACTION_POINT * (line.endTime - line.startTime))
}

function segmentCost(plan: Plan, setupIndex: number, from: number, to: number): number {
  const setup = plan.setups[setupIndex]
  const pace = CAMERA_STAGE_EDIT_PACES[plan.pace]
  const duration = to - from
  let cost = duration < pace.min
    ? COST.shortBase + COST.shortSlope * (pace.min - duration) / pace.min
    : duration > pace.max
      ? COST.longBase + COST.longSlope * (duration - pace.max)
      : COST.targetWeight * ((duration - pace.target) / pace.target) ** 2
  const primaries = primarySubjectIds(setup)
  const wide = setup.role === 'establishing' || setup.role === 'master'
  for (const frameIndex of plan.cache.indexesIn(from, to)) {
    const time = plan.frames[frameIndex].time
    if (!plan.usable[setupIndex][frameIndex]) cost += COST.unusableFrame
    const view = plan.cache.view(frameIndex, setup.cameraId)
    const line = lineAt(plan.lines, time)
    if (line) {
      const listener = plan.subjectIds.find((id) => id !== line.speakerId)
      // 长句说到后半段，切去看听的人的反应；短句一直拍说话人。
      const lateInLongLine = line.endTime - line.startTime > pace.target && time > line.startTime + 0.55 * (line.endTime - line.startTime)
      if (primaries.length === 1 && primaries[0] === line.speakerId) cost += lateInLongLine ? COST.longLineSpeakerLateFrame : 0
      else if (wide && view?.visible.get(line.speakerId)) cost += COST.speakerWideFrame
      else if (listener && primaries.length === 1 && primaries[0] === listener) cost += lateInLongLine ? 0 : COST.speakerReactionFrame
      else if (setup.role === 'insert') cost += COST.speakerInsertFrame
      else cost += COST.speakerMissingFrame
      const size = view ? Math.max(-1, ...(primaries.length > 0 ? primaries : [...view.sizeIndex.keys()]).map((id) => view.sizeIndex.get(id) ?? -1)) : -1
      // 过肩画面里还有前景那人，读起来比同景别的单人松半档：先过肩、后单人，越说越近。
      const closeness = size - (setup.role === 'over_shoulder' ? 0.5 : 0)
      if (size >= 0) cost += COST.tighteningFrame * Math.abs(closeness - desiredSizeIndex(plan, time))
    } else if (setup.role === 'master') cost += COST.quietMasterFrame
    else if (setup.role === 'establishing') cost += 0
    else if (setup.role === 'insert') cost += COST.quietInsertFrame
    else cost += COST.quietCloseFrame
    for (const action of plan.actions) {
      if (time >= action.startTime && time < action.endTime && view?.visible.get(action.subjectId) !== true) cost += COST.actorHiddenFrame
    }
    // 建立镜头只在开场交代环境，中途再回到大远景就是倒退。
    if (setup.role === 'establishing' && time - plan.start > COST.establishingSeconds) cost += COST.establishingLateFrame
    if (setup.role === 'insert') cost += COST.insertBiasFrame
  }
  return cost
}

function transitionCost(plan: Plan, fromIndex: number, toIndex: number, time: number): number {
  const frameIndex = plan.cache.frameIndexAt(time)
  const before = plan.cache.view(frameIndex, plan.setups[fromIndex].cameraId)
  const after = plan.cache.view(frameIndex, plan.setups[toIndex].cameraId)
  if (!before || !after) return 0
  let cost = 0
  const subjects = plan.cache.subjectsAt(frameIndex)
  if (subjects.length === 2) {
    const a = axisSideAt(before.position, subjects[0], subjects[1])
    const b = axisSideAt(after.position, subjects[0], subjects[1])
    if (a !== 0 && b !== 0 && a !== b) cost += COST.axis
  }
  const sizeOf = (setup: StageCoverageSetup, view: typeof before): number | null => {
    const primary = primarySubjectIds(setup)
    const ids = primary.length > 0 ? primary : [...view.sizeIndex.keys()]
    const sizes = ids.map((id) => view.sizeIndex.get(id)).filter((size): size is number => size !== null && size !== undefined)
    return sizes.length > 0 ? Math.max(...sizes) : sizeIndexOf(setup.size as CameraStageShotSize)
  }
  const sizeBefore = sizeOf(plan.setups[fromIndex], before)
  const sizeAfter = sizeOf(plan.setups[toIndex], after)
  const shared = subjects.find((subject) => subject.objectId && before.visible.get(subject.objectId) && after.visible.get(subject.objectId))
  if (shared && sizeBefore !== null && sizeAfter !== null && viewAngleBetween(before.position, after.position, shared) < 30 && Math.abs(sizeBefore - sizeAfter) < 2) cost += COST.jumpCut
  if (sizeBefore !== null && sizeAfter !== null && Math.abs(sizeBefore - sizeAfter) >= 4) cost += COST.sizeJump
  return cost
}

function cutCost(plan: Plan, time: number): number {
  const inside = plan.actions.find((action) => time > action.startTime + 0.05 && time < action.endTime - 0.05)
  if (inside) {
    const progress = (time - inside.startTime) / (inside.endTime - inside.startTime)
    // 中段奖励；稍偏一点（10%–20%、80%–90%）不奖不罚，检查时只是提示；贴着起止才罚。
    if (progress >= 0.2 && progress <= 0.8) return COST.actionMid
    return progress >= 0.1 && progress <= 0.9 ? 0 : COST.actionEdge
  }
  if (plan.actions.some((action) => Math.abs(time - action.startTime) < 0.4 || Math.abs(time - action.endTime) < 0.4)) return COST.nearActionEdge
  const index = plan.lines.findIndex((line) => Math.abs(line.startTime - time) < 0.05)
  if (index >= 0 && (index === 0 || plan.lines[index - 1].speakerId !== plan.lines[index].speakerId)) return COST.speakerChange
  if (reactionPoints(plan.lines, plan.pace).some((point) => Math.abs(point - time) < 0.05)) return 0
  return COST.unmotivated
}

function openCost(plan: Plan, setupIndex: number): number {
  const hasEstablishing = plan.setups.some((setup) => setup.role === 'establishing')
  return plan.establish && hasEstablishing && plan.setups[setupIndex].role !== 'establishing' ? COST.notEstablishing : 0
}

/** 维特比：best[j][s] = 到第 j 个切点为止、最后一镜用机位 s 的最低代价。 */
function planCuts(plan: Plan, times: readonly number[], end: number): EditSegment[] {
  const bounds = [...times, end]
  const n = bounds.length - 1
  const count = plan.setups.length
  const best = Array.from({ length: n + 1 }, () => new Array<number>(count).fill(Infinity))
  const back = Array.from({ length: n + 1 }, () => new Array<{ i: number; s: number } | null>(count).fill(null))
  const segment = new Map<string, number>()
  const segCost = (s: number, i: number, j: number): number => {
    const key = `${s}:${i}:${j}`
    if (!segment.has(key)) segment.set(key, segmentCost(plan, s, bounds[i], bounds[j]))
    return segment.get(key)!
  }
  for (let j = 1; j <= n; j += 1) {
    for (let s = 0; s < count; s += 1) {
      let value = openCost(plan, s) + segCost(s, 0, j)
      let from: { i: number; s: number } | null = null
      for (let i = 1; i < j; i += 1) {
        const cut = cutCost(plan, bounds[i])
        for (let p = 0; p < count; p += 1) {
          if (p === s || !Number.isFinite(best[i][p])) continue
          const candidate = best[i][p] + cut + transitionCost(plan, p, s, bounds[i]) + segCost(s, i, j)
          if (candidate < value) { value = candidate; from = { i, s: p } }
        }
      }
      best[j][s] = value
      back[j][s] = from
    }
  }
  let s = best[n].indexOf(Math.min(...best[n]))
  let j = n
  const segments: EditSegment[] = []
  while (j > 0) {
    const from = back[j][s]
    const i = from?.i ?? 0
    segments.unshift({ startTime: bounds[i], endTime: bounds[j], cameraId: plan.setups[s].cameraId })
    if (!from) break
    j = from.i
    s = from.s
  }
  return segments
}

function reasonFor(plan: Plan, segment: EditSegment, index: number, names: (id: string) => string): string {
  const setup = plan.setups.find((item) => item.cameraId === segment.cameraId)
  const role = setup ? CAMERA_STAGE_COVERAGE_ROLE_LABELS[setup.role] : '机位'
  if (index === 0) return setup?.role === 'establishing' ? '开场先交代环境' : `开场用${role}`
  const action = plan.actions.find((item) => segment.startTime > item.startTime + 0.05 && segment.startTime < item.endTime - 0.05)
  if (action) return `动作剪辑点：在「${names(action.subjectId)}」${action.label}中段切到${role}`
  const line = plan.lines.find((item) => Math.abs(item.startTime - segment.startTime) < 0.05)
  if (line && setup) {
    const primary = primarySubjectIds(setup)
    if (primary.length === 1 && primary[0] === line.speakerId) return `「${names(line.speakerId)}」开口，切到说话人`
    if (primary.length === 1) return `「${names(line.speakerId)}」开口，切「${names(primary[0])}」听的反应`
    return `「${names(line.speakerId)}」开口，用${role}交代两人`
  }
  const speaking = lineAt(plan.lines, segment.startTime)
  const primary = setup ? primarySubjectIds(setup) : []
  if (speaking && primary.length === 1 && primary[0] !== speaking.speakerId) return `「${names(speaking.speakerId)}」说到后半句，切「${names(primary[0])}」听的反应`
  if (speaking && primary.length === 1) return `「${names(speaking.speakerId)}」说话中，换到${role}镜头`
  return `换${role}保持节奏`
}

function requireCoverage(state: State, coverageId: string): StageCoverage {
  const coverage = liveCoverages(state.coverages, state.objects).find((item) => item.id === coverageId)
  if (coverage) return coverage
  const available = liveCoverages(state.coverages, state.objects).map((item) => `${item.id}（${item.name}）`)
  throw notExecutedFailure(new Error(`COVERAGE_NOT_FOUND：«${coverageId}» 不是本场景的覆盖（或它的摄像机都已删除）。当前覆盖：${available.join('、') || '没有'}；先用 cover_camera_stage_scene 布置。`))
}

function rangeOf(state: State, coverage: StageCoverage | undefined, startTime: number | undefined, endTime: number | undefined): { start: number; end: number } {
  const start = startTime ?? coverage?.startTime ?? 0
  const end = endTime ?? coverage?.endTime ?? Math.max(state.animation.duration, start + 1)
  if (end <= start) throw notExecutedFailure(new Error(`EDIT_RANGE_INVALID：结束时刻 ${end} 秒不晚于开始时刻 ${start} 秒。`))
  return { start, end }
}

/** 机位轨在 [start, end) 里的每一段；null 段换成活动摄像机。 */
export function segmentsFromCuts(cuts: readonly StageCameraCut[], activeCameraId: string | null, start: number, end: number): EditSegment[] {
  const resolve = (cameraId: string | null): string | null => cameraId ?? activeCameraId
  const segments: EditSegment[] = [{ startTime: start, endTime: end, cameraId: resolve(cameraLiveAt(cuts, start)) }]
  for (const cut of cuts) {
    if (cut.time <= start + 1e-6 || cut.time >= end - 1e-6) continue
    const cameraId = resolve(cut.cameraId)
    const last = segments[segments.length - 1]
    if (cameraId === last.cameraId) continue
    last.endTime = cut.time
    segments.push({ startTime: cut.time, endTime: end, cameraId })
  }
  return segments
}

function checkContext(state: State, coverage: StageCoverage | undefined, range: { start: number; end: number }, lines: readonly CameraStageCoverageLine[], pace: CameraStageEditPace, segments: readonly EditSegment[], frames: readonly EditFrame[]) {
  const coverages = liveCoverages(state.coverages, state.objects)
  const subjectIds = coverage?.subjectIds
    ?? state.objects.filter((object) => object.type === 'character' && !object.setId).slice(0, 2).map((object) => object.id)
  return {
    frames,
    startTime: range.start,
    endTime: range.end,
    segments,
    subjectIds,
    setupOf: (cameraId: string | null) => coverageSetupFor(coverages, cameraId, coverage),
    cameraName: (cameraId: string | null) => (cameraId ? state.objects.find((object) => object.id === cameraId)?.name ?? cameraId : '活动摄像机'),
    lines,
    actions: subjectActions(state.animation, subjectIds).filter((action) => action.endTime > range.start && action.startTime < range.end),
    pace,
  }
}

export interface CameraStageCutResult extends EditCheckResult {
  projectId: string
  coverageId: string
  startTime: number
  endTime: number
  pace: CameraStageEditPace
  cutCount: number
  createdCutIds: string[]
  removedCutIds: string[]
  undoToken: string
}

async function cutCameraStageCoverageInternal(input: CameraStageCutInput): Promise<CameraStageCutResult> {
  logger.info('多机位剪辑开始', { event: 'camera_stage.edit.cut.start', projectId: input.projectId, coverageId: input.coverageId, pace: input.pace })
  try {
    await ensureCameraStageProjectRuntime(input.projectId)
    const store = cameraStageProjectStore(input.projectId)
    const state = store.getState()
    const coverage = requireCoverage(state, input.coverageId)
    const range = rangeOf(state, coverage, input.startTime, input.endTime)
    const strangers = [...new Set((input.lines ?? []).map((line) => line.speakerId))].filter((id) => !coverage.subjectIds.includes(id))
    if (strangers.length > 0) throw notExecutedFailure(new Error(`COVERAGE_SPEAKER_NOT_SUBJECT：台词的 speakerId ${strangers.join('、')} 不是这组覆盖的主体（${coverage.subjectIds.join('、')}）。`))
    const lines = (input.lines ?? (coverage.lines.length > 0 ? coverage.lines : inferredLines(state.animation, coverage.subjectIds, range.start, range.end)))
      .filter((line) => line.endTime > range.start && line.startTime < range.end)
      .sort((left, right) => left.startTime - right.startTime)
    const frames = sampleEditFrames(state.objects, state.animation, sampleTimes(range.start, range.end))
    const setupOf = (cameraId: string | null): StageCoverageSetup | null => coverageSetupFor([coverage], cameraId, coverage)
    const cache = new EditViewCache(frames, coverage.subjectIds, setupOf)
    const actions = subjectActions(state.animation, coverage.subjectIds).filter((action) => action.endTime > range.start && action.startTime < range.end)
    const usable = coverage.setups.map((setup) => frames.map((_, index) => {
      const view = cache.view(index, setup.cameraId)
      if (!view) return false
      const keys = setup.role === 'insert' ? [...view.visible.keys()] : primarySubjectIds(setup)
      return keys.length > 0 && keys.every((key) => view.visible.get(key) === true)
    }))
    const plan: Plan = { setups: coverage.setups, frames, cache, usable, lines, actions, subjectIds: coverage.subjectIds, pace: input.pace, start: range.start, establish: input.establish }
    const names = (id: string): string => state.objects.find((object) => object.id === id)?.name ?? id
    const planned = planCuts(plan, candidateTimes(range.start, range.end, lines, actions, input.pace, state.animation.fps), range.end)
      .map((segment, index) => ({ ...segment, reason: reasonFor(plan, segment, index, names) }))

    const beforeCutIds = new Set(state.cameraCuts.map((cut) => cut.id))
    const undoToken = captureCameraStageUndo(input.projectId)
    await afterCameraStageWrite(input.projectId, undoToken, async () => {
      store.getState().replaceCameraCuts(range.start, range.end, planned.map((segment) => ({ time: segment.startTime, cameraId: segment.cameraId })))
      if (input.lines) store.getState().setCoverage({ ...coverage, lines: [...input.lines].sort((left, right) => left.startTime - right.startTime) })
      const written = segmentsFromCuts(store.getState().cameraCuts, store.getState().activeCameraId, range.start, range.end)
      const expected = planned.map((segment) => segment.cameraId).join('>')
      if (written.map((segment) => segment.cameraId).join('>') !== expected) throw new Error('写入机位轨后读回的切镜序列与剪辑结果不一致，已恢复到写入前。')
      await saveCameraStageProjectRuntime(input.projectId)
    })

    const after = store.getState()
    const afterCutIds = new Set(after.cameraCuts.map((cut) => cut.id))
    const written = segmentsFromCuts(after.cameraCuts, after.activeCameraId, range.start, range.end)
      .map((segment) => ({ ...segment, reason: planned.find((item) => Math.abs(item.startTime - segment.startTime) < 1e-3)?.reason }))
    const checked = checkEdit(checkContext(after, coverage, range, lines, input.pace, written, frames), cache)
    logger.info('多机位剪辑完成', {
      event: 'camera_stage.edit.cut.completed', projectId: input.projectId, coverageId: coverage.id,
      shotCount: checked.shots.length, violationCount: checked.violations.length,
    })
    return {
      projectId: input.projectId,
      coverageId: coverage.id,
      startTime: round(range.start),
      endTime: round(range.end),
      pace: input.pace,
      cutCount: after.cameraCuts.filter((cut) => cut.time >= range.start - 1e-6 && cut.time < range.end - 1e-6).length,
      createdCutIds: [...afterCutIds].filter((id) => !beforeCutIds.has(id)),
      removedCutIds: [...beforeCutIds].filter((id) => !afterCutIds.has(id)),
      ...checked,
      undoToken,
    }
  } catch (error) {
    logger.error('多机位剪辑失败', error, { event: 'camera_stage.edit.cut.failed', projectId: input.projectId, coverageId: input.coverageId })
    throw error
  }
}

export const cutCameraStageCoverage = bindCameraStageProjectOperation(cutCameraStageCoverageInternal, (input) => input.projectId)

async function checkCameraStageEditInternal(input: CameraStageCheckInput): Promise<{ documentId: string; startTime: number; endTime: number } & EditCheckResult> {
  await ensureCameraStageProjectRuntime(input.projectId)
  const state = cameraStageProjectStore(input.projectId).getState()
  const coverage = input.coverageId ? requireCoverage(state, input.coverageId) : undefined
  const range = rangeOf(state, coverage, input.startTime, input.endTime)
  const lines = coverage
    ? (coverage.lines.length > 0 ? coverage.lines : inferredLines(state.animation, coverage.subjectIds, range.start, range.end))
      .filter((line) => line.endTime > range.start && line.startTime < range.end)
    : []
  const frames = sampleEditFrames(state.objects, state.animation, sampleTimes(range.start, range.end))
  const segments = segmentsFromCuts(state.cameraCuts, state.activeCameraId, range.start, range.end)
  const result = checkEdit(checkContext(state, coverage, range, lines, input.pace, segments, frames))
  logger.info('剪辑规则检查完成', {
    event: 'camera_stage.edit.check.completed', projectId: input.projectId, coverageId: coverage?.id ?? null,
    shotCount: result.shots.length, violationCount: result.violations.length,
  })
  return { documentId: input.projectId, startTime: round(range.start), endTime: round(range.end), ...result }
}

export const checkCameraStageEdit = bindCameraStageProjectOperation(checkCameraStageEditInternal, (input) => input.projectId)
