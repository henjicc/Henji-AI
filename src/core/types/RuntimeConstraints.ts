export type RuntimeConstraintValue = string | number | boolean

export interface RuntimeNumberFieldConstraint {
  field: string
  min?: number
  max?: number
  integer?: boolean
  fallback?: number
}

export interface RuntimeEnumFieldConstraint {
  field: string
  allowed: RuntimeConstraintValue[]
  fallback?: RuntimeConstraintValue
}

export interface RuntimeImageSizeFieldConstraint {
  field: string
  format?: 'string' | 'object'
  widthKey?: string
  heightKey?: string
  minSide?: number
  maxSide?: number
  minPixels?: number
  maxPixels: number
  minAspectRatio?: number
  maxAspectRatio?: number
}

export type RuntimeMediaFieldKind = 'image' | 'video' | 'audio' | 'file'

/**
 * 声明请求体中需要由主进程上传并替换为公网 URL 的字段。
 *
 * 用于 cref / mask_url / pdf_url 这类无法仅凭通用字段名可靠判断媒体类型的字段，
 * 避免在上传运行时继续堆供应商或模型特例。
 */
export interface RuntimeMediaFieldConstraint {
  field: string
  kind: RuntimeMediaFieldKind
}

export interface RuntimeConstraints {
  numberFields?: RuntimeNumberFieldConstraint[]
  enumFields?: RuntimeEnumFieldConstraint[]
  imageSizeFields?: RuntimeImageSizeFieldConstraint[]
  mediaFields?: RuntimeMediaFieldConstraint[]
}
