import { inspectAsset } from '@/commands/assetLibrary'
import { createLogger } from '@/core/logging'
import {
  SURFACE_OBSERVATION_SCHEMA_VERSION,
  type SurfaceCaptureRect,
} from '@/core/assistant/surfaceObservation'
import {
  prefersNativeMediaObservation,
  type ApplicationSurfaceId,
} from '@/core/assistant/applicationSurfaces'
import { getApplicationSurface } from '@/features/navigation/application/surfaceCatalog'
import { addMediaReferenceToLibrary } from '@/features/assets/services/assetCollectionService'
import { getPlatform } from '@/platform'
import { saveBase64ToUploads } from '@/utils/save/uploads'
import { assetToAgentAttachment } from '../conversation/assistantAttachments'

const logger = createLogger('features.assistant.surface_observation')
/**
 * 观察截图必须遮罩的区域。
 *
 * `contenteditable` 一并纳入：项目里的提示词/指令编辑器是 ProseMirror 富文本，
 * 不是 `<input>`，此前完全漏过遮罩——而文本链路的密钥脱敏对截图不起作用。
 * 非输入控件呈现的敏感内容（例如展示本地绝对路径的状态行）用
 * `data-observation-sensitive` 显式标注。
 */
const SENSITIVE_SELECTOR = [
  'input', 'textarea', 'select',
  '[contenteditable="true"]', '[contenteditable=""]', '[contenteditable="plaintext-only"]',
  '[data-observation-sensitive]',
].join(', ')

function clippedRect(element: Element): DOMRect {
  const source = element.getBoundingClientRect()
  const left = Math.max(0, source.left)
  const top = Math.max(0, source.top)
  const right = Math.min(window.innerWidth, source.right)
  const bottom = Math.min(window.innerHeight, source.bottom)
  return new DOMRect(left, top, Math.max(0, right - left), Math.max(0, bottom - top))
}

function integerCaptureRect(rect: DOMRect): SurfaceCaptureRect {
  const x = Math.max(0, Math.floor(rect.x))
  const y = Math.max(0, Math.floor(rect.y))
  return {
    x,
    y,
    width: Math.max(1, Math.ceil(rect.right) - x),
    height: Math.max(1, Math.ceil(rect.bottom) - y),
  }
}

function findVisibleSurface(surfaceId: string): Element | null {
  return [...document.querySelectorAll('[data-application-surface-id]')].find((element) => {
    const registeredId = element.getAttribute('data-application-surface-id') ?? ''
    const matches = registeredId === surfaceId
      || (surfaceId === 'settings.general' && registeredId.startsWith('settings.general.'))
      || (surfaceId === 'settings.interface' && registeredId.startsWith('settings.interface.'))
    if (!matches) return false
    const rect = element.getBoundingClientRect()
    const style = window.getComputedStyle(element)
    return rect.width >= 32 && rect.height >= 32 && style.display !== 'none' && style.visibility !== 'hidden'
  }) ?? null
}

function maskRects(root: Element, capture: SurfaceCaptureRect): SurfaceCaptureRect[] {
  return [...root.querySelectorAll(SENSITIVE_SELECTOR)].flatMap((element) => {
    const rect = clippedRect(element)
    if (rect.width < 1 || rect.height < 1) return []
    // 与捕获区域求真实交集：敏感元素可能被滚动到捕获区域之外（设置页内容区可滚动），
    // 此前只做 max(0, …) 会把区域外的元素折叠成贴边的黑条，遮住无关内容。
    const left = Math.max(0, Math.floor(rect.left) - capture.x)
    const top = Math.max(0, Math.floor(rect.top) - capture.y)
    const right = Math.min(capture.width, Math.ceil(rect.right) - capture.x)
    const bottom = Math.min(capture.height, Math.ceil(rect.bottom) - capture.y)
    const width = right - left
    const height = bottom - top
    return width > 0 && height > 0 ? [{ x: left, y: top, width, height }] : []
  }).slice(0, 128)
}

async function nativeAssetObservation(surfaceId: string, mediaRef: string) {
  if (!mediaRef.startsWith('asset:')) throw new Error('INVALID_INPUT')
  const asset = await inspectAsset(mediaRef.slice('asset:'.length))
  if (asset.inspectionStatus !== 'ready') throw new Error('SURFACE_MEDIA_UNAVAILABLE')
  return {
    surfaceId,
    providerId: 'assets.media_observer',
    sourceKind: 'native_media' as const,
    verificationKind: 'visual_pending_model' as const,
    attachment: assetToAgentAttachment(asset),
    maskedRegionCount: 0,
    capturedAt: new Date().toISOString(),
  }
}

export async function observeApplicationSurface(input: {
  surfaceId: string
  purpose: string
  mediaRef?: string
}, signal: AbortSignal) {
  if (signal.aborted) throw new DOMException('操作已取消', 'AbortError')
  const surface = getApplicationSurface(input.surfaceId)
  if (!surface) throw new Error('NOT_FOUND')
  if (input.mediaRef && prefersNativeMediaObservation(surface.id)) {
    return await nativeAssetObservation(surface.id, input.mediaRef)
  }
  const surfaceElement = findVisibleSurface(surface.id)
  if (!surfaceElement) throw new Error('SURFACE_NOT_VISIBLE')
  const specializedRegion = surface.observationProviderId === 'surface.region_observer'
    ? null
    : [...surfaceElement.querySelectorAll('[data-application-observation-region]')].find(
      (candidate) => candidate.getAttribute('data-application-observation-region') === surface.observationProviderId
    )
  const element = specializedRegion ?? surfaceElement
  const rect = integerCaptureRect(clippedRect(element))
  if (rect.width < 32 || rect.height < 32) throw new Error('SURFACE_NOT_VISIBLE')
  const masks = maskRects(element, rect)
  logger.info('应用表面观察请求', {
    event: 'surface_observation.requested',
    surfaceId: surface.id,
    providerId: surface.observationProviderId,
    purpose: input.purpose,
    width: rect.width,
    height: rect.height,
    maskCount: masks.length,
  })
  const captured = await getPlatform().media.captureApplicationSurface({
    schemaVersion: SURFACE_OBSERVATION_SCHEMA_VERSION,
    surfaceId: surface.id as ApplicationSurfaceId,
    rect,
    masks,
    maskPolicyId: surface.observationPolicy.maskPolicyId,
  })
  if (signal.aborted) throw new DOMException('操作已取消', 'AbortError')
  const saved = await saveBase64ToUploads(captured.dataUrl)
  const collected = await addMediaReferenceToLibrary({
    filePath: saved.fullPath,
    mediaType: 'image',
    source: 'generated',
    displayName: `${surface.id}-observation.png`,
  })
  const asset = await inspectAsset(collected.id)
  logger.info('应用表面观察完成', {
    event: 'surface_observation.completed',
    surfaceId: surface.id,
    providerId: surface.observationProviderId,
    assetId: asset.id,
    maskCount: captured.maskedRegionCount,
  })
  return {
    surfaceId: surface.id,
    providerId: surface.observationProviderId,
    sourceKind: surface.id === 'tool.camera_stage'
      ? 'viewport_3d' as const
      : surface.id === 'workspace.canvas' || surface.id === 'tool.image_edit'
        ? 'canvas_preview' as const
        : 'surface_region' as const,
    verificationKind: 'visual_pending_model' as const,
    attachment: assetToAgentAttachment(asset),
    maskedRegionCount: captured.maskedRegionCount,
    capturedAt: new Date().toISOString(),
  }
}
