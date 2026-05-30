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

export interface RuntimeConstraints {
  numberFields?: RuntimeNumberFieldConstraint[]
  enumFields?: RuntimeEnumFieldConstraint[]
  imageSizeFields?: RuntimeImageSizeFieldConstraint[]
}
