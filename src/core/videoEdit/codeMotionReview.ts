import type { MotionReviewPolicy, MotionReviewSample } from '../media/motionReview'
import type { CodeAuthorProgram, CodeAuthorFrameObservation, AuthorElementObservation } from './codeAuthorProgram'
import type { VideoEditComposition } from './document'
import { videoEditSourceMapLocalFrame, visitVideoEditPictureInstances, type VideoEditSourceMapEntry, type VideoEditSourceMapRange } from './sourceMap'
import { videoEditMotionSampleFacts, VIDEO_EDIT_MOTION_STRUCTURE_SAMPLE_BUDGET, type VideoEditMotionStructureFact } from './motionStructure'
import { activeVideoEditEffects } from './compositing'
import { videoEditClipToFrame } from './clipGeometry'
import { evaluateVideoEditClip } from './keyframes'
import { videoEditJitterFacts, videoEditPictureRole, videoEditRootMapper, videoEditSafeAreaFacts, videoEditSampleSegments, type VideoEditPictureSample } from './pictureReview'
import { videoEditTextOverflowFacts, type VideoEditTextDrawSample } from './textOverflowReview'
import { textRectCorners } from './textDrawObservation'
import { codePoint, codeMultiply } from './codeMaterial/geometry'

export interface CodeMotionReviewResult { records: VideoEditMotionStructureFact[]; sampledFrames: number; sampledElements: number; warnings: string[] }
export type CodeMotionObserver = (composition: VideoEditComposition, frame: number) => Promise<CodeAuthorFrameObservation>

/** Geometry comes from the real render worker. Arbitrary draw internals cannot be
 * inferred from stationary bounds; never report those pixels as proven still. */
export async function collectVideoEditCodeMotion(root: VideoEditComposition, range: VideoEditSourceMapRange, programs: Readonly<Record<string, CodeAuthorProgram>>, policy: MotionReviewPolicy, observe: CodeMotionObserver): Promise<CodeMotionReviewResult> {
  const records: VideoEditMotionStructureFact[] = []
  const textCoverage = new Map<string, { name: string; drawn: boolean }>(), uncoveredText = new Set<string>()
  const jobs: Array<{ local: VideoEditComposition; entry: VideoEditSourceMapEntry }> = []
  let plannedFrames = 0, sampledFrames = 0, sampledElements = 0
  visitVideoEditPictureInstances(root, range, { sequence() {}, clip(local, entry) {
    const clip = entry.path.at(-1)!.clip
    const unknown = (detail: string): void => { records.push({ kind: 'code_unavailable', sequenceId: local.id, path: entry.path, subjectId: clip.id, timeline: entry.timeline, basis: 'code_structure', detail }) }
    if (activeVideoEditEffects(clip).some(effect => effect.code)) unknown('代码滤镜的像素结果需按检查帧观察，不能用图层几何判定。')
    if (clip.kind !== 'code' || !clip.code) return
    if (!programs[clip.code.versionId]) { unknown('此代码版本尚未检查，请重新打开工程后观察。'); return }
    plannedFrames += entry.timeline.to - entry.timeline.from
    if (plannedFrames > VIDEO_EDIT_MOTION_STRUCTURE_SAMPLE_BUDGET) throw new Error('代码运动结构超过单次60000帧实例预算，请缩小 from/to；未截断证据。')
    jobs.push({ local, entry })
  } })
  for (const { local, entry } of jobs) {
    const clip = entry.path.at(-1)!.clip
    const traces = new Map<string, MotionReviewSample[]>()
    // Output-pixel geometry in the queried sequence for the picture checks (jitter, safe areas).
    const pictures = new Map<string, { element: AuthorElementObservation; samples: VideoEditPictureSample[] }>()
    const textSamples = new Map<string, Map<number, VideoEditTextDrawSample[]>>()
    const layouts = new Map<string, string>(), drawnLayouts = new Set<string>()
    let previous = new Map<string, AuthorElementObservation>()
    for (let frame = entry.timeline.from; frame < entry.timeline.to; frame++) {
      const localFrame = videoEditSourceMapLocalFrame(entry, frame)
      const observed = await observe(local, localFrame)
      if (observed.sequenceId !== local.id || observed.revision !== local.revision || observed.frame !== localFrame) throw new Error('运动观察对应的画面已改变，请重试。')
      const layer = observed.clips.find(value => value.clipId === clip.id && value.versionId === clip.code!.versionId)
      const current = new Map((layer?.elements ?? []).map(element => [element.id, element]))
      sampledFrames++; sampledElements += current.size
      if (sampledElements > 200000) throw new Error('代码运动采样超过单次200000元素帧预算，请缩小 from/to；未截断证据。')
      if (layer && current.size) {
        const placement = evaluateVideoEditClip(clip, localFrame), toRoot = videoEditRootMapper(root, entry.path.slice(0, -1), frame)
        const parentOpacity = entry.path.slice(0, -1).reduce((opacity, step, index) => opacity * evaluateVideoEditClip(step.clip, videoEditSourceMapLocalFrame({ path: entry.path.slice(0, index + 1) }, frame)).opacity, 1)
        const picture = { width: layer.width, height: layer.height }
        for (const element of current.values()) {
          if (element.corners.length !== 4) continue
          const quad = element.corners.map(([x, y]) => { const point = toRoot(videoEditClipToFrame(placement, picture, local, x / picture.width, y / picture.height)); return { x: point.x * root.width, y: point.y * root.height } })
          const picked = pictures.get(element.id) ?? { element, samples: [] }
          picked.samples.push({ frame, quad, opacity: (element.opacity ?? 1) * placement.opacity }); pictures.set(element.id, picked)
          const coverageKey = JSON.stringify([entry.path.map(step => step.clipId), element.id]), coverage = textCoverage.get(coverageKey)
          if (element.textDraws?.length || element.textUncovered?.some(reason => reason.includes('Canvas 文字'))) textCoverage.set(coverageKey, { name: element.name || element.id, drawn: !!element.textDraws?.length || !!coverage?.drawn })
          for (const id of element.textLayouts ?? []) layouts.set(id, element.name || element.id)
          for (const id of element.unassignedTextLayouts ?? []) if (!layouts.has(id)) layouts.set(id, clip.name || element.name || element.id)
          for (const draw of element.textDraws ?? []) if (draw.layoutId) drawnLayouts.add(draw.layoutId)
          for (const reason of element.textUncovered ?? []) uncoveredText.add(reason)
          const toOutput = ([x, y]: [number, number]): [number, number] => {
            const point = toRoot(videoEditClipToFrame(placement, picture, local, x / picture.width, y / picture.height))
            return [point.x * root.width, point.y * root.height]
          }
          for (const [drawIndex, draw] of (element.textDraws ?? []).entries()) {
            draw.uncovered.forEach(reason => uncoveredText.add(reason))
            if (draw.boundsKind !== 'measured') uncoveredText.add('墨迹范围只有估计值，未覆盖正文裁切判定')
            const matrix = codeMultiply(element.matrix, draw.matrix)
            const localPoint = ([x, y]: [number, number]): [number, number] => toOutput(codePoint(element.matrix, x, y))
            const inkQuad = draw.inkBounds ? textRectCorners(draw.inkBounds).map(([x, y]) => toOutput(codePoint(matrix, x, y))) : []
            const effectiveClips = draw.clips.map(clip => clip.map(localPoint))
            if (draw.stageClip) { const [x, y, right, bottom] = draw.stageClip; effectiveClips.push(textRectCorners({ x, y, width: right - x, height: bottom - y }).map(toOutput)) }
            const frameClips = [textRectCorners({ x: 0, y: 0, width: root.width, height: root.height }), textRectCorners({ x: 0, y: 0, width: picture.width, height: picture.height }).map(toOutput)]
            if (draw.canvasClip) frameClips.push(draw.canvasClip.map(localPoint))
            // 嵌套序列会在每层画幅裁切，不能只检查最后的根画幅。
            for (let depth = 0; depth < entry.path.length; depth++) {
              const mapper = videoEditRootMapper(root, entry.path.slice(0, depth), frame)
              frameClips.push([[0, 0], [1, 0], [1, 1], [0, 1]].map(([x, y]) => { const p = mapper({ x, y }); return [p.x * root.width, p.y * root.height] }))
            }
            const draws = textSamples.get(element.id) ?? new Map<number, VideoEditTextDrawSample[]>(), samples = draws.get(drawIndex) ?? []
            samples.push({ frame, drawIndex, draw: { ...draw, matrix }, inkQuad, effectiveClips, frameClips, opacity: (element.opacity ?? 1) * placement.opacity * parentOpacity * draw.opacity })
            draws.set(drawIndex, samples); textSamples.set(element.id, draws)
          }
        }
      }
      for (const id of new Set([...previous.keys(), ...current.keys()])) {
        const before = previous.get(id), after = current.get(id), both = before && after
        const speed = both ? Math.max(...after.corners.map((point, i) => Math.hypot(point[0] - before.corners[i][0], point[1] - before.corners[i][1]))) / (layer?.width ?? local.width) * root.fps * 100 : null
        const samples = traces.get(id) ?? []
        samples.push({ fromSeconds: frame / root.fps, toSeconds: (frame + 1) / root.fps, speed, zoom: 0, change: frame > entry.timeline.from && Boolean(before) !== Boolean(after) ? 1 : 0, cut: false, still: false })
        traces.set(id, samples)
      }
      previous = current
    }
    const undrawn = new Set([...layouts].filter(([id]) => !drawnLayouts.has(id)).map(([, name]) => name))
    for (const name of undrawn) uncoveredText.add(`${name}：查询区间内已排版但没有 drawText 该布局，整段文字约束与遗漏未覆盖；请绘制整段布局`)
    for (const [id, samples] of traces) {
      const picked = pictures.get(id), name = picked?.element.name.trim() || id
      const base = { sequenceId: local.id, path: entry.path, subjectId: clip.id, basis: 'code_structure' as const, elementPath: [id], label: clip.name ? `${clip.name} · ${name}` : name }
      records.push(...videoEditMotionSampleFacts(samples, base, entry.timeline, root.fps, policy, false))
      const first = picked?.samples.find(sample => sample.opacity >= .01)
      if (picked && first) {
        const role = videoEditPictureRole(picked.element, first.quad)
        records.push(...videoEditJitterFacts(picked.samples, root.fps, base, role), ...videoEditSafeAreaFacts(videoEditSampleSegments(picked.samples, root.width, root.fps), root, root.fps, base, role))
      }
      records.push({ ...base, kind: 'code_unavailable', timeline: entry.timeline, detail: '已测量作者图层位姿；draw 内部像素变化不能由 bounds 判断，请按需观察画面。' })
      for (const samples of textSamples.get(id)?.values() ?? []) records.push(...videoEditTextOverflowFacts(samples, root.fps, base))
      if (records.length > 20000) throw new Error('代码运动候选超过单次20000项预算，请缩小 from/to；未截断结果。')
    }
  }
  const warnings: string[] = []
  if (textCoverage.size) warnings.push('文字超框与截断只在排版内容连续稳定至少0.3秒时报，位姿运动不影响判定；字素揭示未完成时不判。裁切逐帧检查后合并，区间内已完全揭开的入场遮罩不报。任意 Canvas clip、滤镜遮挡、后续覆盖和跨图层合成的可见性未覆盖；墨迹伸出、阴影或外观越界不作内容超框。')
  if (textCoverage.size && range.to - range.from < Math.max(3, Math.ceil(.3 * root.fps))) warnings.push('查询区间短于文字检查所需的最小连续帧数（至少3帧且0.3秒），本次无法形成稳定区间；请扩大 from/to。')
  const missingText = new Set([...textCoverage.values()].filter(value => !value.drawn).map(value => value.name))
  if (missingText.size) warnings.push(`这些图层未使用排版库或未提供新版 drawText 绘制事实，无法检查文字超框：${[...missingText].join('、')}。请调用 upgrade_video_edit_code_materials，指定这些素材并设置 upgradeLibraries:true，升级内置库并改指引用。`)
  if (uncoveredText.size) warnings.push(`文字绘制观察未覆盖：${[...uncoveredText].join('、')}。`)
  return { records, sampledFrames, sampledElements, warnings }
}
