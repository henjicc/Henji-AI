import type { z } from 'zod'
import type { queryVideoEditReviewCapability } from '@/core/application-control/domains/videoEdit/videoEditReviewCapability'
import type { CodeAuthorFrameObservation } from '@/core/videoEdit/codeAuthorProgram'
import type { VideoEditComposition, VideoEditClip, VideoEditMedia } from '@/core/videoEdit/document'
import { videoEditPictureTransitionsAt } from '@/core/videoEdit/document'
import { activeVideoEditEffects } from '@/core/videoEdit/compositing'
import { videoEditClipSourceTimeAt } from '@/core/videoEdit/clipSpeed'
import { evaluateCodeMaterialParameters, prepareCodeMaterialParameters } from '@/core/videoEdit/codeMaterialAnimation'
import { validateCodeMaterialParameterValue } from '@/core/videoEdit/codeMaterial/parameters'
import { codeMaterialMediaIds, codeMaterialUsesAudio } from '@/core/videoEdit/codeMaterialResources'
import { videoEditCodeInputs } from '@/core/videoEdit/codeInputParameters'
import { videoEditNestedCaptionSourceId } from '@/core/videoEdit/nestedCaptions'
import { evaluateVideoEditClip } from '@/core/videoEdit/keyframes'
import { assertVideoEditReviewBudget, type VideoEditReviewRecord } from '@/core/videoEdit/review'
import { projectVideoEditSequenceMapRange, videoEditSourceMapLocalFrame, visitVideoEditPictureInstances, type VideoEditSourceMapRange, type VideoEditSourceMapEntry } from '@/core/videoEdit/sourceMap'
import { trialVideoEditCodeFrames } from './videoEditCodeTrial'
import { createVideoEditMotionAnalyzer } from './videoEditMotionReviewWorkerClient'
import { readVideoEditCodeProgram, withVideoEditCodeMetadata } from './videoEditCodeState'
import type { VideoEditInstance } from './videoEditService'
import type { VideoEditEffectPixelEvidence } from '@/core/videoEdit/effectPixelReview'
import { pinVideoEditMotionSources, verifyVideoEditMotionSources } from './videoEditPixelMotion'

type Options = NonNullable<z.infer<typeof queryVideoEditReviewCapability.inputSchema>['visual']>
interface Placement { local: VideoEditComposition; entry: VideoEditSourceMapEntry }
interface Comparison { frame: number; off: VideoEditComposition; record: Omit<VideoEditReviewRecord, 'kind' | 'timeline'>; name: string; parameter?: string; offValue?: number | boolean }

/** 临时副本通过正式 replaceContent 触发同一缓存失效；不写工程，不改变播放头。 */
function altered(composition: VideoEditComposition, clipId: string, change: (clip: VideoEditClip) => VideoEditClip): VideoEditComposition {
  const replace = (clips: VideoEditClip[]): VideoEditClip[] => clips.map(clip => clip.id === clipId ? change(clip) : clip)
  return { ...composition, clips: replace(composition.clips), sequences: composition.sequences?.map(sequence => ({ ...sequence, clips: replace(sequence.clips) })) }
}

export async function collectVideoEditVisualReview(owner: VideoEditInstance, composition: VideoEditComposition, range: VideoEditSourceMapRange, options: Options, signal: AbortSignal, assertCurrent: () => void, existingCount: number, warnings: string[], reviewFrames: readonly number[] = []): Promise<{ records: VideoEditReviewRecord[]; sources: VideoEditMedia[] }> {
  const records: VideoEditReviewRecord[] = [], placements: Placement[] = [], skippedProbes: string[] = []
  const captions: Array<{ text: string; record: VideoEditReviewRecord }> = []
  visitVideoEditPictureInstances(composition, range, { sequence() {}, clip(local, entry) { placements.push({ local, entry }) } })
  if (options.narration) visitVideoEditPictureInstances(composition, { from: 0, to: range.to }, {
    clip() {},
    sequence(instance) {
      // 嵌套试渲染会裁切/拆分字幕；句首只认保存序列中的原始段落。
      const saved = composition.sequences?.find(sequence => sequence.id === instance.composition.id) ?? instance.composition
      for (const caption of saved.captions ?? []) {
        // 句首要定位该帧的实际采样；共享单点投影表达的是跨越时间边界。
        const full = projectVideoEditSequenceMapRange(instance, { from: caption.start, to: caption.start + 1 })
        const visible = projectVideoEditSequenceMapRange(instance, { from: caption.start, to: caption.start + caption.duration })
        if (!full || !visible || full.from < visible.from || full.from >= visible.to || full.from < range.from || full.from >= range.to) continue
        captions.push({ text: caption.text, record: { kind: 'narration_alignment', sequenceId: instance.composition.id, subjectId: videoEditNestedCaptionSourceId(caption), subjectType: 'video_edit.caption', path: instance.path, timeline: { from: full.from, to: full.from + 1 } } })
        assertVideoEditReviewBudget(existingCount + captions.length)
      }
    },
  })
  const comparisons: Comparison[] = []
  if (options.effects) for (const { entry, local } of placements) {
    const clip = entry.path.at(-1)!.clip
    for (const effect of activeVideoEditEffects(clip)) {
      const off = altered(composition, clip.id, value => ({ ...value, effects: value.effects?.map(value => value.id === effect.id ? { ...value, enabled: false } : value) }))
      for (const frame of new Set([entry.timeline.from, Math.floor((entry.timeline.from + entry.timeline.to - 1) / 2), entry.timeline.to - 1])) comparisons.push({ frame, off, record: { sequenceId: local.id, subjectId: effect.id, subjectType: 'video_edit.effect', path: entry.path }, name: effect.name })
    }
  }
  for (const probe of options.probes) {
    if (probe.frame < range.from || probe.frame >= range.to) throw new Error('visual.probes.frame 必须位于本次 from/to 内。')
    const matches = placements.filter(({ entry }) => probe.clipRef.id === `${owner.document.id}:${entry.path.at(-1)!.clip.id}` && probe.frame >= entry.timeline.from && probe.frame < entry.timeline.to)
    if (!matches.length) throw new Error('visual.probes.clipRef 在指定帧没有可见放置，请使用本工程代码片段引用。')
    for (const { entry, local } of matches) {
      const clip = entry.path.at(-1)!.clip, code = clip.code
      if (!code) throw new Error('visual.probes.clipRef 必须是作者代码生成器片段。')
      const program = await withVideoEditCodeMetadata(() => readVideoEditCodeProgram(owner, owner.document, code))
      const declaration = program.parameters.find(value => value.key === probe.parameter)
      if (!declaration || declaration.type !== 'number' && declaration.type !== 'boolean') throw new Error(`visual.probes.parameter ${probe.parameter} 必须是已声明的数值或布尔参数。`)
      const offValue = validateCodeMaterialParameterValue(declaration, probe.offValue) as number | boolean
      const localFrame = videoEditSourceMapLocalFrame(entry, probe.frame)
      const window = videoEditPictureTransitionsAt(local, localFrame).some(window => window.left?.id === clip.id || window.right?.id === clip.id)
      const values = evaluateCodeMaterialParameters(prepareCodeMaterialParameters(program, code), videoEditClipSourceTimeAt(clip, localFrame - clip.start, local.frameRate, window && program.mode === 'static'))
      if (values[probe.parameter] === offValue) { skippedProbes.push(`帧 ${probe.frame} ${probe.parameter}`); continue }
      const off = altered(composition, clip.id, value => { const curves = { ...value.code!.curves }; delete curves[probe.parameter]; return { ...value, code: { ...value.code!, parameters: { ...value.code!.parameters, [probe.parameter]: offValue }, curves } } })
      comparisons.push({ frame: probe.frame, off, record: { sequenceId: local.id, subjectId: clip.id, path: entry.path }, name: `${clip.name} / ${probe.parameter}`, parameter: probe.parameter, offValue })
    }
  }
  const comparisonFrames = new Set(comparisons.map(value => value.frame))
  const pixelFrames = new Set([...comparisonFrames, ...(options.banding ? reviewFrames : [])])
  if (options.banding && !pixelFrames.size) warnings.push('色带检查没有可检查的候选帧；请将 from/to 指向含画面片段的区间，或用 visual.probes 指定已放置代码片段的 frame 和参数后重查。')
  const additionalBandingFrames = pixelFrames.size - comparisonFrames.size
  // 字幕仅需有代码放置的局部观察；按序列和帧去重，再按文档批量取，避免反复切换根/子序列。
  const observations = new Map<VideoEditComposition, { local: VideoEditComposition; frames: Set<number>; values: Map<number, CodeAuthorFrameObservation> }>()
  for (const { record } of captions) for (const { local, entry } of placements) {
    const frame = record.timeline.from
    if (!entry.path.at(-1)!.clip.code || frame < entry.timeline.from || frame >= entry.timeline.to) continue
    const job = observations.get(local) ?? { local, frames: new Set(), values: new Map() }
    job.frames.add(videoEditSourceMapLocalFrame(entry, frame)); observations.set(local, job)
  }
  const plannedFrames = comparisons.length + comparisonFrames.size * 2 + additionalBandingFrames + [...observations.values()].reduce((sum, job) => sum + job.frames.size, 0)
  const plannedPixels = (comparisons.length + comparisonFrames.size * 2 + additionalBandingFrames) * composition.width * composition.height + [...observations.values()].reduce((sum, job) => sum + job.frames.size * job.local.width * job.local.height, 0)
  if (plannedFrames > 120 || plannedPixels > 250_000_000) throw new Error(`画面复核预计需渲染 ${plannedFrames} 帧（${Math.ceil(plannedPixels / 1e6)} 百万像素），超过单次计算预算；请缩小 from/to，或分别启用 visual.narration / effects / banding。尚未开始渲染，未截断证据。`)
  // 色带记录数要扫完才知道，由 append 逐条按实际数量计入预算；按理论上界预检会让多帧检查误报超预算。
  assertVideoEditReviewBudget(existingCount + captions.length + comparisons.length)
  const dependencies = await withVideoEditCodeMetadata(() => {
    const media = new Map<string, VideoEditMedia>()
    for (const { local, entry } of placements) {
      const clip = entry.path.at(-1)!.clip, ids = new Set<string>()
      if (entry.mediaId) ids.add(entry.mediaId)
      for (const code of [clip.code, ...activeVideoEditEffects(clip).map(effect => effect.code)]) if (code) {
        const program = readVideoEditCodeProgram(owner, owner.document, code)
        const values = prepareCodeMaterialParameters(program, code).values
        const inputs = videoEditCodeInputs(local, { ...code, parameters: values }, instance => readVideoEditCodeProgram(owner, owner.document, instance).parameters)
        for (const id of codeMaterialMediaIds({ ...code, parameters: inputs?.parameters ?? values })) ids.add(id)
        if (codeMaterialUsesAudio(program)) for (const item of local.items) if (item.mediaId && local.clips.some(clip => clip.itemId === item.id && clip.kind === 'audio')) ids.add(item.mediaId)
      }
      for (const source of local.media) if (ids.has(source.id)) media.set(source.id, source)
    }
    return [...media.values()]
  })
  const sources = await pinVideoEditMotionSources(dependencies, signal, assertCurrent)
  // 文件身份进入正式渲染输入，避免沿用此前同路径文件的画面缓存。
  const byId = new Map(sources.map(media => [media.id, media]))
  composition = { ...composition, media: composition.media.map(media => { const pinned = byId.get(media.id); return pinned ? { ...pinned, sourceRevision: `${media.sourceRevision ?? ''}:review:${pinned.assetContent!.contentIdentity}` } : media }) }
  const pinnedDocuments = new Map<VideoEditComposition, VideoEditComposition>()
  const pinnedDocument = (document: VideoEditComposition): VideoEditComposition => {
    let pinned = pinnedDocuments.get(document)
    if (!pinned) { pinned = { ...document, media: document.media.map(media => composition.media.find(source => source.id === media.id) ?? media) }; pinnedDocuments.set(document, pinned) }
    return pinned
  }
  const append = (record: VideoEditReviewRecord): void => { assertVideoEditReviewBudget(existingCount + records.length + 1); records.push(record) }
  const render = async (document: VideoEditComposition, frame: number, observe?: (value: CodeAuthorFrameObservation) => void): Promise<ImageBitmap> => {
    assertCurrent()
    const bitmap = await trialVideoEditCodeFrames([{ document: pinnedDocument(document), frame }], signal, true, undefined, undefined, observe)
    try { assertCurrent(); if (!bitmap) throw new Error('画面复核未取得合成帧，请重查。'); return bitmap } catch (error) { bitmap?.close(); throw error }
  }
  for (const job of observations.values()) {
    assertCurrent()
    await trialVideoEditCodeFrames([...job.frames].map(frame => ({ document: pinnedDocument(job.local), frame })), signal, false, undefined, undefined, value => { job.values.set(value.frame, value) })
    assertCurrent()
  }
  const seenCaptions = new Set<string>()
  for (const caption of captions) {
    const { record } = caption, frame = record.timeline.from
    const key = JSON.stringify([record.sequenceId, record.subjectId, record.path.map(step => step.clipId)])
    if (seenCaptions.has(key)) continue
    seenCaptions.add(key)
    const { width, height } = composition
    const content: string[] = []
    for (const { local, entry } of placements) {
      if (frame < entry.timeline.from || frame >= entry.timeline.to) continue
      const clip = entry.path.at(-1)!.clip, localFrame = videoEditSourceMapLocalFrame(entry, frame)
      const opacity = entry.path.reduce((value, step, index) => value * evaluateVideoEditClip(step.clip, videoEditSourceMapLocalFrame({ path: entry.path.slice(0, index + 1) }, frame)).opacity, 1)
      if (opacity < .01) continue
      if (!clip.code) { content.push(clip.text || clip.name); continue }
      const layer = observations.get(local)?.values.get(localFrame)?.clips.find(value => value.clipId === clip.id && value.versionId === clip.code!.versionId)
      if (!layer?.elements.length) content.push(`${clip.name}（没有可观察的作者图层，需读图）`)
      for (const element of layer?.elements ?? []) {
        if ((element.opacity ?? 1) < .01) continue
        const texts = [...new Set([...(element.canvasReview ?? []).filter(fact => fact.kind === 'text' && fact.opacity >= .01 && fact.retained !== false).map(fact => fact.text ?? ''), ...(element.textDraws ?? []).filter(draw => draw.opacity >= .01 && draw.retained !== false).map(draw => draw.sourceText)])].filter(Boolean)
        content.push(`${clip.name} / ${element.name}${texts.length ? `：${texts.join('；')}` : ''}`)
      }
    }
    append({ ...record, motionEvidence: { basis: 'code_structure', visual: { captionText: caption.text, content, width, height }, suggestion: `序列帧 ${frame}（${(frame / composition.fps).toFixed(2)}秒）为这段字幕句首；对照 visual.captionText 与 content，并用 observe_video_edit_frame 读图核对语义。画面若晚于口播，提前对应片段/作者动画，或调整字幕与声音剪切；内容清单是结构候选，不证明遮挡后的像素可见。` } })
  }
  const analyzer = createVideoEditMotionAnalyzer(signal)
  try {
    for (const frame of pixelFrames) {
      const baseline = await render(composition, frame)
      try {
        if (options.banding) {
          const image = await createImageBitmap(baseline)
          try {
            const result = await analyzer.analyze({ banding: image })
            assertCurrent()
            if (!result.banding) throw new Error('色带检查没有返回证据，请重查。')
            const clipRefs = [...new Set(placements.filter(({ entry }) => frame >= entry.timeline.from && frame < entry.timeline.to).map(({ entry }) => entry.path.at(-1)!.clip.id))].map(id => ({ kind: 'video_edit.clip' as const, id: `${owner.document.id}:${id}` }))
            const hasSourceMedia = placements.some(({ entry }) => frame >= entry.timeline.from && frame < entry.timeline.to && ['video', 'image'].includes(entry.path.at(-1)!.clip.kind))
            for (const evidence of result.banding) append({ kind: 'banding', subjectType: 'video_edit.sequence', subjectId: composition.id, sequenceId: composition.id, path: [], timeline: { from: frame, to: frame + 1 },
              motionEvidence: { basis: 'program_pixels', banding: { ...evidence, clipRefs }, suggestion: `序列帧 ${frame}（${(frame / composition.fps).toFixed(2)}秒）在比例区域 (${evidence.region.x.toFixed(3)}, ${evidence.region.y.toFixed(3)}, ${evidence.region.width.toFixed(3)}, ${evidence.region.height.toFixed(3)}) 检出宽平台与连续一级台阶，疑似色带；同帧片段见 clipRefs，不能据此定位源层。${hasSourceMedia ? '同帧有视频/图片，色带可能是素材自带；先对照原素材，必要时去色带或加颗粒。' : ''}若来自代码，删掉氛围用大面积极浅渐变；确需时在 GPU 中画并加交错梯度噪声，幅度按叠到底色后最终画面的半级亮度算，不按透明度；Canvas2D 渐变只用于小范围。取帧将暗部对比度拉高约6倍读图复查。` } })
          } finally { image.close() }
        }
        if (!comparisonFrames.has(frame)) continue
        const measured: Array<{ job: Comparison; pixels: VideoEditEffectPixelEvidence }> = []
        const compare = async (image: ImageBitmap): Promise<VideoEditEffectPixelEvidence> => {
          const images: ImageBitmap[] = []
          try {
            images.push(await createImageBitmap(baseline)); images.push(image)
            const result = await analyzer.analyze({ comparison: images as [ImageBitmap, ImageBitmap] })
            assertCurrent()
            if (!result.comparison) throw new Error('效果像素比较没有返回证据，请重查。')
            return result.comparison
          } finally { images[0]?.close(); image.close() }
        }
        for (const job of comparisons.filter(job => job.frame === frame)) measured.push({ job, pixels: await compare(await render(job.off, frame)) })
        // 所有效果共享同一帧的开、重复开基线；中间每次只持有一个关闭帧，避免内存随效果数增长。
        const stability = await compare(await render(composition, frame))
        for (const { job: { record, name, parameter, offValue }, pixels: changed } of measured) {
          const pixels = { ...changed, unstablePixels: stability.changedPixels }
          const kind = pixels.unstablePixels ? 'effect_unstable' : pixels.changedPixels ? 'effect_visible' : 'effect_unchanged'
          append({ ...record, kind, timeline: { from: frame, to: frame + 1 }, motionEvidence: { basis: 'program_pixels', visual: { ...pixels, ...(parameter === undefined ? {} : { parameter, offValue }) },
            suggestion: `序列帧 ${frame}（${(frame / composition.fps).toFixed(2)}秒）“${name}”：${kind === 'effect_unstable' ? '重复开启时画面不一致，不能归因于效果；检查作者确定性与输入就绪，再重查。' : kind === 'effect_unchanged' ? '开关前后全尺寸像素无差异；检查是否实际绘制、被裁切或遮挡、参数是否被使用及辉光/描边范围，再换效果应显现的帧比较。' : '开关前后有像素差异；结合变化比例、最大和平均通道差，再取帧读图确认是否为预期效果。'} 此结论只覆盖这一帧。` } })
        }
      } finally { baseline.close() }
    }
  } finally { analyzer.dispose() }
  if (options.banding) warnings.push('色带仅检查所采最终合成帧的原尺寸宽平台和连续一级台阶；有噪点或抖动的细小断层可能漏检。位置是画面比例坐标，同帧片段不是源层归因；候选须拉高暗部对比度约6倍读图，未检测到不保证其他帧或最终编码无色带。')
  if (skippedProbes.length) warnings.push(`这些探针当前值已等于 offValue，未作效果判断：${skippedProbes.join('、')}。`)
  warnings.push('口播清单按字幕段句首，不自动识别语义；片段/图层及正文清单不包含遮挡分析，网页画面就绪由正式取帧链路负责。效果只比较所采帧的全尺寸最终合成像素，可能被上层遮挡或本帧自然为零；相同不能推断整段无效，差异不能证明效果正确。任意作者参数无统一关闭语义，需显式 probes；重复使用同一嵌套片段时开关影响该实体的全部实例。')
  await verifyVideoEditMotionSources(sources, signal, assertCurrent)
  return { records, sources }
}
