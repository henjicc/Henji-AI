import type { MotionReviewPolicy, MotionReviewSample } from '../media/motionReview'
import type { CodeAuthorProgram, CodeAuthorFrameObservation, AuthorElementObservation } from './codeAuthorProgram'
import type { VideoEditComposition } from './document'
import { videoEditSourceMapLocalFrame, visitVideoEditPictureInstances, type VideoEditSourceMapEntry, type VideoEditSourceMapRange } from './sourceMap'
import { videoEditMotionSampleFacts, VIDEO_EDIT_MOTION_STRUCTURE_SAMPLE_BUDGET, type VideoEditMotionStructureFact } from './motionStructure'
import { activeVideoEditEffects } from './compositing'
import { videoEditClipToFrame } from './clipGeometry'
import { evaluateVideoEditClip } from './keyframes'
import { videoEditJitterFacts, videoEditPictureRole, videoEditRootMapper, videoEditSafeAreaFacts, videoEditSampleSegments, type VideoEditPictureSample } from './pictureReview'

export interface CodeMotionReviewResult { records: VideoEditMotionStructureFact[]; sampledFrames: number; sampledElements: number; warnings: string[] }
export type CodeMotionObserver = (composition: VideoEditComposition, frame: number) => Promise<CodeAuthorFrameObservation>

/** Geometry comes from the real render worker. Arbitrary draw internals cannot be
 * inferred from stationary bounds; never report those pixels as proven still. */
export async function collectVideoEditCodeMotion(root: VideoEditComposition, range: VideoEditSourceMapRange, programs: Readonly<Record<string, CodeAuthorProgram>>, policy: MotionReviewPolicy, observe: CodeMotionObserver): Promise<CodeMotionReviewResult> {
  const records: VideoEditMotionStructureFact[] = []
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
        const picture = { width: layer.width, height: layer.height }
        for (const element of current.values()) {
          if (element.corners.length !== 4) continue
          const quad = element.corners.map(([x, y]) => { const point = toRoot(videoEditClipToFrame(placement, picture, local, x / picture.width, y / picture.height)); return { x: point.x * root.width, y: point.y * root.height } })
          const picked = pictures.get(element.id) ?? { element, samples: [] }
          picked.samples.push({ frame, quad, opacity: (element.opacity ?? 1) * placement.opacity }); pictures.set(element.id, picked)
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
      if (records.length > 20000) throw new Error('代码运动候选超过单次20000项预算，请缩小 from/to；未截断结果。')
    }
  }
  return { records, sampledFrames, sampledElements, warnings: [] }
}
