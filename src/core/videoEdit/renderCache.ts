import { activeVideoEditEffects } from './compositing'
import { videoEditTransitionClipIds } from './transitions'
import { videoEditDuration, type VideoEditClip, type VideoEditComposition, type VideoEditSequence } from './document'

/**
 * 预渲染缓存（PR“渲染入点到出点”的渲染条）：序列按固定长度的窗口切分，每个窗口的画面渲染成一段预览文件。
 * 窗口指纹覆盖该窗口画面的全部依赖：其中的片段与效果参数、转场、字幕、轨道状态、引用的素材身份、嵌套序列
 * （递归）、代码素材版本、字体与跟踪结果。任一依赖改变，只有受影响的窗口失效。
 */

/**
 * 每段预览文件覆盖的序列时长。换段要为下一个文件打开解码器，YOGA 全片实测 10 秒一段时换段点占了剩余丢帧的大半；
 * 30 秒一段让换段点减到三分之一，一次修改最多重渲 30 秒（与 PR 预览文件按段失效相当）。
 */
export const VIDEO_EDIT_RENDER_WINDOW_SECONDS = 30
/** 渲染管线输出变化（合成、解码、编码设置）时递增，旧预览文件全部失效。 */
export const VIDEO_EDIT_RENDER_CACHE_VERSION = 1

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
function pictureClip(clip: VideoEditClip): unknown {
  const { volume: _volume, audioMapping: _mapping, preservePitch: _pitch, ...rest } = clip
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

/** 序列按固定窗口切分，并给出每个窗口的内容指纹。 */
export function videoEditRenderWindows(document: VideoEditComposition, dependencies: VideoEditRenderDependencies): VideoEditRenderWindow[] {
  const duration = videoEditDuration(document)
  const size = Math.max(1, Math.round(document.fps * VIDEO_EDIT_RENDER_WINDOW_SECONDS))
  const context = new DigestContext(document)
  const visual = document.clips.filter(clip => clip.kind !== 'audio')
  const longest = Math.max(0, ...(document.transitions ?? []).map(transition => transition.durationFrames))
  const { clips: _clips, transitions: _transitions, captions: _captions, annotations: _annotations, markers: _markers, name: _name, media: _media, items: _items, sequences: _sequences, codeMaterials: _codeMaterials, revision: _revision, ...settings } = document
  const base = JSON.stringify([VIDEO_EDIT_RENDER_CACHE_VERSION, settings, dependencies.fontRevision, dependencies.analysis])
  const windows: VideoEditRenderWindow[] = []
  for (let index = 0; index * size < duration; index++) {
    const startFrame = index * size, endFrame = Math.min(duration, startFrame + size)
    // Transition handles reach clips just outside the window; include them conservatively.
    const clips = visual.filter(clip => clip.start < endFrame + longest && clip.start + clip.duration > startFrame - longest)
    const ids = new Set(clips.map(clip => clip.id))
    const transitions = (document.transitions ?? []).filter(transition => videoEditTransitionClipIds(transition).some(id => ids.has(id)))
    const captions = (document.captions ?? []).filter(caption => caption.start < endFrame && caption.start + caption.duration > startFrame)
    const key = hash(JSON.stringify([base, startFrame, endFrame, clips.map(pictureClip), transitions, captions, context.references(clips)]))
    const inside = clips.filter(clip => clip.start < endFrame && clip.start + clip.duration > startFrame)
    windows.push({ index, startFrame, endFrame, key, heavy: heavyClips(inside, transitions.length) })
  }
  return windows
}
