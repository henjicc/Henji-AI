import { resolveImageEditOutputGeometryV3 } from '@/core/imageEdit/v3'
import type { ImageEditorViewportLayoutV3 } from '../editor/useImageEditorViewportLayoutV3'
import type { ImageEditorGpuRasterSceneV3 } from './imageEditorGpuRasterSceneCompilerV3'
import type {
  ImageEditorGpuSceneExportRequestV3,
  ImageEditorGpuSceneExportTilePlanV3,
} from './imageEditorGpuSceneProtocolV3'

export interface ImageEditorGpuExportRectV3 {
  x: number
  y: number
  width: number
  height: number
}

export function imageEditorGpuExportFullAnalysisLayoutV3(
  requestId: string,
  analysis: NonNullable<ImageEditorGpuSceneExportRequestV3['multiscaleAnalysis']>,
  scene: ImageEditorGpuRasterSceneV3,
): ImageEditorViewportLayoutV3 {
  return imageEditorGpuExportLayoutV3(requestId, {
    tileX: -1, tileY: -1, x: 0, y: 0, width: analysis.width, height: analysis.height,
    renderX: 0, renderY: 0, renderWidth: analysis.width, renderHeight: analysis.height,
    coreOffsetX: 0, coreOffsetY: 0,
  }, scene, analysis.width)
}

export function scaleImageEditorGpuExportTilePlanV3(
  tile: ImageEditorGpuSceneExportTilePlanV3,
  output: { width: number; height: number },
  analysis: NonNullable<ImageEditorGpuSceneExportRequestV3['multiscaleAnalysis']>,
): ImageEditorGpuSceneExportTilePlanV3 {
  const x = Math.floor(tile.renderX * analysis.width / output.width)
  const y = Math.floor(tile.renderY * analysis.height / output.height)
  const right = Math.ceil((tile.renderX + tile.renderWidth) * analysis.width / output.width)
  const bottom = Math.ceil((tile.renderY + tile.renderHeight) * analysis.height / output.height)
  return {
    tileX: tile.tileX, tileY: tile.tileY, x, y,
    width: right - x, height: bottom - y,
    renderX: x, renderY: y, renderWidth: right - x, renderHeight: bottom - y,
    coreOffsetX: 0, coreOffsetY: 0,
  }
}

export function imageEditorGpuExportLayoutV3(
  requestId: string,
  tile: ImageEditorGpuSceneExportTilePlanV3,
  scene: ImageEditorGpuRasterSceneV3,
  outputWidth: number,
): ImageEditorViewportLayoutV3 {
  const geometry = resolveImageEditOutputGeometryV3(scene.geometry)
  const scale = outputWidth / geometry.outputWidth
  return {
    stageWidth: tile.renderWidth,
    stageHeight: tile.renderHeight,
    viewportKey: `${requestId}:${tile.tileX}:${tile.tileY}`,
    viewport: {
      documentX: tile.renderX / scale,
      documentY: tile.renderY / scale,
      width: tile.renderWidth,
      height: tile.renderHeight,
      zoom: scale,
      devicePixelRatio: 1,
      interacting: false,
    },
  }
}

export function cropImageEditorGpuExportCoreV3(
  source: Float32Array,
  tile: ImageEditorGpuSceneExportTilePlanV3,
): Float32Array {
  if (source.length !== tile.renderWidth * tile.renderHeight * 4) {
    throw new Error('GPU Scene 导出回读尺寸与规划不一致')
  }
  const output = new Float32Array(tile.width * tile.height * 4)
  for (let y = 0; y < tile.height; y += 1) {
    const start = ((tile.coreOffsetY + y) * tile.renderWidth + tile.coreOffsetX) * 4
    output.set(source.subarray(start, start + tile.width * 4), y * tile.width * 4)
  }
  return output
}

export function imageEditorGpuExportExactBufferV3(value: ArrayBuffer | Uint8Array): ArrayBuffer {
  if (value instanceof ArrayBuffer) return value
  return value.byteOffset === 0 && value.byteLength === value.buffer.byteLength
    ? value.buffer as ArrayBuffer
    : value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer
}

export function imageEditorGpuExportAbortErrorV3(): Error {
  const error = new Error('GPU Scene 导出已取消或过期')
  error.name = 'AbortError'
  return error
}

export function maximumImageEditorGpuExportTileDimensionsV3(
  tiles: readonly ImageEditorGpuSceneExportTilePlanV3[],
): readonly [number, number] {
  return [Math.max(1, ...tiles.map((tile) => tile.width)),
    Math.max(1, ...tiles.map((tile) => tile.height))]
}

export function imageEditorGpuExportOverlapPatchesV3(
  tiles: readonly ImageEditorGpuSceneExportTilePlanV3[],
  core: ImageEditorGpuSceneExportTilePlanV3,
): readonly ImageEditorGpuSceneExportTilePlanV3[] {
  return tiles.filter((tile) => Math.abs(tile.tileX - core.tileX) <= 1
    && Math.abs(tile.tileY - core.tileY) <= 1)
}

export function imageEditorGpuExportOutputRectV3(
  tile: ImageEditorGpuSceneExportTilePlanV3,
): ImageEditorGpuExportRectV3 {
  return { x: tile.x, y: tile.y, width: tile.width, height: tile.height }
}

export function imageEditorGpuExportRenderRectV3(
  tile: ImageEditorGpuSceneExportTilePlanV3,
): ImageEditorGpuExportRectV3 {
  return { x: tile.renderX, y: tile.renderY,
    width: tile.renderWidth, height: tile.renderHeight }
}
