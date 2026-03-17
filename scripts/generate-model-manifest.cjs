const fs = require('fs')
const path = require('path')
const ts = require('typescript')

const ROOT = process.cwd()
const MODELS_DIR = path.join(ROOT, 'src', 'models')
const OUTPUT = path.join(ROOT, 'src-tauri', 'resources', 'model-manifest.json')

const KNOWN_ENDPOINT_CONSTANTS = {
  KIE_CREATE_TASK_ENDPOINT: '/api/v1/jobs/createTask',
  MODELSCOPE_CREATE_TASK_ENDPOINT: '/api/v1/jobs/createTask',
}

const CUSTOM_BUILDER_OVERRIDES = {
  'ppio-seedream-4.0': `(params) => { const maxImages = params.maxImages || params.max_images || 1; const prompt = typeof params.prompt === 'string' ? params.prompt : ''; const finalPrompt = maxImages > 1 ? ('生成' + maxImages + '张图片。' + prompt) : prompt; const requestData = { prompt: finalPrompt, watermark: false }; const requestImages = resolvePpioImageSources(params); if (params.resolution) { const resolution = params.resolution; if (resolution.width && resolution.height) { requestData.size = resolution.width + 'x' + resolution.height; } else { const quality = resolution.quality === '4K' ? '4K' : '2K'; const target = quality === '4K' ? 16777216 : 4194304; const ratioText = (resolution.aspectRatio === 'smart' || resolution.aspectRatio === 'auto' || !resolution.aspectRatio) ? '1:1' : String(resolution.aspectRatio); const pair = ratioText.split(':').map(Number); const ratio = pair[0] > 0 && pair[1] > 0 ? pair[0] / pair[1] : 1; let h = Math.sqrt(target / ratio); let w = h * ratio; let width = Math.max(15, Math.round(w)); let height = Math.max(15, Math.round(h)); const maxPixels = 16777216; if (width * height > maxPixels) { const scale = Math.sqrt(maxPixels / (width * height)); width = Math.max(15, Math.round(width * scale)); height = Math.max(15, Math.round(height * scale)); } requestData.size = width + 'x' + height; } } else if (params.size) { requestData.size = params.size; } if (requestImages.length > 0) { requestData.images = requestImages; } if (maxImages > 1) { requestData.sequential_image_generation = 'auto'; requestData.max_images = maxImages; } else { requestData.sequential_image_generation = 'disabled'; } return requestData; }`,
  'ppio-seedream-4.5': `(params) => { const maxImages = params.maxImages || params.max_images || 1; const prompt = typeof params.prompt === 'string' ? params.prompt : ''; const finalPrompt = maxImages > 1 ? ('生成' + maxImages + '张图片。' + prompt) : prompt; const requestData = { prompt: finalPrompt, watermark: false }; const requestImages = resolvePpioImageSources(params); if (params.resolution) { const resolution = params.resolution; if (resolution.width && resolution.height) { requestData.size = resolution.width + 'x' + resolution.height; } else { const quality = resolution.quality === '4K' ? '4K' : '2K'; const target = quality === '4K' ? 16777216 : 4194304; const ratioText = (resolution.aspectRatio === 'smart' || resolution.aspectRatio === 'auto' || !resolution.aspectRatio) ? '1:1' : String(resolution.aspectRatio); const pair = ratioText.split(':').map(Number); const ratio = pair[0] > 0 && pair[1] > 0 ? pair[0] / pair[1] : 1; let h = Math.sqrt(target / ratio); let w = h * ratio; let width = Math.max(1920, Math.round(w)); let height = Math.max(1920, Math.round(h)); const maxPixels = 16777216; if (width * height > maxPixels) { const scale = Math.sqrt(maxPixels / (width * height)); width = Math.max(1920, Math.round(width * scale)); height = Math.max(1920, Math.round(height * scale)); } requestData.size = width + 'x' + height; } } else if (params.size) { requestData.size = params.size; } if (requestImages.length > 0) { requestData.image = requestImages; } if (maxImages > 1) { requestData.sequential_image_generation = 'auto'; requestData.sequential_image_generation_options = { max_images: maxImages }; } else { requestData.sequential_image_generation = 'disabled'; } if (params.optimizePrompt === true) { requestData.optimize_prompt_options = { mode: 'standard' }; } return requestData; }`,
  'fal-ai-bytedance-seedream-v4': `(params) => { const images = Array.isArray(params.images) ? params.images : []; const prompt = typeof params.prompt === 'string' ? params.prompt : ''; const numImages = Number(params.falSeedream40NumImages || 1); const resolution = params.falSeedreamV4Resolution || {}; const ratioText = (resolution.aspectRatio === 'smart' || resolution.aspectRatio === 'auto' || !resolution.aspectRatio) ? '1:1' : String(resolution.aspectRatio); const quality = resolution.quality === '4K' ? '4K' : '2K'; let width = Number(resolution.width || 0); let height = Number(resolution.height || 0); if (!(width > 0 && height > 0)) { const pair = ratioText.split(':').map(Number); const ratio = pair[0] > 0 && pair[1] > 0 ? pair[0] / pair[1] : 1; const target = quality === '4K' ? 16777216 : 4194304; let h = Math.sqrt(target / ratio); let w = h * ratio; width = Math.round(w); height = Math.round(h); } width = Math.max(1024, Math.min(4096, Math.round(width))); height = Math.max(1024, Math.min(4096, Math.round(height))); const pixels = width * height; if (pixels > 16777216) { const scale = Math.sqrt(16777216 / pixels); width = Math.max(1024, Math.min(4096, Math.round(width * scale))); height = Math.max(1024, Math.min(4096, Math.round(height * scale))); } const requestData = { prompt, image_size: { width, height }, num_images: numImages, enable_safety_checker: false }; if (images.length > 0) { requestData.image_urls = images; } return requestData; }`,
  'fal-ai-bytedance-seedream-v4.5': `(params) => { const images = Array.isArray(params.images) ? params.images : []; const prompt = typeof params.prompt === 'string' ? params.prompt : ''; const numImages = Number(params.falSeedream45NumImages || 1); const resolution = params.falSeedreamV45Resolution || {}; const ratioText = (resolution.aspectRatio === 'smart' || resolution.aspectRatio === 'auto' || !resolution.aspectRatio) ? '1:1' : String(resolution.aspectRatio); const quality = resolution.quality === '4K' ? '4K' : '2K'; let width = Number(resolution.width || 0); let height = Number(resolution.height || 0); if (!(width > 0 && height > 0)) { const pair = ratioText.split(':').map(Number); const ratio = pair[0] > 0 && pair[1] > 0 ? pair[0] / pair[1] : 1; const target = quality === '4K' ? 16777216 : 4194304; let h = Math.sqrt(target / ratio); let w = h * ratio; width = Math.round(w); height = Math.round(h); } width = Math.max(1920, Math.min(4096, Math.round(width))); height = Math.max(1920, Math.min(4096, Math.round(height))); let pixels = width * height; if (pixels < 3686400) { const scale = Math.sqrt(3686400 / Math.max(1, pixels)); width = Math.max(1920, Math.min(4096, Math.round(width * scale))); height = Math.max(1920, Math.min(4096, Math.round(height * scale))); pixels = width * height; } if (pixels > 16777216) { const scale = Math.sqrt(16777216 / pixels); width = Math.max(1920, Math.min(4096, Math.round(width * scale))); height = Math.max(1920, Math.min(4096, Math.round(height * scale))); } const requestData = { prompt, image_size: { width, height }, num_images: numImages, enable_safety_checker: false }; if (images.length > 0) { requestData.image_urls = images; } return requestData; }`,
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

  return {
    interval: Number(intervalRaw),
    maxAttempts: Number(maxAttemptsRaw),
  }
}

function parseStringLiteral(expr) {
  const trimmed = (expr || '').trim()
  const match = trimmed.match(/^['"]([^'"]+)['"]$/)
  return match ? match[1] : undefined
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
  const endpoints = parseEndpointConfig(text, constMap)
  const request = parseRequestConfig(text, modelId)

  return {
    modelId,
    providerId,
    modelType,
    polling,
    endpoints,
    request,
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
