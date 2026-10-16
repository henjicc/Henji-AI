import { VIDEO_EDIT_DOCUMENT_VERSION } from '@/core/persistence/schemaVersions'
import { addressCodeMaterialFiles, normalizeCodeMaterialFiles } from '@/core/videoEdit/codeMaterial/sources'
import { createVideoEditSequence, videoEditComposition, type VideoEditComposition, type VideoEditDocument, type VideoEditSequence } from '@/core/videoEdit/document'
import { makeVideoEditItemClip } from '@/core/videoEdit/projectItems'
import { resizeCodeMaterialCanvas } from '@/core/videoEdit/codeElementBake'
import { instantiateTitleTemplate } from '@/core/videoEdit/titleTemplates'
import type { StyleKit } from '@/core/videoEdit/styleKit'
import type { CodeParameterValues } from '@/core/videoEdit/codeMaterial/contract'
import { videoEditOffscreenPool } from '../engine/videoEditOffscreenPool'
import { compileVideoEditCode } from './videoEditCodeState'
import type { VideoEditPresetSource } from './videoEditPresetCatalog'

export const PRESET_PREVIEW_FPS = 30
/** Shared moving footage, so every effect, caption, transition and style is judged on the same picture. */
const BACKDROP = `export default { apiVersion: 1, languageVersion: 3, name: "预设样片", kind: "generator", mode: "dynamic", width: 1920, height: 1080, durationSeconds: 8, seed: 7,
  parameters: { hue: { type: "number", title: "色相", default: 0.58, min: 0, max: 1, step: 0.01 }, sat: { type: "number", title: "饱和", default: 1, min: 0, max: 2, step: 0.01 }, label: { type: "text", title: "文字", default: "", maxLength: 40 } },
  render(ctx) {
    const h = ctx.params.hue; const k = ctx.params.sat; const W = ctx.width; const H = ctx.height; const t = ctx.time;
    return [
      group({ id: "camera", x: W / 2, y: H / 2, scale: 1 + 0.06 * progress(t, 0, 8) }, [
        rect({ id: "sky", x: -W / 2, y: -H / 2, width: W, height: H, fill: linearGradient({ x1: 0, y1: -H / 2, x2: 0, y2: H / 2, stops: [[0, hsv(h, 0.5 * k, 0.18)], [0.58, hsv(h + 0.05, 0.42 * k, 0.46)], [1, hsv(h + 0.08, 0.5 * k, 0.1)]] }) }),
        rect({ id: "dawn", x: -W / 2, y: -H / 2, width: W, height: H, blend: "screen", opacity: 0.7, fill: radialGradient({ cx: W * (0.18 * sin(t * 0.25) - 0.08), cy: H * 0.1, r: W * 0.42, stops: [[0, hsv(h + 0.5, 0.42 * k, 0.85)], [1, [0, 0, 0, 0]]] }) }),
        repeat(12, i => ellipse({ id: "bokeh", x: -W * 0.6 + W * 1.2 * random(i) + t * W * 0.012 * (1 + random(i + 30)) - H * (0.02 + 0.05 * random(i + 60)), y: -H * 0.45 + H * 0.6 * random(i + 90) - H * (0.02 + 0.05 * random(i + 60)), width: H * (0.04 + 0.1 * random(i + 60)), height: H * (0.04 + 0.1 * random(i + 60)), fill: hsv(h + 0.42 + 0.16 * random(i + 120), 0.3 * k, 1), opacity: 0.12 + 0.22 * random(i + 150), blur: H * 0.012, blend: "screen" })),
        path({ id: "ridge", closed: true, fill: hsv(h + 0.08, 0.45 * k, 0.13), points: [[-W * 0.6, H * 0.5], [-W * 0.6, H * 0.12], [-W * 0.32, -H * 0.02], [-W * 0.1, H * 0.1], [W * 0.14, -H * 0.04], [W * 0.38, H * 0.08], [W * 0.6, H * 0.0], [W * 0.6, H * 0.5]] }),
        path({ id: "front", closed: true, fill: hsv(h + 0.1, 0.5 * k, 0.06), points: [[-W * 0.6, H * 0.5], [-W * 0.6, H * 0.3], [-W * 0.2, H * 0.22], [W * 0.18, H * 0.3], [W * 0.6, H * 0.2], [W * 0.6, H * 0.5]] })
      ]),
      rect({ id: "vignette", x: 0, y: 0, width: W, height: H, fill: radialGradient({ cx: W / 2, cy: H / 2, r: W * 0.72, stops: [[0.5, [0, 0, 0, 0]], [1, [0, 0, 0, 0.6]]] }) }),
      text({ id: "label", x: W / 2, y: H * 0.5, text: ctx.params.label, fontSize: H * 0.12, fontWeight: 700, color: [1, 1, 1, 0.9], align: "center", baseline: "middle" })
    ];
  }
}`
const CAPTIONS = ['先把一件事做好', '然后，再把它做得更好']
interface Builder { document: VideoEditDocument; sequence: VideoEditSequence }
/** Every preview reuses one document identity, so the shared render session only receives updates. */
const PREVIEW_DOCUMENT_ID = 'preset-preview'
const PREVIEW_SEQUENCE_ID = 'preset-preview-sequence'
let previewRevision = 0
function start(size: { width: number; height: number }): Builder {
  const sequence: VideoEditSequence = { ...createVideoEditSequence('预设预览'), id: PREVIEW_SEQUENCE_ID, ...size }
  for (const index of [2, 3, 4, 5]) sequence.tracks.push({ id: `preview-track-${index}`, name: `视频 ${index}`, index, kind: 'video', locked: false, enabled: true, muted: false, solo: false })
  const document: VideoEditDocument = { format: 'henji-video-project', version: VIDEO_EDIT_DOCUMENT_VERSION, id: PREVIEW_DOCUMENT_ID, name: '预设预览', revision: ++previewRevision, media: [], bins: [], items: [], sequences: [sequence], codeMaterials: [] }
  return { document, sequence }
}
async function codeClip(builder: Builder, source: Parameters<typeof normalizeCodeMaterialFiles>[0], parameters: CodeParameterValues, placement: { frame: number; track: number; seconds: number; sourceInSeconds?: number }, signal: AbortSignal): Promise<string> {
  const { width, height } = builder.sequence
  const files = normalizeCodeMaterialFiles(source)
  const resized = { ...files, files: { ...files.files, [files.entry]: resizeCodeMaterialCanvas(files.files[files.entry], { width, height }) } }
  const { codeSources: _sources, ...manifest } = await addressCodeMaterialFiles(resized)
  const program = await compileVideoEditCode(resized, signal); signal.throwIfAborted()
  const versionId = crypto.randomUUID(); const definitionId = crypto.randomUUID(); const itemId = crypto.randomUUID()
  builder.document.codeMaterials!.push({ id: definitionId, name: '预设样片', defaultVersionId: versionId, versions: [{ id: versionId, ...manifest, apiVersion: 1, languageVersion: 3 }] })
  // A personal copy may have dropped a parameter the reel sets; pass only what the component declares.
  const declared = Object.fromEntries(Object.entries(parameters).filter(([key]) => program.parameters.some(value => value.key === key)))
  builder.document.items.push({ id: itemId, name: '预设样片', kind: 'code', code: { definitionId, versionId, parameters: declared } })
  // Never ask for more frames than the component has after its source-in point.
  const available = Math.floor((program.durationSeconds - (placement.sourceInSeconds ?? 0)) * PRESET_PREVIEW_FPS)
  const duration = Math.max(1, Math.min(Math.round(placement.seconds * PRESET_PREVIEW_FPS), available))
  // Source ranges are for media items; a generator clip just starts later in its own clock (transition handles).
  const clip = makeVideoEditItemClip(builder.document, itemId, builder.sequence.id, { frame: placement.frame, track: placement.track, duration }, () => program)
  if (placement.sourceInSeconds) clip.sourceInUs = Math.round(placement.sourceInSeconds * 1e6)
  builder.sequence.clips.push(clip); return clip.id
}
const EXAMPLE_SECONDS = 3
/**
 * A style has no look of its own to render — it is a guide for the AI. What can be shown are its reference
 * examples, played back to back over the shared footage, each for at most three seconds.
 */
async function exampleReel(kit: StyleKit, size: { width: number; height: number }, signal: AbortSignal): Promise<Builder> {
  const builder = start(size); const f = PRESET_PREVIEW_FPS; let frame = 0
  const slots: Array<{ example: StyleKit['examples'][number]; frame: number; seconds: number }> = []
  for (const example of kit.examples) { slots.push({ example, frame, seconds: EXAMPLE_SECONDS }); frame += EXAMPLE_SECONDS * f }
  const total = Math.max(frame / f, 2)
  await codeClip(builder, BACKDROP, {}, { frame: 0, track: 1, seconds: total }, signal)
  // Examples that time their own exit read a hold parameter; others simply end with their slot.
  for (const slot of slots) await codeClip(builder, slot.example.source, { hold: Math.max(.3, slot.seconds - .6) }, { frame: slot.frame, track: 2, seconds: slot.seconds }, signal)
  return builder
}
async function build(source: VideoEditPresetSource, size: { width: number; height: number }, signal: AbortSignal): Promise<Builder> {
  switch (source.category) {
    case 'style': return exampleReel(source.kit, size, signal)
    case 'title': {
      const builder = start(size)
      await codeClip(builder, BACKDROP, {}, { frame: 0, track: 1, seconds: 8 }, signal)
      for (const snapshot of instantiateTitleTemplate(source.template, {}, builder.sequence)) {
        const itemId = crypto.randomUUID(); const track = 2 + snapshot.track
        builder.document.items.push({ id: itemId, name: snapshot.name, kind: snapshot.kind, ...(snapshot.graphic ? { graphic: structuredClone(snapshot.graphic) } : {}) })
        builder.sequence.clips.push({ ...makeVideoEditItemClip(builder.document, itemId, builder.sequence.id, { frame: snapshot.start, track, duration: snapshot.duration }), ...snapshot, id: crypto.randomUUID(), itemId, track })
      }
      return builder
    }
    case 'text': {
      const builder = start(size)
      await codeClip(builder, BACKDROP, {}, { frame: 0, track: 1, seconds: 8 }, signal)
      builder.sequence.captions = [{ id: 'preview-caption', start: 0, duration: 8 * PRESET_PREVIEW_FPS, text: `${CAPTIONS[0]}，${CAPTIONS[1]}`, style: structuredClone(source.preset.style) }]
      return builder
    }
    case 'effect': {
      if (source.preset.media !== 'video') throw new Error('声音效果没有画面预览。')
      const builder = start(size)
      const id = await codeClip(builder, BACKDROP, {}, { frame: 0, track: 1, seconds: 8 }, signal)
      builder.sequence.clips.find(value => value.id === id)!.effects = source.preset.effects.map(effect => ({ ...structuredClone(effect), id: crypto.randomUUID() }))
      return builder
    }
    case 'transition': {
      const builder = start(size)
      const left = await codeClip(builder, BACKDROP, { hue: .58, label: 'A' }, { frame: 0, track: 1, seconds: 2 }, signal)
      const right = await codeClip(builder, BACKDROP, { hue: .05, label: 'B' }, { frame: 2 * PRESET_PREVIEW_FPS, track: 1, seconds: 2, sourceInSeconds: 1 }, signal)
      builder.sequence.transitions = [{ id: 'preview-transition', kind: source.kind, leftClipId: left, rightClipId: right, durationFrames: PRESET_PREVIEW_FPS }]
      return builder
    }
  }
}
export interface PresetPreviewTimeline { composition: VideoEditComposition; frames: number; poster: number }
/** Poster frame: the moment a preset reads best (settled opener, mid-transition, captions on screen). */
function posterFrame(source: VideoEditPresetSource, frames: number): number {
  const at = (seconds: number): number => Math.min(frames - 1, Math.round(seconds * PRESET_PREVIEW_FPS))
  switch (source.category) {
    case 'style': return at(1.8)
    case 'title': return at(Math.min(2, source.template.parameters.durationSeconds / 2))
    // Just before the midpoint: a dip to black, white or a flash still shows both shots.
    case 'transition': return at(1.65)
    default: return at(1)
  }
}
const timelines = new Map<string, Promise<PresetPreviewTimeline>>()
/** Built once per preset content and size; compiling the components is the only step that is not real time. */
export function presetPreviewTimeline(source: VideoEditPresetSource, size: { width: number; height: number }): Promise<PresetPreviewTimeline> {
  // A style rebuilds only when its examples change, not while its guide text is being edited.
  const key = JSON.stringify([source.category === 'style' ? { category: 'style', examples: source.kit.examples } : source, size])
  let value = timelines.get(key)
  if (!value) {
    value = build(source, size, new AbortController().signal).then(builder => {
      const composition = videoEditComposition(builder.document, builder.sequence.id)
      const frames = Math.max(1, ...builder.sequence.clips.map(clip => clip.start + clip.duration))
      return { composition, frames, poster: posterFrame(source, frames) }
    })
    const pending = value
    pending.catch(() => { if (timelines.get(key) === pending) timelines.delete(key) })
    timelines.set(key, pending)
    if (timelines.size > 96) timelines.delete(timelines.keys().next().value!)
  }
  return value
}

/**
 * One long-lived render session for every preset preview — the same compositor as the program monitor. Frames are
 * requested one at a time so posters and a playing loop interleave; the session is released after a quiet minute.
 */
class PresetRenderer {
  async frame(composition: VideoEditComposition, frame: number, signal: AbortSignal): Promise<ImageBitmap | null> {
    const lease = await videoEditOffscreenPool.acquire(composition, signal, async document => {
      const { VideoEditRenderSession } = await import('../engine/videoEditRenderSession')
      return new VideoEditRenderSession(document)
    })
    let succeeded = false; let expired = false
    let abort!: () => void; let timer: ReturnType<typeof setTimeout> | undefined
    const deadline = new Promise<never>((_, reject) => {
      abort = () => { expired = true; reject(signal.reason ?? new DOMException('预设预览已取消。', 'AbortError')) }
      signal.addEventListener('abort', abort, { once: true })
      timer = setTimeout(() => { expired = true; reject(new Error('预设单帧渲染超过30秒，请重试。')) }, 30_000)
      if (signal.aborted) abort()
    })
    try {
      const result = await Promise.race([lease.session.present(frame).then(result => {
        if (expired || signal.aborted) { result.bitmap?.close(); throw signal.reason ?? new Error('预设预览已失效。') }
        return result
      }), deadline])
      if (signal.aborted) { result.bitmap?.close(); signal.throwIfAborted() }
      if (result.effectErrors?.length) { result.bitmap?.close(); throw new Error(result.effectErrors.join('\n')) }
      succeeded = true
      return result.bitmap ?? null
    } finally { clearTimeout(timer); signal.removeEventListener('abort', abort); await lease.release(!succeeded) }
  }
}

const renderer = new PresetRenderer()
export function renderPresetPreviewFrame(composition: VideoEditComposition, frame: number, signal: AbortSignal): Promise<ImageBitmap | null> { return renderer.frame(composition, frame, signal) }
