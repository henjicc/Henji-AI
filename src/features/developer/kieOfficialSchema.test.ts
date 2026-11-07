/** @vitest-environment jsdom */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'
import { beforeAll, expect, it, vi } from 'vitest'
import { loadAllModels } from '@/core/loaders/modelLoader'
import { checkGenerationModelVariants, listSdkModels } from './sdkModelInventory'
import { officialSchemaProblems, resolveRefs, type JsonSchema } from './officialSchemaTesting'

/**
 * KIE 每个接口的官方文档都有 .md 版本，内含完整 OpenAPI（无需登录，input 多为 additionalProperties: false）。
 * 所有接口共用 /api/v1/jobs/createTask，靠请求里的 model 区分，所以按 model 存快照，再拿参数组合检查构建出的每个请求去对。
 * 快照缺失或要更新时，用 HENJI_REFRESH_KIE_OPENAPI=1 运行本测试：读 llms.txt 列出的全部 market 文档重新抓取。
 */
const SNAPSHOT_DIR = path.resolve(__dirname, '../../../packages/ai-sdk/tests/fixtures/kie-openapi')
const REFRESH = process.env.HENJI_REFRESH_KIE_OPENAPI === '1'
const INDEX_URL = 'https://docs.kie.ai/llms.txt'

interface Snapshot { source: { url: string; collectedAt: string; loginRequired: false; classification: 'official-literal' }; model: string; body: JsonSchema }

const snapshotPath = (model: string): string => path.join(SNAPSHOT_DIR, `${model.replace(/[/:]/g, '__')}.json`)

/** 读全部 market 文档，按请求体里 model 的取值建表；同一 model 出现在多份文档时取第一份。 */
async function fetchAllSchemas(): Promise<Map<string, Snapshot>> {
  const index = await (await fetch(INDEX_URL)).text()
  const urls = [...new Set([...index.matchAll(/\((https:\/\/docs\.kie\.ai\/market\/[^)]+\.md)\)/g)].map((match) => match[1]))]
  const byModel = new Map<string, Snapshot>()
  const collectedAt = new Date().toISOString().slice(0, 10)
  for (let start = 0; start < urls.length; start += 8) {
    await Promise.all(urls.slice(start, start + 8).map(async (url) => {
      const text = await fetch(url).then((response) => response.ok ? response.text() : '').catch(() => '')
      // 一份文档可能有好几段 YAML（回调示例等），逐段找带请求体的那段；接口说明里还嵌着带缩进的代码块，结束围栏要在行首。
      for (const [, yamlBlock] of text.matchAll(/```yaml\n([\s\S]*?)\n```(?:\n|$)/g)) {
        const document = parseYaml(yamlBlock) as { paths?: Record<string, { post?: { requestBody?: { content?: Record<string, { schema?: unknown }> } } }>; components?: { schemas?: Record<string, unknown> } }
      for (const item of Object.values(document.paths ?? {})) {
        const schema = item.post?.requestBody?.content?.['application/json']?.schema
        if (!schema) continue
        const body = resolveRefs(schema, document.components?.schemas ?? {}) as JsonSchema
        const modelSchema = ((body.properties ?? {}) as Record<string, { enum?: unknown[]; default?: unknown }>).model
        const models = modelSchema?.enum ?? (modelSchema?.default ? [modelSchema.default] : [])
        for (const model of models) {
          if (typeof model === 'string' && !byModel.has(model)) {
            byModel.set(model, { source: { url, collectedAt, loginRequired: false, classification: 'official-literal' }, model, body })
          }
        }
      }
      }
    }))
  }
  return byModel
}

beforeAll(async () => {
  await loadAllModels()
  vi.stubGlobal('Image', undefined)
})

it('KIE 请求符合各接口的官方输入格式', async () => {
  const requests = new Map<string, Array<{ modelId: string; label: string; body: Record<string, unknown> }>>()
  // 过时模型用户已经看不到，接口常常已被 KIE 下线，不在这里核对。
  for (const row of listSdkModels().filter((item) => item.generation && item.providerId === 'kie' && !item.deprecated)) {
    for (const check of await checkGenerationModelVariants(row.modelId)) {
      if (!check.result.ok || !check.result.body) continue
      // 示例图是 data URI；真实请求里本地素材会先经 KIE 上传换成公网地址，按地址校验。
      const body = JSON.parse(JSON.stringify(check.result.body).replace(/"data:[^"]*"/g, '"https://example.com/henji-sample.png"')) as Record<string, unknown>
      if (typeof body.model !== 'string') continue
      const list = requests.get(body.model) ?? []
      list.push({ modelId: row.modelId, label: check.label, body })
      requests.set(body.model, list)
    }
  }
  expect(requests.size).toBeGreaterThan(0)

  const problems: string[] = []
  if (REFRESH) {
    mkdirSync(SNAPSHOT_DIR, { recursive: true })
    const all = await fetchAllSchemas()
    for (const model of requests.keys()) {
      const fresh = all.get(model)
      if (fresh) writeFileSync(snapshotPath(model), `${JSON.stringify(fresh, null, 2)}\n`)
      else problems.push(`${model}：KIE 文档里找不到这个 model（接口可能已下线或改名）`)
    }
  }
  for (const [model, list] of requests) {
    if (!existsSync(snapshotPath(model))) {
      if (!REFRESH) problems.push(`${model}：没有官方格式快照，用 HENJI_REFRESH_KIE_OPENAPI=1 运行本测试抓取`)
      continue
    }
    const snapshot = JSON.parse(readFileSync(snapshotPath(model), 'utf8')) as Snapshot
    // 回调地址由宿主按需追加，构建器不发；input 逐个字段核对。
    problems.push(...officialSchemaProblems(model, snapshot.body, list, ['input']))
  }
  expect(problems).toEqual([])
}, 600_000)
