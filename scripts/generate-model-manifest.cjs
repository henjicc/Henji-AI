const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const vm = require('vm')

const ROOT = process.cwd()
const MODELS_DIR = path.join(ROOT, 'src', 'models')
const OUTPUT = path.join(ROOT, 'resources', 'model-manifest.json')

const KNOWN_ENDPOINT_CONSTANTS = {
  KIE_CREATE_TASK_ENDPOINT: '/api/v1/jobs/createTask',
  MODELSCOPE_CREATE_TASK_ENDPOINT: '/api/v1/jobs/createTask',
}

const CUSTOM_BUILDER_OVERRIDES = {
  'fal-ai-bytedance-seedream-v4': `(params) => {
    const clamp = (value, min, max) => Math.min(max, Math.max(min, value))
    const parseRatio = (raw) => {
      const pair = String(raw || '').split(':').map(Number)
      return pair[0] > 0 && pair[1] > 0 ? pair[0] / pair[1] : null
    }
    const smartRatioHint = typeof params.__firstImageRatio === 'number' && Number.isFinite(params.__firstImageRatio) && params.__firstImageRatio > 0
      ? params.__firstImageRatio
      : 1
    const uploadedImages = Array.isArray(params.uploadedFilePaths) ? params.uploadedFilePaths.filter((item) => typeof item === 'string' && item.trim().length > 0) : []
    const images = uploadedImages.length > 0 ? uploadedImages : (Array.isArray(params.images) ? params.images : [])
    const prompt = typeof params.prompt === 'string' ? params.prompt : ''
    const numImages = Number(params.falSeedream40NumImages || 1)
    const legacyResolution = params.falSeedreamV4Resolution && typeof params.falSeedreamV4Resolution === 'object'
      ? params.falSeedreamV4Resolution
      : null
    const aspectRatio = legacyResolution && typeof legacyResolution.aspectRatio === 'string'
      ? legacyResolution.aspectRatio
      : String(params.falSeedreamV4AspectRatio || 'smart')
    const quality = (legacyResolution && legacyResolution.quality === '4K') || params.falSeedreamV4Resolution === '4K' ? '4K' : '2K'
    const isSmart = aspectRatio === 'smart' || aspectRatio === 'auto' || !aspectRatio
    let width = Number((legacyResolution && legacyResolution.width) || 0)
    let height = Number((legacyResolution && legacyResolution.height) || 0)
    if (!(width > 0 && height > 0) || isSmart) {
      const ratio = isSmart ? smartRatioHint : (parseRatio(aspectRatio) || 1)
      const normalizedRatio = clamp(ratio, 1 / 16, 16)
      const target = quality === '4K' ? 16777216 : 4194304
      let h = Math.sqrt(target / normalizedRatio)
      let w = h * normalizedRatio
      width = Math.round(w)
      height = Math.round(h)
    }
    width = Math.max(1024, Math.min(4096, Math.round(width)))
    height = Math.max(1024, Math.min(4096, Math.round(height)))
    const pixels = width * height
    if (pixels > 16777216) {
      const scale = Math.sqrt(16777216 / pixels)
      width = Math.max(1024, Math.min(4096, Math.round(width * scale)))
      height = Math.max(1024, Math.min(4096, Math.round(height * scale)))
    }
    const requestData = { prompt, image_size: { width, height }, num_images: numImages, enable_safety_checker: false }
    if (images.length > 0) {
      requestData.image_urls = images
    }
    return requestData
  }`,
  'fal-ai-bytedance-seedream-v4.5': `(params) => {
    const clamp = (value, min, max) => Math.min(max, Math.max(min, value))
    const parseRatio = (raw) => {
      const pair = String(raw || '').split(':').map(Number)
      return pair[0] > 0 && pair[1] > 0 ? pair[0] / pair[1] : null
    }
    const smartRatioHint = typeof params.__firstImageRatio === 'number' && Number.isFinite(params.__firstImageRatio) && params.__firstImageRatio > 0
      ? params.__firstImageRatio
      : 1
    const uploadedImages = Array.isArray(params.uploadedFilePaths) ? params.uploadedFilePaths.filter((item) => typeof item === 'string' && item.trim().length > 0) : []
    const images = uploadedImages.length > 0 ? uploadedImages : (Array.isArray(params.images) ? params.images : [])
    const prompt = typeof params.prompt === 'string' ? params.prompt : ''
    const numImages = Number(params.falSeedream45NumImages || 1)
    const legacyResolution = params.falSeedreamV45Resolution && typeof params.falSeedreamV45Resolution === 'object'
      ? params.falSeedreamV45Resolution
      : null
    const aspectRatio = legacyResolution && typeof legacyResolution.aspectRatio === 'string'
      ? legacyResolution.aspectRatio
      : String(params.falSeedreamV45AspectRatio || 'smart')
    const quality = (legacyResolution && legacyResolution.quality === '4K') || params.falSeedreamV45Resolution === '4K' ? '4K' : '2K'
    const isSmart = aspectRatio === 'smart' || aspectRatio === 'auto' || !aspectRatio
    let width = Number((legacyResolution && legacyResolution.width) || 0)
    let height = Number((legacyResolution && legacyResolution.height) || 0)
    if (!(width > 0 && height > 0) || isSmart) {
      const ratio = isSmart ? smartRatioHint : (parseRatio(aspectRatio) || 1)
      const normalizedRatio = clamp(ratio, 1 / 16, 16)
      const target = quality === '4K' ? 16777216 : 4194304
      let h = Math.sqrt(target / normalizedRatio)
      let w = h * normalizedRatio
      width = Math.round(w)
      height = Math.round(h)
    }
    width = Math.max(1, Math.min(4096, Math.round(width)))
    height = Math.max(1, Math.min(4096, Math.round(height)))
    let pixels = width * height
    if (pixels < 3686400) {
      const scale = Math.sqrt(3686400 / Math.max(1, pixels))
      width = Math.max(1, Math.min(4096, Math.round(width * scale)))
      height = Math.max(1, Math.min(4096, Math.round(height * scale)))
      pixels = width * height
    }
    if (pixels > 16777216) {
      const scale = Math.sqrt(16777216 / pixels)
      width = Math.max(1, Math.min(4096, Math.round(width * scale)))
      height = Math.max(1, Math.min(4096, Math.round(height * scale)))
    }
    const requestData = { prompt, image_size: { width, height }, num_images: numImages, enable_safety_checker: false }
    if (images.length > 0) {
      requestData.image_urls = images
    }
    return requestData
  }`,
  'kie-seedream-4.0': `(params) => {
    const parseRatio = (raw) => {
      const pair = String(raw || '').split(':').map(Number)
      return pair[0] > 0 && pair[1] > 0 ? pair[0] / pair[1] : null
    }
    const pickClosestRatio = (target) => {
      const options = ['21:9', '16:9', '3:2', '4:3', '1:1', '3:4', '2:3', '9:16']
      let best = '1:1'
      let bestDiff = Number.POSITIVE_INFINITY
      for (const ratioText of options) {
        const ratio = parseRatio(ratioText)
        if (!ratio) continue
        const diff = Math.abs(ratio - target)
        if (diff < bestDiff) {
          bestDiff = diff
          best = ratioText
        }
      }
      return best
    }
    const mapImageSize = (ratio) => {
      if (!ratio) return 'square_hd'
      if (ratio.includes('_')) return ratio
      if (ratio === '1:1') return 'square_hd'
      if (ratio === '4:3') return 'landscape_4_3'
      if (ratio === '3:4') return 'portrait_4_3'
      if (ratio === '3:2') return 'landscape_3_2'
      if (ratio === '2:3') return 'portrait_3_2'
      if (ratio === '16:9') return 'landscape_16_9'
      if (ratio === '9:16') return 'portrait_16_9'
      if (ratio === '21:9') return 'landscape_21_9'
      return 'square_hd'
    }
    const smartRatioHint = typeof params.__firstImageRatio === 'number' && Number.isFinite(params.__firstImageRatio) && params.__firstImageRatio > 0
      ? params.__firstImageRatio
      : null
    const uploadedImages = Array.isArray(params.uploadedFilePaths) ? params.uploadedFilePaths.filter((item) => typeof item === 'string' && item.trim().length > 0) : []
    const images = uploadedImages.length > 0 ? uploadedImages : (Array.isArray(params.images) ? params.images : [])
    const prompt = typeof params.prompt === 'string' ? params.prompt : ''
    const rawAspect = params.kieSeedream40AspectRatio || params.image_size || params.aspect_ratio
    const resolution = params.kieSeedream40Resolution || params.image_resolution || params.resolution
    const maxImages = params.kieSeedream40MaxImages || params.max_images || params.maxImages
    const modelName = images.length === 0 ? 'bytedance/seedream-v4-text-to-image' : 'bytedance/seedream-v4-edit'
    const input = { prompt }
    const aspectText = typeof rawAspect === 'string' ? rawAspect : ''
    const isSmart = !aspectText || aspectText === 'smart' || aspectText === 'auto'
    const normalizedAspect = isSmart
      ? (smartRatioHint ? pickClosestRatio(smartRatioHint) : '1:1')
      : aspectText
    input.image_size = mapImageSize(String(normalizedAspect))
    if (resolution) {
      input.image_resolution = resolution
    }
    if (maxImages !== undefined) {
      input.max_images = maxImages
    }
    if (images.length > 0) {
      input.image_urls = images
    }
    return { model: modelName, input }
  }`,
  'kie-seedream-4.5': `(params) => {
    const parseRatio = (raw) => {
      const pair = String(raw || '').split(':').map(Number)
      return pair[0] > 0 && pair[1] > 0 ? pair[0] / pair[1] : null
    }
    const pickClosestRatio = (target) => {
      const options = ['21:9', '16:9', '3:2', '4:3', '1:1', '3:4', '2:3', '9:16']
      let best = '1:1'
      let bestDiff = Number.POSITIVE_INFINITY
      for (const ratioText of options) {
        const ratio = parseRatio(ratioText)
        if (!ratio) continue
        const diff = Math.abs(ratio - target)
        if (diff < bestDiff) {
          bestDiff = diff
          best = ratioText
        }
      }
      return best
    }
    const mapQuality = (value) => {
      if (value === '4K' || value === 'high') return 'high'
      return 'basic'
    }
    const smartRatioHint = typeof params.__firstImageRatio === 'number' && Number.isFinite(params.__firstImageRatio) && params.__firstImageRatio > 0
      ? params.__firstImageRatio
      : null
    const uploadedImages = Array.isArray(params.uploadedFilePaths) ? params.uploadedFilePaths.filter((item) => typeof item === 'string' && item.trim().length > 0) : []
    const images = uploadedImages.length > 0 ? uploadedImages : (Array.isArray(params.images) ? params.images : [])
    const prompt = typeof params.prompt === 'string' ? params.prompt : ''
    const rawAspect = params.kieSeedreamAspectRatio || params.aspect_ratio
    const quality = params.kieSeedreamQuality || params.quality
    const modelName = images.length === 0 ? 'seedream/4.5-text-to-image' : 'seedream/4.5-edit'
    const input = { prompt }
    const aspectText = typeof rawAspect === 'string' ? rawAspect : ''
    const isSmart = !aspectText || aspectText === 'smart' || aspectText === 'auto'
    input.aspect_ratio = isSmart
      ? (smartRatioHint ? pickClosestRatio(smartRatioHint) : '1:1')
      : aspectText
    if (quality) {
      input.quality = mapQuality(String(quality))
    }
    if (images.length > 0) {
      input.image_urls = images
    }
    return { model: modelName, input }
  }`,
}

function walk(dir, files = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(full, files)
      continue
    }
    if (entry.isFile() && entry.name.endsWith('.model.ts')) {
      files.push(full)
    }
  }
  return files
}

function matchFirst(text, pattern) {
  const match = text.match(pattern)
  return match ? match[1] : undefined
}

function findKeyColonIndex(text, key, fromIndex = 0) {
  const regex = new RegExp(`\\b${key}\\s*:`, 'g')
  regex.lastIndex = fromIndex
  const match = regex.exec(text)
  return match ? match.index + match[0].length : -1
}

function extractObjectLiteral(text, key) {
  const colonIndex = findKeyColonIndex(text, key)
  if (colonIndex < 0) return undefined

  const openIndex = text.indexOf('{', colonIndex)
  if (openIndex < 0) return undefined

  let depth = 0
  let inSingle = false
  let inDouble = false
  let inTemplate = false
  let escaped = false
  let inLineComment = false
  let inBlockComment = false

  for (let i = openIndex; i < text.length; i += 1) {
    const ch = text[i]
    const next = text[i + 1]

    if (inLineComment) {
      if (ch === '\n') inLineComment = false
      continue
    }
    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false
        i += 1
      }
      continue
    }

    if (!inSingle && !inDouble && !inTemplate && ch === '/' && next === '/') {
      inLineComment = true
      i += 1
      continue
    }
    if (!inSingle && !inDouble && !inTemplate && ch === '/' && next === '*') {
      inBlockComment = true
      i += 1
      continue
    }

    if (escaped) {
      escaped = false
      continue
    }
    if (ch === '\\') {
      escaped = true
      continue
    }

    if (!inDouble && !inTemplate && ch === '\'') {
      inSingle = !inSingle
      continue
    }
    if (!inSingle && !inTemplate && ch === '"') {
      inDouble = !inDouble
      continue
    }
    if (!inSingle && !inDouble && ch === '`') {
      inTemplate = !inTemplate
      continue
    }

    if (inSingle || inDouble || inTemplate) {
      continue
    }

    if (ch === '{') {
      depth += 1
      continue
    }
    if (ch === '}') {
      depth -= 1
      if (depth === 0) {
        return text.slice(openIndex + 1, i)
      }
    }
  }

  return undefined
}

function extractValueExpression(text, key) {
  const colonIndex = findKeyColonIndex(text, key)
  if (colonIndex < 0) return undefined

  let start = colonIndex
  while (start < text.length && /\s/.test(text[start])) {
    start += 1
  }

  let depthBrace = 0
  let depthParen = 0
  let depthBracket = 0
  let inSingle = false
  let inDouble = false
  let inTemplate = false
  let escaped = false
  let inLineComment = false
  let inBlockComment = false

  for (let i = start; i < text.length; i += 1) {
    const ch = text[i]
    const next = text[i + 1]

    if (inLineComment) {
      if (ch === '\n') inLineComment = false
      continue
    }
    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false
        i += 1
      }
      continue
    }

    if (!inSingle && !inDouble && !inTemplate && ch === '/' && next === '/') {
      inLineComment = true
      i += 1
      continue
    }
    if (!inSingle && !inDouble && !inTemplate && ch === '/' && next === '*') {
      inBlockComment = true
      i += 1
      continue
    }

    if (escaped) {
      escaped = false
      continue
    }
    if (ch === '\\') {
      escaped = true
      continue
    }

    if (!inDouble && !inTemplate && ch === '\'') {
      inSingle = !inSingle
      continue
    }
    if (!inSingle && !inTemplate && ch === '"') {
      inDouble = !inDouble
      continue
    }
    if (!inSingle && !inDouble && ch === '`') {
      inTemplate = !inTemplate
      continue
    }

    if (inSingle || inDouble || inTemplate) {
      continue
    }

    if (ch === '{') depthBrace += 1
    else if (ch === '}') depthBrace -= 1
    else if (ch === '(') depthParen += 1
    else if (ch === ')') depthParen -= 1
    else if (ch === '[') depthBracket += 1
    else if (ch === ']') depthBracket -= 1

    if (depthBrace === 0 && depthParen === 0 && depthBracket === 0 && ch === ',') {
      return text.slice(start, i).trim()
    }
  }

  return text.slice(start).trim()
}

function parseConstStringMap(text) {
  const map = {}
  const regex = /const\s+([A-Za-z0-9_]+)\s*=\s*['"]([^'"]+)['"]/g
  for (const match of text.matchAll(regex)) {
    map[match[1]] = match[2]
  }
  return map
}

function parsePolling(metaBlock) {
  const pollingBlock = matchFirst(metaBlock, /polling\s*:\s*\{([\s\S]*?)\}/)
  if (!pollingBlock) return undefined

  const intervalRaw = matchFirst(pollingBlock, /interval\s*:\s*(\d+)/)
  const maxAttemptsRaw = matchFirst(pollingBlock, /maxAttempts\s*:\s*(\d+)/)
  if (!intervalRaw || !maxAttemptsRaw) return undefined

  const expectedAttemptsRaw = matchFirst(pollingBlock, /expectedAttempts\s*:\s*(\d+)/)

  const result = {
    interval: Number(intervalRaw),
    maxAttempts: Number(maxAttemptsRaw),
  }
  if (expectedAttemptsRaw) {
    result.expectedAttempts = Number(expectedAttemptsRaw)
  }
  return result
}

function parseProgressConfig(metaBlock) {
  const progressExpr = extractValueExpression(metaBlock, 'progress')
  const progress = evaluateStaticExpression(progressExpr)
  return progress && typeof progress === 'object'
    ? progress
    : undefined
}

function parseProgressLearning(metaBlock) {
  const progressLearningExpr = extractValueExpression(metaBlock, 'progressLearning')
  const progressLearning = evaluateStaticExpression(progressLearningExpr)
  return progressLearning && typeof progressLearning === 'object'
    ? progressLearning
    : undefined
}

function parseStringLiteral(expr) {
  const trimmed = (expr || '').trim()
  const match = trimmed.match(/^['"]([^'"]+)['"]$/)
  return match ? match[1] : undefined
}

function parseAliases(metaBlock) {
  const aliasesExpr = extractValueExpression(metaBlock, 'aliases')
  if (!aliasesExpr) return undefined

  const aliases = evaluateStaticExpression(aliasesExpr)
  if (!Array.isArray(aliases)) return undefined

  const normalized = aliases.filter((alias) => typeof alias === 'string' && alias.trim().length > 0)
  return normalized.length > 0 ? normalized : undefined
}

function parseAliasParamDefaults(metaBlock) {
  const defaultsExpr = extractValueExpression(metaBlock, 'aliasParamDefaults')
  const defaults = evaluateStaticExpression(defaultsExpr)
  return defaults && typeof defaults === 'object' && !Array.isArray(defaults)
    ? defaults
    : undefined
}

function parseAliasParamMappings(metaBlock) {
  const mappingsExpr = extractValueExpression(metaBlock, 'aliasParamMappings')
  const mappings = evaluateStaticExpression(mappingsExpr)
  return mappings && typeof mappings === 'object' && !Array.isArray(mappings)
    ? mappings
    : undefined
}

function parseNamedRoutes(endpointBlock) {
  const routesBlock = extractObjectLiteral(endpointBlock, 'routes')
  if (!routesBlock) return undefined

  const routes = {}
  const entryRegex = /['"]?([A-Za-z0-9_-]+)['"]?\s*:\s*\{([^{}]*)\}/g
  for (const match of routesBlock.matchAll(entryRegex)) {
    const name = match[1]
    const body = match[2]
    const pathValue = matchFirst(body, /path\s*:\s*['"]([^'"]+)['"]/)
    if (!pathValue) {
      continue
    }
    const methodValue = matchFirst(body, /method\s*:\s*['"]([^'"]+)['"]/)
    routes[name] = methodValue
      ? { path: pathValue, method: methodValue }
      : { path: pathValue }
  }

  return Object.keys(routes).length > 0 ? routes : undefined
}

function firstStringLiteral(text) {
  const match = (text || '').match(/['"]([^'"]+)['"]/)
  return match ? match[1] : undefined
}

function compileFunctionExpression(expr) {
  if (!expr) return undefined

  let normalized = expr.trim()
  if (normalized.startsWith('async ')) {
    normalized = normalized.replace(/^async\s+/, '')
  }

  const wrapped = `const __fn = ${normalized};`
  const result = ts.transpileModule(wrapped, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2018,
      module: ts.ModuleKind.None,
      removeComments: false,
    },
  })

  const output = result.outputText
  const marker = 'const __fn = '
  const markerIndex = output.indexOf(marker)
  if (markerIndex < 0) {
    return normalized
  }

  let functionCode = output.slice(markerIndex + marker.length).trim()
  if (functionCode.endsWith(';')) {
    functionCode = functionCode.slice(0, -1)
  }
  return functionCode.trim()
}

function evaluateStaticExpression(expr) {
  if (!expr) return undefined

  const wrapped = `const __value = ${expr};`
  const result = ts.transpileModule(wrapped, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2018,
      module: ts.ModuleKind.CommonJS,
      removeComments: false,
    },
  })

  const sandbox = {
    module: { exports: undefined },
    exports: {},
  }

  try {
    vm.runInNewContext(`${result.outputText}\nmodule.exports = __value;`, sandbox, {
      timeout: 1000,
    })
    return sandbox.module.exports
  } catch {
    return undefined
  }
}

function parseEndpointConfig(modelText, constMap) {
  const endpointExpr = extractValueExpression(modelText, 'endpoints')
  if (!endpointExpr) return undefined

  const literal = parseStringLiteral(endpointExpr)
  if (literal) {
    return { defaultRoute: literal }
  }

  if (KNOWN_ENDPOINT_CONSTANTS[endpointExpr]) {
    return { defaultRoute: KNOWN_ENDPOINT_CONSTANTS[endpointExpr] }
  }
  if (constMap[endpointExpr]) {
    return { defaultRoute: constMap[endpointExpr] }
  }

  const endpointBlock = extractObjectLiteral(modelText, 'endpoints')
  if (!endpointBlock) return undefined

  const selectorExpr = extractValueExpression(endpointBlock, 'selector')
  const selectorJs = selectorExpr ? compileFunctionExpression(selectorExpr) : undefined
  const defaultRoute =
    matchFirst(endpointBlock, /default(?:Route)?\s*:\s*['"]([^'"]+)['"]/) ||
    matchFirst(endpointBlock, /path\s*:\s*['"]([^'"]+)['"]/) ||
    firstStringLiteral(selectorExpr)

  if (!defaultRoute && !selectorJs) {
    return undefined
  }

  return {
    defaultRoute: defaultRoute || '',
    selectorJs,
    routes: parseNamedRoutes(endpointBlock),
  }
}

function parseRequestConfig(modelText, modelId) {
  const requestBlock = extractObjectLiteral(modelText, 'request')
  if (!requestBlock) return undefined

  const override = CUSTOM_BUILDER_OVERRIDES[modelId]
  if (override) {
    const compiled = compileFunctionExpression(override)
    return compiled ? { builderJs: compiled } : undefined
  }

  const builderExpr = extractValueExpression(requestBlock, 'builder')
  const builderJs = compileFunctionExpression(builderExpr)
  if (!builderJs) return undefined

  return { builderJs }
}

function parseRuntimeConstraints(modelText) {
  const runtimeConstraintsExpr = extractValueExpression(modelText, 'runtimeConstraints')
  const runtimeConstraints = evaluateStaticExpression(runtimeConstraintsExpr)
  return runtimeConstraints && typeof runtimeConstraints === 'object'
    ? runtimeConstraints
    : undefined
}

function parseModel(filePath) {
  const text = fs.readFileSync(filePath, 'utf8')
  const metaBlock = extractObjectLiteral(text, 'meta')
  if (!metaBlock) return null

  const modelId = matchFirst(metaBlock, /id\s*:\s*['"]([^'"]+)['"]/)
  const providerId = matchFirst(metaBlock, /provider\s*:\s*['"]([^'"]+)['"]/)
  const modelType = matchFirst(metaBlock, /type\s*:\s*['"]([^'"]+)['"]/)

  if (!modelId || !providerId) return null

  const constMap = parseConstStringMap(text)
  const polling = parsePolling(metaBlock)
  const aliases = parseAliases(metaBlock)
  const aliasParamDefaults = parseAliasParamDefaults(metaBlock)
  const aliasParamMappings = parseAliasParamMappings(metaBlock)
  const progress = parseProgressConfig(metaBlock)
  const progressLearning = parseProgressLearning(metaBlock)
  const endpoints = parseEndpointConfig(text, constMap)
  const request = parseRequestConfig(text, modelId)
  const runtimeConstraints = parseRuntimeConstraints(text)

  return {
    modelId,
    aliases,
    aliasParamDefaults,
    aliasParamMappings,
    providerId,
    modelType,
    polling,
    progress,
    progressLearning,
    endpoints,
    request,
    runtimeConstraints,
  }
}

function main() {
  const files = walk(MODELS_DIR)
  const models = files
    .map(parseModel)
    .filter(Boolean)
    .sort((a, b) => a.modelId.localeCompare(b.modelId))

  const payload = { models }
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true })
  fs.writeFileSync(OUTPUT, JSON.stringify(payload, null, 2), 'utf8')

  console.log(`[model-manifest] generated ${models.length} models -> ${OUTPUT}`)
}

main()
