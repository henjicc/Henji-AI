import type { z } from 'zod'
import type { AudioEditProcessorDescriptor } from '../../../../src/core/audioEdit/types'

/** Registered host implementations dispatch computation to FFmpeg/Worker, never renderer code. */
export interface AudioEditProcessorImplementation {
  descriptor: AudioEditProcessorDescriptor
  parameters: z.ZodType<Record<string, number>>
  process(input: { inputPath: string; outputPath: string; parameters: Record<string, number>; signal?: AbortSignal }): Promise<void>
}
const implementations = new Map<string, AudioEditProcessorImplementation>()
export function registerAudioEditProcessor(implementation: AudioEditProcessorImplementation): () => void {
  const id = implementation.descriptor.id
  if (!id.startsWith('builtin:') || implementations.has(id)) throw new Error('自研处理器须使用唯一 builtin: 标识')
  implementations.set(id, implementation)
  return () => { if (implementations.get(id) === implementation) implementations.delete(id) }
}
export function getRegisteredAudioEditProcessor(id: string): AudioEditProcessorImplementation | undefined { return implementations.get(id) }
export function registeredAudioEditProcessors(): AudioEditProcessorDescriptor[] { return [...implementations.values()].map(value => value.descriptor) }
