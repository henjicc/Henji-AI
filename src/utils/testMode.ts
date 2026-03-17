/**
 * 测试模式工具
 * 用于开发和调试，不影响生产功能
 */

import { logError, logInfo } from '../utils/errorLogger'
import type { AiRuntimeTrace } from '@/core/types'
export interface TestModeOptions {
  skipRequest: boolean // 不发送实际请求
  logParams: boolean   // 在控制台输出参数
  enableDevTools: boolean // 允许在构建版中使用F12打开控制台
  // 未来可以添加更多选项
  // mockResponse: boolean
  // slowMode: boolean
  // etc.
}

export interface TestModeState {
  enabled: boolean
  options: TestModeOptions
  lastParams: Record<string, unknown> | null
  lastTrace: TestModeTraceRecord | null
}

export interface TestModeTraceRecord {
  model: string
  type?: string
  prompt?: string
  timestamp: string
  trace: AiRuntimeTrace
}

const STORAGE_KEY = 'henji_test_mode'

// 默认配置
const DEFAULT_OPTIONS: TestModeOptions = {
  skipRequest: true,
  logParams: true,
  enableDevTools: false
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isAiRuntimeTrace(value: unknown): value is AiRuntimeTrace {
  if (!isRecord(value)) {
    return false
  }

  return typeof value.modelId === 'string' &&
    typeof value.providerId === 'string' &&
    typeof value.requestId === 'string' &&
    (value.phase === 'generate' || value.phase === 'continuePolling') &&
    typeof value.route === 'string' &&
    typeof value.method === 'string' &&
    'responseBody' in value
}

function normalizeTestModeState(value: unknown): TestModeState {
  if (!isRecord(value)) {
    return {
      enabled: false,
      options: DEFAULT_OPTIONS,
      lastParams: null,
      lastTrace: null
    }
  }

  const rawOptions = isRecord(value.options) ? value.options : {}

  return {
    enabled: value.enabled === true,
    options: {
      skipRequest: rawOptions.skipRequest !== false,
      logParams: rawOptions.logParams !== false,
      enableDevTools: rawOptions.enableDevTools === true
    },
    lastParams: isRecord(value.lastParams) ? value.lastParams : null,
    lastTrace: isRecord(value.lastTrace) && typeof value.lastTrace.model === 'string' &&
      typeof value.lastTrace.timestamp === 'string' && isAiRuntimeTrace(value.lastTrace.trace)
      ? {
          model: value.lastTrace.model,
          type: typeof value.lastTrace.type === 'string' ? value.lastTrace.type : undefined,
          prompt: typeof value.lastTrace.prompt === 'string' ? value.lastTrace.prompt : undefined,
          timestamp: value.lastTrace.timestamp,
          trace: value.lastTrace.trace
        }
      : null
  }
}

// 获取测试模式状态
export function getTestModeState(): TestModeState {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      return normalizeTestModeState(JSON.parse(stored))
    }
  } catch (e) {
    logError('[TestMode] Failed to load state:', e)
  }

  return {
    enabled: false,
    options: DEFAULT_OPTIONS,
    lastParams: null,
    lastTrace: null
  }
}

// 保存测试模式状态
export function saveTestModeState(state: TestModeState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    // 触发自定义事件，通知其他组件状态已更新
    window.dispatchEvent(new CustomEvent('test-mode-changed', { detail: state }))
  } catch (e) {
    logError('[TestMode] Failed to save state:', e)
  }
}

// 切换测试模式
export function toggleTestMode(): boolean {
  const state = getTestModeState()
  state.enabled = !state.enabled
  saveTestModeState(state)

  logInfo('', `[TestMode] ${state.enabled ? '已开启' : '已关闭'}`)

  return state.enabled
}

// 更新测试选项
export function updateTestOptions(options: Partial<TestModeOptions>): void {
  const state = getTestModeState()
  state.options = { ...state.options, ...options }
  saveTestModeState(state)
}

/**
 * 格式化 Base64 数据，只显示标识而不显示完整内容
 */
function formatBase64(value: any): any {
  if (typeof value === 'string') {
    // 检测 Base64 数据（data:image/... 或 data:video/...）
    if (value.startsWith('data:image/') || value.startsWith('data:video/') || value.startsWith('data:audio/')) {
      const match = value.match(/^data:([^;]+);/)
      const mimeType = match ? match[1] : 'unknown'
      const sizeKB = Math.round(value.length * 0.75 / 1024) // 估算大小
      return `[Base64 ${mimeType} ~${sizeKB}KB]`
    }
  } else if (Array.isArray(value)) {
    return value.map(formatBase64)
  } else if (value && typeof value === 'object') {
    const formatted: any = {}
    for (const [key, val] of Object.entries(value)) {
      formatted[key] = formatBase64(val)
    }
    return formatted
  }
  return value
}

/**
 * 提取关键参数
 */
function extractKeyParams(options: any, type: string): Record<string, any> {
  const keyParams: Record<string, any> = {}

  // 通用参数
  if (options.mode) keyParams['模式'] = options.mode
  if (options.seed) keyParams['种子'] = options.seed
  if (options.negative_prompt || options.negativePrompt) {
    keyParams['负面提示词'] = options.negative_prompt || options.negativePrompt
  }

  // 图片参数
  if (type === 'image') {
    if (options.num_images) keyParams['图片数量'] = options.num_images
    if (options.aspect_ratio) keyParams['宽高比'] = options.aspect_ratio
    if (options.aspectRatio) keyParams['宽高比'] = options.aspectRatio
    if (options.resolution) keyParams['分辨率'] = options.resolution
    if (options.size) keyParams['尺寸'] = options.size
    if (options.guidance_scale) keyParams['引导强度'] = options.guidance_scale
    if (options.num_inference_steps) keyParams['推理步数'] = options.num_inference_steps
  }

  // 视频参数
  if (type === 'video') {
    if (options.duration) keyParams['时长'] = `${options.duration}秒`
    if (options.aspect_ratio) keyParams['宽高比'] = options.aspect_ratio
    if (options.aspectRatio) keyParams['宽高比'] = options.aspectRatio
    if (options.resolution) keyParams['分辨率'] = options.resolution
    if (options.fps) keyParams['帧率'] = `${options.fps} FPS`
    if (options.cfg_scale) keyParams['CFG Scale'] = options.cfg_scale
  }

  // 音频参数
  if (type === 'audio') {
    if (options.duration) keyParams['时长'] = `${options.duration}秒`
    if (options.format) keyParams['格式'] = options.format
    if (options.sample_rate) keyParams['采样率'] = `${options.sample_rate} Hz`
    if (options.speed) keyParams['语速'] = options.speed
    if (options.emotion) keyParams['情感'] = options.emotion
  }

  return keyParams
}

/**
 * 分析上传的文件
 */
function analyzeUploadedFiles(options: any): Record<string, any> {
  const files: Record<string, any> = {}

  // 图片
  if (options.images) {
    const images = Array.isArray(options.images) ? options.images : [options.images]
    files['上传图片'] = `${images.length} 张`

    // 分析图片格式
    const formats = images.map((img: string) => {
      if (typeof img === 'string') {
        if (img.startsWith('data:image/')) {
          const match = img.match(/^data:image\/([^;]+);/)
          return match ? match[1].toUpperCase() : 'Base64'
        } else if (img.startsWith('http')) {
          return 'URL'
        } else if (img.startsWith('blob:')) {
          return 'Blob'
        }
      }
      return '未知'
    })
    files['图片格式'] = formats.join(', ')
  }

  if (options.image_url) {
    files['图片URL'] = typeof options.image_url === 'string'
      ? (options.image_url.startsWith('data:') ? '[Base64]' : options.image_url)
      : '[多个]'
  }

  if (options.image_urls) {
    const urls = Array.isArray(options.image_urls) ? options.image_urls : [options.image_urls]
    files['图片URLs'] = `${urls.length} 个`
  }

  // 视频
  if (options.videos) {
    const videos = Array.isArray(options.videos) ? options.videos : [options.videos]
    files['上传视频'] = `${videos.length} 个`
  }

  // 文件路径
  if (options.uploadedFilePaths && options.uploadedFilePaths.length > 0) {
    files['本地文件路径'] = options.uploadedFilePaths
  }

  return files
}

// 记录请求参数
export function logRequestParams(params: any): void {
  const state = getTestModeState()

  if (!state.enabled) return

  // 保存最后的参数（格式化 Base64）
  state.lastParams = {
    ...params,
    options: formatBase64(params.options)
  }
  state.lastTrace = null
  saveTestModeState(state)

  // 输出到控制台
  if (state.options.logParams) {
    const { input, model, type, options = {} } = params

    console.group('🧪 [测试模式] 请求参数详情')

    // 基本信息
    console.group('📋 基本信息')
    logInfo('模型:', model)
    logInfo('类型:', type === 'image' ? '图片' : type === 'video' ? '视频' : type === 'audio' ? '音频' : type)
    logInfo('提示词:', input || '(无)')
    logInfo('时间:', new Date(params.timestamp).toLocaleString('zh-CN'))
    console.groupEnd()

    // 关键参数
    const keyParams = extractKeyParams(options, type)
    if (Object.keys(keyParams).length > 0) {
      console.group('⚙️ 关键参数')
      for (const [key, value] of Object.entries(keyParams)) {
        logInfo(`${key}:`, value)
      }
      console.groupEnd()
    }

    // 上传的文件
    const files = analyzeUploadedFiles(options)
    if (Object.keys(files).length > 0) {
      console.group('📁 上传文件')
      for (const [key, value] of Object.entries(files)) {
        logInfo(`${key}:`, value)
      }
      console.groupEnd()
    }

    // 完整参数（格式化 Base64）
    console.group('📦 完整参数 (Base64已简化)')
    const formattedOptions = formatBase64(options)
    logInfo('', formattedOptions)
    console.groupEnd()

    // 原始参数（折叠，仅在需要时展开）
    console.groupCollapsed('🔍 原始参数 (包含Base64)')
    logInfo('完整options对象:', options)
    console.groupEnd()

    console.groupEnd()
  }
}

export function recordApiTrace(record: TestModeTraceRecord): void {
  const state = getTestModeState()
  if (!state.enabled) return

  state.lastTrace = record
  saveTestModeState(state)

  if (!state.options.logParams) {
    return
  }

  console.groupCollapsed(`🧪 [测试模式] 真实 API 交互 - ${record.model}`)
  logInfo('[Trace] 概览', {
    model: record.model,
    type: record.type,
    phase: record.trace.phase,
    provider: record.trace.providerId,
    route: record.trace.route,
    method: record.trace.method,
    requestId: record.trace.requestId,
    taskId: record.trace.taskId,
    timestamp: record.timestamp
  })
  console.group('📤 最终实际请求')
  console.log(record.trace.requestBody ?? '[无 JSON Body]')
  console.groupEnd()
  console.group('📥 API 实际响应')
  console.log(record.trace.responseBody)
  console.groupEnd()
  console.groupEnd()
}

// 检查是否应该跳过请求
export function shouldSkipRequest(): boolean {
  const state = getTestModeState()
  return state.enabled && state.options.skipRequest
}

// 检查测试模式是否启用
export function isTestModeEnabled(): boolean {
  return getTestModeState().enabled
}
