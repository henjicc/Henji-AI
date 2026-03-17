use crate::ai_runtime::errors::{AiResult, AiRuntimeError};
use boa_engine::{Context, Source};
use serde_json::{Map, Value};

const JS_PRELUDE: &str = r#"
const console = {
  log: function () {},
  warn: function () {},
  error: function () {}
};

function parseImageSize(sizeParam) {
  if (!sizeParam) return "landscape_4_3";
  if (typeof sizeParam === "string" && sizeParam.includes("*")) {
    const pair = sizeParam.split("*").map(function (item) { return Number(item); });
    return { width: pair[0], height: pair[1] };
  }
  return sizeParam;
}

function calculateQwenResolution(widthRatio, heightRatio) {
  const MIN_SIZE = 64;
  const MAX_SIZE = 2048;
  const STEP = 8;
  if (widthRatio === heightRatio) {
    return { width: MAX_SIZE, height: MAX_SIZE };
  }
  const ratio = widthRatio / heightRatio;
  let width;
  let height;
  if (ratio > 1) {
    width = MAX_SIZE;
    height = width / ratio;
    if (height < MIN_SIZE) {
      height = MIN_SIZE;
      width = height * ratio;
    }
  } else {
    height = MAX_SIZE;
    width = height * ratio;
    if (width < MIN_SIZE) {
      width = MIN_SIZE;
      height = width / ratio;
    }
  }
  const finalWidth = Math.floor(width / STEP) * STEP;
  const finalHeight = Math.floor(height / STEP) * STEP;
  return {
    width: Math.max(MIN_SIZE, Math.min(MAX_SIZE, finalWidth)),
    height: Math.max(MIN_SIZE, Math.min(MAX_SIZE, finalHeight))
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
  if (widthRatio === heightRatio) {
    return { width: baseSize, height: baseSize };
  }
  const maxPixels = baseSize * baseSize;
  const ratio = widthRatio / heightRatio;
  const height = Math.sqrt(maxPixels / ratio);
  const width = height * ratio;
  const finalWidth = Math.floor(width / 8) * 8;
  const finalHeight = Math.floor(height / 8) * 8;
  return { width: finalWidth, height: finalHeight };
}

function calculateResolutionWithBounds(baseSize, widthRatio, heightRatio, minSize, maxSize) {
  const actualMin = minSize === undefined ? 64 : minSize;
  const actualMax = maxSize === undefined ? 2048 : maxSize;
  const base = calculateResolution(baseSize, widthRatio, heightRatio);
  let width = base.width;
  let height = base.height;
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
  width = Math.max(actualMin, Math.min(actualMax, width));
  height = Math.max(actualMin, Math.min(actualMax, height));
  width = Math.floor(width / 16) * 16;
  height = Math.floor(height / 16) * 16;
  return { width, height };
}

function resolveModelscopeSize(modelId, imageSize, baseSize) {
  if (!imageSize) return undefined;
  if (typeof imageSize === "string" && imageSize.includes("x")) return imageSize;
  let ratio = imageSize === "smart" || imageSize === "auto" || imageSize === "自定义"
    ? "1:1"
    : imageSize;
  if (typeof ratio !== "string" || !ratio.includes(":")) return undefined;
  const pair = ratio.split(":").map(Number);
  const w = pair[0];
  const h = pair[1];
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
  const request = { model: options.modelId, prompt: prompt };

  const sizeParam = typeof params.size === "string" ? params.size : undefined;
  const imageSizeParam =
    typeof params.modelscopeImageSize === "string"
      ? params.modelscopeImageSize
      : (typeof params.image_size === "string"
        ? params.image_size
        : (typeof params.aspect_ratio === "string" ? params.aspect_ratio : undefined));

  const baseSizeParam =
    typeof params.resolutionBaseSize === "number"
      ? params.resolutionBaseSize
      : (typeof options.baseSize === "number" ? options.baseSize : undefined);

  const sizeValue = sizeParam || resolveModelscopeSize(options.modelId, imageSizeParam, baseSizeParam);
  if (sizeValue) {
    request.size = sizeValue;
  }

  const steps = params.modelscopeSteps !== undefined ? params.modelscopeSteps : params.steps;
  if (steps !== undefined) {
    request.steps = steps;
  }

  if (options.allowNegativePrompt !== false && typeof params.modelscopeNegativePrompt === "string") {
    request.negative_prompt = params.modelscopeNegativePrompt;
  }

  if (options.allowGuidance !== false && params.modelscopeGuidance !== undefined) {
    request.guidance = params.modelscopeGuidance;
  }

  if (params.seed !== undefined) {
    request.seed = params.seed;
  }

  if (options.allowImage) {
    let images = [];
    if (Array.isArray(params.image_url)) {
      images = params.image_url;
    } else if (Array.isArray(params.images)) {
      images = params.images;
    }
    if (images.length > 0) {
      request.image_url = images;
    }
  }

  return request;
}

function filterMediaSources(values) {
  if (!Array.isArray(values)) return [];
  return values.filter(function (item) {
    return typeof item === "string" && item.trim().length > 0;
  });
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
  if (preferred.length > 0) {
    return preferred[0];
  }
  return typeof params.video === "string" && params.video.trim().length > 0
    ? params.video
    : undefined;
}

function resolveUploadedImageSources(params) {
  return resolvePpioImageSources(params);
}

function resolveUploadedMediaSources(values) {
  return filterMediaSources(values);
}

function resolveBoolean(value, fallbackValue) {
  return typeof value === "boolean" ? value : fallbackValue;
}

function resolveDuration(value) {
  return value === 10 ? 10 : 5;
}

const DEFAULT_WAN25_SIZE = "1280*720";
const DEFAULT_WAN25_RESOLUTION = "720P";
const SUPPORTED_WAN25_SIZES = [
  "832*480",
  "480*832",
  "624*624",
  "1280*720",
  "720*1280",
  "960*960",
  "1088*832",
  "832*1088",
  "1920*1080",
  "1080*1920",
  "1440*1440",
  "1632*1248",
  "1248*1632"
];
const SUPPORTED_WAN25_RESOLUTIONS = ["480P", "720P", "1080P"];

function resolveSupportedValue(preferred, legacy, supportedValues, fallbackValue) {
  const allowedValues = Array.isArray(supportedValues) ? supportedValues : [];
  if (typeof preferred === "string" && allowedValues.includes(preferred)) {
    return preferred;
  }
  if (typeof legacy === "string" && allowedValues.includes(legacy)) {
    return legacy;
  }
  return fallbackValue;
}
"#;

pub fn eval_function(function_source: &str, params: &Map<String, Value>) -> AiResult<Value> {
    let fn_literal = serde_json::to_string(function_source)
        .map_err(|e| AiRuntimeError::new("js_eval_failed", e.to_string()))?;
    let params_json = serde_json::to_string(params)
        .map_err(|e| AiRuntimeError::new("js_eval_failed", e.to_string()))?;
    let params_literal = serde_json::to_string(&params_json)
        .map_err(|e| AiRuntimeError::new("js_eval_failed", e.to_string()))?;

    let script = format!(
        r#"
{prelude}
const __henjiFn = eval("(" + {fn_source} + ")");
const __henjiParams = JSON.parse({params_source});
const __henjiResult = __henjiFn(__henjiParams);
JSON.stringify(__henjiResult === undefined ? null : __henjiResult);
"#,
        prelude = JS_PRELUDE,
        fn_source = fn_literal,
        params_source = params_literal
    );

    let mut context = Context::default();
    let output = context
        .eval(Source::from_bytes(script.as_str()))
        .map_err(|e| AiRuntimeError::new("js_eval_failed", format!("{:?}", e)))?;

    let output_text = output
        .to_string(&mut context)
        .map_err(|e| AiRuntimeError::new("js_eval_failed", format!("{:?}", e)))?
        .to_std_string_escaped();

    serde_json::from_str::<Value>(&output_text)
        .map_err(|e| AiRuntimeError::new("js_eval_failed", e.to_string()))
}
