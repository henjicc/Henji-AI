import vm from 'node:vm'
import { AiRuntimeError } from './errors'
import type { JsonObject, JsonValue } from './types'

const JS_PRELUDE = `
const console = { log() {}, warn() {}, error() {} };
function parseImageSize(sizeParam) {
  if (!sizeParam) return "landscape_4_3";
  if (typeof sizeParam === "string" && sizeParam.includes("*")) {
    const pair = sizeParam.split("*").map(function (item) { return Number(item); });
    return { width: pair[0], height: pair[1] };
  }
  return sizeParam;
}
function calculateQwenResolution(widthRatio, heightRatio) {
  const MIN_SIZE = 64, MAX_SIZE = 2048, STEP = 8;
  if (widthRatio === heightRatio) return { width: MAX_SIZE, height: MAX_SIZE };
  const ratio = widthRatio / heightRatio;
  let width, height;
  if (ratio > 1) {
    width = MAX_SIZE; height = width / ratio;
    if (height < MIN_SIZE) { height = MIN_SIZE; width = height * ratio; }
  } else {
    height = MAX_SIZE; width = height * ratio;
    if (width < MIN_SIZE) { width = MIN_SIZE; height = width / ratio; }
  }
  return {
    width: Math.max(MIN_SIZE, Math.min(MAX_SIZE, Math.floor(width / STEP) * STEP)),
    height: Math.max(MIN_SIZE, Math.min(MAX_SIZE, Math.floor(height / STEP) * STEP))
  };
}
function normalizeBaseSize(baseSize, min, max, step) {
  const actualMin = min === undefined ? 512 : min;
  const actualMax = max === undefined ? 2048 : max;
  const actualStep = step === undefined ? 8 : step;
  let normalized = Math.max(actualMin, Math.min(actualMax, baseSize));
  normalized = Math.round(normalized / actualStep) * actualStep;
  return normalized;
}
function calculateResolution(baseSize, widthRatio, heightRatio) {
  if (widthRatio === heightRatio) return { width: baseSize, height: baseSize };
  const maxPixels = baseSize * baseSize;
  const ratio = widthRatio / heightRatio;
  const height = Math.sqrt(maxPixels / ratio);
  const width = height * ratio;
  return { width: Math.floor(width / 8) * 8, height: Math.floor(height / 8) * 8 };
}
function calculateResolutionWithBounds(baseSize, widthRatio, heightRatio, minSize, maxSize) {
  const actualMin = minSize === undefined ? 64 : minSize;
  const actualMax = maxSize === undefined ? 2048 : maxSize;
  const base = calculateResolution(baseSize, widthRatio, heightRatio);
  let width = base.width, height = base.height;
  const maxDimension = Math.max(width, height);
  const minDimension = Math.min(width, height);
  if (maxDimension > actualMax) {
    const scale = actualMax / maxDimension;
    width = Math.floor((width * scale) / 16) * 16;
    height = Math.floor((height * scale) / 16) * 16;
  }
  if (minDimension < actualMin) {
    const scale = actualMin / minDimension;
    width = Math.floor((width * scale) / 16) * 16;
    height = Math.floor((height * scale) / 16) * 16;
  }
  width = Math.floor(Math.max(actualMin, Math.min(actualMax, width)) / 16) * 16;
  height = Math.floor(Math.max(actualMin, Math.min(actualMax, height)) / 16) * 16;
  return { width, height };
}
function resolveModelscopeSize(modelId, imageSize, baseSize) {
  if (!imageSize) return undefined;
  if (typeof imageSize === "string" && imageSize.includes("x")) return imageSize;
  let ratio = imageSize === "smart" || imageSize === "auto" || imageSize === "自定义" ? "1:1" : imageSize;
  if (typeof ratio !== "string" || !ratio.includes(":")) return undefined;
  const pair = ratio.split(":").map(Number);
  const w = pair[0], h = pair[1];
  if (!w || !h) return undefined;
  if (modelId === "Qwen/Qwen-Image-Edit-2509") {
    const size = calculateQwenResolution(w, h);
    return size.width + "x" + size.height;
  }
  const normalizedBase = normalizeBaseSize(Number(baseSize || 1024), 512, 2048, 8);
  const size = calculateResolutionWithBounds(normalizedBase, w, h, 64, 2048);
  return size.width + "x" + size.height;
}
function buildModelscopeRequest(params, options) {
  const prompt = typeof params.prompt === "string" ? params.prompt : "";
  const request = { model: options.modelId, prompt };
  const sizeParam = typeof params.size === "string" ? params.size : undefined;
  const imageSizeParam = typeof params.modelscopeImageSize === "string"
    ? params.modelscopeImageSize
    : (typeof params.image_size === "string" ? params.image_size : (typeof params.aspect_ratio === "string" ? params.aspect_ratio : undefined));
  const baseSizeParam = typeof params.resolutionBaseSize === "number"
    ? params.resolutionBaseSize
    : (typeof options.baseSize === "number" ? options.baseSize : undefined);
  const sizeValue = sizeParam || resolveModelscopeSize(options.modelId, imageSizeParam, baseSizeParam);
  if (sizeValue) request.size = sizeValue;
  const steps = params.modelscopeSteps !== undefined ? params.modelscopeSteps : params.steps;
  if (steps !== undefined) request.steps = steps;
  if (options.allowNegativePrompt !== false && typeof params.modelscopeNegativePrompt === "string") request.negative_prompt = params.modelscopeNegativePrompt;
  if (options.allowGuidance !== false && params.modelscopeGuidance !== undefined) request.guidance = params.modelscopeGuidance;
  if (params.seed !== undefined) request.seed = params.seed;
  if (options.allowImage) {
    let images = [];
    if (Array.isArray(params.image_url)) images = params.image_url;
    else if (Array.isArray(params.images)) images = params.images;
    if (images.length > 0) request.image_url = images;
  }
  return request;
}
function filterMediaSources(values) {
  if (!Array.isArray(values)) return [];
  return values.filter(function (item) { return typeof item === "string" && item.trim().length > 0; });
}
function resolvePpioImageSources(params) {
  const preferred = filterMediaSources(params.uploadedFilePaths);
  return preferred.length > 0 ? preferred : filterMediaSources(params.images);
}
function resolvePpioVideoSources(params) {
  const preferred = filterMediaSources(params.uploadedVideoFilePaths);
  return preferred.length > 0 ? preferred : filterMediaSources(params.videos);
}
function resolvePpioPrimaryVideoSource(params) {
  const preferred = resolvePpioVideoSources(params);
  if (preferred.length > 0) return preferred[0];
  return typeof params.video === "string" && params.video.trim().length > 0 ? params.video : undefined;
}
function resolveKieImageSources(params) { const preferred = filterMediaSources(params.uploadedFilePaths); return preferred.length > 0 ? preferred : filterMediaSources(params.images); }
function resolveKieVideoSources(params) { const preferred = filterMediaSources(params.uploadedVideoFilePaths); return preferred.length > 0 ? preferred : filterMediaSources(params.videos); }
function resolveKiePrimaryVideoSource(params) {
  const preferred = resolveKieVideoSources(params);
  if (preferred.length > 0) return preferred[0];
  return typeof params.video === "string" && params.video.trim().length > 0 ? params.video : undefined;
}
function resolveUploadedImageSources(params) { return resolvePpioImageSources(params); }
function resolveUploadedMediaSources(values) { return filterMediaSources(values); }
function resolveBoolean(value, fallbackValue) { return typeof value === "boolean" ? value : fallbackValue; }
function resolveDuration(value) { return value === 10 ? 10 : 5; }
const DEFAULT_WAN25_SIZE = "1280*720";
const DEFAULT_WAN25_RESOLUTION = "720P";
const SUPPORTED_WAN25_SIZES = ["832*480","480*832","624*624","1280*720","720*1280","960*960","1088*832","832*1088","1920*1080","1080*1920","1440*1440","1632*1248","1248*1632"];
const SUPPORTED_WAN25_RESOLUTIONS = ["480P", "720P", "1080P"];
function resolveSupportedValue(preferred, legacy, supportedValues, fallbackValue) {
  const allowedValues = Array.isArray(supportedValues) ? supportedValues : [];
  if (typeof preferred === "string" && allowedValues.includes(preferred)) return preferred;
  if (typeof legacy === "string" && allowedValues.includes(legacy)) return legacy;
  return fallbackValue;
}
`

export function evalFunction(functionSource: string, params: JsonObject): JsonValue {
  try {
    const context = vm.createContext({})
    const script = new vm.Script(`
      ${JS_PRELUDE}
      const __henjiFn = eval("(" + ${JSON.stringify(functionSource)} + ")");
      const __henjiParams = JSON.parse(${JSON.stringify(JSON.stringify(params))});
      const __henjiResult = __henjiFn(__henjiParams);
      JSON.stringify(__henjiResult === undefined ? null : __henjiResult);
    `)
    const output = script.runInContext(context, { timeout: 1000 })
    return JSON.parse(String(output)) as JsonValue
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new AiRuntimeError('js_eval_failed', message)
  }
}
