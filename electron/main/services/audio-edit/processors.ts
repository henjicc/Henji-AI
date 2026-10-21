import { getRegisteredAudioEditProcessor, registeredAudioEditProcessors } from './processor-registry'
import { removeUnmanagedCachePath } from '../media-recycle/cache-deletion'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { AudioEditProcessorDescriptor, AudioEditProcessorSetting } from '../../../../src/core/audioEdit/types'
import { invokeAudioWorker } from './audio-worker-client'

const KNOWN_RX_PROCESSORS = [
  { match: /mouth[ -]?de-?click/i, role: 'mouth_declick' as const },
  { match: /voice[ -]?de-?noise/i, role: 'voice_denoise' as const },
  { match: /breath[ -]?control/i, role: 'breath_control' as const },
]
const pluginPaths = new Map<string, string>()
let processorCache: { expiresAt: number; value: Promise<AudioEditProcessorDescriptor[]> } | null = null

async function walkVst3(root: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(root, { withFileTypes: true })
    return entries.flatMap((entry) => entry.name.toLowerCase().endsWith('.vst3')
      ? [path.join(root, entry.name)]
      : [])
  } catch {
    return []
  }
}

/** Lightweight discovery remains useful before the isolated Rust probe is available. */
export async function listAudioEditProcessors(): Promise<AudioEditProcessorDescriptor[]> {
  if (processorCache && processorCache.expiresAt > Date.now()) return [...await processorCache.value, ...registeredAudioEditProcessors()]
  const value = discoverAudioEditProcessors()
  processorCache = { expiresAt: Date.now() + 60_000, value }
  return [...await value, ...registeredAudioEditProcessors()]
}

async function discoverAudioEditProcessors(): Promise<AudioEditProcessorDescriptor[]> {
  if (process.platform !== 'win32') return []
  const roots = [
    path.join(process.env['COMMONPROGRAMFILES'] ?? 'C:\\Program Files\\Common Files', 'VST3'),
    path.join(process.env['LOCALAPPDATA'] ?? '', 'Programs', 'Common', 'VST3'),
  ]
  let files: string[]
  try {
    const result = await invokeAudioWorker<{ plugins: string[] }>({ type: 'scan', roots })
    files = result.plugins
  } catch {
    files = (await Promise.all(roots.map(walkVst3))).flat()
  }
  return Promise.all(files.map(async (filePath) => {
    const id = `rx-${crypto.createHash('sha256').update(filePath.toLowerCase()).digest('hex').slice(0, 24)}`
    pluginPaths.set(id, filePath)
    const name = path.basename(filePath, path.extname(filePath))
    const known = KNOWN_RX_PROCESSORS.find((candidate) => candidate.match.test(name))
    if (!known) {
      return {
        id, name, vendor: /izotope|rx/i.test(filePath) ? 'iZotope' : '未知厂商', version: '未知',
        available: false, reason: '首版只支持已验证的 RX 口播处理器。',
      }
    }
    try {
      const inspected = await invokeAudioWorker<{
        info: { name: string; vendor: string; version: string }
        latencyFrames: number
        parameters: NonNullable<AudioEditProcessorDescriptor['parameters']>
      }>({ type: 'inspect', plugin_path: filePath, sample_rate: 48_000 })
      return {
        id,
        name: inspected.info.name,
        vendor: inspected.info.vendor,
        version: inspected.info.version,
        available: true,
        semanticRole: known.role,
        latencyFrames: inspected.latencyFrames,
        parameters: inspected.parameters,
      }
    } catch (error) {
      return {
      id,
      name,
      vendor: /izotope|rx/i.test(filePath) ? 'iZotope' : '未知厂商',
        version: '未知',
        available: false,
        semanticRole: known.role,
        reason: error instanceof Error ? error.message : '插件探测失败。',
      }
    }
  }))
}

const PROCESSOR_ORDER: NonNullable<AudioEditProcessorDescriptor['semanticRole']>[] = [
  'voice_denoise', 'mouth_declick', 'breath_control',
]

export async function processAudioEditVstChain(inputPath: string, workingDirectory: string, recipe?: AudioEditProcessorSetting[], signal?: AbortSignal, onProgress?: (progress: number) => void): Promise<{ outputPath: string; temporaryPaths: string[] }> {
  const seen = new Set<string>()
  const available = await listAudioEditProcessors()
  if (recipe?.some((setting) => setting.enabled && !available.some((processor) => processor.id === setting.id && processor.available))) throw new Error('口播使用的声音插件不可用，请重新选择或关闭声音处理。')
  const enabledRecipe = recipe?.filter(setting => setting.enabled)
  const processors = enabledRecipe
    ? enabledRecipe.map(setting => available.find(processor => processor.id === setting.id && processor.available)!)
    : available.filter(processor => {
      if (!processor.available || !processor.semanticRole || seen.has(processor.semanticRole)) return false
      seen.add(processor.semanticRole); return true
    }).sort((a, b) => PROCESSOR_ORDER.indexOf(a.semanticRole!) - PROCESSOR_ORDER.indexOf(b.semanticRole!))
  if (processors.length === 0) throw new Error('VST3_UNAVAILABLE：没有找到可用的 RX 口播处理器，请关闭 VST3 后导出。')
  const temporaryPaths: string[] = []
  const runId = crypto.randomUUID()
  let currentPath = inputPath
  try { for (const [index, processor] of processors.entries()) {
    signal?.throwIfAborted()
    const outputPath = path.join(workingDirectory, `vst-${runId}-${index}.wav`)
    temporaryPaths.push(outputPath)
    const custom = getRegisteredAudioEditProcessor(processor.id)
    const parameters = enabledRecipe?.[index].parameters ?? {}
    if (custom) await custom.process({ inputPath: currentPath, outputPath, parameters: custom.parameters.parse(parameters), signal })
    else await invokeAudioWorker({ type: 'process', plugin_path: pluginPaths.get(processor.id)!, input_path: currentPath, output_path: outputPath, parameters, bypass: false }, 30 * 60_000, signal)
    currentPath = outputPath
    onProgress?.((index + 1) / processors.length)
  }
  return { outputPath: currentPath, temporaryPaths }
  } catch (error) {
    await Promise.all(temporaryPaths.map((file) => removeUnmanagedCachePath(file, { force: true })))
    throw error
  }
}

export async function audioEditProcessorCacheIdentity(recipe?: AudioEditProcessorSetting[]): Promise<unknown> {
  const descriptors = await listAudioEditProcessors()
  return Promise.all(descriptors.filter(d => d.available && (recipe ? recipe.some(s => s.enabled && s.id === d.id) : d.semanticRole)).map(async d => {
    const file = pluginPaths.get(d.id), stat = file ? await fs.stat(file) : undefined
    return [d.id, d.version, stat?.mtimeMs, stat?.size]
  }))
}
