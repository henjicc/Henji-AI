import {
  CAMERA_STAGE_COVERAGE_ROLE_LABELS,
  CAMERA_STAGE_EDIT_PACES,
  CAMERA_STAGE_EDIT_RULES,
  type CameraStageCoverageLine,
  type CameraStageEditPace,
  type CameraStageEditRule,
  type CameraStageEditShot,
  type CameraStageEditViolation,
} from '@/core/application-control/domains/cameraStage/cameraStageCoverageSchemas'
import { CAMERA_STAGE_SHOT_SIZES, CAMERA_STAGE_SHOT_SIZE_LABELS } from '@/core/application-control/domains/cameraStage/cameraStageShotSchemas'
import type { StageCoverageSetup } from '../domain/coverage'
import {
  axisSideAt,
  ignoredForSetup,
  primarySubjectIds,
  setupSubjects,
  subjectOf,
  viewAngleBetween,
  viewAt,
  type EditAction,
  type EditCameraView,
  type EditFrame,
} from './editMeasure'
import type { StageShotSubject } from './shotGeometry'

/*
 * 剪辑规则（可检查的条件，判的是量出来的实际画面）：
 * - axis 180° 轴线：相邻两镜在两人连线两侧即越轴；中间夹一镜骑在轴线上（或机位越过轴线的那一镜）就不算。
 * - jump_cut 30°：相邻两镜看同一主体的机位夹角 < 30° 且景别差不到两档，算跳切。
 * - cut_on_action：切点落在动作里时要在中段（20%–80%），紧挨动作起止 0.4 秒内切也提示。
 * - speaker：换人说话时（开口 0.6 秒内）画面要拍说话人，或是听的人的反应；整句都看不到说话人也提示。
 * - duration：镜头时长在节奏的上下限内。
 * - establishing：开场第一镜是建立镜头（或远景以上）。
 * - size_progression：相邻两镜景别跳四档以上（远景直接到特写）提示。
 * - subject_visible：这一镜的主要主体有四成以上时间在画外或被挡。
 * 剪辑（cut_camera_stage_coverage）按同一套条件打分挑镜头，写完再用这里检查一遍。
 */

const ACTION_MID = { from: 0.2, to: 0.8 }
const ACTION_EDGE_SECONDS = 0.4
const SPEAKER_PROBE_SECONDS = 0.6
const VISIBLE_SHARE = 0.6
const ON_AXIS_WIDE_SIZE = 1

export interface EditSegment {
  startTime: number
  endTime: number
  cameraId: string | null
  reason?: string
}

export interface EditCheckContext {
  frames: readonly EditFrame[]
  startTime: number
  endTime: number
  segments: readonly EditSegment[]
  /** 这段戏的主体（一到两人） */
  subjectIds: readonly string[]
  setupOf: (cameraId: string | null) => StageCoverageSetup | null
  cameraName: (cameraId: string | null) => string
  lines: readonly CameraStageCoverageLine[]
  actions: readonly EditAction[]
  pace: CameraStageEditPace
}

export interface EditCheckResult {
  shots: CameraStageEditShot[]
  violations: CameraStageEditViolation[]
  passedRules: CameraStageEditRule[]
  summary: string
}

const round = (value: number, digits = 2): number => Math.round(value * 10 ** digits) / 10 ** digits

/** 每个“帧 × 摄像机”只量一次。 */
export class EditViewCache {
  private readonly views = new Map<string, EditCameraView | null>()

  constructor(private readonly frames: readonly EditFrame[], private readonly subjectIds: readonly string[], private readonly setupOf: (cameraId: string | null) => StageCoverageSetup | null) {}

  frameIndexAt(time: number): number {
    let best = 0
    for (let index = 0; index < this.frames.length; index += 1) {
      if (this.frames[index].time <= time + 1e-6) best = index
      else break
    }
    return best
  }

  subjectsAt(index: number): StageShotSubject[] {
    return this.subjectIds.flatMap((id) => subjectOf(this.frames[index].objects, id) ?? [])
  }

  view(index: number, cameraId: string | null): EditCameraView | null {
    if (!cameraId) return null
    const key = `${index}:${cameraId}`
    if (this.views.has(key)) return this.views.get(key) ?? null
    const frame = this.frames[index]
    const setup = this.setupOf(cameraId)
    const subjects = setup?.role === 'insert' ? setupSubjects(frame, setup) : this.subjectsAt(index)
    const view = viewAt(frame, cameraId, subjects, setup ? ignoredForSetup(setup) : undefined)
    this.views.set(key, view)
    return view
  }

  indexesIn(start: number, end: number): number[] {
    const indexes = this.frames.flatMap((frame, index) => (frame.time >= start - 1e-6 && frame.time < end - 1e-6 ? [index] : []))
    return indexes.length > 0 ? indexes : [this.frameIndexAt(start)]
  }
}

/** 这一镜拍的主要是谁：覆盖里有角色就按角色，否则取画面里最大的那个可见主体。 */
function primaryOf(view: EditCameraView | null, setup: StageCoverageSetup | null, subjectIds: readonly string[]): string | null {
  if (setup) {
    const primaries = primarySubjectIds(setup)
    if (primaries.length === 1) return primaries[0]
    if (setup.role === 'insert') return null
  }
  if (!view) return null
  const visible = subjectIds.filter((id) => view.visible.get(id))
  return visible.sort((left, right) => (view.heightRatio.get(right) ?? 0) - (view.heightRatio.get(left) ?? 0))[0] ?? null
}

function shotSizeIndex(view: EditCameraView | null, primary: string | null, setup: StageCoverageSetup | null): number | null {
  if (!view) return null
  if (setup?.role === 'insert') return [...view.sizeIndex.values()][0] ?? null
  if (primary) return view.sizeIndex.get(primary) ?? null
  const sizes = [...view.sizeIndex.entries()].filter(([id]) => view.visible.get(id)).map(([, size]) => size).filter((size): size is number => size !== null)
  return sizes.length > 0 ? Math.max(...sizes) : null
}

interface MeasuredShot extends CameraStageEditShot {
  midIndex: number
  sizeIndex: number | null
  /** 主要主体在这一镜里可见的帧占比 */
  primaryShare: number
}

function measureShots(context: EditCheckContext, cache: EditViewCache): MeasuredShot[] {
  return context.segments.map((segment, index) => {
    const setup = context.setupOf(segment.cameraId)
    const indexes = cache.indexesIn(segment.startTime, segment.endTime)
    const midIndex = indexes[Math.floor(indexes.length / 2)]
    const mid = cache.view(midIndex, segment.cameraId)
    const primary = primaryOf(mid, setup, context.subjectIds)
    const expected = setup ? (setup.role === 'insert' ? null : primarySubjectIds(setup)) : primary ? [primary] : []
    const shares = indexes.map((frameIndex) => {
      // 场景里没有可拍的主体时这条规则不适用。
      if (!setup && context.subjectIds.length === 0) return true
      const view = cache.view(frameIndex, segment.cameraId)
      if (!view) return false
      if (expected === null) return [...view.visible.values()].some(Boolean)
      return expected.length > 0 && expected.every((id) => view.visible.get(id))
    })
    const sizeIndex = shotSizeIndex(mid, primary, setup)
    return {
      index,
      startTime: round(segment.startTime),
      endTime: round(segment.endTime),
      duration: round(segment.endTime - segment.startTime),
      cameraId: segment.cameraId,
      cameraName: context.cameraName(segment.cameraId),
      role: setup?.role ?? null,
      size: sizeIndex === null ? null : CAMERA_STAGE_SHOT_SIZES[sizeIndex],
      primarySubjectId: primary,
      visibleSubjectIds: context.subjectIds.filter((id) => mid?.visible.get(id)),
      ...(segment.reason ? { reason: segment.reason } : {}),
      midIndex,
      sizeIndex,
      primaryShare: shares.filter(Boolean).length / shares.length,
    }
  })
}

const sizeLabel = (index: number | null): string => index === null ? '看不到主体' : CAMERA_STAGE_SHOT_SIZE_LABELS[CAMERA_STAGE_SHOT_SIZES[index]]

function shotLabel(shot: MeasuredShot): string {
  return `第 ${shot.index + 1} 镜「${shot.cameraName}」${shot.role ? `（${CAMERA_STAGE_COVERAGE_ROLE_LABELS[shot.role]}）` : ''}`
}

/** 两人轴线：换镜那一刻两人的位置。 */
function axisSubjects(cache: EditViewCache, frameIndex: number, subjectIds: readonly string[]): [StageShotSubject, StageShotSubject] | null {
  if (subjectIds.length < 2) return null
  const subjects = cache.subjectsAt(frameIndex)
  return subjects.length === 2 ? [subjects[0], subjects[1]] : null
}

export function checkEdit(context: EditCheckContext, cache = new EditViewCache(context.frames, context.subjectIds, context.setupOf)): EditCheckResult {
  const shots = measureShots(context, cache)
  const violations: CameraStageEditViolation[] = []
  const pace = CAMERA_STAGE_EDIT_PACES[context.pace]
  const name = (id: string): string => context.frames[0]?.objects.find((object) => object.id === id)?.name ?? id

  shots.forEach((shot, index) => {
    // 主体出画或被挡
    if (shot.role !== 'insert' && shot.primaryShare < VISIBLE_SHARE) {
      violations.push({
        rule: 'subject_visible', severity: 'error', shotIndexes: [index], time: round((shot.startTime + shot.endTime) / 2),
        message: `${shotLabel(shot)}里主要主体有 ${Math.round((1 - shot.primaryShare) * 100)}% 的时间在画外或被挡`,
        suggestion: '换一台拍得到主体的机位（看 cover_camera_stage_scene 结果里的 visibleSpans），或在这段用主镜头、建立镜头',
      })
    }
    // 镜头时长
    const isLast = index === shots.length - 1
    if (shot.duration < pace.min - 1e-6 && !(isLast && shots.length === 1)) {
      violations.push({
        rule: 'duration', severity: 'warning', shotIndexes: [index], time: shot.startTime,
        message: `${shotLabel(shot)}只有 ${shot.duration} 秒，短于${pace.label}节奏的下限 ${pace.min} 秒`,
        suggestion: '和前后一镜合并，或改用更快的节奏',
      })
    }
    if (shot.duration > pace.max + 1e-6) {
      violations.push({
        rule: 'duration', severity: 'warning', shotIndexes: [index], time: shot.startTime,
        message: `${shotLabel(shot)}有 ${shot.duration} 秒，长于${pace.label}节奏的上限 ${pace.max} 秒`,
        suggestion: '在中途切一次反应镜头或换个景别，或改用更慢的节奏',
      })
    }
  })

  // 开场建立
  const first = shots[0]
  if (first && first.role !== 'establishing' && !(first.sizeIndex !== null && first.sizeIndex <= ON_AXIS_WIDE_SIZE)) {
    violations.push({
      rule: 'establishing', severity: 'warning', shotIndexes: [0], time: first.startTime,
      message: `开场第一镜是${sizeLabel(first.sizeIndex)}，没有先交代环境`,
      suggestion: '开场先用建立镜头（大远景或远景）再推近',
    })
  }

  // 相邻两镜：越轴、跳切、景别跳变、动作剪辑点
  for (let index = 1; index < shots.length; index += 1) {
    const before = shots[index - 1]
    const after = shots[index]
    const cutTime = after.startTime
    const frameIndex = cache.frameIndexAt(cutTime)
    const viewBefore = cache.view(frameIndex, before.cameraId)
    const viewAfter = cache.view(frameIndex, after.cameraId)
    const pair = axisSubjects(cache, frameIndex, context.subjectIds)
    if (pair && viewBefore && viewAfter && before.cameraId !== after.cameraId) {
      const sideBefore = axisSideAt(viewBefore.position, pair[0], pair[1])
      const sideAfter = axisSideAt(viewAfter.position, pair[0], pair[1])
      if (sideBefore !== 0 && sideAfter !== 0 && sideBefore !== sideAfter) {
        violations.push({
          rule: 'axis', severity: 'error', shotIndexes: [index - 1, index], time: cutTime,
          message: `${shotLabel(before)}与${shotLabel(after)}在「${pair[0].name}」「${pair[1].name}」连线两侧，越轴后两人在画面上左右对调`,
          suggestion: '换成轴线同侧的机位，或在两镜之间插一镜骑在轴线上的镜头（机位在两人连线的延长线附近）',
        })
      }
      const shared = context.subjectIds.find((id) => viewBefore.visible.get(id) && viewAfter.visible.get(id))
      const subject = shared ? pair.find((item) => item.objectId === shared) : undefined
      if (subject && before.sizeIndex !== null && after.sizeIndex !== null) {
        const angle = viewAngleBetween(viewBefore.position, viewAfter.position, subject)
        const sizeGap = Math.abs(before.sizeIndex - after.sizeIndex)
        if (angle < 30 && sizeGap < 2) {
          violations.push({
            rule: 'jump_cut', severity: 'error', shotIndexes: [index - 1, index], time: cutTime,
            message: `${shotLabel(before)}与${shotLabel(after)}看「${subject.name}」只差 ${Math.round(angle)}°、景别差 ${sizeGap} 档，是跳切`,
            suggestion: '换一台机位夹角至少 30° 的镜头，或让景别差两档以上（如中景接特写）',
          })
        }
      }
    }
    if (before.sizeIndex !== null && after.sizeIndex !== null && Math.abs(before.sizeIndex - after.sizeIndex) >= 4) {
      violations.push({
        rule: 'size_progression', severity: 'warning', shotIndexes: [index - 1, index], time: cutTime,
        message: `${sizeLabel(before.sizeIndex)}直接切到${sizeLabel(after.sizeIndex)}，景别跳了 ${Math.abs(before.sizeIndex - after.sizeIndex)} 档`,
        suggestion: '中间加一镜过渡景别（如远景→中景→近景），让镜头逐步推近',
      })
    }
    const inside = context.actions.find((action) => cutTime > action.startTime + 0.05 && cutTime < action.endTime - 0.05)
    if (inside) {
      const progress = (cutTime - inside.startTime) / (inside.endTime - inside.startTime)
      if (progress < ACTION_MID.from || progress > ACTION_MID.to) {
        const mid = round((inside.startTime + inside.endTime) / 2)
        violations.push({
          rule: 'cut_on_action', severity: 'warning', shotIndexes: [index - 1, index], time: cutTime,
          message: `切点落在「${name(inside.subjectId)}」${inside.label}的${progress < 0.5 ? '开头' : '结尾'}（${Math.round(progress * 100)}%）`,
          suggestion: `把切点挪到 ${mid} 秒左右（动作中段），动作跨过切点更顺`,
        })
      }
    } else {
      const edge = context.actions.find((action) => Math.abs(cutTime - action.startTime) < ACTION_EDGE_SECONDS || Math.abs(cutTime - action.endTime) < ACTION_EDGE_SECONDS)
      if (edge) {
        violations.push({
          rule: 'cut_on_action', severity: 'warning', shotIndexes: [index - 1, index], time: cutTime,
          message: `切点紧挨着「${name(edge.subjectId)}」${edge.label}的${Math.abs(cutTime - edge.startTime) < ACTION_EDGE_SECONDS ? '起点' : '终点'}`,
          suggestion: `把切点挪进动作中段（约 ${round((edge.startTime + edge.endTime) / 2)} 秒）`,
        })
      }
    }
  }

  // 说话人
  context.lines.forEach((line, lineIndex) => {
    const previous = context.lines[lineIndex - 1]
    const changed = !previous || previous.speakerId !== line.speakerId || line.startTime - previous.endTime > 1.5
    const listener = context.subjectIds.find((id) => id !== line.speakerId) ?? null
    const probe = Math.min(line.endTime - 1e-3, line.startTime + SPEAKER_PROBE_SECONDS)
    const shotIndex = shots.findIndex((shot) => probe >= shot.startTime - 1e-6 && probe < shot.endTime - 1e-6)
    const shot = shots[shotIndex]
    if (!shot) return
    const frameIndex = cache.frameIndexAt(probe)
    const view = cache.view(frameIndex, shot.cameraId)
    const speakerVisible = view?.visible.get(line.speakerId) === true
    const reaction = !!listener && shot.primarySubjectId === listener && view?.visible.get(listener) === true
    if (changed && !speakerVisible && !reaction) {
      violations.push({
        rule: 'speaker', severity: 'error', shotIndexes: [shotIndex], time: round(line.startTime),
        message: `${round(line.startTime)} 秒换「${name(line.speakerId)}」说话时，${shotLabel(shot)}既没拍到说话人，也不是听的人的反应`,
        suggestion: `在 ${round(line.startTime)} 秒切到拍「${name(line.speakerId)}」的单人或过肩镜头${listener ? `，或切「${name(listener)}」的反应镜头` : ''}`,
      })
      return
    }
    const lineShots = shots.filter((item) => item.endTime > line.startTime + 1e-6 && item.startTime < line.endTime - 1e-6)
    const seen = lineShots.some((item) => cache.indexesIn(Math.max(item.startTime, line.startTime), Math.min(item.endTime, line.endTime))
      .some((index) => cache.view(index, item.cameraId)?.visible.get(line.speakerId)))
    const reacted = lineShots.some((item) => !!listener && item.primarySubjectId === listener)
    if (!seen && !reacted) {
      violations.push({
        rule: 'speaker', severity: 'warning', shotIndexes: lineShots.map((item) => item.index), time: round(line.startTime),
        message: `「${name(line.speakerId)}」${round(line.startTime)}–${round(line.endTime)} 秒这句话整句都看不到说话人`,
        suggestion: `这句里至少给「${name(line.speakerId)}」一镜`,
      })
    }
  })

  violations.sort((left, right) => left.time - right.time)
  const broken = new Set(violations.map((violation) => violation.rule))
  const passedRules = CAMERA_STAGE_EDIT_RULES.filter((rule) => !broken.has(rule) && (rule !== 'speaker' || context.lines.length > 0))
  const errors = violations.filter((violation) => violation.severity === 'error').length
  const summary = violations.length === 0
    ? `${shots.length} 镜全部通过剪辑规则检查。`
    : `${shots.length} 镜里有 ${errors} 处错误、${violations.length - errors} 处提示：${[...broken].join('、')}。`
  return {
    shots: shots.map(({ midIndex: _mid, sizeIndex: _size, primaryShare: _share, ...shot }) => shot),
    violations,
    passedRules,
    summary,
  }
}
