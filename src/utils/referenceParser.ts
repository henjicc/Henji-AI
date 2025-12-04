/**
 * @ 引用解析器
 * 用于解析、验证和解析 prompt 中的 @ 引用（@Image1, @Video1, @Element1 等）
 */

export interface ParsedReference {
  type: 'image' | 'video' | 'element'
  index: number  // 1-based index
  raw: string    // 原始字符串，如 "@Image1"
  position: {
    start: number
    end: number
  }
}

export interface ReferenceValidationError {
  reference: string
  message: string
  position: {
    start: number
    end: number
  }
}

export interface ReferenceValidation {
  isValid: boolean
  errors: ReferenceValidationError[]
  warnings: string[]
}

export interface ValidationContext {
  imageCount: number
  videoCount: number
  elementCount: number
  maxTotal?: number  // 最大总数限制（如 Kling O1 的 7 个限制）
}

export interface Element {
  id: string
  frontalImage: string
  referenceImages: string[]
}

export interface ResolveContext {
  images: string[]
  videos: string[]
  elements: Element[]
}

// 正则表达式：匹配 @Image1, @Video1, @Element1 等
const REFERENCE_REGEX = /@(Image|Video|Element)(\d+)/g

/**
 * 解析 prompt 中的所有 @ 引用
 * @param prompt 用户输入的 prompt
 * @returns 解析出的引用数组
 */
export function parseReferences(prompt: string): ParsedReference[] {
  const references: ParsedReference[] = []

  // 重置正则表达式的 lastIndex
  REFERENCE_REGEX.lastIndex = 0

  let match: RegExpExecArray | null
  while ((match = REFERENCE_REGEX.exec(prompt)) !== null) {
    const type = match[1].toLowerCase() as 'image' | 'video' | 'element'
    const index = parseInt(match[2], 10)

    references.push({
      type,
      index,
      raw: match[0],
      position: {
        start: match.index,
        end: match.index + match[0].length
      }
    })
  }

  return references
}

/**
 * 验证 prompt 中的 @ 引用是否有效
 * @param prompt 用户输入的 prompt
 * @param context 验证上下文（已上传的媒体数量）
 * @returns 验证结果
 */
export function validateReferences(
  prompt: string,
  context: ValidationContext
): ReferenceValidation {
  const references = parseReferences(prompt)
  const errors: ReferenceValidationError[] = []
  const warnings: string[] = []

  // 验证每个引用
  for (const ref of references) {
    if (ref.type === 'image') {
      if (ref.index < 1) {
        errors.push({
          reference: ref.raw,
          message: '图片索引必须从 1 开始',
          position: ref.position
        })
      } else if (ref.index > context.imageCount) {
        errors.push({
          reference: ref.raw,
          message: `图片 ${ref.index} 不存在（已上传 ${context.imageCount} 张）`,
          position: ref.position
        })
      }
    } else if (ref.type === 'video') {
      if (ref.index < 1) {
        errors.push({
          reference: ref.raw,
          message: '视频索引必须从 1 开始',
          position: ref.position
        })
      } else if (ref.index > context.videoCount) {
        errors.push({
          reference: ref.raw,
          message: `视频 ${ref.index} 不存在（已上传 ${context.videoCount} 个）`,
          position: ref.position
        })
      }
    } else if (ref.type === 'element') {
      if (ref.index < 1) {
        errors.push({
          reference: ref.raw,
          message: 'Element 索引必须从 1 开始',
          position: ref.position
        })
      } else if (ref.index > context.elementCount) {
        errors.push({
          reference: ref.raw,
          message: `Element ${ref.index} 不存在（已添加 ${context.elementCount} 个）`,
          position: ref.position
        })
      }
    }
  }

  // 检查总数限制
  if (context.maxTotal !== undefined) {
    const totalCount = context.imageCount + context.videoCount + context.elementCount
    if (totalCount > context.maxTotal) {
      warnings.push(
        `总数超过限制：已上传 ${totalCount} 项，最多支持 ${context.maxTotal} 项`
      )
    }
  }

  // 检查是否有重复引用
  const seen = new Set<string>()
  for (const ref of references) {
    if (seen.has(ref.raw)) {
      warnings.push(`重复引用：${ref.raw}`)
    }
    seen.add(ref.raw)
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings
  }
}

/**
 * 解析 prompt 中的 @ 引用，替换为实际的 URL 或保持原样
 * 注意：根据 Kling O1 API 文档，prompt 中应该保留 @ 引用，不需要替换为 URL
 * 这个函数主要用于调试和日志记录
 *
 * @param prompt 用户输入的 prompt
 * @param context 解析上下文（实际的媒体 URL）
 * @returns 解析后的 prompt（保持 @ 引用不变）
 */
export function resolveReferences(
  prompt: string,
  context: ResolveContext
): string {
  // 根据 Kling O1 API 文档，prompt 中的 @ 引用应该保持原样
  // API 会自动根据 image_urls, video_url, elements 数组来解析引用
  // 所以这里直接返回原始 prompt
  return prompt
}

/**
 * 获取 prompt 中引用的所有媒体索引
 * @param prompt 用户输入的 prompt
 * @returns 引用的媒体索引
 */
export function getReferencedIndices(prompt: string): {
  images: number[]
  videos: number[]
  elements: number[]
} {
  const references = parseReferences(prompt)

  const images = new Set<number>()
  const videos = new Set<number>()
  const elements = new Set<number>()

  for (const ref of references) {
    if (ref.type === 'image') {
      images.add(ref.index)
    } else if (ref.type === 'video') {
      videos.add(ref.index)
    } else if (ref.type === 'element') {
      elements.add(ref.index)
    }
  }

  return {
    images: Array.from(images).sort((a, b) => a - b),
    videos: Array.from(videos).sort((a, b) => a - b),
    elements: Array.from(elements).sort((a, b) => a - b)
  }
}

/**
 * 检查 prompt 是否包含任何 @ 引用
 * @param prompt 用户输入的 prompt
 * @returns 是否包含引用
 */
export function hasReferences(prompt: string): boolean {
  REFERENCE_REGEX.lastIndex = 0
  return REFERENCE_REGEX.test(prompt)
}

/**
 * 生成引用提示文本（用于 UI 显示）
 * @param context 验证上下文
 * @returns 提示文本数组
 */
export function generateReferenceHints(context: ValidationContext): string[] {
  const hints: string[] = []

  if (context.imageCount > 0) {
    const imageRefs = Array.from({ length: context.imageCount }, (_, i) => `@Image${i + 1}`)
    hints.push(`可用图片引用: ${imageRefs.join(', ')}`)
  }

  if (context.videoCount > 0) {
    const videoRefs = Array.from({ length: context.videoCount }, (_, i) => `@Video${i + 1}`)
    hints.push(`可用视频引用: ${videoRefs.join(', ')}`)
  }

  if (context.elementCount > 0) {
    const elementRefs = Array.from({ length: context.elementCount }, (_, i) => `@Element${i + 1}`)
    hints.push(`可用 Element 引用: ${elementRefs.join(', ')}`)
  }

  if (hints.length === 0) {
    hints.push('上传图片、视频或添加 Element 后，可以在 prompt 中使用 @ 引用')
  }

  return hints
}
