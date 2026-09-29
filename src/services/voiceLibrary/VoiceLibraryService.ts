import { createLogger } from '@/core/logging'
import { databaseService } from '@/services/database/DatabaseService'

const logger = createLogger('services.voiceLibrary.VoiceLibraryService')

const VOICE_LIBRARY_SETTING_KEY = 'voice_library_records'
const VOICE_LIBRARY_CACHE_KEY = 'voice_library_records_cache_v1'

interface VoiceLibraryScope {
  providerId?: string
  modelId?: string
}

export interface VoiceLibraryRecord {
  voiceId: string
  voiceName: string
  description?: string
  providerId: string
  modelId?: string
  createdAt: string
  updatedAt: string
  expiresAt?: string
  previewPath?: string
  taskId?: string
  status?: 'training' | 'ready' | 'failed'
  activated?: boolean
}

export interface UpsertVoiceLibraryInput {
  createdAt?: string
  voiceId: string
  voiceName: string
  description?: string
  providerId: string
  modelId?: string
  expiresAt?: string
  previewPath?: string
  taskId?: string
  status?: 'training' | 'ready' | 'failed'
  activated?: boolean
}

function isRecord(value: DynamicValue): value is DynamicValueMap {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeString(value: DynamicValue): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function normalizeRecord(value: DynamicValue): VoiceLibraryRecord | null {
  if (!isRecord(value)) {
    return null
  }

  const voiceId = normalizeString(value.voiceId)
  const voiceName = normalizeString(value.voiceName)
  const providerId = normalizeString(value.providerId)
  if (!voiceId || !voiceName || !providerId) {
    return null
  }

  const createdAt = normalizeString(value.createdAt) ?? new Date().toISOString()
  const updatedAt = normalizeString(value.updatedAt) ?? createdAt

  return {
    voiceId,
    voiceName,
    providerId,
    modelId: normalizeString(value.modelId),
    description: normalizeString(value.description),
    createdAt,
    updatedAt,
    expiresAt: normalizeString(value.expiresAt),
    previewPath: normalizeString(value.previewPath),
    taskId: normalizeString(value.taskId),
    status: value.status === 'training' || value.status === 'failed' ? value.status : 'ready',
    activated: value.activated === true,
  }
}

function parseVoiceRecords(raw: string | null): VoiceLibraryRecord[] {
  if (!raw) {
    return []
  }
  try {
    const parsed = JSON.parse(raw) as DynamicValue
    if (!Array.isArray(parsed)) {
      return []
    }
    const result: VoiceLibraryRecord[] = []
    for (const item of parsed) {
      const normalized = normalizeRecord(item)
      if (normalized) {
        result.push(normalized)
      }
    }
    return result
  } catch (error) {
    logger.warn('[VoiceLibrary] parse failed', error)
    return []
  }
}

function applyScope(records: VoiceLibraryRecord[], scope?: VoiceLibraryScope): VoiceLibraryRecord[] {
  if (!scope) {
    return records
  }
  return records.filter((item) => {
    if (scope.providerId && item.providerId !== scope.providerId) {
      return false
    }
    if (scope.modelId && item.modelId !== scope.modelId) {
      return false
    }
    return true
  })
}

function readLocalCache(): VoiceLibraryRecord[] {
  if (typeof window === 'undefined' || !window.localStorage) {
    return []
  }
  try {
    const raw = window.localStorage.getItem(VOICE_LIBRARY_CACHE_KEY)
    return parseVoiceRecords(raw)
  } catch {
    return []
  }
}

function writeLocalCache(records: VoiceLibraryRecord[]): void {
  if (typeof window === 'undefined' || !window.localStorage) {
    return
  }
  try {
    window.localStorage.setItem(VOICE_LIBRARY_CACHE_KEY, JSON.stringify(records))
  } catch (error) {
    logger.warn('[VoiceLibrary] write cache failed', error)
  }
}

class VoiceLibraryService {
  private listeners = new Set<() => void>()
  private writes: Promise<unknown> = Promise.resolve()

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  private cache: VoiceLibraryRecord[] | null = null
  private loadingPromise: Promise<VoiceLibraryRecord[]> | null = null

  private async ensureLoaded(): Promise<VoiceLibraryRecord[]> {
    if (this.loadingPromise) {
      return this.loadingPromise
    }
    if (this.cache) return this.cache

    const localCache = readLocalCache()
    if (localCache.length > 0) {
      this.cache = localCache
    }

    this.loadingPromise = (async () => {
      await databaseService.init()
      const raw = await databaseService.getSetting(VOICE_LIBRARY_SETTING_KEY)
      const records = parseVoiceRecords(raw)
      this.cache = records
      writeLocalCache(records)
      return records
    })().finally(() => { this.loadingPromise = null })

    return this.loadingPromise
  }

  private async persist(records: VoiceLibraryRecord[]): Promise<void> {
    await databaseService.init()
    await databaseService.setSetting(
      VOICE_LIBRARY_SETTING_KEY,
      JSON.stringify(records),
      'json'
    )
    this.cache = records
    writeLocalCache(records)
    this.listeners.forEach(listener => listener())
  }

  async listVoices(scope?: VoiceLibraryScope): Promise<VoiceLibraryRecord[]> {
    const records = await this.ensureLoaded()
    return applyScope(records, scope).sort((left, right) => {
      if (left.updatedAt === right.updatedAt) {
        return left.voiceId.localeCompare(right.voiceId)
      }
      return left.updatedAt < right.updatedAt ? 1 : -1
    })
  }

  upsertVoice(input: UpsertVoiceLibraryInput): Promise<VoiceLibraryRecord> {
    const write = this.writes.then(() => this.upsert(input))
    this.writes = write.catch(() => undefined)
    return write
  }

  async markTaskFailed(taskId: string): Promise<void> {
    const records = await this.listVoices()
    for (const record of records.filter(item => item.taskId === taskId)) await this.upsertVoice({ ...record, status: 'failed' })
  }

  private async upsert(input: UpsertVoiceLibraryInput): Promise<VoiceLibraryRecord> {
    const voiceId = normalizeString(input.voiceId)
    const voiceName = normalizeString(input.voiceName)
    const providerId = normalizeString(input.providerId)
    if (!voiceId || !voiceName || !providerId) {
      throw new Error('voiceId、voiceName、providerId 不能为空')
    }

    const modelId = normalizeString(input.modelId)
    const description = normalizeString(input.description)
    const expiresAt = normalizeString(input.expiresAt)
    const now = new Date().toISOString()
    const records = [...await this.ensureLoaded()]
    const existedIndex = records.findIndex((item) => {
      if (item.voiceId !== voiceId || item.providerId !== providerId) {
        return false
      }
      if (!modelId) {
        return true
      }
      return item.modelId === modelId
    })

    if (existedIndex >= 0) {
      const existed = records[existedIndex]
      const next: VoiceLibraryRecord = {
        ...existed,
        voiceName,
        description: description ?? existed.description,
        modelId: modelId ?? existed.modelId,
        expiresAt: input.activated === true ? undefined : expiresAt ?? existed.expiresAt,
        activated: input.activated ?? existed.activated,
        updatedAt: now,
        previewPath: input.previewPath ?? existed.previewPath,
        taskId: input.taskId ?? existed.taskId,
        status: input.status ?? existed.status,
      }
      records[existedIndex] = next
      await this.persist(records)
      return next
    }

    const created: VoiceLibraryRecord = {
      voiceId,
      voiceName,
      providerId,
      modelId,
      description,
      createdAt: normalizeString(input.createdAt) ?? now,
      updatedAt: now,
      expiresAt,
      previewPath: input.previewPath,
      taskId: input.taskId,
      status: input.status,
      activated: input.activated,
    }
    records.push(created)
    await this.persist(records)
    return created
  }

  deleteVoice(voiceId: string, scope?: VoiceLibraryScope): Promise<void> {
    const write = this.writes.then(() => this.remove(voiceId, scope))
    this.writes = write.catch(() => undefined)
    return write
  }

  private async remove(voiceId: string, scope?: VoiceLibraryScope): Promise<void> {
    const normalizedVoiceId = normalizeString(voiceId)
    if (!normalizedVoiceId) {
      return
    }
    const records = [...await this.ensureLoaded()]
    const filtered = records.filter((item) => {
      if (item.voiceId !== normalizedVoiceId) {
        return true
      }
      if (!scope) {
        return false
      }
      if (scope.providerId && item.providerId !== scope.providerId) {
        return true
      }
      if (scope.modelId && item.modelId !== scope.modelId) {
        return true
      }
      return false
    })
    if (filtered.length === records.length) {
      return
    }
    await this.persist(filtered)
  }

  getCachedVoiceName(voiceId: string, scope?: VoiceLibraryScope): string | undefined {
    const normalizedVoiceId = normalizeString(voiceId)
    if (!normalizedVoiceId) {
      return undefined
    }
    const cache = this.cache ?? readLocalCache()
    const scoped = applyScope(cache, scope)
    const matched = scoped.find((item) => item.voiceId === normalizedVoiceId)
    return matched?.voiceName
  }
}

export const voiceLibraryService = new VoiceLibraryService()
