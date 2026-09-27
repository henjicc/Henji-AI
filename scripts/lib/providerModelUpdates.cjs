const crypto = require('node:crypto')

const CATEGORY_PATTERNS = {
  maintenance: /维护|恢复|故障|异常|不可用|maintenance|incident|outage|unavailable|restored/i,
  deprecation: /下线|停用|弃用|移除|退役|deprecat|retir|sunset|discontinu|end[- ]of[- ]life/i,
  api: /接口|参数|字段|端点|请求|响应|兼容|迁移|\bapi\b|endpoint|request|response|schema|parameter/i,
  pricing: /价格|定价|计费|降价|涨价|免费|pricing|price|cost|billing|per token|per request/i,
}

const MODEL_FAMILY = /(?:gpt|gemini|qwen|wan|kling|flux|seed|deepseek|llama|whisper|glm|kimi|minimax|mimo|doubao|suno|hunyuan|recraft|ideogram|veo|sora|pixverse|ltx|compound|paraformer|sensevoice|telespeech|fun-asr)/i
const DEFAULT_MODEL_PATTERN = /[A-Za-z][A-Za-z0-9]*(?:[-_.\/][A-Za-z0-9]+){1,8}/g

function decodeEntities(value) {
  return value
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
}

function jsonText(value) {
  const lines = []
  function visit(item, key = '') {
    if (/request.?id|trace.?id|timestamp|server.?time/i.test(key)) return
    if (typeof item === 'string') {
      const trimmed = item.trim()
      if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
        try { visit(JSON.parse(trimmed), key); return } catch {}
      }
      lines.push(item.replace(/\\n/g, '\n'))
      return
    }
    if (Array.isArray(item)) {
      for (const value of item) visit(value, key)
      return
    }
    if (item && typeof item === 'object') {
      for (const [childKey, value] of Object.entries(item)) visit(value, childKey)
    }
  }
  visit(value)
  return lines.join('\n')
}

function normalizeSourceText(value, contentType = '') {
  let text = String(value ?? '')
  if (/json/i.test(contentType) || /^[\s\n]*[\[{]/.test(text)) {
    try { text = jsonText(JSON.parse(text)) } catch {}
  }
  if (/html/i.test(contentType) || /<html|<body|<main|<div/i.test(text)) {
    text = text
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '\n')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '\n')
      .replace(/<\/(?:p|div|li|tr|h[1-6]|section|article)>/gi, '\n')
      .replace(/<(?:br|hr)\b[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
  }
  return decodeEntities(text)
    .normalize('NFKC')
    .replace(/\r/g, '')
    .split('\n')
    .map(line => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
}

function normalizedLines(text) {
  return [...new Set(text.split('\n')
    .map(line => line.replace(/\s+/g, ' ').trim())
    .filter(line => line.length >= 4)
    .map(line => line.slice(0, 600)))]
}

function digest(values) {
  return crypto.createHash('sha256').update(values.join('\n')).digest('hex')
}

function extractModelSignals(text, source = {}) {
  const expression = source.modelPattern
    ? new RegExp(source.modelPattern, source.modelFlags || 'gi')
    : new RegExp(DEFAULT_MODEL_PATTERN.source, DEFAULT_MODEL_PATTERN.flags)
  const ignored = (source.ignoreModelPatterns || []).map(pattern => new RegExp(pattern, 'i'))
  const matches = text.match(expression) || []
  return [...new Set(matches
    .map(value => value.toLowerCase().replace(/^[./]+|[.,:;)/]+$/g, ''))
    .filter(value => value.length >= 4 && value.length <= 120)
    .filter(value => /\d/.test(value) || MODEL_FAMILY.test(value))
    .filter(value => !/\.(?:js|css|png|jpg|jpeg|pdf|svg|woff2?|json|md|html?)$/i.test(value))
    .filter(value => !ignored.some(pattern => pattern.test(value))))]
    .sort((left, right) => left.localeCompare(right, 'en'))
}

function extractCategorySignals(text, category, source = {}) {
  const configured = source.categoryPatterns?.[category]
  const pattern = configured ? new RegExp(configured, 'i') : CATEGORY_PATTERNS[category]
  return normalizedLines(text).filter(line => pattern.test(line)).sort((left, right) => left.localeCompare(right, 'zh-CN'))
}

function buildFacets(raw, source, contentType = '') {
  const text = normalizeSourceText(raw, contentType)
  const facets = {}
  for (const category of source.facets || ['models']) {
    const values = category === 'models'
      ? extractModelSignals(text, source)
      : extractCategorySignals(text, category, source)
    facets[category] = {
      count: values.length,
      hash: digest(values),
      sample: values.slice(0, 8),
    }
  }
  return { text, facets }
}

function compareFacets(current, expected = {}) {
  return Object.entries(current).flatMap(([category, facet]) => {
    const baseline = expected[category]
    if (!baseline) return [{ category, kind: 'unbaselined', current: facet }]
    if (baseline.hash !== facet.hash) return [{ category, kind: 'changed', baseline, current: facet }]
    return []
  })
}

function looksLikeLoginWall(text, source) {
  const patterns = (source.loginPatterns || []).map(pattern => new RegExp(pattern, 'i'))
  return patterns.some(pattern => pattern.test(text))
}

async function fetchOfficialSource(source, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch
  if (!fetchImpl) throw new Error('fetch is unavailable')
  const timeoutMs = options.timeoutMs ?? 20_000
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    let response = await fetchImpl(source.url, {
      headers: { 'User-Agent': 'Henji-AI-model-watch/1.0', Accept: 'text/html,application/json,text/plain;q=0.9,*/*;q=0.8' },
      redirect: 'follow',
      signal: controller.signal,
    })
    let body = await response.text()
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    if (source.resolve?.type === 'json-url') {
      const manifest = JSON.parse(body)
      let target = manifest
      for (const segment of source.resolve.path) target = target?.[segment]
      if (typeof target !== 'string' || !/^https:\/\//.test(target)) throw new Error('official source manifest did not contain a valid HTTPS target')
      const resolvedUrl = `${target.replace(/\/$/, '')}/${source.resolve.suffix.replace(/^\//, '')}`
      response = await fetchImpl(resolvedUrl, {
        headers: { 'User-Agent': 'Henji-AI-model-watch/1.0', Accept: 'text/markdown,text/plain;q=0.9,*/*;q=0.8' },
        redirect: 'follow',
        signal: controller.signal,
      })
      body = await response.text()
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
    }
    return { body, contentType: response.headers?.get?.('content-type') || '', finalUrl: response.url || source.url }
  } finally {
    clearTimeout(timer)
  }
}

async function inspectSource(source, baseline = {}, options = {}) {
  try {
    const fetched = await fetchOfficialSource(source, options)
    const { text, facets } = buildFacets(fetched.body, source, fetched.contentType)
    if (looksLikeLoginWall(text, source)) {
      return { id: source.id, provider: source.provider, url: source.url, status: 'requires_login', facets, changes: [] }
    }
    const requiredFacets = source.requiredFacets || ['models']
    const emptyRequired = requiredFacets.filter(category => !facets[category] || facets[category].count === 0)
    if (emptyRequired.length) {
      return { id: source.id, provider: source.provider, url: source.url, status: 'inconclusive', facets, emptyRequired, changes: [] }
    }
    const changes = compareFacets(facets, baseline.facets)
    return {
      id: source.id,
      provider: source.provider,
      url: source.url,
      finalUrl: fetched.finalUrl,
      status: changes.length ? 'changed' : 'ok',
      facets,
      changes,
    }
  } catch (error) {
    return {
      id: source.id,
      provider: source.provider,
      url: source.url,
      status: error?.name === 'AbortError' ? 'timeout' : 'source_error',
      error: error instanceof Error ? error.message : String(error),
      changes: [],
    }
  }
}

async function inspectRegistry(registry, baselines, options = {}) {
  const providerFilter = options.providers ? new Set(options.providers.map(value => value.toLowerCase())) : null
  const sources = registry.sources.filter(source => !providerFilter || providerFilter.has(source.provider.toLowerCase()))
  const concurrency = Math.max(1, Math.min(options.concurrency ?? 4, 8))
  const results = []
  let cursor = 0
  async function worker() {
    while (cursor < sources.length) {
      const source = sources[cursor++]
      results.push(await inspectSource(source, baselines[source.id], options))
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, sources.length) }, () => worker()))
  return results.sort((left, right) => left.provider.localeCompare(right.provider, 'en') || left.id.localeCompare(right.id, 'en'))
}

function resultSummary(results) {
  const summary = { sources: results.length, ok: 0, changed: 0, inconclusive: 0, requires_login: 0, source_error: 0, timeout: 0 }
  for (const result of results) summary[result.status] = (summary[result.status] || 0) + 1
  return summary
}

module.exports = {
  buildFacets,
  compareFacets,
  extractCategorySignals,
  extractModelSignals,
  fetchOfficialSource,
  inspectRegistry,
  inspectSource,
  normalizeSourceText,
  resultSummary,
}
