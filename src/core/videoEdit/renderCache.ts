import { VIDEO_EDIT_RENDER_ENGINE_VERSION } from 'virtual:video-edit-render-engine'
import { activeVideoEditEffects, videoEditEffectCodes } from './compositing'
import { videoEditClipRetimed } from './clipSpeed'
import { codeMediaInputClipSeconds } from './codeMediaInput'
import { videoEditCodeInputs, videoEditCodeSceneKeys, type VideoEditCodeDeclarationReader } from './codeInputParameters'
import { isCodeImageReference, type CodeSceneReference } from './codeMaterial/contract'
import type { CodeMaterialInstance } from './codeMaterialPersistence'
import { videoEditSceneFootprints, videoEditSceneRecordsInRange } from './scene/sceneFootprint'
import type { ResolvedVideoEditScene, ResolvedVideoEditSceneRecord } from './scene/sceneResolve'
import type { VideoEditScene, VideoEditSceneRecord } from './scene/sceneSchema'
import { videoEditSceneRecordMediaIds } from './scene/sceneMedia'
import { VIDEO_EDIT_FRAME_INTERPOLATION_ENGINE } from './timeRemap'
import { videoEditTransitionPictureClips } from './transitions'
import { videoEditClipEnabled, videoEditDuration, videoEditPictureFilter, videoEditPictureTransitionWindows, videoEditVisibleTrackIndexes, type VideoEditClip, type VideoEditComposition, type VideoEditSequence } from './document'

/**
 * 预渲染缓存：按画面剪辑点分段，每段画面渲染成一份内容寻址的预览文件。
 * 窗口指纹覆盖该窗口画面的全部依赖：其中的片段与效果参数、转场、字幕、轨道状态、引用的素材身份、嵌套序列
 * （递归）、代码素材版本、片子数据、字体与跟踪结果。任一依赖改变，只有受影响的窗口失效。
 */

/**
 * 前瞻预打开已覆盖换段解码器的启动，先把重渲染粒度上限降到 5 秒；最终以实测调整。
 * 小于半秒的相邻段先合并，再等分长段，避免转场、字幕产生大量极短文件。
 */
export const VIDEO_EDIT_RENDER_WINDOW_SECONDS = 5
export const VIDEO_EDIT_RENDER_MIN_SECONDS = 0.5
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
  /**
   * 代码参数声明：片子数据按代码声明的结构解析后，一段只计入与它相交的记录。省略或读不到时，引用片子数据的片段
   * 按整份片子数据计入它所在的每一段（改任何一条记录，这个片段的所有段都失效）。
   */
  codeDeclarations?: VideoEditCodeDeclarationReader
  /** 网页参数引用的网页文件夹内容指纹（按引用里的路径）：网页文件改了，用到它的窗口失效。 */
  webContent?: (path: string) => string
}

/** 片子数据与解析后记录的短指纹按对象身份缓存：文档快照不可变，没改的片子数据跨编辑复用。 */
const sceneDigests = new WeakMap<VideoEditScene, string>()
const recordDigests = new WeakMap<ResolvedVideoEditSceneRecord, string>()
function sceneDigest(scene: VideoEditScene): string {
  let digest = sceneDigests.get(scene)
  if (digest === undefined) { digest = hash(JSON.stringify(scene)); sceneDigests.set(scene, digest) }
  return digest
}
/** 按解析后的取值：剪切、锚定移动了记录时，它的时刻跟着变，落到哪一段就让哪一段失效。 */
function recordDigest(record: ResolvedVideoEditSceneRecord): string {
  let digest = recordDigests.get(record)
  if (digest === undefined) { digest = hash(JSON.stringify([record.id, record.kind, record.parent?.id ?? null, record.at ?? null, String(record.end), record.footage ?? null, record.values])); recordDigests.set(record, digest) }
  return digest
}

/**
 * 一次计算里的引用指纹：素材、代码版本、调色表、风格与嵌套序列各自只序列化、散列一次，窗口里只放短指纹。
 * 代码只计入片段实际用到的版本（版本自带入口、文件哈希与钉住的组件，就是完整的源码身份），不计入整份定义：
 * 提交一个没人用的新版本不让预览文件失效。
 */
class DigestContext {
  private readonly digests = new WeakMap<object, string>()
  private readonly sequences = new Map<VideoEditSequence, string>()
  private readonly clips = new WeakMap<VideoEditClip, readonly string[]>()
  private readonly visiting = new Set<string>()
  private readonly sceneWholes = new WeakMap<VideoEditScene, readonly string[]>()
  private mediaById?: ReadonlyMap<string, VideoEditComposition['media'][number]>
  constructor(private readonly document: VideoEditComposition, private readonly declarations?: VideoEditCodeDeclarationReader, private readonly webContent?: (path: string) => string) {}
  digest(value: object): string {
    let digest = this.digests.get(value)
    if (digest === undefined) { digest = hash(JSON.stringify(value)); this.digests.set(value, digest) }
    return digest
  }
  /** 片段直接引用的素材、嵌套序列、代码版本和调色表。 */
  private clip(clip: VideoEditClip): readonly string[] {
    const cached = this.clips.get(clip)
    if (cached) return cached
    const parts: string[] = []
    const item = this.document.items.find(value => value.id === clip.itemId)
    if (item?.kind === 'sequence') {
      const sequence = this.document.sequences?.find(value => value.id === item.sequenceId)
      parts.push(sequence ? `sequence:${this.sequence(sequence)}` : `missing:${item.sequenceId}`)
    } else if (item) {
      const media = this.document.media.find(value => value.id === item.mediaId)
      parts.push(media ? `media:${this.digest(media)}` : `missing:${item.mediaId}`)
    }
    // Code clips, code effects and image parameters reference versions and media by id inside the clip JSON.
    const text = JSON.stringify(pictureClip(clip))
    for (const definition of this.document.codeMaterials ?? []) {
      if (!text.includes(definition.id)) continue
      const used = definition.versions.filter(version => text.includes(version.id))
      // 只提到定义、没有提到版本时无法确定用的是哪一版，按整份定义计入。
      if (used.length) for (const version of used) parts.push(`code:${this.digest(version)}`)
      else parts.push(`definition:${this.digest(definition)}`)
    }
    for (const media of this.document.media) if (text.includes(media.id)) parts.push(`media:${this.digest(media)}`)
    for (const lut of this.document.colorLuts ?? []) if (text.includes(lut.id)) parts.push(`lut:${this.digest(lut)}`)
    for (const instance of [clip.code, ...videoEditEffectCodes(activeVideoEditEffects(clip))]) for (const value of Object.values(instance?.parameters ?? {})) {
      if (isCodeImageReference(value) && value.kind === 'web') parts.push(`web:${this.webContent?.(value.path) ?? 'unknown'}`)
    }
    this.clips.set(clip, parts)
    return parts
  }
  references(clips: readonly VideoEditClip[]): string[] { return clips.flatMap(clip => this.clip(clip)) }
  /** 片段代码与代码效果引用的片子数据：每个 scene 参数一项。 */
  private sceneReferences(clip: VideoEditClip): Array<{ instance: CodeMaterialInstance; key: string; scene: VideoEditScene | undefined; sceneId: string }> {
    return [clip.code, ...videoEditEffectCodes(activeVideoEditEffects(clip))].flatMap(instance => videoEditCodeSceneKeys(instance).map(key => {
      const sceneId = (instance!.parameters[key] as CodeSceneReference).sceneId
      return { instance: instance!, key, scene: this.document.scenes?.find(scene => scene.id === sceneId), sceneId }
    }))
  }
  /** 记录引用到的素材身份：片段上只有 sceneId，录屏与截图素材只出现在片子数据里。 */
  private sceneMedia(records: Iterable<VideoEditSceneRecord>, extra: readonly string[] = []): string[] {
    this.mediaById ??= new Map(this.document.media.map(media => [media.id, media]))
    return [...new Set([...videoEditSceneRecordMediaIds(this.document, records), ...extra])].flatMap(id => { const media = this.mediaById!.get(id); return media ? [`media:${this.digest(media)}`] : [] })
  }
  /** 整份片子数据及其引用的全部素材。 */
  private wholeScene(scene: VideoEditScene): readonly string[] {
    let parts = this.sceneWholes.get(scene)
    if (!parts) { parts = [`scene:${sceneDigest(scene)}`, ...this.sceneMedia(scene.records)]; this.sceneWholes.set(scene, parts) }
    return parts
  }
  /**
   * 能按时段计入的前提：代码片段本身、没变速（作者代码按变速后的时间取值，与片段素材时间不再对应）。代码效果与变速的
   * 片段一律整份计入，也就不读它们的声明（读取中还要多等一轮编译）。
   */
  private sceneRange(clip: VideoEditClip, instance: CodeMaterialInstance, key: string): ResolvedVideoEditScene | undefined {
    return instance === clip.code && clip.kind === 'code' && !videoEditClipRetimed(clip) ? videoEditCodeInputs(this.document, instance, this.declarations)?.scenes[key] : undefined
  }
  /**
   * 片段画面依赖的片子数据在 [startFrame, endFrame) 里的部分：只计入与这一段相交的记录（片段素材时间，与取帧时间表
   * 同一条时间轴，前后各多算一帧给运动模糊的快门取样）及它们引用的素材。说不清时段（声明还没读到、见 sceneRange）的
   * 计入整份片子数据及其全部素材。
   */
  scenes(clip: VideoEditClip, startFrame: number, endFrame: number): string[] {
    return this.sceneReferences(clip).flatMap(({ instance, key, scene, sceneId }) => {
      if (!scene) return [`missing-scene:${sceneId}`]
      const resolved = this.sceneRange(clip, instance, key)
      if (!resolved) return this.wholeScene(scene)
      const from = codeMediaInputClipSeconds(clip, startFrame - 1, this.document.frameRate), to = codeMediaInputClipSeconds(clip, endFrame + 1, this.document.frameRate)
      const records = videoEditSceneRecordsInRange(videoEditSceneFootprints(resolved), from, to)
      return [`scene-range:${hash(records.map(recordDigest).join(','))}`, ...this.sceneMedia(records.map(record => record.source), records.flatMap(record => record.footage ? [record.footage] : []))]
    })
  }
  /** 切段签名里的片子数据：整份内容与素材，以及能否按时段计入（声明读到以后各段指纹会换成按时段计入）。 */
  sceneSignature(clip: VideoEditClip): string[] {
    return this.sceneReferences(clip).flatMap(({ instance, key, scene, sceneId }) => scene ? [...this.wholeScene(scene), this.sceneRange(clip, instance, key) ? 'range' : 'whole'] : [`missing:${sceneId}`])
  }
  sequence(sequence: VideoEditSequence): string {
    const cached = this.sequences.get(sequence)
    if (cached) return cached
    if (this.visiting.has(sequence.id)) return `cycle:${sequence.id}`
    this.visiting.add(sequence.id)
    const { annotations: _annotations, markers: _markers, name: _name, ...picture } = sequence
    const visual = sequence.clips.filter(clip => clip.kind !== 'audio')
    // 子序列里代码读到的片子数据整份计入（连同其中的素材）：子序列的时间与父窗口的对应关系不在这里展开。
    const scenes = visual.flatMap(clip => this.sceneReferences(clip).flatMap(({ scene, sceneId }) => scene ? this.wholeScene(scene) : [`missing-scene:${sceneId}`]))
    const digest = hash(JSON.stringify([{ ...picture, clips: visual.map(pictureClip) }, this.style(sequence.styleId), this.references(visual), ...(scenes.length ? [scenes] : [])]))
    this.visiting.delete(sequence.id)
    this.sequences.set(sequence, digest)
    return digest
  }
  /** 只计入序列绑定的那份风格；工程里其他风格副本不影响这条序列的画面。 */
  style(styleId: string | undefined): string | null {
    const style = styleId ? this.document.styles?.find(value => value.id === styleId) : undefined
    return style ? this.digest(style) : styleId ? `missing:${styleId}` : null
  }
}

/** 窗口里可能吃力的画面：代码片段与代码效果、嵌套序列、转场或三层以上画面。实际播放测得超时也算（由调用方标注）。 */
function heavyClips(clips: readonly VideoEditClip[], transitions: number): boolean {
  if (transitions > 0) return true
  if (clips.filter(clip => clip.kind !== 'text').length >= 3) return true
  return clips.some(clip => clip.kind === 'code' || clip.kind === 'graphic' || clip.kind === 'sequence' || activeVideoEditEffects(clip).some(effect => effect.code))
}

/** 一条序列的窗口与输入签名：签名相同（例如只改了声音）时窗口与指纹必然相同，可直接沿用上一次的结果。 */
export interface VideoEditRenderWindowSet { signature: string; windows: VideoEditRenderWindow[] }

/** 按可见内容变化切段；位置只参与映射，不进入内容指纹。 */
export function videoEditRenderWindows(document: VideoEditComposition, dependencies: VideoEditRenderDependencies): VideoEditRenderWindow[] {
  return videoEditRenderWindowSet(document, dependencies).windows
}

/**
 * 同 videoEditRenderWindows，另给出全部输入的签名；传入上一次的结果且签名相同则原样返回，不再逐段散列。
 * 签名覆盖切段与指纹用到的一切：时长、公共设置、可见画面片段与跟踪来源及其引用、转场、字幕。音频片段不在其中。
 */
export function videoEditRenderWindowSet(document: VideoEditComposition, dependencies: VideoEditRenderDependencies, previous?: VideoEditRenderWindowSet): VideoEditRenderWindowSet {
  const duration = videoEditDuration(document)
  const size = Math.max(1, Math.round(document.fps * VIDEO_EDIT_RENDER_WINDOW_SECONDS))
  const context = new DigestContext(document, dependencies.codeDeclarations, dependencies.webContent)
  const minimum = Math.max(1, Math.round(document.fps * VIDEO_EDIT_RENDER_MIN_SECONDS))
  const visible = videoEditVisibleTrackIndexes(document); const picture = videoEditPictureFilter(document)
  // 停用片段的首尾仍作切点：开关一个片段只让与它重叠的窗口失效，别处的切段与已渲染文件不变。
  const placed = document.clips.filter(clip => clip.kind !== 'audio' && visible.has(clip.track))
  const visual = placed.filter(videoEditClipEnabled)
  const transitionWindows = videoEditPictureTransitionWindows(document)
  const visibleCaptions = document.captionTrackEnabled === false ? [] : document.captions ?? []
  const { id: _id, binId: _bin, label: _label, textTranscription: _transcription, tracks: _tracks, sampleRate: _rate, channels: _channels, captionTrackLocked: _locked, clips: _clips, transitions: _transitions, captions: _captions, annotations: _annotations, markers: _markers, name: _name, media: _media, items: _items, sequences: _sequences, codeMaterials: _codeMaterials, colorLuts: _luts, styles: _styles, scenes: _scenes, revision: _revision, ...settings } = document
  // 渲染引擎版本由合成、指纹与编码相关源码在构建时散列得出（scripts/vite/renderEngineVersion.mjs），引擎实现一变旧窗口全部失效。
  // 速度曲线与补帧方式随片段进入窗口指纹；补帧实现换版本（如光流接入）时旧窗口失效。公共部分整份只散列一次。
  const base = hash(JSON.stringify([VIDEO_EDIT_RENDER_ENGINE_VERSION, VIDEO_EDIT_FRAME_INTERPOLATION_ENGINE, settings, context.style(document.styleId), dependencies.fontRevision, dependencies.analysis]))
  // 隐藏的跟踪来源仍会改变跟随片段的位置；它只参与依赖，不制造可见剪辑点。
  const followSources = (clips: readonly VideoEditClip[]): VideoEditClip[] => {
    const result = [...clips]
    const seen = new Set(clips.map(clip => clip.id))
    for (const clip of result) if (clip.follow && !seen.has(clip.follow.clipId)) {
      const source = document.clips.find(candidate => candidate.id === clip.follow!.clipId)
      if (source) { seen.add(source.id); result.push(source) }
    }
    return result
  }
  const signature = hash(JSON.stringify([base, duration, size, minimum, [...visible].sort((a, b) => a - b),
    followSources(visual).map(clip => { const scenes = context.sceneSignature(clip); return [pictureClip(clip), context.references([clip]), ...(scenes.length ? [scenes] : [])] }),
    // 停用片段不进指纹，但首尾参与切段：移动、裁剪、增删它都要重新分段。
    placed.filter(clip => !videoEditClipEnabled(clip)).map(clip => [clip.start, clip.start + clip.duration]),
    transitionWindows.map(window => [window.transition, window.start, window.end, window.left.id, window.right.id, window.empty]), visibleCaptions]))
  if (previous?.signature === signature) return previous
  const windows: VideoEditRenderWindow[] = []
  const cuts = [...new Set([0, duration, ...placed.flatMap(clip => [clip.start, clip.start + clip.duration]),
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
      const handles = new Set(overlapping.flatMap(window => videoEditTransitionPictureClips(window).map(clip => clip.id)))
      const clips = visual.filter(clip => handles.has(clip.id) || clip.start < endFrame && clip.start + clip.duration > startFrame)
      const dependencies = followSources(clips)
      // 同内容的副本可共用文件；片段身份只在段内引用关系中保留。
      const ids = new Map(dependencies.map((clip, index) => [clip.id, `clip:${index}`]))
      const pictures = dependencies.map(clip => {
        const { id, name: _name, ...shown } = pictureClip(clip)
        // 片子数据不整份进公共部分：只有引用它的片段带上与这一段相交的那几条记录。
        const scenes = context.scenes(clip, startFrame, endFrame)
        return { ...shown, id: ids.get(id), start: clip.start - startFrame, visible: picture.has(clip), ...(scenes.length ? { scenes } : {}),
          ...(clip.follow ? { follow: { ...clip.follow, clipId: ids.get(clip.follow.clipId) ?? clip.follow.clipId } } : {}),
          // 效果实例身份与名称不改变像素；副本会分配新身份，但应能共用预览。
          effects: activeVideoEditEffects(clip).map(({ id: _id, name: _name, ...effect }) => effect) }
      })
      const transitions = overlapping.map(({ transition: { id: _id, ...transition }, start, end, empty }) => ({ ...transition,
        leftClipId: transition.leftClipId && ids.get(transition.leftClipId), rightClipId: transition.rightClipId && ids.get(transition.rightClipId), start: start - startFrame, end: end - startFrame, empty }))
      const captions = visibleCaptions.filter(caption => caption.start < endFrame && caption.start + caption.duration > startFrame)
        .map(({ id: _id, clipId: _clipId, speech: _speech, ...caption }) => ({ ...caption, start: caption.start - startFrame }))
      const key = hash(JSON.stringify([base, endFrame - startFrame, pictures, transitions, captions, context.references(dependencies)]))
      windows.push({ index: windows.length, startFrame, endFrame, key, heavy: heavyClips(clips, transitions.length) })
    }
  }
  return { signature, windows }
}
