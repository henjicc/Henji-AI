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
import { getAiProviderApiKey } from '../keystore'
import { createMainLogger } from '../logging'
import { sdkRuntimeContext } from '../ai-runtime/sdk-runtime'
import { requireAudioEditProject, saveAudioEditProject } from './project-store'
import { createAudioEditTask, findActiveAudioEditTask, updateAudioEditTask } from './task-store'

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
  const project = requireAudioEditProject(request.projectId)
  const modelId = await chooseModel(project.source.audioPath, request.modelId)
  const inputDigest = crypto.createHash('sha256').update(JSON.stringify({
    projectId: project.id,
    audioPath: project.source.audioPath,
    modelId,
    language: request.language ?? 'zh',
  })).digest('hex')
  const active = findActiveAudioEditTask(project.id, 'transcription', inputDigest)
  if (active) throw new Error(`TASK_ALREADY_RUNNING：该工程正在转写（${active.requestId}）。`)
  const requestId = crypto.randomUUID()
  const controller = new AbortController()
  controllers.set(requestId, controller)
  createAudioEditTask({ requestId, projectId: project.id, kind: 'transcription', inputDigest })
  updateAudioEditTask(requestId, { state: 'running' })
  logger.info('口播转写开始', {
    event: 'audio_edit.transcription.start', requestId, modelId,
    context: { projectId: project.id },
  })
  try {
    const output = await client.execute<unknown, SpeechRecognitionOutput, SpeechRecognitionEvent>(modelId, {
      audio: { kind: 'media-ref', ref: project.source.audioPath },
      language: request.language ?? 'zh',
      punctuation: true,
      timestamps: true,
      ...(modelId.startsWith('groq.') ? { options: { timestampGranularities: ['word', 'segment'] } } : {}),
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
    const transcript = toBlocks(output, project.source.sampleRate)
    const granularity = transcript.some((block) => block.granularity === 'word')
      ? 'word'
      : transcript.length > 0
        ? 'segment'
        : 'none'
    const next = saveAudioEditProject({
      ...project,
      transcript,
      suggestions: analyzeAudioEditTranscript(transcript, { sampleRate: project.source.sampleRate }),
      selectedAsrModelId: modelId,
    })
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
  }
}

export function cancelAudioEditTranscription(requestId: string): void {
  controllers.get(requestId)?.abort()
}
