import { expect, it, vi } from 'vitest'
import { aiReadSavedResult } from '@/commands/aiRuntime'
import { readGenerationResultTimings } from './generationResultTimings'
import { createGenerationReflectionRegistrations } from './generationReflection'
import { replaceGenerationTaskStatusSnapshots } from './generationTaskStatusRegistry'
vi.mock('@/commands/aiRuntime', () => ({ aiReadSavedResult: vi.fn() }))
vi.mock('./generationPreparationService', () => ({ getGenerationModelSchema: vi.fn(), getGenerationModelSchemaRef: vi.fn(), searchGenerationModelCatalog: () => ({ models: [] }) }))
it('reads the requested persisted output without depending on mounted generation UI', async () => {
  const outputTimings = [{ outputIndex: 1, timings: { granularity: 'word', items: [{ text: 'hello', startMs: 20, endMs: 500 }] } }]
  vi.mocked(aiReadSavedResult).mockResolvedValue({ metadata: { outputTimings } })
  expect(await readGenerationResultTimings('stable-record')).toEqual(outputTimings)
  expect(aiReadSavedResult).toHaveBeenCalledWith('stable-record')
  vi.mocked(aiReadSavedResult).mockResolvedValue(null)
  expect(await readGenerationResultTimings('absent')).toEqual([])
})
it('exposes timestamps through the same generation.result reflection used by MCP and Pi', async () => {
  const outputTimings = [{ outputIndex: 0, timings: { granularity: 'char', items: [{ text: '你', startMs: 10, endMs: 100 }] } }]
  vi.mocked(aiReadSavedResult).mockResolvedValue({ metadata: { outputTimings } })
  replaceGenerationTaskStatusSnapshots([{ taskId: 'voice', status: 'completed', progress: 100, modelId: 'tts', mediaType: 'audio', resultAvailable: true, errorCode: null, errorMessage: null }])
  try {
    const registration = createGenerationReflectionRegistrations().find(value => value.entity.id === 'generation.result')!
    const snapshot = await registration.provider!.readEntity({ kind: 'generation.result', id: 'voice' }, { propertyIds: ['generation.result.output_timings'] })
    expect(snapshot.properties).toEqual({ 'generation.result.output_timings': outputTimings })
    expect(registration.schemaDocuments?.some(value => value.ref.id === 'generation.result.output_timings.value')).toBe(true)
  } finally { replaceGenerationTaskStatusSnapshots([]) }
})
