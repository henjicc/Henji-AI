import type { MotionReviewPolicy, MotionReviewSample } from '../media/motionReview'
import { evaluateCodeMaterial } from './codeMaterial/evaluate'
import { codeElementBounds, codeLocalBounds, codePoint, codeTransform, type CodeElementBounds } from './codeMaterial/geometry'
import type { CodeDrawCommand, CodeMaterialProgram, CodeTextLayout, CodeTextMeasureRequest } from './codeMaterial/contract'
import { codeMaterialContextForFrame, codeMaterialContextForTransitionFrame } from './codeMaterialTiming'
import { evaluateCodeMaterialParameters, prepareCodeMaterialParameters } from './codeMaterialAnimation'
import { videoEditClipSourceTimeAt } from './clipSpeed'
import type { VideoEditComposition } from './document'
import { videoEditSourceMapLocalFrame, visitVideoEditPictureInstances, type VideoEditSourceMapEntry, type VideoEditSourceMapRange } from './sourceMap'
import { videoEditMotionSampleFacts, VIDEO_EDIT_MOTION_STRUCTURE_SAMPLE_BUDGET, type VideoEditMotionStructureFact } from './motionStructure'
import { activeVideoEditEffects } from './compositing'
import { codeMaterialUsesAudio } from './codeMaterialResources'
import { codeAudioTime, codeMotionAudioKey } from './codeAudio'
import type { AudioContentAnalysis } from '../audioAnalysis/contentAnalysis'

export interface CodeMotionReviewResult { records: VideoEditMotionStructureFact[]; sampledFrames: number; sampledElements: number; warnings: string[] }
class NeedsTextMeasurement extends Error { constructor(readonly request: CodeTextMeasureRequest) { super('需要共享字体度量。') } }
interface State { path: string[]; points: Array<[number, number]>; signature: string; visible: boolean; group: boolean; pixelsUnknown: boolean }
interface Trace { path: string[]; samples: MotionReviewSample[]; group: boolean; pixelsUnknown: boolean }

function state(bound: CodeElementBounds, program: CodeMaterialProgram): State {
  const command = bound.command
  // A group's child bounds change when a child animates. Use a fixed local basis
  // for group motion; children measure only their own transform, never the parent's.
  const box = command.kind === 'group' ? { x: 0, y: 0, width: program.width, height: program.height } : codeLocalBounds(command)
  const matrix = codeTransform(command)
  const points = [[box.x, box.y], [box.x + box.width, box.y], [box.x, box.y + box.height], [box.x + box.width, box.y + box.height]].map(([x, y]) => codePoint(matrix, x, y))
  const visible = bound.opacity > 1e-8 && bound.width > 0 && bound.height > 0 && bound.x < program.width && bound.y < program.height && bound.x + bound.width > 0 && bound.y + bound.height > 0
  const path = bound.elementPath.length ? bound.elementPath : [bound.elementId]
  const own = { ...command } as Record<string, unknown>
  for (const key of ['children', 'layout', 'elementId', 'elementPath', 'sourceSpan', 'x', 'y', 'scale', 'scaleX', 'scaleY', 'rotation', 'anchorX', 'anchorY', 'matrix']) delete own[key]
  if (command.kind === 'shader') delete own.time
  const signature = JSON.stringify(own)
  return { path, points, signature, visible, group: command.kind === 'group', pixelsUnknown: command.kind === 'shader' || command.kind === 'image' && command.source.kind !== 'image' }
}

/** Evaluate checked author IR, source-anchored parameters and element overrides.
 * Text comes from the rendering host's real metrics; no guessed widths or pixels.
 * All CPU work is intended for the motion Worker, with explicit resource budgets. */
export async function collectVideoEditCodeMotion(root: VideoEditComposition, range: VideoEditSourceMapRange, programs: Readonly<Record<string, CodeMaterialProgram>>, policy: MotionReviewPolicy,
  measureText: (request: CodeTextMeasureRequest) => CodeTextLayout | Promise<CodeTextLayout>, audios: Readonly<Record<string, AudioContentAnalysis>> = {}): Promise<CodeMotionReviewResult> {
  const records: VideoEditMotionStructureFact[] = [], warnings = new Set<string>()
  const jobs: Array<{ local: VideoEditComposition; entry: VideoEditSourceMapEntry; program: CodeMaterialProgram }> = []
  let plannedFrames = 0, sampledFrames = 0, sampledElements = 0, operations = 0, cacheBytes = 0
  const layouts = new Map<string, { layout: CodeTextLayout; bytes: number }>()
  visitVideoEditPictureInstances(root, range, { sequence() {}, clip(local, entry) {
    const step = entry.path.at(-1)!, clip = step.clip
    const unknown = (detail: string): void => { records.push({ kind: 'code_unavailable', sequenceId: local.id, path: entry.path, subjectId: step.clipId, timeline: entry.timeline, basis: 'code_structure', detail }) }
    if (activeVideoEditEffects(clip).some(effect => effect.code)) unknown('代码滤镜的像素结果需按检查帧观察，不能用图层几何判定。')
    if (clip.kind !== 'code' || !clip.code) return
    const program = programs[clip.code.versionId]
    if (!program || program.kind !== 'generator' || program.languageVersion !== 3) { unknown('此代码版本没有可复用的第三版元素结构；请按检查帧观察结果。'); return }
    if (codeMaterialUsesAudio(program) && !audios[codeMotionAudioKey(local.id, clip.id)]) { unknown('此代码由声音驱动，尚未提供同源声音分析，未用零值伪造动作。'); return }
    plannedFrames += entry.timeline.to - entry.timeline.from
    if (plannedFrames > VIDEO_EDIT_MOTION_STRUCTURE_SAMPLE_BUDGET) throw new Error('代码运动结构超过单次60000帧实例预算，请缩小 from/to；未截断证据。')
    jobs.push({ local, entry, program })
  } })
  const measured = (request: CodeTextMeasureRequest): CodeTextLayout => {
    const key = JSON.stringify(request), known = layouts.get(key)
    if (!known) throw new NeedsTextMeasurement(request)
    layouts.delete(key); layouts.set(key, known)
    return known.layout
  }
  for (const { local, entry, program } of jobs) {
    const step = entry.path.at(-1)!, clip = step.clip, parameters = prepareCodeMaterialParameters(program, clip.code!)
    const traces = new Map<string, Trace>()
    let previous = new Map<string, State>()
    const firstLocal = videoEditSourceMapLocalFrame(entry, entry.timeline.from), lastLocal = videoEditSourceMapLocalFrame(entry, entry.timeline.to - 1)
    const window = { start: Math.min(firstLocal, lastLocal), end: Math.max(firstLocal, lastLocal) + 1 }
    for (let frame = entry.timeline.from; frame < entry.timeline.to; frame++) {
      sampledFrames++
      const localFrame = videoEditSourceMapLocalFrame(entry, frame)
      const context = localFrame >= clip.start && localFrame < clip.start + clip.duration ? codeMaterialContextForFrame(clip, localFrame, local.frameRate, program)
        : codeMaterialContextForTransitionFrame(clip, localFrame, local.frameRate, program, window)
      const audio = audios[codeMotionAudioKey(local.id, clip.id)]
      if (audio) { context.audio = audio; context.audioTime = codeAudioTime(clip, localFrame, local.fps) }
      const sourceTime = videoEditClipSourceTimeAt(clip, localFrame - clip.start, local.frameRate, program.mode === 'static')
      const values = evaluateCodeMaterialParameters(parameters, sourceTime)
      let commands: CodeDrawCommand[]
      const requested = new Set<string>()
      for (;;) {
        let reported = false
        try {
          commands = evaluateCodeMaterial(program, context, values, { elementOverrides: clip.elementOverrides, sourceTime, transitionHandles: localFrame < clip.start || localFrame >= clip.start + clip.duration, cullInvisible: false, measureText: measured,
            onEvaluation: value => { reported = true; operations += value.operations; if (operations > 20000000) throw new Error('代码运动求值超过单次两千万操作预算，请缩小 from/to；未截断证据。') } })
          break
        } catch (error) {
          if (!(error instanceof NeedsTextMeasurement)) throw error
          // Failed evaluations do not report their work; charge the compiler's
          // conservative bound so repeated measurement retries remain bounded.
          if (!reported) operations += program.metrics.cpuOperations
          if (operations > 20000000) throw new Error('代码文字测量重试超过求值预算，请缩小 from/to 或简化本帧。')
          const key = JSON.stringify(error.request)
          if (requested.has(key)) throw new Error('本帧文字度量超出缓存容量，请简化本帧文字；未循环重试。')
          requested.add(key)
          const layout = await measureText(error.request), bytes = key.length * 2 + layout.glyphs.length * 64 + 256
          if (bytes > 8 * 1024 ** 2) throw new Error('单份文字度量超过运动分析预算，请缩短文字或简化本帧。')
          while (layouts.size && cacheBytes + bytes > 8 * 1024 ** 2) { const oldest = layouts.keys().next().value!; cacheBytes -= layouts.get(oldest)!.bytes; layouts.delete(oldest) }
          layouts.set(key, { layout, bytes }); cacheBytes += bytes
          if (layout.missingFont) warnings.add('部分代码文字沿正式渲染使用替代字体，请看图复核排版。')
        }
      }
      const current = new Map<string, State>()
      const bounds = codeElementBounds(commands)
      sampledElements += bounds.length
      if (sampledElements > 200000) throw new Error('代码运动超过单次200000元素帧预算，请缩小 from/to；未截断证据。')
      for (const bound of bounds) {
        const value = state(bound, program), key = JSON.stringify(value.path)
        current.set(key, value)
      }
      for (const key of new Set([...previous.keys(), ...current.keys()])) {
        const before = previous.get(key), after = current.get(key)
        if (!before?.visible && !after?.visible) continue
        const active = after ?? before!
        let trace = traces.get(key)
        if (!trace) { trace = { path: active.path, samples: [], group: active.group, pixelsUnknown: active.pixelsUnknown }; traces.set(key, trace) }
        trace.pixelsUnknown ||= active.pixelsUnknown
        const both = Boolean(before?.visible && after?.visible)
        const speed = both ? Math.max(...after!.points.map((point, i) => Math.hypot(point[0] - before!.points[i][0], point[1] - before!.points[i][1]))) / program.width * root.fps * 100 : null
        const changed = frame > entry.timeline.from && (before?.visible !== after?.visible || both && before!.signature !== after!.signature)
        trace.samples.push({ fromSeconds: frame / root.fps, toSeconds: (frame + 1) / root.fps, speed, zoom: 0, change: changed ? 1 : 0, cut: false,
          still: both && speed! < 1e-8 && !changed && !active.pixelsUnknown })
      }
      previous = current
    }
    for (const trace of traces.values()) {
      const base = { sequenceId: local.id, path: entry.path, subjectId: step.clipId, basis: 'code_structure' as const, elementPath: trace.path }
      records.push(...videoEditMotionSampleFacts(trace.samples, base, entry.timeline, root.fps, policy, !trace.group && !trace.pixelsUnknown))
      if (trace.pixelsUnknown) records.push({ ...base, kind: 'code_unavailable', timeline: entry.timeline, detail: '此元素含视频、序列输入或着色器，几何不能证明内部像素静止；请定向观察。' })
      if (records.length > 20000) throw new Error('代码运动候选超过单次20000项预算，请缩小 from/to；未截断结果。')
    }
  }
  // An ancestor's appearance/fade is one component event. Children still retain
  // their independent motion; only identical-time content changes are grouped.
  const changeKey = (record: VideoEditMotionStructureFact, path: string[]): string => JSON.stringify([record.sequenceId, record.path.map(step => step.clipId), record.timeline.from, path])
  const changes = new Set(records.filter(record => record.kind === 'code_change').map(record => changeKey(record, record.elementPath!)))
  const filtered = records.filter(record => record.kind !== 'code_change' || !record.elementPath!.some((_, index) => index > 0 && changes.has(changeKey(record, record.elementPath!.slice(0, index)))))
  if (filtered.length > 20000) throw new Error('代码运动候选超过单次20000项预算，请缩小 from/to；未截断结果。')
  return { records: filtered, sampledFrames, sampledElements, warnings: [...warnings] }
}
