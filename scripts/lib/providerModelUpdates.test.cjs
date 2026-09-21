const assert = require('node:assert/strict')
const test = require('node:test')
const {
  buildFacets,
  inspectSource,
  normalizeSourceText,
  resultSummary,
} = require('./providerModelUpdates.cjs')

const source = {
  id: 'fixture', provider: 'fixture', url: 'https://official.example/models',
  facets: ['models', 'maintenance', 'deprecation', 'api', 'pricing'],
}

test('官网 HTML 只保留可见语义，并按五类生成稳定指纹', () => {
  const html = '<html><script>volatile-build-123</script><body><h1>Model qwen-audio-3.0-asr-flash</h1><p>2026-09-19 模型维护</p><p>API 参数迁移，价格降价</p><p>legacy-model-1 下线</p></body></html>'
  const first = buildFacets(html, source, 'text/html')
  const second = buildFacets(html.replace('volatile-build-123', 'volatile-build-456'), source, 'text/html')
  assert.equal(normalizeSourceText(html, 'text/html').includes('volatile-build'), false)
  assert.deepEqual(first.facets, second.facets)
  assert.ok(first.facets.models.sample.includes('qwen-audio-3.0-asr-flash'))
  assert.equal(first.facets.maintenance.count, 1)
  assert.equal(first.facets.deprecation.count, 1)
  assert.equal(first.facets.api.count, 1)
  assert.equal(first.facets.pricing.count, 1)
})

test('相同基线通过；新增模型与维护公告产生可分类差异', async () => {
  const initial = '<p>model qwen3-asr-flash</p><p>API 参数</p>'
  const baseline = { facets: buildFacets(initial, source, 'text/html').facets }
  const response = body => new Response(body, { status: 200, headers: { 'Content-Type': 'text/html' } })
  const unchanged = await inspectSource(source, baseline, { fetchImpl: async () => response(initial) })
  assert.equal(unchanged.status, 'ok')
  const changed = await inspectSource(source, baseline, { fetchImpl: async () => response(`${initial}<p>qwen-audio-3.0-asr-flash</p><p>模型正在维护</p>`) })
  assert.equal(changed.status, 'changed')
  assert.deepEqual(changed.changes.map(item => item.category).sort(), ['maintenance', 'models'])
})

test('登录墙、网络错误和超时都显式报告，不会伪装成无更新', async () => {
  const loginSource = { ...source, loginPatterns: ['请先登录'] }
  const login = await inspectSource(loginSource, {}, { fetchImpl: async () => new Response('<p>请先登录</p>') })
  assert.equal(login.status, 'requires_login')
  const failed = await inspectSource(source, {}, { fetchImpl: async () => { throw new Error('ECONNRESET') } })
  assert.equal(failed.status, 'source_error')
  assert.equal(resultSummary([login, failed]).ok, 0)
  assert.equal(resultSummary([login, failed]).requires_login, 1)
  assert.equal(resultSummary([login, failed]).source_error, 1)
})

test('官网只返回应用外壳时标成结果不足', async () => {
  const result = await inspectSource(source, {}, { fetchImpl: async () => new Response('<html><body>Documentation</body></html>') })
  assert.equal(result.status, 'inconclusive')
  assert.deepEqual(result.emptyRequired, ['models'])
})

test('可从官网版本清单解析当前机器可读文档地址', async () => {
  const manifestSource = {
    ...source,
    resolve: { type: 'json-url', path: ['Data', 'TargetPrefix'], suffix: 'dist/models.md' },
  }
  const requested = []
  const result = await inspectSource(manifestSource, {}, { fetchImpl: async url => {
    requested.push(String(url))
    return String(url).endsWith('/models.md')
      ? new Response('model mimo-v2.5-pro')
      : new Response(JSON.stringify({ Data: { TargetPrefix: 'https://cdn.official.example/version' } }), { headers: { 'Content-Type': 'application/json' } })
  } })
  assert.equal(result.status, 'changed')
  assert.deepEqual(requested, ['https://official.example/models', 'https://cdn.official.example/version/dist/models.md'])
})
