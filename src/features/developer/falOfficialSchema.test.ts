/** @vitest-environment jsdom */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { beforeAll, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { loadAllModels } from '@/core/loaders/modelLoader'
import { checkGenerationModelVariants, listSdkModels } from './sdkModelInventory'

/**
 * Fal 为每个端点公开官方 OpenAPI（无需登录）。这里把各端点的输入格式存成快照，再拿参数组合检查构建出的每个请求去对：
 * 字段名、取值范围、枚举与必填项都按官方格式校验，官方没列的字段单独报出来。
 * 快照缺失或要更新时，用 HENJI_REFRESH_FAL_OPENAPI=1 运行本测试重新抓取。
 */
const SNAPSHOT_DIR = path.resolve(__dirname, '../../../packages/ai-sdk/tests/fixtures/fal-openapi')
const REFRESH = process.env.HENJI_REFRESH_FAL_OPENAPI === '1'

type JsonSchema = Record<string, unknown>
interface Snapshot { source: { url: string; collectedAt: string; loginRequired: false; classification: 'official-literal' }; endpointId: string; input: JsonSchema }

const snapshotPath = (endpointId: string): string => path.join(SNAPSHOT_DIR, `${endpointId.replace(/\//g, '__')}.json`)
const openApiUrl = (endpointId: string): string => `https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=${endpointId}`

// 只留校验要用的关键字；说明、示例与界面提示占了快照的大半体积，校验用不到。
const DROPPED_KEYS = new Set(['description', 'examples', 'example', 'title', 'x-fal-order-properties', 'ui', 'metadata'])

/** 把 components 里的引用展开成一份自包含的输入格式，顺带去掉校验用不到的关键字。 */
function resolveRefs(value: unknown, schemas: Record<string, unknown>, seen: readonly string[] = []): unknown {
  if (Array.isArray(value)) return value.map((item) => resolveRefs(item, schemas, seen))
  if (!value || typeof value !== 'object') return value
  const ref = (value as { $ref?: unknown }).$ref
  if (typeof ref === 'string') {
    const name = ref.split('/').pop() ?? ''
    if (seen.includes(name)) return {}
    return resolveRefs(schemas[name], schemas, [...seen, name])
  }
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !DROPPED_KEYS.has(key) && !key.startsWith('x-'))
    .map(([key, item]) => [key, key === 'properties' ? Object.fromEntries(Object.entries(item as Record<string, unknown>).map(([name, child]) => [name, resolveRefs(child, schemas, seen)])) : resolveRefs(item, schemas, seen)]))
}

async function fetchSnapshot(endpointId: string): Promise<Snapshot | null> {
  const response = await fetch(openApiUrl(endpointId))
  if (!response.ok) return null
  const document = await response.json() as { paths?: Record<string, { post?: { requestBody?: { content?: Record<string, { schema?: unknown }> } } }>; components?: { schemas?: Record<string, unknown> } }
  const post = Object.entries(document.paths ?? {}).find(([route, item]) => item.post && !route.includes('/requests/'))?.[1].post
  const schema = post?.requestBody?.content?.['application/json']?.schema
  if (!schema) return null
  return {
    source: { url: openApiUrl(endpointId), collectedAt: new Date().toISOString().slice(0, 10), loginRequired: false, classification: 'official-literal' },
    endpointId,
    input: resolveRefs(schema, document.components?.schemas ?? {}) as JsonSchema,
  }
}

beforeAll(async () => {
  await loadAllModels()
  vi.stubGlobal('Image', undefined)
})

it('Fal 请求符合各端点的官方输入格式', async () => {
  const requests = new Map<string, Array<{ modelId: string; label: string; body: Record<string, unknown> }>>()
  // 过时模型用户已经看不到，端点常常已被 Fal 下线，不在这里核对。
  for (const row of listSdkModels().filter((item) => item.generation && item.providerId === 'fal' && !item.deprecated)) {
    for (const check of await checkGenerationModelVariants(row.modelId)) {
      if (!check.result.ok || !check.result.route || !check.result.body || typeof check.result.body !== 'object') continue
      const list = requests.get(check.result.route) ?? []
      list.push({ modelId: row.modelId, label: check.label, body: check.result.body as Record<string, unknown> })
      requests.set(check.result.route, list)
    }
  }
  expect(requests.size).toBeGreaterThan(0)

  const problems: string[] = []
  if (REFRESH) mkdirSync(SNAPSHOT_DIR, { recursive: true })
  for (const [endpointId, list] of requests) {
    if (REFRESH) {
      const fresh = await fetchSnapshot(endpointId)
      if (fresh) writeFileSync(snapshotPath(endpointId), `${JSON.stringify(fresh, null, 2)}\n`)
      else problems.push(`${endpointId}：官方 OpenAPI 取不到（端点可能已下线或改名）`)
    }
    if (!existsSync(snapshotPath(endpointId))) {
      if (!REFRESH) problems.push(`${endpointId}：没有官方格式快照，用 HENJI_REFRESH_FAL_OPENAPI=1 运行本测试抓取`)
      continue
    }
    const snapshot = JSON.parse(readFileSync(snapshotPath(endpointId), 'utf8')) as Snapshot
    const validator = z.fromJSONSchema(snapshot.input as Parameters<typeof z.fromJSONSchema>[0])
    const documented = new Set(Object.keys((snapshot.input.properties ?? {}) as Record<string, unknown>))
    // 同一端点的同类问题只报一次，附上第一个出现的组合。
    const seen = new Set<string>()
    for (const { modelId, label, body } of list) {
      const parsed = validator.safeParse(body)
      const issues = [
        ...(parsed.success ? [] : parsed.error.issues.map((issue) => `${issue.path.join('.') || '(根)'} ${issue.message}`)),
        ...Object.keys(body).filter((key) => !documented.has(key)).map((key) => `${key} 官方未列出`),
      ]
      for (const issue of issues) {
        if (seen.has(issue)) continue
        seen.add(issue)
        problems.push(`${endpointId}（${modelId} [${label}]）：${issue}`)
      }
    }
  }
  expect(problems).toEqual([])
}, 120_000)
