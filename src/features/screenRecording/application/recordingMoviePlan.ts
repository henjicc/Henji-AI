import { createVideoEditSequence, videoEditDuration, type VideoEditDocument, type VideoEditSequence, type VideoEditClip } from '@/core/videoEdit/document'
import { makeVideoEditItemClip } from '@/core/videoEdit/projectItems'
import { videoEditSpeedRatio } from '@/core/videoEdit/clipSpeed'
import { createVideoEditGraphic } from '@/core/videoEdit/graphics'
import { BUILTIN_TITLE_TEMPLATES, instantiateTitleTemplate } from '@/core/videoEdit/titleTemplates'
import { createVideoEditMaskShape, type VideoEditEffectMask } from '@/core/videoEdit/effectMasks'
import type { VideoEditEffect } from '@/core/videoEdit/compositing'
import { APP_WINDOW_BACKGROUND_HEX } from '@/core/theme/colorTokens'
import { titleColor } from '@/core/videoEdit/titleTemplates'
import type { RecordingDocument } from '@/core/screenRecording/document'
import type { RecordingUnderstanding } from '@/core/screenRecording/understanding'
import { mapRecordingMovieRange, recordingMovieSpans, type RecordingMovieRecipe, type RecordingRedactionCandidate } from '@/core/screenRecording/movie'
import { recordingMediaSpans } from './recordingTimeline'
import { buildAudioEditCaptionGroups } from '@/core/audioEdit/captions'

export function recordingMovieEffect(id: string, name: string, params: Record<string, number | boolean | string> = {}, mask?: VideoEditEffectMask): VideoEditEffect {
  return { id: crypto.randomUUID(), name, enabled: true, amount: 1, builtin: { id, params }, ...(mask ? { mask } : {}) }
}
function roundFrameMask(width: number, height: number): VideoEditEffectMask {
  const rx = .025 * height / width, ry = .025, k = .5522847498
  return { regionId: 'shapes', shapes: [{ id: crypto.randomUUID(), kind: 'path', invert: true, feather: 0, points: [
    [rx, 0, -rx * k, 0, 0, 0], [1 - rx, 0, 0, 0, rx * k, 0], [1, ry, 0, -ry * k, 0, 0], [1, 1 - ry, 0, 0, 0, ry * k],
    [1 - rx, 1, rx * k, 0, 0, 0], [rx, 1, 0, 0, -rx * k, 0], [0, 1 - ry, 0, ry * k, 0, 0], [0, ry, 0, 0, 0, -ry * k],
  ] }] }
}
function shapeClip(document: VideoEditDocument, sequence: VideoEditSequence, name: string, graphic: NonNullable<VideoEditClip['graphic']>, start: number, duration: number, track: number): VideoEditClip {
  const itemId = crypto.randomUUID()
  document.items.push({ id: itemId, name, kind: 'graphic', graphic })
  return makeVideoEditItemClip(document, itemId, sequence.id, { frame: start, duration, track })
}
export interface RecordingMoviePlan { sequenceIds: string[]; screenSequenceIds: string[]; warnings: string[] }
/** Mutates only the importer's detached draft. The import service owns the single history commit. */
export function buildRecordingMoviePlan(document: VideoEditDocument, recording: RecordingDocument, understanding: RecordingUnderstanding, recipe: RecordingMovieRecipe, name: string, targetSequenceId?: string, redactions: readonly RecordingRedactionCandidate[] = []): RecordingMoviePlan {
  if (redactions.some(v => !v.id || !Number.isSafeInteger(v.startUs) || !Number.isSafeInteger(v.endUs) || v.startUs < 0 || v.endUs <= v.startUs || v.box.length !== 4 || v.box.some(n => !Number.isFinite(n) || n < 0 || n > 1) || v.box[2] <= 0 || v.box[3] <= 0 || v.box[0] + v.box[2] > 1 || v.box[1] + v.box[3] > 1)) throw new Error('候选打码范围无效。')
  const spans = recordingMovieSpans(recording, understanding, recipe), result: RecordingMoviePlan = { sequenceIds: [], screenSequenceIds: [], warnings: [] }
  const target = targetSequenceId ? document.sequences.find(v => v.id === targetSequenceId) : undefined
  if (targetSequenceId && !target) throw new Error('目标序列不存在，请重新选择。')
  if (target && (target.clips.length || target.captions?.length || target.markers?.length || target.annotations.length || target.tracks.some(v => v.locked))) throw new Error('指定序列必须为空且未锁定；要保留原剪辑，请省略 sequenceRef 生成新序列。')
  for (const [formatIndex, format] of recipe.formats.entries()) {
    const size = format === 'portrait' ? { width: 1080, height: 1920 } : format === 'square' ? { width: 1080, height: 1080 } : { width: 1920, height: 1080 }
    const sequence = { ...createVideoEditSequence(`${name.slice(0, 160)} · ${{ landscape: '横版', portrait: '竖版', square: '方版' }[format]}`), ...size, frameRate: { numerator: recording.source?.options.fps ?? 30, denominator: 1 } }
    if (formatIndex === 0 && target) { sequence.id = target.id; document.sequences = document.sequences.filter(v => v.id !== target.id) }
    const fps = sequence.frameRate.numerator / sequence.frameRate.denominator
    const frame = (us: number): number => Math.floor(us * fps / 1e6 + 1e-7)
    sequence.tracks = ['麦克风', '系统声音', '背景', '屏幕', '摄像头', '步骤'].map((label, index) => ({ id: crypto.randomUUID(), name: label, index, kind: index < 2 ? 'audio' : 'video', enabled: true, locked: false, muted: false, solo: false }))
    sequence.captions = []; sequence.markers = []
    const screen = { ...createVideoEditSequence(`${sequence.name} · 屏幕画面`), ...size, frameRate: sequence.frameRate }
    screen.tracks = [{ ...sequence.tracks[3], id: crypto.randomUUID(), index: 0 }]
    document.sequences.push(sequence, screen)
    result.sequenceIds.push(sequence.id); result.screenSequenceIds.push(screen.id)
    const linkIds = new Map<string, string>()
    for (const source of recording.media.filter(v => v.durationUs > 0)) {
      if (source.kind === 'camera' && recipe.camera === 'off') continue
      const media = document.media.find(v => v.path.replaceAll('\\', '/') === source.path.replaceAll('\\', '/'))
      const item = document.items.find(v => v.mediaId === media?.id)
      if (!media || !item) throw new Error('录制原片导入不完整。')
      const lane = source.kind === 'screen' ? screen : sequence
      const track = { microphone: 0, systemAudio: 1, screen: 0, camera: 4 }[source.kind]
      for (const active of recordingMediaSpans(recording, source, Math.round(media.durationSeconds * 1e6))) for (const span of mapRecordingMovieRange(spans, active)) {
        // Split at redaction boundaries so each candidate is a normal disabled effect on the right source range.
        const bounds = [...new Set([span.startUs, span.endUs, ...(source.kind === 'screen' ? redactions.flatMap(v => [v.startUs, v.endUs]).filter(v => v > span.startUs && v < span.endUs) : [])])].sort((a, b) => a - b)
        for (let i = 0; i + 1 < bounds.length; i++) {
          const startUs = bounds[i], endUs = bounds[i + 1], outputUs = span.outputStartUs + (startUs - span.startUs) / span.speed
          const start = frame(outputUs), duration = Math.min(frame(span.outputStartUs + (endUs - span.startUs) / span.speed) - start, Math.floor((endUs - startUs) * fps / (1e6 * span.speed) + 1e-7))
          if (duration < 1) continue
          const clip = makeVideoEditItemClip(document, item.id, lane.id, { frame: start, duration, track, sourceInUs: startUs - source.monoUs, sourceOutUs: endUs - source.monoUs, ...(media.kind === 'video' ? { sourceComponent: source.kind === 'screen' || source.kind === 'camera' ? 'video' : 'audio' } : {}) })
          clip.speed = videoEditSpeedRatio(span.speed)
          const linkKey = `${start}:${duration}`; if (!linkIds.has(linkKey)) linkIds.set(linkKey, crypto.randomUUID())
          // Nested screen sequence owns its picture; audio/camera links stay within their own sequence.
          if (source.kind !== 'screen') clip.linkId = linkIds.get(linkKey)
          if (source.kind === 'screen') {
            if (recipe.cursor && media.recordingCursor) clip.effects = [recordingMovieEffect('recording_cursor', '录制光标')]
            for (const candidate of redactions.filter(v => v.startUs < endUs && v.endUs > startUs)) {
              const [x, y, width, height] = candidate.box
              const mask: VideoEditEffectMask = { regionId: 'shapes', shapes: [{ id: crypto.randomUUID(), kind: 'rect', points: [[x, y, 0, 0, 0, 0], [x + width, y, 0, 0, 0, 0], [x + width, y + height, 0, 0, 0, 0], [x, y + height, 0, 0, 0, 0]], feather: 0 }] }
              clip.effects = [...clip.effects ?? [], { ...recordingMovieEffect('mosaic', '候选打码（待确认）', { block_size: 35 }, mask), enabled: false }]
            }
          }
          if (source.kind === 'camera') {
            clip.scale = .24; clip.x = .34; clip.y = .25
            const ellipse = createVideoEditMaskShape('ellipse')
            const aspect = Math.min(1, (media.height ?? 720) / (media.width ?? 1280))
            ellipse.points = ellipse.points.map(([x, y, ix, iy, ox, oy]) => [.5 + ((x - .3) / .4 - .5) * aspect, (y - .3) / .4, ix / .4 * aspect, iy / .4, ox / .4 * aspect, oy / .4] as typeof ellipse.points[number]); ellipse.invert = true; ellipse.feather = 0
            clip.effects = [recordingMovieEffect('crop', recipe.camera === 'person' ? '摄像头人像抠像' : '摄像头圆形画框', { left: 100 }, recipe.camera === 'person' ? { regionId: 'background' } : { regionId: 'shapes', shapes: [ellipse] })]
          }
          lane.clips.push(clip)
        }
      }
    }
    const duration = Math.max(videoEditDuration(screen), videoEditDuration(sequence))
    if (!screen.clips.length) throw new Error('配方没有保留可播放的屏幕片段。')
    const nestedItem = { id: crypto.randomUUID(), name: '屏幕画面', kind: 'sequence' as const, sequenceId: screen.id }
    document.items.push(nestedItem)
    const picture = makeVideoEditItemClip(document, nestedItem.id, sequence.id, { frame: 0, duration: videoEditDuration(screen), track: 3 })
    if (recipe.frame) { picture.scale = .92; picture.effects = [recordingMovieEffect('crop', '圆角画框', { left: 100 }, roundFrameMask(size.width, size.height))] }
    sequence.clips.push(picture)
    if (recipe.frame) {
      const graphic = createVideoEditGraphic('rect', size.width, size.height)
      Object.assign(graphic.objects[0].parameters, { x: 0, y: 0, width: size.width, height: size.height, fill: titleColor(APP_WINDOW_BACKGROUND_HEX) })
      sequence.clips.push(shapeClip(document, sequence, '背景', graphic, 0, duration, 2))
    }
    if (recipe.captions) {
      const blocks = understanding.transcript.flatMap(text => {
        const mapped = mapRecordingMovieRange(spans, text)
        // A sentence spanning a cut/speed boundary is still one sentence, never repeated per fragment.
        return mapped.length ? [{ id: crypto.randomUUID(), text: text.text, startFrame: frame(mapped[0].outputStartUs), endFrame: frame(mapped.at(-1)!.outputEndUs), included: true, locked: false, granularity: text.granularity }] : []
      }).filter(v => v.endFrame > v.startFrame && v.text.trim()).sort((a, b) => a.startFrame - b.startFrame)
      for (const group of buildAudioEditCaptionGroups(blocks, fps)) sequence.captions.push({ id: group.id, start: group.startFrame, duration: group.endFrame - group.startFrame, text: group.text.slice(0, 2000) })
    }
    if (recipe.steps) for (const step of understanding.steps) {
      const mapped = mapRecordingMovieRange(spans, step)[0]
      if (!mapped) continue
      const start = frame(mapped.outputStartUs), duration = Math.min(3 * fps, frame(mapped.outputEndUs) - start)
      if (duration < fps / 2) continue
      const snapshot = instantiateTitleTemplate(BUILTIN_TITLE_TEMPLATES[0], { text: step.title, subtitle: '', entrance: 'fade', durationSeconds: duration / fps }, sequence)[0]
      const clip = shapeClip(document, sequence, step.title, snapshot.graphic!, start, duration, 5)
      clip.y = -.64; sequence.clips.push(clip)
    }
    for (const chapter of understanding.chapters) {
      const first = understanding.steps.find(v => chapter.stepIds.includes(v.id) && mapRecordingMovieRange(spans, v).length)
      const mapped = first && mapRecordingMovieRange(spans, first)[0]
      if (mapped) sequence.markers.push({ id: crypto.randomUUID(), frame: frame(mapped.outputStartUs), name: chapter.title })
    }
  }
  return result
}
