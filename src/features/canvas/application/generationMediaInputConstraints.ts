import type { ParamDef } from '@/core/types'
import type { RowMediaKind } from '@/features/canvas/domain/socketTypes'

export interface GenerationMediaInputConstraint {
  accept: readonly string[]
  maxSizeBytes?: number
}

export type GenerationMediaInputConstraints = Partial<
  Record<RowMediaKind, GenerationMediaInputConstraint>
>

export type GenerationMediaInputConstraintErrorCode =
  | 'unsupported-format'
  | 'too-large'
  | 'unreadable'

export class GenerationMediaInputConstraintError extends Error {
  constructor(
    readonly code: GenerationMediaInputConstraintErrorCode,
    readonly source: string,
    readonly constraint: GenerationMediaInputConstraint,
  ) {
    super(`GENERATION_MEDIA_INPUT_${code.toUpperCase().replaceAll('-', '_')}`)
    this.name = 'GenerationMediaInputConstraintError'
  }
}

function paramMediaKind(param: ParamDef): RowMediaKind | null {
  if (param.type === 'image-upload') return 'image'
  if (param.type === 'video-upload') return 'video'
  return null
}

function mergeAccept(
  current: readonly string[],
  next: readonly string[],
): readonly string[] {
  if (current.length === 0) return [...next]
  if (next.length === 0) return [...current]
  const nextSet = new Set(next.map((value) => value.toLowerCase()))
  return current.filter((value) => nextSet.has(value.toLowerCase()))
}

/**
 * 标准媒体行替代了被 excludeParamIds 隐藏的 schema 上传参数，因此必须把该参数的格式/体积
 * 约束同步到媒体行与执行前预检，不能只保留数量限制。
 */
export function resolveGenerationMediaInputConstraints(
  schema: readonly ParamDef[],
  excludeParamIds: readonly string[] = [],
): GenerationMediaInputConstraints {
  const excluded = new Set(excludeParamIds)
  const result: GenerationMediaInputConstraints = {}
  for (const param of schema) {
    if (!excluded.has(param.id)) continue
    const kind = paramMediaKind(param)
    if (!kind) continue
    const accept = 'accept' in param && Array.isArray(param.accept) ? param.accept : []
    const maxSizeBytes = 'maxSize' in param && typeof param.maxSize === 'number'
      ? param.maxSize
      : undefined
    const current = result[kind]
    result[kind] = {
      accept: mergeAccept(current?.accept ?? [], accept),
      ...(
        current?.maxSizeBytes !== undefined || maxSizeBytes !== undefined
          ? { maxSizeBytes: Math.min(
              current?.maxSizeBytes ?? Number.POSITIVE_INFINITY,
              maxSizeBytes ?? Number.POSITIVE_INFINITY,
            ) }
          : {}
      ),
    }
  }
  return result
}

const EXTENSION_TO_MIME: Readonly<Record<string, string>> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
  avif: 'image/avif',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
}

function fileExtension(fileName: string | null | undefined): string {
  const normalized = fileName?.split(/[?#]/, 1)[0] ?? ''
  const match = normalized.match(/\.([a-z0-9]+)$/i)
  return match?.[1]?.toLowerCase() ?? ''
}

export function isMediaFileAccepted(
  constraint: GenerationMediaInputConstraint | undefined,
  input: { fileName?: string | null; mimeType?: string | null; sizeBytes?: number },
): boolean {
  if (!constraint) return true
  if (
    constraint.maxSizeBytes !== undefined
    && input.sizeBytes !== undefined
    && input.sizeBytes > constraint.maxSizeBytes
  ) return false
  if (constraint.accept.length === 0) return true
  const extension = fileExtension(input.fileName)
  const mimeType = (input.mimeType || EXTENSION_TO_MIME[extension] || '').toLowerCase()
  return constraint.accept.some((raw) => {
    const accepted = raw.toLowerCase()
    if (accepted.startsWith('.')) return extension === accepted.slice(1)
    if (accepted.endsWith('/*')) return mimeType.startsWith(accepted.slice(0, -1))
    return mimeType === accepted
  })
}

export function formatAcceptedMediaTypes(accept: readonly string[]): string {
  const labels = accept.map((value) => {
    if (value === 'image/jpeg') return 'JPEG'
    if (value === 'image/png') return 'PNG'
    if (value === 'image/webp') return 'WebP'
    return value.replace(/^image\//, '').replace(/^video\//, '').toUpperCase()
  })
  return [...new Set(labels)].join(' / ')
}

interface ImageInfoForConstraintValidation {
  extension: string
  fileName: string | null
  fileSizeBytes: number
}

/** 连线、本地上传和素材拖入最终都会经过这里，确保文件选择器 accept 不是唯一防线。 */
export async function validateGenerationImageInputs(
  images: readonly string[],
  constraint: GenerationMediaInputConstraint | undefined,
  readImageInfo: (source: string) => Promise<ImageInfoForConstraintValidation>,
): Promise<void> {
  if (!constraint || (
    constraint.accept.length === 0
    && constraint.maxSizeBytes === undefined
  )) return
  for (const source of images) {
    let info: ImageInfoForConstraintValidation
    try {
      info = await readImageInfo(source)
    } catch {
      throw new GenerationMediaInputConstraintError('unreadable', source, constraint)
    }
    const fileName = info.fileName ?? (info.extension ? `source.${info.extension}` : source)
    if (!isMediaFileAccepted(constraint, {
      fileName,
      sizeBytes: info.fileSizeBytes,
    })) {
      const tooLarge = constraint.maxSizeBytes !== undefined
        && info.fileSizeBytes > constraint.maxSizeBytes
      throw new GenerationMediaInputConstraintError(
        tooLarge ? 'too-large' : 'unsupported-format',
        source,
        constraint,
      )
    }
  }
}
