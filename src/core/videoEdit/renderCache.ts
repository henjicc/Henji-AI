import { activeVideoEditEffects } from './compositing'
import { VIDEO_EDIT_FRAME_INTERPOLATION_ENGINE } from './timeRemap'
import { videoEditTransitionWindow, videoEditTransitionMedium } from './transitions'
import { videoEditDuration, videoEditVisibleTracks, type VideoEditClip, type VideoEditComposition, type VideoEditSequence } from './document'

/**
 * 预渲染缓存：按画面剪辑点分段，每段画面渲染成一份内容寻址的预览文件。
 * 窗口指纹覆盖该窗口画面的全部依赖：其中的片段与效果参数、转场、字幕、轨道状态、引用的素材身份、嵌套序列
 * （递归）、代码素材版本、字体与跟踪结果。任一依赖改变，只有受影响的窗口失效。
 */

/**
 * 前瞻预打开已覆盖换段解码器的启动，先把重渲染粒度上限降到 5 秒；最终以实测调整。
 * 小于半秒的相邻段先合并，再等分长段，避免转场、字幕产生大量极短文件。
 */
export const VIDEO_EDIT_RENDER_WINDOW_SECONDS = 5
export const VIDEO_EDIT_RENDER_MIN_SECONDS = 0.5
/** 渲染管线输出变化（合成、解码、编码设置）时递增，旧预览文件全部失效。3：运动模糊取样与代码图层绘制（2026-10-27）。 */
export const VIDEO_EDIT_RENDER_CACHE_VERSION = 3

export interface VideoEditRenderWindow { index: number; startFrame: number; endFrame: number; key: string; heavy: boolean }

/** 两个不同种子的 53 位字符串散列拼成 106 位，足够区分同一工程里的窗口内容。 */
function hash(text: string): string {
  const one = (seed: number): string => {
    let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed
    for (let index = 0; index < text.length; index++) {
      const code = text.charCodeAt(index)
      h1 = Math.imul(h1 ^ code, 2654435761); h2 = Math.imul(h2 ^ code, 1597334677)
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
  }
  return `${one(1)}${one(7)}`
}

/** 声音相关字段不影响画面，修改音量不让预览文件失效。 */
function pictureClip(clip: VideoEditClip) {
  const { volume: _volume, audioMapping: _mapping, preservePitch: _pitch, pitchSemitones: _semitones, linkId: _link, groupId: _group,
    takes: _takes, creativeSource: _creative, audioRole: _role, remix: _remix, snapToBeat: _snap, templateId: _template, contentAnchor: _anchor, ...rest } = clip
  return rest
}

export interface VideoEditRenderDependencies {
  /** 字体库版本：替换字体后文字画面改变。 */
  fontRevision: number
  /** 跟踪与智能区域分析结果的指纹（随结果对象变化）。 */
  analysis: string
}

/** 一个序列（含其引用的全部嵌套序列、素材、代码与调色表）画面内容的指纹；同一文档对象内按序列对象缓存。 */
class DigestContext {
  private readonly sequences = new Map<VideoEditSequence, string>()
  private readonly visiting = new Set<string>()
  constructor(private readonly document: VideoEditComposition) {}
  /** 片段直接引用的素材、嵌套序列、代码定义和调色表。 */
  references(clips: readonly VideoEditClip[]): string[] {
    const parts: string[] = []
    const text = JSON.stringify(clips.map(pictureClip))
    for (const clip of clips) {
      const item = this.document.items.find(value => value.id === clip.itemId)
      if (!item) continue
      if (item.kind === 'sequence') {
        const sequence = this.document.sequences?.find(value => value.id === item.sequenceId)
        parts.push(sequence ? this.sequence(sequence) : `missing:${item.sequenceId}`)
      } else parts.push(JSON.stringify(this.document.media.find(value => value.id === item.mediaId) ?? `missing:${item.mediaId}`))
    }
    // Code clips, code effects and image parameters reference definitions and media by id inside the clip JSON.
    for (const definition of this.document.codeMaterials ?? []) if (text.includes(definition.id)) parts.push(JSON.stringify(definition))
    for (const media of this.document.media) if (text.includes(media.id)) parts.push(JSON.stringify(media))
    for (const lut of this.document.colorLuts ?? []) if (text.includes(lut.id)) parts.push(JSON.stringify(lut))
    return parts
  }
  sequence(sequence: VideoEditSequence): string {
    const cached = this.sequences.get(sequence)
    if (cached) return cached
    if (this.visiting.has(sequence.id)) return `cycle:${sequence.id}`
    this.visiting.add(sequence.id)
    const { annotations: _annotations, markers: _markers, name: _name, ...picture } = sequence
    const visual = sequence.clips.filter(clip => clip.kind !== 'audio')
    const digest = hash(JSON.stringify([{ ...picture, clips: visual.map(pictureClip) }, this.references(visual)]))
    this.visiting.delete(sequence.id)
    this.sequences.set(sequence, digest)
    return digest
  }
}

/** 窗口里可能吃力的画面：代码片段与代码效果、嵌套序列、转场或三层以上画面。实际播放测得超时也算（由调用方标注）。 */
function heavyClips(clips: readonly VideoEditClip[], transitions: number): boolean {
  if (transitions > 0) return true
  if (clips.filter(clip => clip.kind !== 'text').length >= 3) return true
  return clips.some(clip => clip.kind === 'code' || clip.kind === 'graphic' || clip.kind === 'sequence' || activeVideoEditEffects(clip).some(effect => effect.code))
}

/** 按可见内容变化切段；位置只参与映射，不进入内容指纹。 */
export function videoEditRenderWindows(document: VideoEditComposition, dependencies: VideoEditRenderDependencies): VideoEditRenderWindow[] {
  const duration = videoEditDuration(document)
  const size = Math.max(1, Math.round(document.fps * VIDEO_EDIT_RENDER_WINDOW_SECONDS))
  const context = new DigestContext(document)
  const minimum = Math.max(1, Math.round(document.fps * VIDEO_EDIT_RENDER_MIN_SECONDS))
  const visible = videoEditVisibleTracks(document)
  const visual = document.clips.filter(clip => clip.kind !== 'audio' && visible.has(clip.track))
  const transitionWindows = (document.transitions ?? []).filter(transition => videoEditTransitionMedium(transition.kind) === 'video')
    .map(transition => videoEditTransitionWindow(document, transition)).filter(window => visible.has(window.left.track))
  const visibleCaptions = document.captionTrackEnabled === false ? [] : document.captions ?? []
  const { id: _id, binId: _bin, label: _label, textTranscription: _transcription, tracks: _tracks, sampleRate: _rate, channels: _channels, captionTrackLocked: _locked, clips: _clips, transitions: _transitions, captions: _captions, annotations: _annotations, markers: _markers, name: _name, media: _media, items: _items, sequences: _sequences, codeMaterials: _codeMaterials, colorLuts: _luts, revision: _revision, ...settings } = document
  // 速度曲线与补帧方式随片段进入窗口指纹；补帧实现换版本（如光流接入）时旧窗口失效。
  const base = JSON.stringify([VIDEO_EDIT_RENDER_CACHE_VERSION, VIDEO_EDIT_FRAME_INTERPOLATION_ENGINE, settings, dependencies.fontRevision, dependencies.analysis])
  const windows: VideoEditRenderWindow[] = []
  const cuts = [...new Set([0, duration, ...visual.flatMap(clip => [clip.start, clip.start + clip.duration]),
    ...transitionWindows.flatMap(window => [window.start, window.end]), ...visibleCaptions.flatMap(caption => [caption.start, caption.start + caption.duration])])]
    .filter(frame => frame >= 0 && frame <= duration).sort((a, b) => a - b)
  const merged = [0]
  for (const cut of cuts.slice(1)) if (cut - merged[merged.length - 1] >= minimum || cut === duration) merged.push(cut)
  if (merged.length > 2 && duration - merged[merged.length - 2] < minimum) merged.splice(-2, 1)
  for (let cut = 1; cut < merged.length; cut++) {
    const start = merged[cut - 1], length = merged[cut] - start, count = Math.ceil(length / size)
    for (let part = 0; part < count; part++) {
      const startFrame = start + Math.floor(length * part / count), endFrame = start + Math.floor(length * (part + 1) / count)
      const overlapping = transitionWindows.filter(window => window.start < endFrame && window.end > startFrame)
      const handles = new Set(overlapping.flatMap(window => [window.left.id, window.right.id]))
      const clips = visual.filter(clip => handles.has(clip.id) || clip.start < endFrame && clip.start + clip.duration > startFrame)
      // 隐藏的跟踪来源仍会改变跟随片段的位置；它只参与依赖，不制造可见剪辑点。
      const dependencies = [...clips]
      const seen = new Set(clips.map(clip => clip.id))
      for (const clip of dependencies) if (clip.follow && !seen.has(clip.follow.clipId)) {
        const source = document.clips.find(candidate => candidate.id === clip.follow!.clipId)
        if (source) { seen.add(source.id); dependencies.push(source) }
      }
      // 同内容的副本可共用文件；片段身份只在段内引用关系中保留。
      const ids = new Map(dependencies.map((clip, index) => [clip.id, `clip:${index}`]))
      const pictures = dependencies.map(clip => {
        const { id, name: _name, ...picture } = pictureClip(clip)
        return { ...picture, id: ids.get(id), start: clip.start - startFrame, visible: visible.has(clip.track),
          ...(clip.follow ? { follow: { ...clip.follow, clipId: ids.get(clip.follow.clipId) ?? clip.follow.clipId } } : {}),
          // 效果实例身份与名称不改变像素；副本会分配新身份，但应能共用预览。
          effects: activeVideoEditEffects(clip).map(({ id: _id, name: _name, ...effect }) => effect) }
      })
      const transitions = overlapping.map(({ transition: { id: _id, ...transition }, start, end }) => ({ ...transition,
        leftClipId: transition.leftClipId && ids.get(transition.leftClipId), rightClipId: transition.rightClipId && ids.get(transition.rightClipId), start: start - startFrame, end: end - startFrame }))
      const captions = visibleCaptions.filter(caption => caption.start < endFrame && caption.start + caption.duration > startFrame)
        .map(({ id: _id, clipId: _clipId, speech: _speech, ...caption }) => ({ ...caption, start: caption.start - startFrame }))
      const key = hash(JSON.stringify([base, endFrame - startFrame, pictures, transitions, captions, context.references(dependencies)]))
      windows.push({ index: windows.length, startFrame, endFrame, key, heavy: heavyClips(clips, transitions.length) })
    }
  }
  return windows
}
