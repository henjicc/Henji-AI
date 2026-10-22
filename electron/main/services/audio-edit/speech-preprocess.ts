import fs from 'node:fs/promises'
import path from 'node:path'
import { invokeAudioWorker } from './audio-worker-client'
import { createMainLogger } from '../logging'

const logger = createMainLogger('main.audio_edit.speech_preprocess')

/** 预处理副本只在本次转写期间存在，原录音和任务身份保持不变。 */
export async function withPreprocessedSpeech<T>(inputPath: string, signal: AbortSignal, consume: (audioPath: string) => Promise<T>): Promise<T> {
  const directory = await fs.mkdtemp(path.join(path.dirname(inputPath), 'speech-'))
  const outputPath = path.join(directory, 'normalized.wav')
  logger.info('讲解音频预处理开始', { event: 'audio_edit.speech_preprocess.start' })
  try {
    await invokeAudioWorker({ type: 'speech_preprocess', input_path: inputPath, output_path: outputPath }, 120_000, signal)
    signal.throwIfAborted()
    logger.info('讲解音频预处理完成', { event: 'audio_edit.speech_preprocess.completed' })
    return await consume(outputPath)
  } catch (error) {
    logger.error('讲解音频预处理或转写未完成', { event: 'audio_edit.speech_preprocess.failed', context: { cancelled: signal.aborted } })
    throw error
  } finally {
    await fs.rm(directory, { recursive: true, force: true })
  }
}
