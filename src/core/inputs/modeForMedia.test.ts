// @vitest-environment jsdom
import { beforeAll, expect, it } from 'vitest'
import { loadAllModels } from '@/core/loaders/modelLoader'
import { registry } from '@/core/ModelRegistry'
import { resolveInputLimits } from './inputLimits'
import { resolveModeForMedia, type MediaCounts } from './modeForMedia'

beforeAll(async () => {
  await loadAllModels()
})

const CASES: MediaCounts[] = [
  { images: 0, videos: 0, audios: 0 },
  { images: 1, videos: 0, audios: 0 },
  { images: 2, videos: 0, audios: 0 },
  { images: 0, videos: 1, audios: 0 },
]

function fits(modelId: string, params: DynamicValueMap, counts: MediaCounts): boolean {
  const limits = resolveInputLimits(modelId, params, { imagesCount: counts.images, videosCount: counts.videos })
  return (['images', 'videos', 'audios'] as const).every((kind) => counts[kind] >= limits[kind].min && counts[kind] <= limits[kind].max)
}

it('只要某个模式或渠道收得下这组素材，按素材选出的设置就收得下', () => {
  const misses: string[] = []
  for (const model of registry.listAllModels()) {
    const defaults = registry.getDefaultValues(model.meta.id)
    const options = model.params.flatMap((param) => (param.type === 'dropdown' || param.type === 'radio') ? (param.options ?? []).map((option) => ({ [param.id]: option.value })) : [])
    for (const counts of CASES) {
      const reachable = [{}, ...options].some((change) => fits(model.meta.id, { ...defaults, ...change }, counts))
      if (reachable && !fits(model.meta.id, resolveModeForMedia(model.meta.id, defaults, counts), counts)) misses.push(`${model.meta.id} ${JSON.stringify(counts)}`)
    }
  }
  expect(misses).toEqual([])
})

it('当前设置已经收得下时不改动', () => {
  const defaults = registry.getDefaultValues('kie-grok-imagine')
  expect(resolveModeForMedia('kie-grok-imagine', defaults, { images: 0, videos: 0, audios: 0 })).toBe(defaults)
  expect(resolveModeForMedia('kie-grok-imagine', defaults, { images: 1, videos: 0, audios: 0 }).kieGrokImagineMode).toBe('image-to-image')
})
