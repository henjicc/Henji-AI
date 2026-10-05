import crypto from 'node:crypto'
import fs from 'node:fs/promises'

import {
  bailianFunAsr,
  bailianQwen3AsrFlashFiletrans,
  createBailianAsrModule,
  createCapabilityClient,
  createGroqAsrModule,
  createSiliconFlowAsrModule,
  createVolcengineAsrModule,
  groqWhisperLargeV3,
  groqWhisperLargeV3Turbo,
  siliconFlowSenseVoiceSmall,
  siliconFlowTeleSpeechAsr,
  volcengineSeedAsrFile,
  type SpeechRecognitionOutput,
  type SpeechRecognitionEvent,
} from '@henjicc/ai-sdk'

import type {
  AudioEditTranscriptBlock,
  AudioEditTranscriptionRequest,
  AudioEditTranscriptionResult,
} from '../../../../src/core/audioEdit/types'
import { analyzeAudioEditTranscript } from '../../../../src/core/audioEdit/analysis'
import { createAudioEditBaseline } from '../../../../src/core/audioEdit/baseline'
import { getAiProviderApiKey } from '../keystore'
import { createMainLogger } from '../logging'
import { sdkRuntimeContext } from '../ai-runtime/sdk-runtime'
import { requireAudioEditProject } from './project-store'
import { assertAudioEditProjectIdle, createAudioEditTask, findAudioEditTranscription, isAudioEditTaskActive, updateAudioEditTask, registerAudioEditTaskController } from './task-store'
import { prepareAudioEditAudio, verifyAudioEditSource } from './media'

const logger = createMainLogger('main.audio_edit.asr')
const controllers = new Map<string, AbortController>()

const modules = [
  createBailianAsrModule(bailianFunAsr),
  createBailianAsrModule(bailianQwen3AsrFlashFiletrans),
  createGroqAsrModule(groqWhisperLargeV3Turbo),
  createGroqAsrModule(groqWhisperLargeV3),
  createSiliconFlowAsrModule(siliconFlowSenseVoiceSmall),
  createSiliconFlowAsrModule(siliconFlowTeleSpeechAsr),
  createVolcengineAsrModule(volcengineSeedAsrFile),
] as const

const client = createCapabilityClient({ runtime: sdkRuntimeContext, modules })

function providerFor(modelId: string): string {
  return modelId.split('.', 1)[0] ?? ''
}

export function listAudioEditAsrModels(): Array<{
  id: string
  providerId: string
  configured: boolean
  timestamps: boolean
  longAudio: boolean
}> {
  return client.list('speech-recognition').map((descriptor) => ({
    id: descriptor.id,
    providerId: descriptor.providerIds?.[0] ?? providerFor(descriptor.id),
    configured: Boolean(getAiProviderApiKey(descriptor.providerIds?.[0] ?? providerFor(descriptor.id))),
    timestamps: descriptor.features?.includes('timestamps') ?? false,
    longAudio: (descriptor.tags?.includes('long-audio') ?? false)
      || (descriptor.features?.includes('async-polling') ?? false),
  }))
}

async function chooseModel(audioPath: string, preferred?: string): Promise<string> {
  const available = listAudioEditAsrModels()
  if (preferred) {
    const selected = available.find((item) => item.id === preferred)
    if (!selected) throw new Error(`ASR_MODEL_NOT_FOUND：没有找到语音识别模型 ${preferred}。`)
    if (!selected.configured) throw new Error('ASR_KEY_MISSING：所选语音识别模型尚未配置凭据。')
    return selected.id
  }
  const byteLength = (await fs.stat(audioPath)).size
  const candidates = available.filter((item) => item.configured && item.timestamps)
  const selected = candidates.find((item) => item.longAudio)
    ?? candidates.find((item) => item.providerId === 'groq' && byteLength <= 25 * 1024 * 1024)
    ?? candidates[0]
  if (!selected) {
    throw new Error('ASR_UNAVAILABLE：请先配置一个支持时间戳的语音识别模型。')
  }
  return selected.id
}

function toBlocks(output: SpeechRecognitionOutput, sampleRate: number): AudioEditTranscriptBlock[] {
  const blocks: AudioEditTranscriptBlock[] = []
  let index = 0
  for (const segment of output.segments ?? []) {
    const words = segment.words?.filter((word) => word.startMs !== undefined && word.endMs !== undefined) ?? []
    if (words.length > 0) {
      for (const word of words) {
        blocks.push({
          id: `word-${index++}`,
          text: word.text,
          startFrame: Math.max(0, Math.round((word.startMs ?? 0) * sampleRate / 1_000)),
          endFrame: Math.max(1, Math.round((word.endMs ?? 0) * sampleRate / 1_000)),
          confidence: word.confidence,
          included: true,
          locked: false,
          granularity: 'word',
        })
      }
      continue
    }
    if (segment.startMs !== undefined && segment.endMs !== undefined) {
      blocks.push({
        id: `segment-${index++}`,
        text: segment.text,
        startFrame: Math.max(0, Math.round(segment.startMs * sampleRate / 1_000)),
        endFrame: Math.max(1, Math.round(segment.endMs * sampleRate / 1_000)),
        confidence: segment.confidence,
        included: true,
        locked: false,
        granularity: 'segment',
      })
    }
  }
  return blocks.filter((block) => block.endFrame > block.startFrame)
}

export async function transcribeAudioEditProject(
  request: AudioEditTranscriptionRequest,
): Promise<AudioEditTranscriptionResult> {
  const project = await requireAudioEditProject(request.projectId)
  if (project.transcript.length) throw new Error('口播已有转写，请保留当前编辑；需要重新识别时另建口播。')
  await verifyAudioEditSource(project)
  const previous = findAudioEditTranscription(project.id)
  if (previous && isAudioEditTaskActive(previous.request_id)) throw new Error('该工程正在转写，请等待或取消。')
  const priorInput = previous?.result_json ? JSON.parse(previous.result_json) as { modelId?: string; sourceDigest?: string; language?: string } : undefined
  if (previous && (!previous.provider_task_id || !priorInput?.modelId)) throw new Error('上次转写的提交结果无法确认，已阻止重复付费。请核对供应商任务后另建工程识别。')
  const modelId = priorInput?.modelId ?? await chooseModel(project.source.sourcePath, request.modelId)
  if (previous && !client.get(modelId)?.descriptor.features?.includes('resume-task')) throw new Error('此模型不支持恢复查询，已阻止自动重复提交。')
  const sourceDigest = project.source.identity?.digest ?? project.source.sourcePath
  if (previous && priorInput?.sourceDigest !== sourceDigest) throw new Error('素材已变化，旧转写任务不能覆盖当前工程。')
  const language = priorInput?.language ?? request.language ?? 'zh'
  const inputDigest = crypto.createHash('sha256').update(JSON.stringify({ projectId: project.id, sourceDigest, modelId, language })).digest('hex')
  const requestId = previous?.request_id ?? request.requestId ?? crypto.randomUUID()
  assertAudioEditProjectIdle(project.id)
  const controller = new AbortController()
  const release = registerAudioEditTaskController(requestId, project.id, controller)
  controllers.set(requestId, controller)
  try {
    if (!previous) createAudioEditTask({ requestId, projectId: project.id, kind: 'transcription', inputDigest })
    updateAudioEditTask(requestId, { state: 'running', result: { modelId, sourceDigest, language } })
  } catch (error) { release(); controllers.delete(requestId); throw error }
  logger.info('口播转写开始', {
    event: 'audio_edit.transcription.start', requestId, modelId,
    context: { projectId: project.id },
  })
  try {
    const audioPath = previous ? project.source.audioPath : await prepareAudioEditAudio(project, controller.signal)
    controller.signal.throwIfAborted()
    const output = await client.execute<unknown, SpeechRecognitionOutput, SpeechRecognitionEvent>(modelId, {
      audio: { kind: 'media-ref', ref: audioPath },
      language,
      punctuation: true,
      timestamps: true,
      options: previous ? { resumeTaskId: previous.provider_task_id } : modelId.startsWith('groq.') ? { timestampGranularities: ['word', 'segment'] } : {},
    }, {
      requestId,
      signal: controller.signal,
      onEvent: (event) => {
        if (event.type === 'started' && event.sessionId) {
          updateAudioEditTask(requestId, { state: 'running', providerTaskId: event.sessionId })
        } else if (event.type === 'processing') {
          updateAudioEditTask(requestId, { state: 'running', providerTaskId: event.taskId })
        }
      },
    })
    controller.signal.throwIfAborted()
    await verifyAudioEditSource(project)
    const transcript = toBlocks(output, project.source.sampleRate).map((block) => ({ ...block, endFrame: Math.min(project.source.durationFrames, block.endFrame) })).filter((block) => block.endFrame > block.startFrame)
    if (!transcript.length) throw new Error('识别结果没有可用时间戳，请选择支持时间戳的模型重试。')
    const granularity = transcript.some((block) => block.granularity === 'word')
      ? 'word'
      : transcript.length > 0
        ? 'segment'
        : 'none'
    // 结果交给渲染层实例接收并经文档会话保存（主进程不写口播内容）；第一次识别同时确立原文基线。
    const recognized = {
      ...project,
      transcript,
      suggestions: analyzeAudioEditTranscript(transcript, { sampleRate: project.source.sampleRate }),
      selectedAsrModelId: modelId,
    }
    const next = { ...recognized, editBaseline: createAudioEditBaseline(recognized, 'original') }
    logger.info('口播转写完成', {
      event: 'audio_edit.transcription.completed', requestId, modelId,
      context: { projectId: project.id, blockCount: transcript.length, granularity },
    })
    updateAudioEditTask(requestId, { state: 'completed', result: { modelId, granularity, blockCount: transcript.length } })
    return { project: next, modelId, granularity }
  } catch (error) {
    updateAudioEditTask(requestId, {
      state: controller.signal.aborted ? 'cancelled' : 'failed',
      errorMessage: error instanceof Error ? error.message : String(error),
    })
    logger.error('口播转写失败', {
      event: 'audio_edit.transcription.failed', requestId, modelId,
      context: { projectId: project.id }, error,
    })
    throw error
  } finally {
    controllers.delete(requestId)
    release()
  }
}

export function cancelAudioEditTranscription(requestId: string): void {
  controllers.get(requestId)?.abort()
}
