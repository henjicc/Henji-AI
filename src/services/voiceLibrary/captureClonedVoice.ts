import { voiceLibraryService } from './VoiceLibraryService'

const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

/** All generation callers save provider-created voices through the same library. */
export async function captureClonedVoice(
  modelId: string,
  providerId: string,
  result: { status?: string; taskId?: string; filePath?: string; url?: string; metadata?: unknown },
): Promise<void> {
  if (!isObject(result.metadata)) return
  const voice = result.metadata.clonedVoice
  const activatedId = result.metadata.activatedVoiceId
  if (typeof activatedId === 'string') {
    const existing = (await voiceLibraryService.listVoices({ providerId, modelId })).find(item => item.voiceId === activatedId)
    if (existing) await voiceLibraryService.upsertVoice({ ...existing, activated: true })
  }
  if (!isObject(voice)) return
  if (typeof voice.id !== 'string' || typeof voice.name !== 'string' || !['ready', 'training'].includes(String(voice.status))) return
  const expiresAt = voice.postpaid === true && voice.activated !== true && typeof voice.createdAt === 'number'
    ? new Date(voice.createdAt + 7 * 24 * 60 * 60 * 1000).toISOString() : undefined
  await voiceLibraryService.upsertVoice({
    providerId, modelId, voiceId: voice.id, voiceName: voice.name,
    status: voice.status as 'ready' | 'training', taskId: result.taskId,
    previewPath: result.filePath || result.url || undefined, expiresAt, activated: voice.activated === true,
  })
}
