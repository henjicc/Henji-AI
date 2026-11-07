/** @vitest-environment jsdom */
import { beforeAll, expect, it, vi } from 'vitest'
import { loadAllModels } from '@/core/loaders/modelLoader'
import { checkGenerationModelVariants, checkGenerationParamDelivery, listSdkModels, SDK_MODEL_CATEGORIES } from './sdkModelInventory'

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

// 构建器有意拒绝的无效输入：参数之间的约束界面表达不了，提交时给出明确提示，不算适配问题。
const INTENDED_REJECTIONS: ReadonlyArray<[modelId: string, message: RegExp]> = [
  ['fal-image-apps-v2-outpaint', /至少需要扩展一侧/],
  // 带参考视频时参考图上限从 7 张降到 4 张，数量限制按素材类型分别写，表达不了“取决于有没有视频”。
  ['kie-kling-3.0-omni', /带参考视频时最多 4 张参考图/],
  // 参考生视频要“图片、视频、音频至少一种”，数量限制只能按单一素材类型写，表达不了“任选其一”，由构建器在提交时提示。
  ...['volcengine-seedance-2.0', 'volcengine-seedance-2.0-fast', 'volcengine-seedance-2.0-mini', 'volcengine-seedance-2.5', 'fal-ai-wan-3.0', 'apimart-wan-3.0', 'apimart-minimax-h3-max', 'apimart-kling-4.0', 'kie-kling-3.0-omni']
    .map((id): [string, RegExp] => [id, /参考生视频至少需要/]),
]
const ANY_OF_MEDIA = /参考生视频至少需要/

// 每个模式 / 渠道分支下单项与两两换参数取值、不带素材与素材放满，界面放行的组合都要能构建请求并计价：
// 只测默认值时，分支里写错的映射、计价与搭配限制发现不了。
it('参数组合在各分支下都能构建请求并计价', async () => {
  const failures: string[] = []
  for (const row of listSdkModels().filter((item) => item.generation)) {
    for (const check of await checkGenerationModelVariants(row.modelId)) {
      const intended = INTENDED_REJECTIONS.some(([id, message]) => id === row.modelId && message.test(check.result.error ?? ''))
        // “任选其一”的限制只该在不带素材时出现，带了素材还报就是真问题。
        && (!ANY_OF_MEDIA.test(check.result.error ?? '') || check.label.includes('不带素材'))
      if (!check.result.ok && intended) continue
      if (!check.result.ok) failures.push(`${row.modelId} [${check.label}] 构建：${check.result.error}`)
      else if (check.priceError) failures.push(`${row.modelId} [${check.label}] 计价：${check.priceError}`)
    }
  }
  expect(failures).toEqual([])
}, 120_000)

// 有意让不同取值发出同一请求的参数：比例为 1:1 时 1K 恰好就是一百万像素。
const INTENDED_MERGES: ReadonlyArray<[modelId: string, paramId: string, values: string]> = [
  ['fal-ai-qwen-image-3.0', 'falQwenImage30Resolution', '1K = 1MP'],
]
const FOLLOWS_SOURCE = new Set(['smart', 'auto', 'adaptive', 'provider'])

// 界面上选得到的不同取值必须发出不同的请求，否则用户看到的和实际请求对不上：
// 构建器悄悄夹取、改值，或参数在当前分支根本不发送（这时应在该分支隐藏）。
it('所选即所发：同一参数的不同取值发出不同的请求', async () => {
  const { registry } = await import('@/core/ModelRegistry')
  const failures: string[] = []
  for (const row of listSdkModels().filter((item) => item.generation)) {
    const roles = new Map(registry.getSchema(row.modelId).map((param) => [param.id, param.role]))
    for (const collision of await checkGenerationParamDelivery(row.modelId)) {
      const values = collision.values.map(String)
      // “智能 / 跟随素材”恰好算出了列表里的某个值。
      if (values.length === 2 && FOLLOWS_SOURCE.has(values[0])) continue
      // 不带素材时，参考类模式退回普通生成。
      if (roles.get(collision.paramId) === 'mode' && collision.context.includes('不带素材')) continue
      if (INTENDED_MERGES.some(([id, paramId, merged]) => id === row.modelId && paramId === collision.paramId && merged === values.join(' = '))) continue
      failures.push(`${row.modelId} [${collision.context}] ${collision.paramId}: ${values.join(' = ')}`)
    }
  }
  expect(failures).toEqual([])
}, 180_000)

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
