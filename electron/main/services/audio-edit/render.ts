import fs from 'node:fs/promises'
import path from 'node:path'
import { Worker } from 'node:worker_threads'
import { z } from 'zod'
import type { AudioEditProjectDocument } from '../../../../src/core/audioEdit/types'
import type { AudioEditGainRegion, AudioEditRenderedAudio, AudioEditRepair } from '../../../../src/core/audioEdit/regions'
import { buildProjectAudioEditTimeline, editedDurationFrames } from '../../../../src/core/audioEdit/timeline'
import { audioEditProjectSchema } from '../../../../src/core/audioEdit/schema'
import { createMainLogger } from '../logging'
import { removeUnmanagedCachePath } from '../media-recycle/cache-deletion'
import { loadFfmpegPath } from '../video/ffmpeg-loader'
import { audioFileStamp, recordAudioLineage, writeAudioCacheRecord } from '../audio/lineage'
import { audioEditCacheDirectory, identifyAudioEditSource, prepareAudioEditAudio, validateAudioEditAudio, verifyAudioEditSource } from './media'
import { listAudioEditProcessors, processAudioEditVstChain, audioEditProcessorCacheIdentity } from './processors'
import {
  runAudioRepair, runAudioMouthDeclick, mixAudioEditProcessed, audioRepairMaskDimensions, encodeAudioRepairMask, audioEditMouthDeclickRanges,
  AUDIO_WORKER_CONTRACT, AUDIO_WORKER_HEAL_CONTEXT, audioWorkerDeclickMargin,
} from './dsp-adapter'
import { separateAudioFile } from '../audio-separation/runtime'
import { essentialSoundOfflineStages } from '../../../../src/core/audio/essentialSound'
import { audioEditChainItemEffects, audioEditChainItemRecipe, splitAudioEditChain, type AudioEditBreathItem } from '../../../../src/core/audioEdit/effects'
import { audioRenderKey, cachedAudioFile } from './render-cache'
import { applyAudioEditRealtimeEffects, applyAudioEffectInstancesToFile } from './effects-render'
import { runAudioEditProcess } from './process'
import { openF32Wav } from './pcm-wav'
import { runAudioEditEffectsWorker } from './effects-worker-client'
import { AUDIO_IDENTITY_PHASES, audioEffectsIdentity } from '../../../../src/core/audio/effects/audioIdentity'
import {
  audioEditFrameCount, audioEditGainLayer, audioEditGainRecipes, audioEditSoundDescriptionSchema, diffAudioEditSound,
  type AudioEditFrameRange, type AudioEditSoundDescription, type AudioEditSoundDiff, type AudioEditSoundOp,
} from './sound-diff'

const logger = createMainLogger('main.audio_edit.render')

/**
 * 整段乘一层或几层音量区域（效果链中间的呼吸处理，或编辑后声音没有上一版可沿用时），在效果工作线程里处理。不拼成 FFmpeg aeval 表达式：
 * 表达式解析器的嵌套深度有限，区域到一百个左右（快节奏处理呼吸声常有上百处减弱）就无法配置滤镜，逐采样求值上百项也慢。
 */
async function renderAudioEditGains(project: AudioEditProjectDocument, source: string, layers: AudioEditGainRegion[][], output: string, signal?: AbortSignal): Promise<void> {
  await runAudioEditEffectsWorker({ kind: 'gains', input: await audioEditF32Source(project, source, signal), output, layers }, signal)
}
async function repairMask(repair: AudioEditRepair, sampleRate: number, signal?: AbortSignal): Promise<Uint8Array> {
  const { width, height } = audioRepairMaskDimensions(repair, sampleRate)
  const worker = new Worker(path.join(__dirname, 'audio-edit-mask-worker.cjs'), { workerData: { strokes: repair.strokes, width, height } })
  try {
    return await new Promise<Uint8Array>((resolve, reject) => {
      const abort = (): void => { reject(signal?.reason ?? new Error('修复已取消')); void worker.terminate() }
      signal?.addEventListener('abort', abort, { once: true })
      const cleanup = (): void => signal?.removeEventListener('abort', abort)
      worker.once('message', (bytes: Uint8Array) => { cleanup(); resolve(encodeAudioRepairMask(bytes, width, height)) })
      worker.once('error', error => { cleanup(); reject(error) })
      worker.once('exit', code => { cleanup(); if (code !== 0) reject(new Error(`画笔计算未完成：${code}`)) })
      if (signal?.aborted) abort()
    })
  } finally { await worker.terminate() }
}

/** 一版编辑后声音（时间轴同原素材，剪辑区间不在其中）怎么得到。 */
interface AudioEditRenderPlan {
  /** 修复与效果链里要整段处理的那一段（不含末尾的增益层）落成的文件；有增益层时一定是 32 位浮点 WAV。 */
  base: string
  /** 末尾连续的呼吸处理与区间音量：每层的区域按处理顺序排好，试听、导出读底声时才乘上，不为它们渲染整条声音。 */
  layers: AudioEditGainRegion[][]
  /** 这一版声音的操作序列，与上一版比较哪些帧变了。 */
  sound: AudioEditSoundDescription
}

/**
 * 顺序：修复（录音上的局部修补）→ 效果控件里要整段处理的那一段效果链（从上到下，逐项按内容缓存，改第 k 项只重算 k 往后）
 * → 末尾连续的呼吸处理 → 区间音量。末尾两类只做成增益层；效果链末尾的实时效果与输出不在这里（试听边播边算，导出用同一份代码离线处理）。
 * beforeItemId：只处理到这一项之前、且不加区间音量（检测口水音等分析要听的是这一项之前的声音）。
 */
async function buildAudioEditRenderPlan(project: AudioEditProjectDocument, signal?: AbortSignal, options: { beforeItemId?: string } = {}): Promise<AudioEditRenderPlan> {
  audioEditProjectSchema.parse(project)
  await verifyAudioEditSource(project, false, signal)
  const identity = project.source.identity ?? await identifyAudioEditSource(project.source.sourcePath, signal)
  const directory = audioEditCacheDirectory(project.id)
  const { sampleRate, channels, durationFrames } = project.source
  let keys = AUDIO_IDENTITY_PHASES.map(() => audioRenderKey(['audio-render-v1', identity.digest, sampleRate, channels, project.source.audioStreamIndex]))
  let input = await prepareAudioEditAudio(project, signal)
  const ops: AudioEditSoundOp[] = []
  const stage = async (recipe: unknown, prefix: string, produce: (source: string, output: string) => Promise<void>): Promise<void> => {
    keys = keys.map(key => audioRenderKey([key, recipe]))
    const source = input
    input = await cachedAudioFile(directory, `${prefix}-${keys[0]}`, 'wav', async output => {
      await produce(source, output)
      await validateAudioEditAudio(output, sampleRate, channels, durationFrames, signal)
    }, signal, keys.slice(1).map(key => `${prefix}-${key}`))
  }
  for (const repair of (project.repairs ?? []).filter(r => r.enabled && r.strength > 0)) {
    const { id: _id, enabled: _enabled, ...recipe } = repair
    const key = `repair:${audioRenderKey(recipe)}`
    // 频谱修复与满强度去爆音只改写选区，结果只看选区两侧固定长度的声音；部分强度的去爆音经 FFmpeg 整段混合，按整段处理。
    ops.push(repair.kind === 'spectral_heal' || repair.strength >= 1
      ? { key, kind: 'local', recipe: key, write: [repair.startFrame, repair.endFrame], context: repair.kind === 'spectral_heal' ? AUDIO_WORKER_HEAL_CONTEXT : audioWorkerDeclickMargin(sampleRate) }
      : { key, kind: 'global', recipe: key })
    await stage(recipe, 'repair', async (source, output) => {
      const mask = repair.strokes?.length ? `${output}.mask` : undefined
      try {
        if (mask) await fs.writeFile(mask, await repairMask(repair, sampleRate, signal))
        await runAudioRepair(source, output, repair, mask, signal)
      } finally { if (mask) await removeUnmanagedCachePath(mask, { force: true }) }
    })
  }
  const rendered = splitAudioEditChain(project).rendered
  const cut = options.beforeItemId ? rendered.findIndex(item => item.id === options.beforeItemId) : -1
  const items = cut >= 0 ? rendered.slice(0, cut) : rendered
  // 末尾连续的呼吸处理之后没有别的整段处理：它们与区间音量一起做成增益层，读声音时才乘上。
  let tail = items.length
  while (tail > 0 && items[tail - 1].kind === 'breath') tail--
  // 连续的实时效果攒成一遍处理；遇到整段处理的效果先把攒下的跑完。
  let pending: ReturnType<typeof audioEditChainItemEffects> = []
  let pendingIds: string[] = []
  const flush = async (): Promise<void> => {
    if (!pending.length) return
    const effects = pending; pending = []
    ops.push({ key: `realtime:${pendingIds.join('|')}`, kind: 'global', recipe: JSON.stringify(audioEffectsIdentity(effects, AUDIO_IDENTITY_PHASES[0])) })
    pendingIds = []
    keys = keys.map((key, index) => audioRenderKey([key, 'realtime', audioEffectsIdentity(effects, AUDIO_IDENTITY_PHASES[index])]))
    input = await applyAudioEffectInstancesToFile(project.id, await audioEditF32Source(project, input, signal), effects, signal)
  }
  for (const item of items.slice(0, tail)) {
    if (item.kind === 'builtin' || (item.kind === 'essential' && !essentialSoundOfflineStages(item.settings).length)) { pending.push(...audioEditChainItemEffects(item)); pendingIds.push(item.id); continue }
    await flush()
    const key = `item:${item.id}`
    if (item.kind === 'essential') {
      for (const offline of essentialSoundOfflineStages(item.settings)) {
        ops.push({ key: `${key}:${offline.kind}`, kind: 'global', recipe: JSON.stringify(['offline-v1', offline]) })
        await stage(['offline-v1', offline], offline.kind, (source, output) => separateAndMix(source, output, offline.kind, offline.amount, signal))
      }
      pending.push(...audioEditChainItemEffects(item)); pendingIds.push(item.id)
    } else if (item.kind === 'separation') {
      ops.push({ key, kind: 'global', recipe: JSON.stringify(audioEditChainItemRecipe(item)) })
      await stage(audioEditChainItemRecipe(item), item.mode, (source, output) => separateAndMix(source, output, item.mode, item.amount, signal))
    } else if (item.kind === 'mouth_declick') {
      const ranges = audioEditMouthDeclickRanges(item.clicks, durationFrames)
      // 超过一批的段数时原生进程分批接力，后一批读前一批的输出，段与段的依赖跨越整条声音，按整段处理。
      ops.push(ranges.length > AUDIO_WORKER_CONTRACT.declickMaxRanges ? { key, kind: 'global', recipe: audioRenderKey(ranges) } : { key, kind: 'clicks', ranges, margin: audioWorkerDeclickMargin(sampleRate) })
      await stage(audioEditChainItemRecipe(item), 'declick', (source, output) => runAudioMouthDeclick(source, output, item.clicks, durationFrames, signal))
    } else if (item.kind === 'breath') {
      const layer = audioEditGainLayer(breathGainRegions(item, sampleRate))
      ops.push({ key, kind: 'gain', regions: audioEditGainRecipes(layer) })
      await stage(audioEditChainItemRecipe(item), 'breath', (source, output) => renderAudioEditGains(project, source, [layer], output, signal))
    } else if (item.kind === 'plugin') {
      // 这台电脑上找不到或加载不了的插件先跳过（设置保留），整条声音照常出来。
      if (!(await listAudioEditProcessors()).some(processor => processor.id === item.pluginId && processor.available)) {
        logger.warn('插件不可用，处理时跳过', { event: 'audio_edit.render.plugin_skipped', context: { projectId: project.id, pluginId: item.pluginId } })
        continue
      }
      const settings = [{ id: item.pluginId, enabled: true, parameters: item.parameters }]
      const recipe = [audioEditChainItemRecipe(item), await audioEditProcessorCacheIdentity(settings)]
      ops.push({ key, kind: 'global', recipe: JSON.stringify(recipe) })
      await stage(recipe, 'plugin', async (source, output) => {
        const processed = await processAudioEditVstChain(source, directory, settings, signal)
        try { await fs.copyFile(processed.outputPath, output) }
        finally { await Promise.all(processed.temporaryPaths.map(file => removeUnmanagedCachePath(file, { force: true }))) }
      })
    }
  }
  await flush()
  const layers: AudioEditGainRegion[][] = []
  for (const item of items.slice(tail)) {
    if (item.kind !== 'breath') continue
    const layer = audioEditGainLayer(breathGainRegions(item, sampleRate))
    ops.push({ key: `item:${item.id}`, kind: 'gain', regions: audioEditGainRecipes(layer) })
    layers.push(layer)
  }
  const gains = options.beforeItemId ? [] : audioEditGainLayer(project.gainRegions ?? [])
  if (gains.length) {
    ops.push({ key: 'gains', kind: 'gain', regions: audioEditGainRecipes(gains) })
    layers.push(gains)
  }
  const sound: AudioEditSoundDescription = { source: audioRenderKey(['sound-source-v1', identity.digest, project.source.audioStreamIndex ?? 0, sampleRate, channels, durationFrames]), frames: durationFrames, ops }
  return { base: layers.length ? await audioEditF32Source(project, input, signal) : input, layers, sound }
}

/** 试听与导出用：底声文件 + 增益层，增益在读取时乘上，区间音量、末尾的呼吸处理不必先渲染成整条声音。 */
export function prepareAudioEditRenderPlan(project: AudioEditProjectDocument, signal?: AbortSignal): Promise<AudioEditRenderPlan> {
  return buildAudioEditRenderPlan(project, signal)
}

/**
 * 编辑后声音的完整文件（时间轴同原素材）：波形显示、XML 导出、整段处理任务、口水音检测这类要读文件的地方用。
 * 有增益层时从上一版编辑后声音复制一份，只重算与上一版不同的帧；拿不准时整段乘一遍。
 */
export async function prepareAudioEditRenderSource(project: AudioEditProjectDocument, signal?: AbortSignal, options: { beforeItemId?: string } = {}): Promise<string> {
  const plan = await buildAudioEditRenderPlan(project, signal, options)
  return materializeAudioEditPlan(project, plan, signal, !options.beforeItemId)
}

/** 人声分离 / 去混响：本地模型处理后按 amount 与处理前的声音混合。 */
async function separateAndMix(source: string, output: string, mode: 'isolate' | 'dereverb', amount: number, signal?: AbortSignal): Promise<void> {
  const separated = await separateAudioFile({ source, mode: mode === 'isolate' ? 'vocals' : 'dereverb', signal })
  await mixAudioEditProcessed(source, separated.primaryPath, amount, output, signal)
}

/** 呼吸声效果换算成音量区域：每处呼吸统一减弱（静音为 -120 dB），两端各留最多 20 毫秒的淡变，不出咔嗒声。 */
function breathGainRegions(item: AudioEditBreathItem, sampleRate: number): AudioEditGainRegion[] {
  const fade = Math.round(sampleRate * 0.02)
  return item.breaths.map((breath, index) => {
    const length = breath.endFrame - breath.startFrame, edge = Math.min(fade, Math.floor(length / 2))
    return { id: `breath-${index}`, startFrame: breath.startFrame, endFrame: breath.endFrame, gainDb: item.mode === 'mute' ? -120 : item.reductionDb, fadeInFrames: edge, fadeOutFrames: edge, enabled: true }
  })
}

/** 渲染源已是同采样率、同声道的 32 位浮点 WAV 时原样返回；否则在缓存里转一份，返回转好的文件。 */
async function audioEditF32Source(project: AudioEditProjectDocument, source: string, signal?: AbortSignal): Promise<string> {
  const direct = await openF32Wav(source)
  const matches = direct && direct.sampleRate === project.source.sampleRate && direct.channels === project.source.channels
  await direct?.close()
  if (matches) return source
  return cachedAudioFile(audioEditCacheDirectory(project.id), `render-f32-${audioRenderKey([source, project.source.sampleRate, project.source.channels])}`, 'wav', async output => {
    await runAudioEditProcess(await loadFfmpegPath(), ['-v', 'error', '-y', '-i', source, '-map', '0:a:0', '-vn', '-c:a', 'pcm_f32le', '-rf64', 'auto', '-ar', String(project.source.sampleRate), '-ac', String(project.source.channels), output], signal)
  }, signal)
}

/*
 * 每个作品最近一份编辑后声音：文件、文件戳与它的操作序列。内存一份，作品缓存目录里落一份（重开软件后第一次改动也能沿用）。
 * 下一版与它比较，只重算不同的帧；文件被清理或重建（文件戳对不上）时没有可沿用的上一版。
 */
const editedRecordSchema = z.object({ format: z.literal('audio-edit-edited-v1'), name: z.string().min(1).regex(/^[^\\/]+$/), stamp: z.string().min(1), sound: audioEditSoundDescriptionSchema }).strict()
type EditedRecord = z.infer<typeof editedRecordSchema>
const EDITED_RECORD = 'edited-latest.json'
const editedRecords = new Map<string, EditedRecord>()
const EDITED_RECORD_LIMIT = 16

/**
 * 上一版编辑后声音：文件还在、文件戳对得上就返回它与它的操作序列；还没有编辑后声音时，原素材的浮点副本就是“什么都没改”的那一版。
 * 记录存在但结构不合法（别的程序版本写的、文件损坏）时返回原因，调用方整段处理，不拿读不懂的记录推断哪些帧没变。
 */
async function previousEdited(project: AudioEditProjectDocument, directory: string, source: string, signal?: AbortSignal): Promise<{ path: string; sound: AudioEditSoundDescription } | { invalid: string } | undefined> {
  let record: EditedRecord | undefined = editedRecords.get(project.id)
  if (!record) {
    const text = await fs.readFile(path.join(directory, EDITED_RECORD), 'utf8').catch(() => undefined)
    if (text !== undefined) {
      let parsed: unknown
      try { parsed = JSON.parse(text) } catch { return { invalid: '上一版编辑后声音的记录无法解析' } }
      const checked = editedRecordSchema.safeParse(parsed)
      if (!checked.success) return { invalid: '上一版编辑后声音的记录结构不合法' }
      record = checked.data
    }
  }
  if (record) {
    const file = path.join(directory, record.name)
    if (await audioFileStamp(file) === record.stamp) return { path: file, sound: record.sound }
  }
  const original = await prepareAudioEditAudio(project, signal)
  return path.dirname(original) === directory ? { path: original, sound: { source, frames: project.source.durationFrames, ops: [] } } : undefined
}

async function rememberEdited(project: AudioEditProjectDocument, directory: string, file: string, sound: AudioEditSoundDescription): Promise<void> {
  const stamp = await audioFileStamp(file)
  if (!stamp || path.dirname(file) !== directory) return
  // 同一份文件就是同一版声音（文件按处理配方命名）：频谱逐块取文件时会反复走到这里，不重复写。
  const current = editedRecords.get(project.id)
  if (current?.name === path.basename(file) && current.stamp === stamp) return
  const record: EditedRecord = { format: 'audio-edit-edited-v1', name: path.basename(file), stamp, sound }
  editedRecords.delete(project.id)
  editedRecords.set(project.id, record)
  while (editedRecords.size > EDITED_RECORD_LIMIT) editedRecords.delete(editedRecords.keys().next().value as string)
  await writeAudioCacheRecord(path.join(directory, EDITED_RECORD), record)
}

/** 与上一版比哪些帧变了；没有上一版或记录不合法时整段。 */
function diffFromPrevious(previous: { sound: AudioEditSoundDescription } | { invalid: string } | undefined, sound: AudioEditSoundDescription): AudioEditSoundDiff {
  if (!previous) return { all: '没有可沿用的上一版编辑后声音' }
  if ('invalid' in previous) return { all: previous.invalid }
  try { return diffAudioEditSound(previous.sound, sound) } catch { return { all: '上一版编辑后声音的记录读不懂' } }
}

interface EditedBuild { mode: 'incremental' | 'full'; recomputedFrames: number; parent?: string; dirty?: AudioEditFrameRange[]; reason?: string }

/** 增益层落成文件：能与上一版比出改动的帧时复制上一版、只改写这些帧；否则整段乘一遍。 */
async function renderGainLayerFile(project: AudioEditProjectDocument, plan: AudioEditRenderPlan, directory: string, output: string, signal?: AbortSignal): Promise<EditedBuild> {
  const frames = project.source.durationFrames
  const previous = await previousEdited(project, directory, plan.sound.source, signal)
  const diff = diffFromPrevious(previous, plan.sound)
  let reason = 'all' in diff ? diff.all : undefined
  if (previous && 'path' in previous && 'ranges' in diff) {
    const recomputedFrames = audioEditFrameCount(diff.ranges)
    const reader = await openF32Wav(previous.path).catch(() => null)
    const compatible = reader?.sampleRate === project.source.sampleRate && reader.channels === project.source.channels
    await reader?.close()
    if (recomputedFrames > frames / 2) reason = '改动超过一半，整段乘更快'
    else if (!compatible) reason = '上一版不是同规格的浮点声音'
    else {
      try {
        await fs.copyFile(previous.path, output)
        if (diff.ranges.length) await runAudioEditEffectsWorker({ kind: 'gains-patch', input: plan.base, output, layers: plan.layers, ranges: diff.ranges }, signal)
        return { mode: 'incremental', recomputedFrames, parent: previous.path, dirty: diff.ranges }
      } catch (error) {
        if (signal?.aborted) throw error
        reason = `沿用上一版失败：${error instanceof Error ? error.message : String(error)}`
      }
    }
  }
  await runAudioEditEffectsWorker({ kind: 'gains', input: plan.base, output, layers: plan.layers }, signal)
  return { mode: 'full', recomputedFrames: frames, ...(reason ? { reason } : {}) }
}

async function materializeAudioEditPlan(project: AudioEditProjectDocument, plan: AudioEditRenderPlan, signal: AbortSignal | undefined, remember: boolean): Promise<string> {
  const directory = audioEditCacheDirectory(project.id)
  const { sampleRate, channels, durationFrames } = project.source
  const started = performance.now()
  const lineageOf = (build: EditedBuild): { file: string; dirty: AudioEditFrameRange[] } | undefined => build.parent && build.dirty ? { file: build.parent, dirty: build.dirty } : undefined
  let output = plan.base
  let built: EditedBuild | undefined
  if (plan.layers.length) {
    const name = `gain-${audioRenderKey(['gain-layers-v1', plan.base, plan.layers.map(audioEditGainRecipes)])}`
    output = await cachedAudioFile(directory, name, 'wav', async temporary => {
      const build = await renderGainLayerFile(project, plan, directory, temporary, signal)
      await validateAudioEditAudio(temporary, sampleRate, channels, durationFrames, signal)
      // 来历在发布（改名）之前写好：改名不改文件戳，读者一看到文件就能查到它与上一版差在哪。
      await recordAudioLineage(path.join(directory, `${name}.wav`), durationFrames, lineageOf(build), { stampFrom: temporary })
      built = build
    }, signal)
  } else if (remember && editedRecords.get(project.id)?.name !== path.basename(output) && path.dirname(output) === directory) {
    // 没有增益层时编辑后声音就是底声文件：同样记下它与上一版差在哪，波形、频谱据此只重算改动的部分。
    const previous = await previousEdited(project, directory, plan.sound.source, signal)
    if (!(previous && 'path' in previous && previous.path === output)) {
      const diff = diffFromPrevious(previous, plan.sound)
      built = previous && 'path' in previous && 'ranges' in diff ? { mode: 'incremental', recomputedFrames: 0, parent: previous.path, dirty: diff.ranges } : { mode: 'full', recomputedFrames: 0, ...('all' in diff ? { reason: diff.all } : {}) }
      // 底声文件早已存在：在把它交给调用方（波形、频谱随后来取）之前写好来历。
      await recordAudioLineage(output, durationFrames, lineageOf(built))
    }
  }
  if (built) {
    logger.info('编辑后声音已就绪', { event: 'audio_edit.render.edited.completed', context: {
      projectId: project.id, revision: project.revision, mode: built.mode, gainLayers: plan.layers.length, recomputedFrames: built.recomputedFrames,
      changedFrames: built.dirty ? audioEditFrameCount(built.dirty) : durationFrames, durationFrames, sampleRate, elapsedMs: performance.now() - started, ...(built.reason ? { fallbackReason: built.reason } : {}),
    } })
  }
  if (remember) await rememberEdited(project, directory, output, plan.sound)
  return output
}

export async function renderAudioEditProject(project: AudioEditProjectDocument, signal?: AbortSignal): Promise<AudioEditRenderedAudio> {
  const started = performance.now()
  logger.info('开始渲染音频', { event: 'audio_edit.render.start', context: { projectId: project.id, revision: project.revision } })
  try {
    const plan = await prepareAudioEditRenderPlan(project, signal)
    const spans = buildProjectAudioEditTimeline(project)
    const durationFrames = editedDurationFrames(spans)
    if (!durationFrames) throw new Error('当前没有可渲染的声音，请保留至少一段音频。')
    // 拼接算法变更只失效成品缓存，源时间上的修复与效果缓存仍可复用。增益层在拼接这一遍读底声时乘上。
    const layers = plan.layers.map(audioEditGainRecipes)
    const key = audioRenderKey(layers.length ? ['splice-crossfade-v1', plan.base, layers, spans, project.source.sampleRate] : ['splice-crossfade-v1', plan.base, spans, project.source.sampleRate])
    const spliced = await cachedAudioFile(audioEditCacheDirectory(project.id), `finished-${key}`, 'wav', async output => {
      // 逐段拼接，拼接点由共享的交叉淡化渲染器处理（与试听同一个函数）；整段读写在工作线程里
      await runAudioEditEffectsWorker({ kind: 'splices', input: await audioEditF32Source(project, plan.base, signal), output, spans, durationFrames, layers: plan.layers }, signal)
      await validateAudioEditAudio(output, project.source.sampleRate, project.source.channels, durationFrames, signal)
    }, signal)
    // 效果链末尾的实时效果与输出作用在剪好的整条声音上（与试听一致）。
    const audioPath = await applyAudioEditRealtimeEffects(project, spliced, signal)
    await verifyAudioEditSource(project, false, signal)
    logger.info('音频渲染完成', { event: 'audio_edit.render.completed', context: { projectId: project.id, elapsedMs: performance.now() - started, sourceFrames: project.source.durationFrames, durationFrames, sampleRate: project.source.sampleRate, channels: project.source.channels, gainLayers: plan.layers.length } })
    return { audioPath, durationFrames, sampleRate: project.source.sampleRate, channels: project.source.channels, revision: project.revision }
  } catch (error) { logger.error('音频渲染失败', { event: 'audio_edit.render.failed', error, context: { projectId: project.id, elapsedMs: performance.now() - started, sourceFrames: project.source.durationFrames } }); throw error }
}

/**
 * 口水音检测：听的是效果链里这一项之前的声音（修复与之前各项都已生效，区间音量不算），返回源采样帧范围。
 * itemId 不在整段处理的那段链里（例如刚加的项还没检测、尚未生效）时，按它在链里的位置取之前各项。
 * 计算在工作线程里分块进行，不阻塞主进程。
 */
export async function detectAudioEditMouthClicksInProject(project: AudioEditProjectDocument, itemId: string, sensitivity: number, range: { startFrame: number; endFrame: number } | undefined, signal?: AbortSignal, onProgress?: (value: number) => void): Promise<Array<{ startFrame: number; endFrame: number; score: number }>> {
  const chain = project.effectChain ?? []
  const index = chain.findIndex(item => item.id === itemId)
  // 这一项之后的效果不影响检测：只保留它之前的各项，再把它自己换成占位（开着、未检测）当作截止位置。
  const probe: AudioEditProjectDocument = { ...project, effectChain: [...chain.slice(0, Math.max(0, index)), { id: itemId, kind: 'mouth_declick', enabled: true, sensitivity, analyzed: false, clicks: [{ startFrame: 0, endFrame: 1 }] }] }
  const input = await audioEditF32Source(project, await prepareAudioEditRenderSource(probe, signal, { beforeItemId: itemId }), signal)
  signal?.throwIfAborted()
  const worker = new Worker(path.join(__dirname, 'audio-edit-mouth-click-worker.cjs'), { workerData: { input, sensitivity, startFrame: range?.startFrame ?? 0, endFrame: range?.endFrame ?? project.source.durationFrames } })
  try {
    return await new Promise((resolve, reject) => {
      const abort = (): void => { reject(signal?.reason ?? new Error('口水音检测已取消')); void worker.terminate() }
      signal?.addEventListener('abort', abort, { once: true })
      const cleanup = (): void => signal?.removeEventListener('abort', abort)
      worker.on('message', (message: { type: 'progress'; value: number } | { type: 'done'; clicks: Array<{ startFrame: number; endFrame: number; score: number }> } | { type: 'error'; message: string }) => {
        if (message.type === 'progress') onProgress?.(message.value)
        else if (message.type === 'done') { cleanup(); resolve(message.clicks.map(({ startFrame, endFrame, score }) => ({ startFrame, endFrame, score }))) }
        else { cleanup(); reject(new Error(`口水音检测失败：${message.message}`)) }
      })
      worker.once('error', error => { cleanup(); reject(error) })
      worker.once('exit', code => { cleanup(); if (code !== 0) reject(new Error(`口水音检测未完成：${code}`)) })
    })
  } finally { await worker.terminate() }
}

/** 仅供测试：清空内存里的“最近一份编辑后声音”。 */
export function resetAudioEditRenderForTests(): void {
  editedRecords.clear()
}
