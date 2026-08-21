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
  'ppio-seedream-4.0': `(params) => {
    const clamp = (value, min, max) => Math.min(max, Math.max(min, value))
    const parseRatio = (raw) => {
      const pair = String(raw || '').split(':').map(Number)
      return pair[0] > 0 && pair[1] > 0 ? pair[0] / pair[1] : null
    }
    const normalizeSize = (ratio, targetPixels) => {
      const normalizedRatio = clamp(ratio, 1 / 16, 16)
      const normalizedPixels = clamp(targetPixels, 1048576, 16777216)
      let h = Math.sqrt(normalizedPixels / normalizedRatio)
      let w = h * normalizedRatio
      let width = Math.max(1, Math.round(w))
      let height = Math.max(1, Math.round(h))
      let pixels = width * height
      if (pixels < 1048576) {
        const scale = Math.sqrt(1048576 / Math.max(1, pixels))
        width = Math.max(1, Math.round(width * scale))
        height = Math.max(1, Math.round(height * scale))
        pixels = width * height
      }
      if (pixels > 16777216) {
        const scale = Math.sqrt(16777216 / pixels)
        width = Math.max(1, Math.round(width * scale))
        height = Math.max(1, Math.round(height * scale))
      }
      while (width * height > 16777216) {
        if (width >= height && width > 15) {
          width -= 1
        } else if (height > 15) {
          height -= 1
        } else {
          break
        }
      }
      return { width, height }
    }
    const smartRatioHint = typeof params.__firstImageRatio === 'number' && Number.isFinite(params.__firstImageRatio) && params.__firstImageRatio > 0
      ? params.__firstImageRatio
      : 1
    const maxImages = params.maxImages || params.max_images || 1
    const prompt = typeof params.prompt === 'string' ? params.prompt : ''
    const finalPrompt = maxImages > 1 ? ('生成' + maxImages + '张图片。' + prompt) : prompt
    const requestData = { prompt: finalPrompt, watermark: false }
    const requestImages = resolvePpioImageSources(params)
    const legacyResolution = params.resolution && typeof params.resolution === 'object' ? params.resolution : null
    const aspectRatio = legacyResolution && typeof legacyResolution.aspectRatio === 'string'
      ? legacyResolution.aspectRatio
      : String(params.ppioSeedream40AspectRatio || 'smart')
    const quality = (legacyResolution && legacyResolution.quality === '4K') || params.ppioSeedream40Resolution === '4K' ? '4K' : '2K'
    const isSmart = aspectRatio === 'smart' || aspectRatio === 'auto' || !aspectRatio
    if (legacyResolution && legacyResolution.width && legacyResolution.height) {
      const size = normalizeSize(Number(legacyResolution.width) / Number(legacyResolution.height), Number(legacyResolution.width) * Number(legacyResolution.height))
      requestData.size = size.width + 'x' + size.height
    } else if (params.size && params.ppioSeedream40AspectRatio === undefined && params.ppioSeedream40Resolution === undefined) {
      requestData.size = params.size
    } else {
      const target = quality === '4K' ? 16777216 : 4194304
      const ratio = isSmart ? smartRatioHint : (parseRatio(aspectRatio) || 1)
      const size = normalizeSize(ratio, target)
      requestData.size = size.width + 'x' + size.height
    }
    if (requestImages.length > 0) {
      requestData.images = requestImages
    }
    if (maxImages > 1) {
      requestData.sequential_image_generation = 'auto'
      requestData.max_images = maxImages
    } else {
      requestData.sequential_image_generation = 'disabled'
    }
    return requestData
  }`,
  'ppio-seedream-4.5': `(params) => {
    const clamp = (value, min, max) => Math.min(max, Math.max(min, value))
    const parseRatio = (raw) => {
      const pair = String(raw || '').split(':').map(Number)
      return pair[0] > 0 && pair[1] > 0 ? pair[0] / pair[1] : null
    }
    const normalizeSize = (ratio, targetPixels) => {
      const normalizedRatio = clamp(ratio, 1 / 16, 16)
      const normalizedPixels = clamp(targetPixels, 3686400, 16777216)
      let h = Math.sqrt(normalizedPixels / normalizedRatio)
      let w = h * normalizedRatio
      let width = Math.max(1, Math.round(w))
      let height = Math.max(1, Math.round(h))
      let pixels = width * height
      if (pixels < 3686400) {
        const scale = Math.sqrt(3686400 / Math.max(1, pixels))
        width = Math.max(1, Math.round(width * scale))
        height = Math.max(1, Math.round(height * scale))
        pixels = width * height
      }
      if (pixels > 16777216) {
        const scale = Math.sqrt(16777216 / pixels)
        width = Math.max(1, Math.round(width * scale))
        height = Math.max(1, Math.round(height * scale))
      }
      while (width * height > 16777216) {
        if (width >= height && width > 15) {
          width -= 1
        } else if (height > 15) {
          height -= 1
        } else {
          break
        }
      }
      return { width, height }
    }
    const smartRatioHint = typeof params.__firstImageRatio === 'number' && Number.isFinite(params.__firstImageRatio) && params.__firstImageRatio > 0
      ? params.__firstImageRatio
      : 1
    const maxImages = params.maxImages || params.max_images || 1
    const prompt = typeof params.prompt === 'string' ? params.prompt : ''
    const finalPrompt = maxImages > 1 ? ('生成' + maxImages + '张图片。' + prompt) : prompt
    const requestData = { prompt: finalPrompt, watermark: false }
    const requestImages = resolvePpioImageSources(params)
    const legacyResolution = params.resolution && typeof params.resolution === 'object' ? params.resolution : null
    const aspectRatio = legacyResolution && typeof legacyResolution.aspectRatio === 'string'
      ? legacyResolution.aspectRatio
      : String(params.ppioSeedream45AspectRatio || 'smart')
    const quality = (legacyResolution && legacyResolution.quality === '4K') || params.ppioSeedream45Resolution === '4K' ? '4K' : '2K'
    const isSmart = aspectRatio === 'smart' || aspectRatio === 'auto' || !aspectRatio
    if (legacyResolution && legacyResolution.width && legacyResolution.height) {
      const size = normalizeSize(Number(legacyResolution.width) / Number(legacyResolution.height), Number(legacyResolution.width) * Number(legacyResolution.height))
      requestData.size = size.width + 'x' + size.height
    } else if (params.size && params.ppioSeedream45AspectRatio === undefined && params.ppioSeedream45Resolution === undefined) {
      requestData.size = params.size
    } else {
      const target = quality === '4K' ? 16777216 : 4194304
      const ratio = isSmart ? smartRatioHint : (parseRatio(aspectRatio) || 1)
      const size = normalizeSize(ratio, target)
      requestData.size = size.width + 'x' + size.height
    }
    if (requestImages.length > 0) {
      requestData.image = requestImages
    }
    if (maxImages > 1) {
      requestData.sequential_image_generation = 'auto'
      requestData.sequential_image_generation_options = { max_images: maxImages }
    } else {
      requestData.sequential_image_generation = 'disabled'
    }
    if (params.optimizePrompt === true) {
      requestData.optimize_prompt_options = { mode: 'standard' }
    }
    return requestData
  }`,
  'ppio-seedream-5.0-lite': `(params) => {
    const clamp = (value, min, max) => Math.min(max, Math.max(min, value))
    const normalizeSide = (value, min, max) => {
      const numeric = Number(value)
      if (!Number.isFinite(numeric) || numeric <= 0) return min
      return clamp(Math.round(numeric), min, max)
    }
    const parseRatio = (raw) => {
      const pair = String(raw || '').split(':').map(Number)
      return pair[0] > 0 && pair[1] > 0 ? pair[0] / pair[1] : null
    }
    const scaleSize = (width, height, scale) => ({
      width: Math.max(1, Math.round(width * scale)),
      height: Math.max(1, Math.round(height * scale))
    })
    const enforceMaxPixels = (width, height, minSide, maxPixels) => {
      let nextWidth = width
      let nextHeight = height
      while (nextWidth * nextHeight > maxPixels) {
        if (nextWidth >= nextHeight && nextWidth > minSide) {
          nextWidth -= 1
          continue
        }
        if (nextHeight > minSide) {
          nextHeight -= 1
          continue
        }
        if (nextWidth > 1) {
          nextWidth -= 1
          continue
        }
        if (nextHeight > 1) {
          nextHeight -= 1
          continue
        }
        break
      }
      return { width: nextWidth, height: nextHeight }
    }
    const normalizeRatioSize = (ratio, targetPixels) => {
      const minPixels = 3686400
      const maxPixels = 10404496
      const minSide = 256
      const maxSide = 12900
      const normalizedRatio = clamp(ratio, 1 / 16, 16)
      const normalizedPixels = clamp(targetPixels, minPixels, maxPixels)
      let h = Math.sqrt(normalizedPixels / normalizedRatio)
      let w = h * normalizedRatio
      let width = normalizeSide(w, minSide, maxSide)
      let height = normalizeSide(h, minSide, maxSide)
      let pixels = width * height
      if (pixels > maxPixels) {
        const scaled = scaleSize(width, height, Math.sqrt(maxPixels / pixels))
        width = normalizeSide(scaled.width, minSide, maxSide)
        height = normalizeSide(scaled.height, minSide, maxSide)
        pixels = width * height
      }
      if (pixels < minPixels) {
        const scaled = scaleSize(width, height, Math.sqrt(minPixels / Math.max(1, pixels)))
        width = normalizeSide(scaled.width, minSide, maxSide)
        height = normalizeSide(scaled.height, minSide, maxSide)
        pixels = width * height
      }
      if (pixels > maxPixels) {
        const scaled = scaleSize(width, height, Math.sqrt(maxPixels / pixels))
        width = normalizeSide(scaled.width, minSide, maxSide)
        height = normalizeSide(scaled.height, minSide, maxSide)
      }
      return enforceMaxPixels(width, height, minSide, maxPixels)
    }
    const normalizeCustomSize = (width, height) => {
      const minSide = 256
      const maxSide = 12900
      const minAspectRatio = 1 / 16
      const maxAspectRatio = 16
      const maxPixels = 10404496
      let nextWidth = normalizeSide(width, minSide, maxSide)
      let nextHeight = normalizeSide(height, minSide, maxSide)
      const ratio = nextWidth / Math.max(1, nextHeight)
      if (ratio < minAspectRatio) {
        nextHeight = Math.max(1, Math.floor(nextWidth / minAspectRatio))
      } else if (ratio > maxAspectRatio) {
        nextWidth = Math.max(1, Math.floor(nextHeight * maxAspectRatio))
      }
      nextWidth = normalizeSide(nextWidth, minSide, maxSide)
      nextHeight = normalizeSide(nextHeight, minSide, maxSide)
      const pixels = nextWidth * nextHeight
      if (pixels <= maxPixels) {
        return { width: nextWidth, height: nextHeight }
      }
      const scaled = scaleSize(nextWidth, nextHeight, Math.sqrt(maxPixels / pixels))
      return enforceMaxPixels(
        normalizeSide(scaled.width, minSide, maxSide),
        normalizeSide(scaled.height, minSide, maxSide),
        minSide,
        maxPixels
      )
    }
    const parseSizeString = (raw) => {
      const match = String(raw || '').trim().match(/^(\\d+)\\s*[xX*]\\s*(\\d+)$/)
      if (!match) return null
      const width = Number(match[1])
      const height = Number(match[2])
      if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        return null
      }
      return { width, height }
    }
    const requestImages = resolvePpioImageSources(params)
    const rawMaxImages = Number.isFinite(Number(params.maxImages))
      ? Math.trunc(Number(params.maxImages))
      : (Number.isFinite(Number(params.max_images)) ? Math.trunc(Number(params.max_images)) : 1)
    const maxGeneratedImages = clamp(rawMaxImages, 1, Math.max(1, 15 - requestImages.length))
    const legacyResolution = params.resolution && typeof params.resolution === 'object' ? params.resolution : null
    const smartRatioHint = typeof params.__firstImageRatio === 'number' && Number.isFinite(params.__firstImageRatio) && params.__firstImageRatio > 0
      ? params.__firstImageRatio
      : 1
    let sizeText = '2048x2048'
    const aspectRatio = legacyResolution && typeof legacyResolution.aspectRatio === 'string'
      ? legacyResolution.aspectRatio
      : String(params.ppioSeedream50LiteAspectRatio || 'smart')
    const quality = (legacyResolution && legacyResolution.quality === '4K') || params.ppioSeedream50LiteResolution === '4K' ? '4K' : '2K'
    const isSmart = aspectRatio === 'smart' || aspectRatio === 'auto' || !aspectRatio
    if (legacyResolution && !isSmart && legacyResolution.width && legacyResolution.height) {
      const size = normalizeCustomSize(legacyResolution.width, legacyResolution.height)
      sizeText = size.width + 'x' + size.height
    } else if (params.size && params.ppioSeedream50LiteAspectRatio === undefined && params.ppioSeedream50LiteResolution === undefined) {
      const parsed = parseSizeString(params.size)
      if (parsed) {
        const size = normalizeCustomSize(parsed.width, parsed.height)
        sizeText = size.width + 'x' + size.height
      }
    } else {
      const target = quality === '4K' ? 10404496 : 4194304
      const ratio = isSmart ? smartRatioHint : (parseRatio(aspectRatio) || 1)
      const size = normalizeRatioSize(ratio, target)
      sizeText = size.width + 'x' + size.height
    }
    const requestData = {
      prompt: typeof params.prompt === 'string' ? params.prompt : '',
      size: sizeText,
      watermark: false,
      sequential_image_generation: maxGeneratedImages > 1 ? 'auto' : 'disabled'
    }
    if (requestImages.length > 0) {
      requestData.image = requestImages
    }
    if (maxGeneratedImages > 1) {
      requestData.sequential_image_generation_options = { max_images: maxGeneratedImages }
    }
    if (params.optimizePrompt === true) {
      requestData.optimize_prompt_options = { mode: 'standard' }
    }
    return requestData
  }`,
  'fal-ai-bytedance-seedream-v4': `(params) => {
    const clamp = (value, min, max) => Math.min(max, Math.max(min, value))
    const parseRatio = (raw) => {
      const pair = String(raw || '').split(':').map(Number)
      return pair[0] > 0 && pair[1] > 0 ? pair[0] / pair[1] : null
    }
    const smartRatioHint = typeof params.__firstImageRatio === 'number' && Number.isFinite(params.__firstImageRatio) && params.__firstImageRatio > 0
      ? params.__firstImageRatio
      : 1
    const images = Array.isArray(params.images) ? params.images : []
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
    const images = Array.isArray(params.images) ? params.images : []
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
    const images = Array.isArray(params.images) ? params.images : []
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
    const images = Array.isArray(params.images) ? params.images : []
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
  const progress = parseProgressConfig(metaBlock)
  const progressLearning = parseProgressLearning(metaBlock)
  const endpoints = parseEndpointConfig(text, constMap)
  const request = parseRequestConfig(text, modelId)
  const runtimeConstraints = parseRuntimeConstraints(text)

  return {
    modelId,
    aliases,
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
