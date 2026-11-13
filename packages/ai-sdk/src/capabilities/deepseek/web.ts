import { unitPrice } from '../../pricing/capabilityPricing'
import { AiRuntimeError, cancelledError } from '../../runtime/AiRuntimeError'
import type { CapabilityExecutionContext, CapabilityModule } from '../types'
import { deepSeekToolsEndpoint, readDeepSeekToolJson } from './http'

export interface DeepSeekToolsModuleOptions {
  /** DeepSeek API root, without the /v1/tools path. */
  apiBaseUrl?: string
}

export interface WebSearchInput {
  /** 1–128 个字符，支持 site: / -site: / lang: / after: / before: / "精确短语" 等搜索语法。 */
  query: string
  /** 返回条数 1–50，默认 10；不影响单次价格。 */
  count?: number
  /** 触发搜索的用户原问题（1–128 个字符），帮助服务端理解意图。 */
  originalQuestion?: string
  /** 是否同时返回网页正文。 */
  includeContent?: boolean
}

export interface WebSearchResult {
  title: string
  url: string
  /** 100–200 字的短摘要，适合展示。 */
  snippet: string
  /** 600–800 字的长摘要，适合给模型阅读。 */
  summary: string
  /** includeContent 为 false 或正文缺失时为空字符串。 */
  content: string
  siteName: string | null
  siteIcon: string | null
  /** UTC RFC 3339，未知为 null。 */
  publishedAt: string | null
  /** 0–3，综合相关性、权威性、时效性；≥1.5 为优质结果。 */
  rerankScore: number
  /** 0–4，-1 为未知；≥3 为极权威。 */
  authority: number
}

export interface WebSearchOutput { results: readonly WebSearchResult[] }
export interface WebFetchInput { url: string }
export interface WebFetchOutput { title: string; content: string }

type Context = CapabilityExecutionContext

const SOURCE = { kind: 'builtin', namespace: '@henjicc/ai-sdk' } as const
// 两个接口都是 5 元/千次成功请求；无结果、失败与超时不计费。
const PER_REQUEST_CNY = 0.005

async function apiKey(context: Context): Promise<string> {
  const value = (await context.runtime.credentials.get('generation', 'deepseek'))?.trim()
  if (!value) throw new AiRuntimeError('api_key_missing', 'DeepSeek API 密钥未配置')
  return value
}

function characters(value: string): number {
  return [...value].length
}

async function postJson(context: Context, url: string, body: unknown, action: string): Promise<Record<string, unknown>> {
  if (context.signal.aborted) throw cancelledError(context.requestId)
  const response = await context.runtime.transport.fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await apiKey(context)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: context.signal,
  })
  return readDeepSeekToolJson(response, action)
}

const text = (value: unknown): string => typeof value === 'string' ? value : ''
const nullableText = (value: unknown): string | null => typeof value === 'string' && value ? value : null
const numeric = (value: unknown, fallback: number): number => typeof value === 'number' && Number.isFinite(value) ? value : fallback

/** DeepSeek 自研搜索引擎的网页搜索；暂不支持图片搜索。 */
export function createDeepSeekWebSearchModule(options: DeepSeekToolsModuleOptions = {}): CapabilityModule<WebSearchInput, WebSearchOutput> {
  const url = deepSeekToolsEndpoint(options.apiBaseUrl, 'search')
  return {
    descriptor: {
      id: 'deepseek.web-search', kind: 'web-search', source: SOURCE, providerIds: ['deepseek'], modelId: 'deepseek-search',
      contract: { input: [{ kind: 'text', required: true }], output: [{ kind: 'structured-data' }] },
      pricing: unitPrice('CNY', 'request', PER_REQUEST_CNY),
    },
    execute: async (input, context) => {
      const query = typeof input?.query === 'string' ? input.query : ''
      if (!query.trim() || characters(query) > 128) throw new AiRuntimeError('invalid_parameter', '搜索词须为 1–128 个字符且不能全是空白')
      const count = input.count ?? 10
      if (!Number.isInteger(count) || count < 1 || count > 50) throw new AiRuntimeError('invalid_parameter', '返回条数须为 1–50 的整数')
      const question = input.originalQuestion?.trim()
      const payload = await postJson(context, url, {
        query, count,
        ...(question ? { ori_question: [...question].slice(0, 128).join('') } : {}),
        need_content: input.includeContent === true,
      }, '网页搜索')
      if (!Array.isArray(payload.results)) throw new AiRuntimeError('invalid_response', 'DeepSeek 网页搜索没有返回结果数组')
      const results = payload.results.flatMap((item): WebSearchResult[] => {
        if (!item || typeof item !== 'object') return []
        const value = item as Record<string, unknown>
        const resultUrl = text(value.url)
        if (!resultUrl) return []
        return [{
          title: text(value.title), url: resultUrl, snippet: text(value.snippet), summary: text(value.summary), content: text(value.content),
          siteName: nullableText(value.site_name), siteIcon: nullableText(value.site_icon), publishedAt: nullableText(value.date),
          rerankScore: numeric(value.rerank_score, 0), authority: numeric(value.authority, -1),
        }]
      })
      return { results }
    },
  }
}

/** 抓取单个网页，返回 Markdown 正文；结果受目标站点可用性与访问策略影响。 */
export function createDeepSeekWebFetchModule(options: DeepSeekToolsModuleOptions = {}): CapabilityModule<WebFetchInput, WebFetchOutput> {
  const url = deepSeekToolsEndpoint(options.apiBaseUrl, 'fetch')
  return {
    descriptor: {
      id: 'deepseek.web-fetch', kind: 'web-fetch', source: SOURCE, providerIds: ['deepseek'], modelId: 'deepseek-fetch',
      contract: { input: [{ kind: 'text', required: true }], output: [{ kind: 'text' }] },
      pricing: unitPrice('CNY', 'request', PER_REQUEST_CNY),
    },
    execute: async (input, context) => {
      const target = typeof input?.url === 'string' ? input.url.trim() : ''
      let parsed: URL | undefined
      try { parsed = new URL(target) } catch { parsed = undefined }
      if (!parsed || !/^https?:$/.test(parsed.protocol) || !parsed.host || parsed.username || parsed.password || target.length > 8192) {
        throw new AiRuntimeError('invalid_parameter', '网页地址须是带主机名的 HTTP(S) 地址，不超过 8192 字符，且不能带用户名或密码')
      }
      const payload = await postJson(context, url, { url: target }, '网页抓取')
      const content = text(payload.content)
      if (!content) throw new AiRuntimeError('invalid_response', 'DeepSeek 网页抓取没有返回正文')
      return { title: text(payload.title), content }
    },
  }
}
