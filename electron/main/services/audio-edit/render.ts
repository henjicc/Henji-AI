import fs from 'node:fs/promises'
import path from 'node:path'
import { Worker } from 'node:worker_threads'
import type { AudioEditProjectDocument } from '../../../../src/core/audioEdit/types'
import { applyAudioEditGainRegions, audioEditSoundRecipe, type AudioEditGainRegion, type AudioEditRenderedAudio, type AudioEditRepair } from '../../../../src/core/audioEdit/regions'
import { buildProjectAudioEditTimeline, editedDurationFrames } from '../../../../src/core/audioEdit/timeline'
import { audioEditProjectSchema } from '../../../../src/core/audioEdit/schema'
import { createMainLogger } from '../logging'
import { removeUnmanagedCachePath } from '../media-recycle/cache-deletion'
import { loadFfmpegPath } from '../video/ffmpeg-loader'
import { audioEditCacheDirectory, identifyAudioEditSource, prepareAudioEditAudio, validateAudioEditAudio, verifyAudioEditSource } from './media'
import { listAudioEditProcessors, processAudioEditVstChain, audioEditProcessorCacheIdentity } from './processors'
import { runAudioRepair, runAudioMouthDeclick, mixAudioEditProcessed, audioRepairMaskDimensions, encodeAudioRepairMask } from './dsp-adapter'
import { separateAudioFile } from '../audio-separation/runtime'
import { essentialSoundOfflineStages } from '../../../../src/core/audio/essentialSound'
import { audioEditChainItemEffects, audioEditChainItemRecipe, splitAudioEditChain, type AudioEditBreathItem } from '../../../../src/core/audioEdit/effects'
import { audioRenderKey, cachedAudioFile } from './render-cache'
import { applyAudioEditRealtimeEffects, applyAudioEffectInstancesToFile } from './effects-render'
import { runAudioEditProcess } from './process'
import { AudioEditSpliceRenderer } from '../../../../src/core/audioEdit/spliceCrossfade'
import { createF32WavWriter, openF32Wav, type F32WavReader } from './pcm-wav'

const logger = createMainLogger('main.audio_edit.render')

/**
 * 音量区域在主进程按一秒一块直接乘到声音上。不再拼成一条 FFmpeg aeval 表达式：表达式解析器的嵌套深度有限，
 * 区域到一百个左右（快节奏处理呼吸声常有上百处减弱）就无法配置滤镜，口播一打开就报错；逐采样求值上百项也慢。
 */
async function renderAudioEditGains(project: AudioEditProjectDocument, reader: F32WavReader, gains: readonly AudioEditGainRegion[], output: string, signal?: AbortSignal): Promise<void> {
  const { sampleRate, channels } = project.source
  const sorted = [...gains].sort((a, b) => a.startFrame - b.startFrame)
  const writer = await createF32WavWriter(output, sampleRate, channels, reader.frames)
  try {
    for (let start = 0; start < reader.frames; start += sampleRate) {
      signal?.throwIfAborted()
      const count = Math.min(sampleRate, reader.frames - start)
      const pcm = (await reader.read(start, count)).slice()
      applyAudioEditGainRegions(pcm, start, channels, sorted.filter(region => region.startFrame < start + count && region.endFrame > start))
      await writer.write(pcm)
    }
  } finally { await writer.close(); await reader.close() }
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

/**
 * 编辑后声音（时间轴同原素材，剪辑区间从不进这里的缓存键）：试听、XML、成品 WAV 与动态链接共用。
 * 顺序：修复（录音上的局部修补）→ 效果控件里要整段处理的那一段效果链（从上到下，逐项按内容缓存，改第 k 项只重算 k 往后）
 * → 区间音量。效果链末尾的实时效果与输出不在这里（试听边播边算，导出用同一份代码离线处理）。
 * beforeItemId：只处理到这一项之前、且不加区间音量（检测口水音等分析要听的是这一项之前的声音）。
 */
export async function prepareAudioEditRenderSource(project: AudioEditProjectDocument, signal?: AbortSignal, options: { beforeItemId?: string } = {}): Promise<string> {
  audioEditProjectSchema.parse(project)
  await verifyAudioEditSource(project, false, signal)
  const identity = project.source.identity ?? await identifyAudioEditSource(project.source.sourcePath, signal)
  const directory = audioEditCacheDirectory(project.id)
  const { sampleRate, channels, durationFrames } = project.source
  let key = audioRenderKey(['audio-render-v1', identity.digest, sampleRate, channels, project.source.audioStreamIndex])
  let input = await prepareAudioEditAudio(project, signal)
  const stage = async (recipe: unknown, prefix: string, produce: (source: string, output: string) => Promise<void>): Promise<void> => {
    key = audioRenderKey([key, recipe])
    const source = input
    input = await cachedAudioFile(directory, `${prefix}-${key}`, 'wav', async output => {
      await produce(source, output)
      await validateAudioEditAudio(output, sampleRate, channels, durationFrames, signal)
    }, signal)
  }
  for (const repair of (project.repairs ?? []).filter(r => r.enabled && r.strength > 0)) {
    const { id: _id, enabled: _enabled, ...recipe } = repair
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
  // 连续的实时效果攒成一遍处理；遇到整段处理的效果先把攒下的跑完。
  let pending: ReturnType<typeof audioEditChainItemEffects> = []
  const flush = async (): Promise<void> => {
    if (!pending.length) return
    const effects = pending; pending = []
    key = audioRenderKey([key, 'realtime', effects.map(({ builtin, amount }) => ({ builtin, amount }))])
    input = await applyAudioEffectInstancesToFile(project.id, await audioEditF32Source(project, input, signal), effects, signal)
  }
  for (const item of items) {
    if (item.kind === 'builtin' || (item.kind === 'essential' && !essentialSoundOfflineStages(item.settings).length)) { pending.push(...audioEditChainItemEffects(item)); continue }
    await flush()
    if (item.kind === 'essential') {
      for (const offline of essentialSoundOfflineStages(item.settings)) await stage(['offline-v1', offline], offline.kind, (source, output) => separateAndMix(source, output, offline.kind, offline.amount, signal))
      pending.push(...audioEditChainItemEffects(item))
    } else if (item.kind === 'separation') {
      await stage(audioEditChainItemRecipe(item), item.mode, (source, output) => separateAndMix(source, output, item.mode, item.amount, signal))
    } else if (item.kind === 'mouth_declick') {
      await stage(audioEditChainItemRecipe(item), 'declick', (source, output) => runAudioMouthDeclick(source, output, item.clicks, durationFrames, signal))
    } else if (item.kind === 'breath') {
      const regions = breathGainRegions(item, sampleRate)
      await stage(audioEditChainItemRecipe(item), 'breath', async (source, output) => renderAudioEditGains(project, await openRenderSource(project, source, signal), regions, output, signal))
    } else if (item.kind === 'plugin') {
      // 这台电脑上找不到或加载不了的插件先跳过（设置保留），整条声音照常出来。
      if (!(await listAudioEditProcessors()).some(processor => processor.id === item.pluginId && processor.available)) {
        logger.warn('插件不可用，处理时跳过', { event: 'audio_edit.render.plugin_skipped', context: { projectId: project.id, pluginId: item.pluginId } })
        continue
      }
      const settings = [{ id: item.pluginId, enabled: true, parameters: item.parameters }]
      await stage([audioEditChainItemRecipe(item), await audioEditProcessorCacheIdentity(settings)], 'plugin', async (source, output) => {
        const processed = await processAudioEditVstChain(source, directory, settings, signal)
        try { await fs.copyFile(processed.outputPath, output) }
        finally { await Promise.all(processed.temporaryPaths.map(file => removeUnmanagedCachePath(file, { force: true }))) }
      })
    }
  }
  await flush()
  if (options.beforeItemId) return input
  const gains = (project.gainRegions ?? []).filter(r => r.enabled)
  if (gains.length) {
    // 只按声音算键：呼吸、气口转成手动剪辑只换 id，不重新生成整段音频
    await stage(audioEditSoundRecipe(undefined, gains).gains, 'gain', async (source, output) => renderAudioEditGains(project, await openRenderSource(project, source, signal), gains, output, signal))
  }
  return input
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
export async function audioEditF32Source(project: AudioEditProjectDocument, source: string, signal?: AbortSignal): Promise<string> {
  const direct = await openF32Wav(source)
  const matches = direct && direct.sampleRate === project.source.sampleRate && direct.channels === project.source.channels
  await direct?.close()
  if (matches) return source
  return cachedAudioFile(audioEditCacheDirectory(project.id), `render-f32-${audioRenderKey([source, project.source.sampleRate, project.source.channels])}`, 'wav', async output => {
    await runAudioEditProcess(await loadFfmpegPath(), ['-v', 'error', '-y', '-i', source, '-map', '0:a:0', '-vn', '-c:a', 'pcm_f32le', '-rf64', 'auto', '-ar', String(project.source.sampleRate), '-ac', String(project.source.channels), output], signal)
  }, signal)
}

/** 渲染源随机读（32 位浮点 WAV，必要时先在缓存里转一份）。 */
async function openRenderSource(project: AudioEditProjectDocument, source: string, signal?: AbortSignal): Promise<F32WavReader> {
  const reader = await openF32Wav(await audioEditF32Source(project, source, signal))
  if (!reader) throw new Error('渲染源转码后仍无法读取，请重试。')
  return reader
}

/** 逐段拼接成片：每段按一秒分块写出，拼接点由共享的交叉淡化渲染器处理（与试听同一个函数）。 */
async function renderAudioEditSplices(project: AudioEditProjectDocument, reader: F32WavReader, spans: ReturnType<typeof buildProjectAudioEditTimeline>, durationFrames: number, output: string, signal?: AbortSignal): Promise<void> {
  const { sampleRate, channels } = project.source
  const splices = new AudioEditSpliceRenderer(spans, { sampleRate, channels, durationFrames: reader.frames }, reader)
  const writer = await createF32WavWriter(output, sampleRate, channels, durationFrames)
  try {
    for (const [index, span] of spans.entries()) {
      const length = span.sourceEndFrame - span.sourceStartFrame
      for (let local = 0; local < length; local += sampleRate) {
        signal?.throwIfAborted()
        await writer.write(await splices.render(index, local, Math.min(length, local + sampleRate)))
      }
    }
  } finally { await writer.close(); await reader.close() }
}

export async function renderAudioEditProject(project: AudioEditProjectDocument, signal?: AbortSignal): Promise<AudioEditRenderedAudio> {
  const started = performance.now()
  logger.info('开始渲染音频', { event: 'audio_edit.render.start', context: { projectId: project.id, revision: project.revision } })
  try {
    const source = await prepareAudioEditRenderSource(project, signal)
    const spans = buildProjectAudioEditTimeline(project)
    const durationFrames = editedDurationFrames(spans)
    if (!durationFrames) throw new Error('当前没有可渲染的声音，请保留至少一段音频。')
    // 拼接算法变更只失效成品缓存，源时间上的修复、增益与效果缓存仍可复用。
    const key = audioRenderKey(['splice-crossfade-v1', source, spans, project.source.sampleRate])
    const spliced = await cachedAudioFile(audioEditCacheDirectory(project.id), `finished-${key}`, 'wav', async output => {
      await renderAudioEditSplices(project, await openRenderSource(project, source, signal), spans, durationFrames, output, signal)
      await validateAudioEditAudio(output, project.source.sampleRate, project.source.channels, durationFrames, signal)
    }, signal)
    // 效果链末尾的实时效果与输出作用在剪好的整条声音上（与试听一致）。
    const audioPath = await applyAudioEditRealtimeEffects(project, spliced, signal)
    await verifyAudioEditSource(project, false, signal)
    logger.info('音频渲染完成', { event: 'audio_edit.render.completed', context: { projectId: project.id, elapsedMs: performance.now() - started } })
    return { audioPath, durationFrames, sampleRate: project.source.sampleRate, channels: project.source.channels, revision: project.revision }
  } catch (error) { logger.error('音频渲染失败', { event: 'audio_edit.render.failed', error, context: { projectId: project.id } }); throw error }
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
