import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes'
import type { ImageEditorPreviewBrushResourceRequestV3 } from './previewDocumentV3'

function safeBytes(values: readonly number[], label: string): number {
  const bytes = values.reduce((total, value) => total * value, 1)
  if (!Number.isSafeInteger(bytes) || bytes < 0) throw new Error(`${label}超出安全整数范围`)
  return bytes
}

function previewDimensions(document: ImageEditDocumentV3, maxDimension: number): {
  width: number
  height: number
} {
  if (!Number.isFinite(maxDimension) || maxDimension <= 0) {
    throw new Error('图片预览最大尺寸必须是正数')
  }
  const scale = Math.min(
    1,
    maxDimension / Math.max(document.geometry.width, document.geometry.height),
  )
  return {
    width: Math.max(1, Math.round(document.geometry.width * scale)),
    height: Math.max(1, Math.round(document.geometry.height * scale)),
  }
}

function countPreviewLayers(document: ImageEditDocumentV3): number {
  const count = (layers: ImageEditDocumentV3['layers']): number => layers.reduce(
    (total, layer) => total + 1 + (layer.type === 'group' ? count(layer.children) : 0),
    0,
  )
  return count(document.layers)
}

export interface ImageEditorPreviewMemoryEstimateV3 {
  width: number
  height: number
  outputBytes: number
  workingBytes: number
}

export function estimateImageEditorPreviewMemoryV3(
  document: ImageEditDocumentV3,
  maxDimension: number,
): ImageEditorPreviewMemoryEstimateV3 {
  const dimensions = previewDimensions(document, maxDimension)
  return {
    ...dimensions,
    outputBytes: safeBytes([dimensions.width, dimensions.height, 4], '图片预览成品表面'),
    workingBytes: safeBytes([
      dimensions.width,
      dimensions.height,
      4,
      Float32Array.BYTES_PER_ELEMENT,
      Math.max(4, countPreviewLayers(document) + 3),
    ], '图片预览 Worker 工作集'),
  }
}

export function imageEditorPreviewBrushTransferBytesV3(
  requests: readonly ImageEditorPreviewBrushResourceRequestV3[],
): number {
  const bytes = requests.reduce((total, request) => total + safeBytes([
    request.width,
    request.height,
    request.storage === 'rgba-float32' ? 4 : 1,
    Float32Array.BYTES_PER_ELEMENT,
  ], '图片预览画笔传输字节数'), 0)
  if (!Number.isSafeInteger(bytes)) throw new Error('图片预览画笔传输字节数超出安全整数范围')
  return bytes
}

export function imageEditorPreviewOutputBytesV3(width: number, height: number): number {
  return safeBytes([width, height, 4], '图片预览成品表面')
}
