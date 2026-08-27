const fs = require('node:fs')
const path = require('node:path')

const packageRoot = path.resolve(__dirname, '..')
const sourceRoot = path.join(packageRoot, 'src')
const domainDocPath = path.join(packageRoot, 'docs', '接入指南', '供应商域名.md')
const errorDocPath = path.join(packageRoot, 'docs', '接入指南', '错误处理.md')

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(dir, entry.name)
    return entry.isDirectory() ? walk(target) : [target]
  })
}

function read(file) {
  return fs.readFileSync(file, 'utf8')
}

function hostsFromUrls(text) {
  const hosts = new Set()
  for (const match of text.matchAll(/https?:\/\/([^/'"`\s)]+)/g)) {
    const host = match[1]
    if (!host.includes('{') && !host.endsWith('.localhost')) hosts.add(host)
  }
  return hosts
}

function collectRuntimeDomains() {
  const runtimeFiles = [
    'providers/apimart.ts',
    'providers/bailian.ts',
    'providers/connection.ts',
    'providers/endpoints/apimart.ts',
    'providers/endpoints/grsai.ts',
    'providers/fal.ts',
    'providers/grsai.ts',
    'providers/kie.ts',
    'providers/modelscope.ts',
    'providers/ppio.ts',
    'providers/volcengine.ts',
    'upload/providers.ts',
    'upload/fal-transport.ts',
    'llm/defaults.ts',
    'llm/streaming.ts',
  ]
  const hosts = new Set()
  for (const relative of runtimeFiles) {
    for (const host of hostsFromUrls(read(path.join(sourceRoot, relative)))) hosts.add(host)
  }

  // LLM 预设里只有 baseUrl/baseUrlHint 会发请求；apiKeyUrl/docs 是给人点击的资料链接。
  const presets = read(path.join(sourceRoot, 'llm', 'providerPresets.ts'))
  for (const match of presets.matchAll(/baseUrl:\s*['"](https?:\/\/[^'"]+)['"]/g)) {
    for (const host of hostsFromUrls(match[1])) hosts.add(host)
  }
  if (presets.includes('{WorkspaceId}.cn-beijing.maas.aliyuncs.com')) {
    hosts.add('*.cn-beijing.maas.aliyuncs.com')
  }

  // Fal endpoint 支持动态子域，文档用通配形式声明。
  if (read(path.join(sourceRoot, 'providers', 'fal.ts')).includes('fal.run')) {
    hosts.add('*.fal.run')
  }

  return [...hosts].sort()
}

function collectAiRuntimeCodes() {
  const codes = new Set()
  for (const file of walk(sourceRoot).filter((item) => item.endsWith('.ts'))) {
    const text = read(file)
    for (const match of text.matchAll(/new\s+AiRuntimeError\(\s*['"]([^'"]+)['"]/g)) {
      codes.add(match[1])
    }
  }
  // cancelledError() 是固定工厂，不是 new AiRuntimeError 调用点。
  const errors = read(path.join(sourceRoot, 'runtime', 'AiRuntimeError.ts'))
  const cancelled = errors.match(/new\s+AiRuntimeError\(\s*['"]([^'"]+)['"]/)?.[1]
  if (cancelled) codes.add(cancelled)
  return [...codes].sort()
}

function collectLlmCategories() {
  const errors = read(path.join(sourceRoot, 'runtime', 'errors.ts'))
  const enumBody = errors.match(/modelProviderErrorCategorySchema\s*=\s*z\.enum\(\[([\s\S]*?)\]\)/)?.[1] ?? ''
  return [...enumBody.matchAll(/['"]([^'"]+)['"]/g)].map((match) => match[1]).sort()
}

function collectFixedLlmCodes() {
  const files = [
    path.join(sourceRoot, 'runtime', 'error-classify.ts'),
    path.join(sourceRoot, 'llm', 'sdk', 'runtime.ts'),
  ]
  const codes = new Set()
  for (const file of files) {
    const text = read(file)
    for (const match of text.matchAll(/code:\s*['"]([A-Z][A-Z0-9_]+)['"]/g)) codes.add(match[1])
    for (const match of text.matchAll(/['"](MODEL_[A-Z0-9_]+|PROVIDER_ERROR)['"]/g)) codes.add(match[1])
  }
  return [...codes].sort()
}

function collectLlmMarkers() {
  const files = [
    path.join(sourceRoot, 'runtime', 'errors.ts'),
    path.join(sourceRoot, 'llm', 'chat.ts'),
    path.join(sourceRoot, 'llm', 'sdk', 'runtime.ts'),
  ]
  const markers = new Set()
  for (const file of files) {
    for (const match of read(file).matchAll(/\[([a-z][a-z0-9_]+)\]/g)) markers.add(match[1])
  }
  return [...markers].sort()
}

function assertDocContains(file, values, label) {
  const text = read(file)
  const missing = values.filter((value) => !text.includes(`\`${value}\``))
  if (missing.length > 0) {
    throw new Error(`${label} 文档缺少: ${missing.join(', ')}`)
  }
}

const report = {
  runtimeDomains: collectRuntimeDomains(),
  aiRuntimeCodes: collectAiRuntimeCodes(),
  llmCategories: collectLlmCategories(),
  fixedLlmCodes: collectFixedLlmCodes(),
  llmMarkers: collectLlmMarkers(),
}

if (process.argv.includes('--check')) {
  assertDocContains(domainDocPath, report.runtimeDomains, '供应商域名')
  assertDocContains(errorDocPath, report.aiRuntimeCodes, 'AiRuntimeError')
  assertDocContains(errorDocPath, report.llmCategories, 'LLM category')
  assertDocContains(errorDocPath, report.fixedLlmCodes, 'LLM fixed code')
  assertDocContains(errorDocPath, report.llmMarkers, 'LLM marker')
  console.log(JSON.stringify({ ok: true, ...report }, null, 2))
} else {
  console.log(JSON.stringify(report, null, 2))
}
