/**
 * 元素（角色 / 物体主体）参数的值结构与校验，供 Kling 4.0 在 Fal 与 KIE 上共用。
 *
 * 值结构：`[{ id?, name?, kind: 'image' | 'video', images: string[], videos: string[], videoSeconds? }]`，
 * `videoSeconds` 是上传时读到的视频时长，只用于估价，不发给平台。
 * 图片元素第 1 张是正面主图、其余是其他角度；视频元素只用一段 3–8 秒单镜头视频。
 * Fal 在提示词里按顺序写 `@Element1`，KIE 写元素名 `@名称`，所以名称只对 KIE 有意义。
 * 媒体值是本地受管路径，由公共上传预处理按字段名（`frontal_image_url`、`image_urls`、`video_url`）上传替换。
 */

import type { JsonObject, JsonValue } from '../../types/runtime'

export interface SubjectElementEntry {
  name: string
  kind: 'image' | 'video'
  images: string[]
  video?: string
  videoSeconds?: number
}

/** 两家对元素的共同上限：最多 7 个，其中视频元素最多 3 个；图片元素 2–4 张图。 */
export const SUBJECT_ELEMENT_LIMITS = { maxItems: 7, maxVideoItems: 3, minImages: 2, maxImages: 4 } as const

/** 视频元素时长读不到时按官方上限 8 秒估价，宁可估高，避免付费授权金额偏低。 */
const SUBJECT_ELEMENT_VIDEO_MAX_SECONDS = 8

const KIE_NAME_PATTERN = /^[一-龥A-Za-z0-9_]{1,20}$/
const KIE_RESERVED_NAME = /^(?:(?:image|video|keyframe|object|audio)_\d+|first_frame|last_frame)$/i

function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function sources(value: JsonValue | undefined): string[] {
  if (typeof value === 'string') return value.trim() ? [value.trim()] : []
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map(item => item.trim()) : []
}

export function readSubjectElements(value: JsonValue | undefined): SubjectElementEntry[] {
  if (!Array.isArray(value)) return []
  return value.filter(isObject).map((element) => {
    const images = sources(element.images)
    const videos = sources(element.videos)
    const kind = element.kind === 'video' || (element.kind !== 'image' && videos.length > 0 && images.length === 0) ? 'video' : 'image'
    return {
      name: typeof element.name === 'string' ? element.name.trim() : '',
      kind,
      images: kind === 'image' ? images : [],
      ...(kind === 'video' && videos[0] ? { video: videos[0] } : {}),
      ...(kind === 'video' && typeof element.videoSeconds === 'number' && element.videoSeconds > 0 ? { videoSeconds: element.videoSeconds } : {}),
    }
  })
}

/** 视频元素按视频输入计费的总秒数：用上传时读到的时长，读不到按上限计。 */
export function subjectElementVideoSeconds(value: JsonValue | undefined): number {
  return readSubjectElements(value)
    .filter(element => element.kind === 'video')
    .reduce((total, element) => total + Math.min(SUBJECT_ELEMENT_VIDEO_MAX_SECONDS, element.videoSeconds ?? SUBJECT_ELEMENT_VIDEO_MAX_SECONDS), 0)
}

function validate(elements: SubjectElementEntry[], modelName: string): void {
  const limits = SUBJECT_ELEMENT_LIMITS
  if (elements.length > limits.maxItems) throw new Error(`${modelName} 最多 ${limits.maxItems} 个元素`)
  if (elements.filter(element => element.kind === 'video').length > limits.maxVideoItems) throw new Error(`${modelName} 最多 ${limits.maxVideoItems} 个视频元素`)
  elements.forEach((element, index) => {
    const label = `${modelName} 第 ${index + 1} 个元素`
    if (element.kind === 'video') {
      if (!element.video) throw new Error(`${label}还没有上传视频`)
    } else if (element.images.length < limits.minImages || element.images.length > limits.maxImages) {
      throw new Error(`${label}需要 ${limits.minImages}–${limits.maxImages} 张图（第 1 张为正面主图）`)
    }
  })
}

/** Fal：图片元素拆成正面主图与其他角度，视频元素只给视频；提示词按顺序引用 `@Element1`。 */
export function buildFalSubjectElements(value: JsonValue | undefined, modelName: string): JsonObject[] {
  const elements = readSubjectElements(value)
  validate(elements, modelName)
  return elements.map((element): JsonObject => element.kind === 'video'
    ? { video_url: element.video! }
    : { frontal_image_url: element.images[0], reference_image_urls: element.images.slice(1) })
}

/**
 * KIE：每个元素必须有唯一名称，提示词用 `@名称` 引用。
 * Flash 端点用 `type` 区分图片与视频元素，标准版没有这个字段。
 */
export function buildKieSubjectElements(value: JsonValue | undefined, modelName: string, options: { sendType: boolean }): JsonObject[] {
  const elements = readSubjectElements(value)
  validate(elements, modelName)
  const seen = new Set<string>()
  return elements.map((element, index): JsonObject => {
    const label = `${modelName} 第 ${index + 1} 个元素`
    if (!KIE_NAME_PATTERN.test(element.name)) throw new Error(`${label}的名称须为 1–20 个汉字、字母、数字或下划线`)
    if (KIE_RESERVED_NAME.test(element.name)) throw new Error(`${label}的名称“${element.name}”是保留名，请换一个`)
    const key = element.name.toLowerCase()
    if (seen.has(key)) throw new Error(`${label}的名称“${element.name}”与前面的元素重复`)
    seen.add(key)
    if (element.kind === 'video') return { name: element.name, video_url: element.video!, ...(options.sendType ? { type: 'video' } : {}) }
    return { name: element.name, image_urls: element.images }
  })
}
