/** @vitest-environment jsdom */
import { beforeAll, expect, it, vi } from 'vitest'
import { loadAllModels } from '@/core/loaders/modelLoader'
import { dryRunGenerationModel, listSdkModels, SDK_MODEL_CATEGORIES } from './sdkModelInventory'

beforeAll(async () => {
  await loadAllModels()
  // 生成请求在主进程里构建，那里没有浏览器的 Image；测试环境的 Image 读远程图片永远不回调，按主进程处理。
  vi.stubGlobal('Image', undefined)
})

it('清单覆盖每个分类，行键唯一', () => {
  const rows = listSdkModels()
  for (const category of SDK_MODEL_CATEGORIES) expect(rows.some((row) => row.category === category), category).toBe(true)
  expect(new Set(rows.map((row) => row.key)).size).toBe(rows.length)
})

// 每个生成模型用默认参数加示例素材离线构建一次请求：SDK 里的 selector 或 builder 写坏了在这里就暴露，不必真调。
it('全部生成模型都能离线构建请求', async () => {
  const failures: string[] = []
  for (const row of listSdkModels().filter((item) => item.generation)) {
    const result = await dryRunGenerationModel(row.modelId, undefined, { sample: true })
    if (!result.ok) failures.push(`${row.modelId}: ${result.error}`)
  }
  expect(failures).toEqual([])
}, 300_000)

it('已过时的模型留在开发者清单里，但用户入口找不到', async () => {
  const { registry } = await import('@/core/ModelRegistry')
  const deprecated = listSdkModels().filter((row) => row.deprecated && row.generation)
  expect(deprecated.length).toBeGreaterThan(0)
  for (const row of deprecated) {
    expect(row.category, row.modelId).not.toBe('tool')
    expect(registry.getModel(row.modelId), row.modelId).toBeDefined()
    expect(registry.isModelDiscoverable(row.modelId), row.modelId).toBe(true)
    expect(registry.listAllModels().some((model) => model.meta.id === row.modelId), row.modelId).toBe(false)
  }
})
