import type { I18nText } from '@/core/types'

// These dictionaries are intentionally `var` because model modules can import
// shared text helpers through a circular barrel during registry initialization.
/* eslint-disable no-var */
var SHARED_FIELDS = {
  acceleration: 'Acceleration',
  aspectRatio: 'Aspect Ratio',
  audioFormat: 'Audio Format',
  audioSpec: 'Audio Spec',
  apiChannel: 'Channel',
  autoFix: 'Auto Fix',
  backgroundMusic: 'Background Music',
  baseSize: 'Base Size',
  bitrate: 'Bitrate',
  cameraFixed: 'Camera Fixed',
  cfgScale: 'CFG Scale',
  channel: 'Channel',
  characterOrientation: 'Character Orientation',
  duration: 'Duration',
  emotion: 'Emotion',
  enhancePrompt: 'Enhance Prompt',
  fastMode: 'Fast Mode',
  fixedCamera: 'Fixed Camera',
  fps: 'FPS',
  generateAudio: 'Generate Audio',
  guidance: 'Guidance',
  imageSize: 'Image Size',
  inferenceSteps: 'Inference Steps',
  keepAudio: 'Keep Audio',
  keepOriginalSound: 'Keep Original Sound',
  maxImages: 'Max Images',
  mode: 'Mode',
  model: 'Model',
  movementAmplitude: 'Movement Amplitude',
  multiClip: 'Multi Clip',
  negativePrompt: 'Negative Prompt',
  numberOfImages: 'Number of Images',
  outputFormat: 'Output Format',
  pitch: 'Pitch',
  promptExpansion: 'Prompt Expansion',
  promptExtension: 'Prompt Extension',
  promptOptimization: 'Prompt Optimization',
  promptOptimizer: 'Prompt Optimizer',
  promptRewrite: 'Prompt Rewrite',
  quality: 'Quality',
  quantity: 'Quantity',
  resolution: 'Resolution',
  retakeDuration: 'Retake Duration',
  retakeMode: 'Retake Mode',
  sampleRate: 'Sample Rate',
  serviceTier: 'Service Tier',
  shotType: 'Shot Type',
  size: 'Size',
  speed: 'Speed',
  startTime: 'Start Time',
  steps: 'Steps',
  style: 'Style',
  thinkingType: 'Thinking Type',
  turboMode: 'Turbo',
  version: 'Version',
  variant: 'Variant',
  voiceId: 'Voice ID',
  volume: 'Volume',
} as const

var SHARED_OPTIONS = {
  '2k': '2K',
  '4k': '4K',
  adaptive: 'Adaptive',
  anime: 'Anime',
  auto: 'Auto',
  clay: 'Clay',
  comic: 'Comic',
  cyberpunk: 'Cyberpunk',
  consistentWithImage: 'Consistent with Image',
  consistentWithVideo: 'Consistent with Video',
  default: 'Default',
  disabled: 'Disabled',
  enabled: 'Enabled',
  enhanced: 'Enhanced',
  fun: 'Fun',
  hd2k: 'HD 2K',
  high: 'High',
  low: 'Low',
  matchImage: 'Match Image',
  matchVideo: 'Match Video',
  medium: 'Medium',
  multiShot: 'Multi-shot',
  normal: 'Normal',
  offlineMode: 'Offline Mode',
  onlineMode: 'Online Mode',
  official: 'Official',
  pro: 'Pro',
  professional: 'Professional',
  realistic: 'Realistic',
  regular: 'Standard',
  replaceAudio: 'Replace Audio',
  replaceAudioAndVideo: 'Replace Audio & Video',
  replaceVideo: 'Replace Video',
  singleShot: 'Single-shot',
  threeDAnimation: '3D Animation',
  smart: 'Smart',
  spicy: 'Spicy',
  standard: 'Standard',
  turbo: 'Turbo',
  uhd4k: 'UHD 4K',
} as const

var SHARED_MODES = {
  imageToVideo: 'Image to Video',
  motionControl: 'Motion Control',
  referenceToVideo: 'Reference to Video',
  retakeVideo: 'Retake Video',
  startEndFrame: 'Start-End Frame',
  textImageToVideo: 'Text/Image to Video',
  textToVideo: 'Text to Video',
  videoEdit: 'Video Edit',
  videoExtension: 'Video Extension',
  videoReference: 'Video Reference',
} as const

var SHARED_TEXTS = {
  'tips.numberOfImagesLimit': 'Set to 1 to generate a single image; greater than 1 will generate multiple images. Total reference + generated images cannot exceed 15.',
  'tips.promptOptimization': 'When enabled, the model will automatically optimize prompts for better generation results. Currently only supports standard mode.',
} as const
/* eslint-enable no-var */

export type SharedFieldKey = keyof typeof SHARED_FIELDS
export type SharedOptionKey = keyof typeof SHARED_OPTIONS
export type SharedModeKey = keyof typeof SHARED_MODES
export type SharedTextPath = keyof typeof SHARED_TEXTS

function resolveSharedFallback<K extends string>(
  dictionary: Record<K, string> | undefined,
  key: K,
  fallback?: string
): string {
  if (typeof fallback === 'string') {
    return fallback
  }
  if (dictionary && key in dictionary) {
    return dictionary[key]
  }
  return key
}

export function sharedFieldText(
  field: SharedFieldKey,
  fallback?: string
): I18nText {
  return {
    key: `params.fields.${field}`,
    absolute: true,
    fallback: resolveSharedFallback(SHARED_FIELDS, field, fallback),
  }
}

export function sharedOptionText(
  option: SharedOptionKey,
  fallback?: string
): I18nText {
  return {
    key: `params.options.${option}`,
    absolute: true,
    fallback: resolveSharedFallback(SHARED_OPTIONS, option, fallback),
  }
}

export function sharedModeText(
  mode: SharedModeKey,
  fallback?: string
): I18nText {
  return {
    key: `params.modes.${mode}`,
    absolute: true,
    fallback: resolveSharedFallback(SHARED_MODES, mode, fallback),
  }
}

export function sharedText(
  path: SharedTextPath,
  fallback?: string
): I18nText {
  return {
    key: `params.${path}`,
    absolute: true,
    fallback: resolveSharedFallback(SHARED_TEXTS, path, fallback),
  }
}

export function modelScopedText(path: string, fallback: string): I18nText {
  return {
    key: path,
    fallback,
  }
}
