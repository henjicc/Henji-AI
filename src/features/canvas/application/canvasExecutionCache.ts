import type { CanvasNodeData } from '../domain/canvasNodes'

export const CANVAS_LATEST_EXECUTION_VERSION = 1 as const

export type CanvasDependencyRunPolicy = 'reuse-if-valid' | 'always-run'
export type CanvasDependencyOutputMode = 'inline' | 'result-nodes'

export interface CanvasExecutionOutputRefV1 {
  resultNodeId: string
  completionId?: string
  outputId?: string
  order: number
}
export interface CanvasLatestExecutionV1 {
  version: typeof CANVAS_LATEST_EXECUTION_VERSION
  inputSignature: string
  outputMode: CanvasDependencyOutputMode
  outputRefs: CanvasExecutionOutputRefV1[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function readCanvasLatestExecution(
  data: CanvasNodeData,
): CanvasLatestExecutionV1 | null {
  const value = (data as DynamicValueMap).latestExecution
  if (!isRecord(value) || value.version !== CANVAS_LATEST_EXECUTION_VERSION) return null
  if (typeof value.inputSignature !== 'string' || value.inputSignature.length === 0) return null
  if (value.outputMode !== 'inline' && value.outputMode !== 'result-nodes') return null
  if (!Array.isArray(value.outputRefs)) return null

  const outputRefs: CanvasExecutionOutputRefV1[] = []
  for (const [index, candidate] of value.outputRefs.entries()) {
    if (!isRecord(candidate) || typeof candidate.resultNodeId !== 'string') return null
    if (candidate.resultNodeId.trim().length === 0) return null
    outputRefs.push({
      resultNodeId: candidate.resultNodeId,
      ...(typeof candidate.completionId === 'string' && candidate.completionId
        ? { completionId: candidate.completionId }
        : {}),
      ...(typeof candidate.outputId === 'string' && candidate.outputId
        ? { outputId: candidate.outputId }
        : {}),
      order: typeof candidate.order === 'number' && Number.isInteger(candidate.order)
        ? candidate.order
        : index,
    })
  }

  return {
    version: CANVAS_LATEST_EXECUTION_VERSION,
    inputSignature: value.inputSignature,
    outputMode: value.outputMode,
    outputRefs: outputRefs.sort((left, right) => left.order - right.order),
  }
}

export function resolveCanvasDependencyRunPolicy(
  data: CanvasNodeData,
): CanvasDependencyRunPolicy {
  const explicit = (data as DynamicValueMap).dependencyRunPolicy
  if (explicit === 'always-run' || explicit === 'reuse-if-valid') return explicit
  return (data as DynamicValueMap).fixedResult === false ? 'always-run' : 'reuse-if-valid'
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!isRecord(value)) return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalize(child)]),
  )
}

/** 稳定短签名只用于缓存判等，不承担密码学或隐私保护用途。 */
export function createCanvasExecutionValueSignature(value: unknown): string {
  const serialized = JSON.stringify(canonicalize(value))
  let left = 0x811c9dc5
  let right = 0x9e3779b9
  for (let index = 0; index < serialized.length; index += 1) {
    const code = serialized.charCodeAt(index)
    left = Math.imul(left ^ code, 0x01000193)
    right = Math.imul(right ^ (code + index), 0x85ebca6b)
  }
  return `canvas-input-v2-${(left >>> 0).toString(16).padStart(8, '0')}${(right >>> 0).toString(16).padStart(8, '0')}`
}
