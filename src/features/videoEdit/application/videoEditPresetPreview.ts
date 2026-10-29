import type { ContentTrustReference } from '@/core/contentTrust'
import { VIDEO_EDIT_DOCUMENT_VERSION } from '@/core/persistence/schemaVersions'
import { VIDEO_EDIT_AUTHOR_CONTENT_COLORS } from '@/core/theme/colorTokens'
import { addressCodeMaterialFiles, normalizeCodeMaterialFiles } from '@/core/videoEdit/codeMaterial/sources'
import { createVideoEditSequence, videoEditComposition, type VideoEditComposition, type VideoEditDocument, type VideoEditSequence } from '@/core/videoEdit/document'
import { makeVideoEditItemClip } from '@/core/videoEdit/projectItems'
import { instantiateNativeTemplate } from '@/core/videoEdit/styles/nativeTemplates'
import type { VideoEditStyleSample } from '@/core/videoEdit/styles/styleSchemas'
import type { CodeParameterValues } from '@/core/videoEdit/codeMaterial/contract'
import { getBundledResourcePath } from '@/platform/desktopApi'
import { videoEditOffscreenPool } from '../engine/videoEditOffscreenPool'
import { videoEditRenderFailures } from '../engine/videoEditRenderFailures'
import { compileVideoEditCode } from './videoEditCodeState'
import type { VideoEditPresetSource } from './videoEditPresetCatalog'

export const PRESET_PREVIEW_FPS = 30
/** 转场预览的 A/B 两个镜头：同一段动态画面按两种色相区分前后镜头。 */
const BACKDROP = `
const color = (h,s,v,a=1) => {
  const rgb = [0,4,2].map(n => { const k=(n+h*6)%6; return Math.round((v-v*s*Math.max(0,Math.min(k,4-k,1)))*255) });
  return 'rgba('+rgb.join(',')+','+a+')';
};
const random = i => { const x=Math.sin(i*127.1+7*311.7)*43758.5453; return x-Math.floor(x) };
export default { name:'预设样片', mode:'dynamic', params:[
 {key:'hue',type:'number',title:'色相',default:.58,min:0,max:1,step:.01,layer:'backdrop'},
 {key:'sat',type:'number',title:'饱和',default:1,min:0,max:2,step:.01,layer:'backdrop'},
 {key:'label',type:'text',title:'文字',default:'',layer:'label'},
 {key:'labelStyle',type:'textStyle',title:'文字样式',default:{fontFamily:'sans-serif',fontSize:130,fontWeight:700},layer:'label'}
], layers(p,W,H) { return [
 {id:'backdrop',name:'背景',bounds:[0,0,W,H],draw(ctx,t) {
  const h=p.hue,k=p.sat; ctx.save(); ctx.translate(W/2,H/2); const zoom=1+.06*Math.min(1,Math.max(0,t/8)); ctx.scale(zoom,zoom);
  const sky=ctx.createLinearGradient(0,-H/2,0,H/2); [[0,color(h,.5*k,.18)],[.58,color(h+.05,.42*k,.46)],[1,color(h+.08,.5*k,.1)]].forEach(([at,c])=>sky.addColorStop(at,c));
  ctx.fillStyle=sky;ctx.fillRect(-W/2,-H/2,W,H);
  ctx.save();ctx.globalCompositeOperation='screen';ctx.globalAlpha=.7;
  const x=W*(.18*Math.sin(t*.25)-.08),y=H*.1;const dawn=ctx.createRadialGradient(x,y,0,x,y,W*.42);dawn.addColorStop(0,color(h+.5,.42*k,.85));dawn.addColorStop(1,color(h+.5,.42*k,.85,0));ctx.fillStyle=dawn;ctx.fillRect(-W/2,-H/2,W,H);
  ctx.filter='blur('+H*.012+'px)';
  for(let i=0;i<12;i++){const r=H*(.02+.05*random(i+60));ctx.globalAlpha=.12+.22*random(i+150);ctx.fillStyle=color(h+.42+.16*random(i+120),.3*k,1);ctx.beginPath();ctx.arc(-W*.6+W*1.2*random(i)+t*W*.012*(1+random(i+30)),-H*.45+H*.6*random(i+90),r,0,Math.PI*2);ctx.fill()}
  ctx.restore();
  for(const [points,c] of [[[[ -.6,.5],[-.6,.12],[-.32,-.02],[-.1,.1],[.14,-.04],[.38,.08],[.6,0],[.6,.5]],color(h+.08,.45*k,.13)],[[[-.6,.5],[-.6,.3],[-.2,.22],[.18,.3],[.6,.2],[.6,.5]],color(h+.1,.5*k,.06)]]){ctx.beginPath();points.forEach(([x,y],i)=>i?ctx.lineTo(x*W,y*H):ctx.moveTo(x*W,y*H));ctx.closePath();ctx.fillStyle=c;ctx.fill()}
  ctx.restore();const vignette=ctx.createRadialGradient(W/2,H/2,0,W/2,H/2,W*.72);vignette.addColorStop(.5,${JSON.stringify(VIDEO_EDIT_AUTHOR_CONTENT_COLORS.vignetteCenter)});vignette.addColorStop(1,${JSON.stringify(VIDEO_EDIT_AUTHOR_CONTENT_COLORS.vignetteEdge)});ctx.fillStyle=vignette;ctx.fillRect(0,0,W,H);
 }},
 {id:'label',name:'标题',bounds:[0,H*.35,W,H*.65],draw(ctx){const s=p.labelStyle;ctx.font=s.fontWeight+' '+s.fontSize+'px '+s.fontFamily;ctx.fillStyle=s.fill.enabled?s.fill.color:'transparent';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(p.label,W/2,H/2)}}
]}};`

/**
 * 模板、文字与效果预览的统一背景：随包分发的实拍照片（resources/video-edit-preview/template-backdrop.webp）。
 * 字幕条、人名条这类只有前景的模板需要一张背景才看得出效果，一律用这张；风格样片自己画满底，不加背景。
 */
const BACKDROP_PHOTO = { relativePath: 'video-edit-preview/template-backdrop.webp', width: 2048, height: 2048 }
let backdropPhotoPath: Promise<string> | undefined
function resolveBackdropPhoto(): Promise<string> {
  backdropPhotoPath ??= getBundledResourcePath(BACKDROP_PHOTO.relativePath).then(path => {
    if (!path) throw new Error('预览背景图缺失，请重新安装。')
    return path
  })
  backdropPhotoPath.catch(() => { backdropPhotoPath = undefined })
  return backdropPhotoPath
}
async function backdropClip(builder: Builder, seconds: number): Promise<string> {
  const mediaId = 'preview-backdrop'; const itemId = 'preview-backdrop-item'
  if (!builder.document.media.some(media => media.id === mediaId)) {
    builder.document.media.push({ id: mediaId, name: '预览背景', path: await resolveBackdropPhoto(), kind: 'image', width: BACKDROP_PHOTO.width, height: BACKDROP_PHOTO.height, durationSeconds: 0 })
    builder.document.items.push({ id: itemId, name: '预览背景', kind: 'image', mediaId })
  }
  const { width, height } = builder.sequence
  // 图片片段默认按完整显示放入画面，这里放大到铺满，任何画幅都不留黑边。
  const cover = Math.max(width / BACKDROP_PHOTO.width, height / BACKDROP_PHOTO.height) / Math.min(width / BACKDROP_PHOTO.width, height / BACKDROP_PHOTO.height)
  const clip = { ...makeVideoEditItemClip(builder.document, itemId, builder.sequence.id, { frame: 0, track: 1, duration: Math.round(seconds * PRESET_PREVIEW_FPS) }), scale: cover }
  builder.sequence.clips.push(clip); return clip.id
}

const CAPTIONS = ['先把一件事做好', '然后，再把它做得更好']
interface Builder { document: VideoEditDocument; sequence: VideoEditSequence }
/** Every preview reuses one document identity, so the shared render session only receives updates. */
const PREVIEW_DOCUMENT_ID = 'preset-preview'
const PREVIEW_SEQUENCE_ID = 'preset-preview-sequence'
let previewRevision = 0
function start(size: { width: number; height: number }, fps = PRESET_PREVIEW_FPS): Builder {
  const sequence: VideoEditSequence = { ...createVideoEditSequence('预设预览'), id: PREVIEW_SEQUENCE_ID, ...size, frameRate: { numerator: fps, denominator: 1 } }
  for (const index of [2, 3, 4, 5]) sequence.tracks.push({ id: `preview-track-${index}`, name: `视频 ${index}`, index, kind: 'video', locked: false, enabled: true, muted: false, solo: false })
  const document: VideoEditDocument = { format: 'henji-video-project', version: VIDEO_EDIT_DOCUMENT_VERSION, id: PREVIEW_DOCUMENT_ID, name: '预设预览', revision: ++previewRevision, media: [], bins: [], items: [], sequences: [sequence], codeMaterials: [] }
  return { document, sequence }
}
async function codeClip(builder: Builder, source: Parameters<typeof normalizeCodeMaterialFiles>[0], parameters: CodeParameterValues, placement: { frame: number; track: number; seconds: number; sourceInSeconds?: number }, signal: AbortSignal): Promise<string> {
  const files = normalizeCodeMaterialFiles(source)
  const { codeSources: _sources, ...manifest } = await addressCodeMaterialFiles(files)
  const program = await compileVideoEditCode(files, signal); signal.throwIfAborted()
  const versionId = crypto.randomUUID(); const definitionId = crypto.randomUUID(); const itemId = crypto.randomUUID()
  builder.document.codeMaterials!.push({ id: definitionId, name: '预设样片', defaultVersionId: versionId, versions: [{ id: versionId, ...manifest, ...(files.trustContext?.[0] ? { foreign: files.trustContext[0] } : {}), apiVersion: 4, languageVersion: 4 }] })
  // A personal copy may have dropped a parameter the reel sets; pass only what the component declares.
  const declared = Object.fromEntries(Object.entries(parameters).filter(([key]) => program.parameters.some(value => value.key === key)))
  builder.document.items.push({ id: itemId, name: '预设样片', kind: 'code', code: { definitionId, versionId, parameters: declared } })
  // Never ask for more frames than the component has after its source-in point.
  const fps = builder.sequence.frameRate.numerator / builder.sequence.frameRate.denominator
  const available = program.durationSeconds === undefined ? Infinity : Math.floor((program.durationSeconds - (placement.sourceInSeconds ?? 0)) * fps)
  const duration = Math.max(1, Math.min(Math.round(placement.seconds * fps), available))
  // Source ranges are for media items; a generator clip just starts later in its own clock (transition handles).
  const clip = makeVideoEditItemClip(builder.document, itemId, builder.sequence.id, { frame: placement.frame, track: placement.track, duration }, () => program)
  if (placement.sourceInSeconds) clip.sourceInUs = Math.round(placement.sourceInSeconds * 1e6)
  builder.sequence.clips.push(clip); return clip.id
}
/** 风格样片：只放样片代码本身（它自己画满不透明的底），按样片的帧率与时长。 */
async function styleSample(sample: VideoEditStyleSample, size: { width: number; height: number }, signal: AbortSignal, fps = PRESET_PREVIEW_FPS, trustContext: ContentTrustReference[] = []): Promise<Builder> {
  const builder = start(size, fps)
  // A sample may declare a shorter durationSeconds hint; the style's own sample setting is authoritative.
  await codeClip(builder, { ...sample.code, trustContext }, {}, { frame: 0, track: 1, seconds: sample.durationSeconds }, signal)
  return builder
}
async function build(source: VideoEditPresetSource, size: { width: number; height: number }, signal: AbortSignal): Promise<Builder> {
  switch (source.category) {
    case 'style': return styleSample(source.sample, size, signal, PRESET_PREVIEW_FPS, source.trustContext)
    case 'template': {
      const builder = start(size)
      await backdropClip(builder, 4)
      if (source.body.kind === 'code') { await codeClip(builder, { ...source.body.code, trustContext: source.trustContext }, {}, { frame: 0, track: 2, seconds: source.body.durationSeconds ?? 4 }, signal); return builder }
      for (const snapshot of instantiateNativeTemplate(source.body.content, builder.sequence)) {
        const itemId = crypto.randomUUID(); const track = 2 + snapshot.track
        builder.document.items.push({ id: itemId, name: snapshot.name, kind: snapshot.kind, ...(snapshot.graphic ? { graphic: structuredClone(snapshot.graphic) } : {}) })
        builder.sequence.clips.push({ ...makeVideoEditItemClip(builder.document, itemId, builder.sequence.id, { frame: snapshot.start, track, duration: snapshot.duration }), ...snapshot, id: crypto.randomUUID(), itemId, track })
      }
      return builder
    }
    case 'text': {
      const builder = start(size)
      await backdropClip(builder, 8)
      builder.sequence.captions = [{ id: 'preview-caption', start: 0, duration: 8 * PRESET_PREVIEW_FPS, text: `${CAPTIONS[0]}，${CAPTIONS[1]}`, style: structuredClone(source.preset.style) }]
      return builder
    }
    case 'effect': {
      if (source.preset.media !== 'video') throw new Error('声音效果没有画面预览。')
      const builder = start(size)
      const id = await backdropClip(builder, 8)
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
    case 'style': return at(source.sample.thumbnail)
    case 'template': return at(1.2)
    // Just before the midpoint: a dip to black, white or a flash still shows both shots.
    case 'transition': return at(1.65)
    default: return at(1)
  }
}
const timelines = new Map<string, Promise<PresetPreviewTimeline>>()
/** Built once per preset content and size; compiling the components is the only step that is not real time. */
export function presetPreviewTimeline(source: VideoEditPresetSource, size: { width: number; height: number }): Promise<PresetPreviewTimeline> {
  const key = JSON.stringify([source, size])
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
      abort = () => { expired = true; reject(signal.reason ?? new DOMException('预览已取消。', 'AbortError')) }
      signal.addEventListener('abort', abort, { once: true })
      timer = setTimeout(() => { expired = true; reject(new Error('预览单帧渲染超过30秒，请重试。')) }, 30_000)
      if (signal.aborted) abort()
    })
    try {
      const result = await Promise.race([lease.run(composition, session => session.present(frame)).then(result => {
        if (expired || signal.aborted) { result.bitmap?.close(); throw signal.reason ?? new Error('预览已失效。') }
        return result
      }), deadline])
      if (signal.aborted) { result.bitmap?.close(); signal.throwIfAborted() }
      // 样片里片子数据的问题只影响内容，不是样片坏了：样片缩略图没有文字位置，问题已由渲染 Worker 写进日志。
      const failures = videoEditRenderFailures(result)
      if (failures.length) { result.bitmap?.close(); throw new Error(failures.join('\n')) }
      succeeded = true
      return result.bitmap ?? null
    } finally { clearTimeout(timer); signal.removeEventListener('abort', abort); await lease.release(!succeeded) }
  }
}

const renderer = new PresetRenderer()
/** 渲染风格样片用：按样片自己的帧率逐帧取画面（预览视频、缩略图与锚点帧）。 */
export async function styleSampleTimeline(sample: VideoEditStyleSample, signal: AbortSignal, trustContext: ContentTrustReference[] = []): Promise<PresetPreviewTimeline & { fps: number }> {
  const builder = await styleSample(sample, { width: sample.width, height: sample.height }, signal, sample.fps, trustContext)
  const frames = Math.max(1, ...builder.sequence.clips.map(clip => clip.start + clip.duration))
  return { composition: videoEditComposition(builder.document, builder.sequence.id), frames, poster: Math.min(frames - 1, Math.round(sample.thumbnail * sample.fps)), fps: sample.fps }
}
export function renderPresetPreviewFrame(composition: VideoEditComposition, frame: number, signal: AbortSignal): Promise<ImageBitmap | null> { return renderer.frame(composition, frame, signal) }
