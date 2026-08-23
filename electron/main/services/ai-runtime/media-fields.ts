/**
 * 媒体字段识别：判断请求体里的某个值是不是待上传的媒体源，以及它是图/视频/音频。
 *
 * 识别分两层，按可靠性排序：
 * 1. 按值识别（主）——用本次请求 params 里真实的媒体源反查。builder 把媒体
 *    塞进什么字段名、嵌套多深都能命中，不依赖命名约定。
 * 2. 按字段名 hint 识别（兜底）——覆盖 builder 对媒体值做过变换（裁剪、拼接）
 *    因而对不上原值的少数情况。
 *
 * 纯函数模块，无 IO、无 Electron 依赖，可直接单测。
 */

import type { JsonObject, JsonValue } from './types'

export type MediaKind = 'image' | 'video' | 'audio' | 'file' | 'unknown'
export type ResolvedMediaKind = Exclude<MediaKind, 'unknown'>
export type MediaSourceIndex = ReadonlyMap<string, ResolvedMediaKind>

/**
 * 媒体输入在 params 上的标准落点。前端各入口（画布端口 / 工具面板 / 对话）
 * 都只往这几个 key 写媒体，所以这里能穷举。
 */
const MEDIA_PARAM_SOURCE_KEYS: ReadonlyArray<{ kind: ResolvedMediaKind; keys: readonly string[] }> = [
  { kind: 'image', keys: ['uploadedFilePaths', 'images', 'image'] },
  { kind: 'video', keys: ['uploadedVideoFilePaths', 'videos', 'video'] },
  { kind: 'audio', keys: ['uploadedAudioFilePaths', 'audios', 'audio'] },
]

const IMAGE_FIELD_HINTS = [
  'image', 'images', 'img_url', 'img_urls', 'image_url', 'image_urls',
  'start_image_url', 'end_image_url', 'first_frame_image_url', 'last_frame_image_url',
  'frame_url', 'frame_urls',
  'reference_image_urls', 'input_urls', 'reference_images', 'input_image',
]
const VIDEO_FIELD_HINTS = [
  'video', 'videos', 'video_url', 'video_urls', 'reference_video_urls',
  'clip_url', 'clip_urls',
  'uploaded_video_file_paths', 'uploaded_video_paths', 'input_video',
]
const AUDIO_FIELD_HINTS = [
  'audio', 'audios', 'audio_url', 'audio_urls', 'prompt_audio_url',
  'prompt_audio_urls', 'reference_audio_url', 'input_audio',
]

const LOCAL_SOURCE_PREFIXES = [
  'henji-media://local/',
  'http://asset.localhost/', 'https://asset.localhost/',
  'http://tauri.localhost/', 'https://tauri.localhost/',
  'asset://localhost/', 'tauri://localhost/',
  'file://localhost/', 'file:///', 'file://',
]

/**
 * 收集本次请求真实用到的本地媒体源，供按值识别使用。
 *
 * 只收本地路径 / data URI —— 远程 URL 本来就不需要重写，排除掉也顺带避免
 * 普通字符串误入索引。
 */
export function buildMediaSourceIndex(params: JsonObject): MediaSourceIndex {
  const index = new Map<string, ResolvedMediaKind>()
  for (const { kind, keys } of MEDIA_PARAM_SOURCE_KEYS) {
    for (const key of keys) {
      collectLocalMediaValues(params[key], (value) => {
        if (!index.has(value)) index.set(value, kind)
      })
    }
  }
  return index
}

function collectLocalMediaValues(value: JsonValue | undefined, visit: (value: string) => void): void {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed && isLocalMediaSource(trimmed)) visit(trimmed)
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) collectLocalMediaValues(item, visit)
  }
}

/** 是否是需要上传的本地媒体源（本地路径 / 本地协议 / data URI）。 */
export function isLocalMediaSource(value: string): boolean {
  return value.startsWith('data:') || normalizeLocalSource(value) !== undefined
}

/**
 * 解析出实际媒体类型：优先沿用字段名 hint 推导出的类型，命中不了就按值回查。
 */
export function resolveMediaKind(
  mediaSources: MediaSourceIndex,
  declaredKind: MediaKind,
  value: string
): MediaKind {
  if (declaredKind !== 'unknown') return declaredKind
  return mediaSources.get(value.trim()) ?? 'unknown'
}

/** 嵌套对象里，子字段没有自己的类型线索时沿用父级类型。 */
export function inheritMediaKind(current: MediaKind, key: string): MediaKind {
  if (current === 'unknown' && key.toLowerCase() === 'url') {
    return 'unknown'
  }
  const nested = classifyMediaKey(key)
  return nested === 'unknown' ? current : nested
}

export function classifyMediaKey(key: string): MediaKind {
  const normalized = key.toLowerCase()
  if (IMAGE_FIELD_HINTS.some((hint) => normalized.includes(hint))) return 'image'
  if (VIDEO_FIELD_HINTS.some((hint) => normalized.includes(hint))) return 'video'
  if (AUDIO_FIELD_HINTS.some((hint) => normalized.includes(hint))) return 'audio'
  return 'unknown'
}

/** 把各种本地协议还原成文件系统路径；不是本地源时返回 undefined。 */
export function normalizeLocalSource(source: string): string | undefined {
  for (const prefix of LOCAL_SOURCE_PREFIXES) {
    if (source.startsWith(prefix)) {
      return stripWindowsDrivePrefix(safeDecodeURIComponent(source.slice(prefix.length)))
    }
  }
  return isLocalPath(source) ? source : undefined
}

export function isRemoteHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value) &&
    !value.startsWith('http://asset.localhost/') &&
    !value.startsWith('http://tauri.localhost/')
}

function isLocalPath(value: string): boolean {
  return value.startsWith('\\\\') ||
    value.startsWith('/') ||
    value.startsWith('~/') ||
    /^[a-zA-Z]:[\\/]/.test(value)
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function stripWindowsDrivePrefix(value: string): string {
  return /^\/[a-zA-Z]:/.test(value) ? value.slice(1) : value
}
