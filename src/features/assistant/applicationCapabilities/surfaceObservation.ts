import { inspectAsset } from '@/commands/assetLibrary'
import { createLogger } from '@/core/logging'
import {
  SURFACE_OBSERVATION_SCHEMA_VERSION,
  type SurfaceCaptureRect,
} from '@/core/assistant/surfaceObservation'
import {
  APPLICATION_WINDOW_OBSERVATION_TARGET,
  prefersNativeMediaObservation,
  type ApplicationObservationTarget,
} from '@/core/assistant/applicationSurfaces'
import { getApplicationSurface } from '@/features/navigation/application/surfaceCatalog'
import { addMediaReferenceToLibrary } from '@/features/assets/services/assetCollectionService'
import { getPlatform } from '@/platform'
import { saveBase64ToUploads } from '@/utils/save/uploads'
import { assetToAgentAttachment } from '../conversation/assistantAttachments'

const logger = createLogger('features.assistant.surface_observation')
/**
 * 观察截图要遮罩的区域：只认显式标记。
 *
 * 不再把所有输入控件一律涂黑——密钥输入框本身就是 `type="password"`，界面上显示的
 * 已经是圆点，截图里同样是圆点；而提示词、参数、搜索这些框涂黑只会让整窗观察失去
 * 意义。确实需要遮住的明文内容（例如展示本地绝对路径的状态行）由组件自己标注
 * `data-observation-sensitive`。
 */
const SENSITIVE_SELECTOR = '[data-observation-sensitive]'

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

async function nativeAssetObservation(target: string, mediaRef: string) {
  if (!mediaRef.startsWith('asset:')) throw new Error('INVALID_INPUT')
  const asset = await inspectAsset(mediaRef.slice('asset:'.length))
  if (asset.inspectionStatus !== 'ready') throw new Error('SURFACE_MEDIA_UNAVAILABLE')
  return {
    target,
    providerId: 'assets.media_observer',
    sourceKind: 'native_media' as const,
    verificationKind: 'visual_pending_model' as const,
    attachment: assetToAgentAttachment(asset),
    maskedRegionCount: 0,
    capturedAt: new Date().toISOString(),
  }
}

/** 整窗观察：以可见视口为捕获区域，遮罩范围覆盖整个文档。 */
function windowCaptureRegion(): { element: Element; rect: SurfaceCaptureRect } {
  const rect = integerCaptureRect(
    new DOMRect(0, 0, document.documentElement.clientWidth, document.documentElement.clientHeight)
  )
  return { element: document.body, rect }
}

function surfaceCaptureRegion(surfaceId: string): { element: Element; rect: SurfaceCaptureRect } {
  const surface = getApplicationSurface(surfaceId)
  if (!surface) throw new Error('NOT_FOUND')
  const surfaceElement = findVisibleSurface(surface.id)
  if (!surfaceElement) throw new Error('SURFACE_NOT_VISIBLE')
  const specializedRegion = surface.observationProviderId === 'surface.region_observer'
    ? null
    : [...surfaceElement.querySelectorAll('[data-application-observation-region]')].find(
      (candidate) => candidate.getAttribute('data-application-observation-region') === surface.observationProviderId
    )
  const element = specializedRegion ?? surfaceElement
  return { element, rect: integerCaptureRect(clippedRect(element)) }
}

function observationProviderFor(target: string): string {
  if (target === APPLICATION_WINDOW_OBSERVATION_TARGET) return 'application.window_observer'
  return getApplicationSurface(target)?.observationProviderId ?? 'surface.region_observer'
}

function sourceKindFor(target: string) {
  if (target === APPLICATION_WINDOW_OBSERVATION_TARGET) return 'application_window' as const
  if (target === 'tool.camera_stage') return 'viewport_3d' as const
  if (target === 'workspace.canvas' || target === 'tool.image_edit') return 'canvas_preview' as const
  return 'surface_region' as const
}

export async function observeApplicationSurface(input: {
  target: string
  purpose: string
  mediaRef?: string
}, signal: AbortSignal) {
  if (signal.aborted) throw new DOMException('操作已取消', 'AbortError')
  const target = input.target
  const isWindow = target === APPLICATION_WINDOW_OBSERVATION_TARGET
  if (!isWindow && !getApplicationSurface(target)) throw new Error('NOT_FOUND')
  if (input.mediaRef && !isWindow && prefersNativeMediaObservation(target)) {
    return await nativeAssetObservation(target, input.mediaRef)
  }
  // 整窗永远可用：窗口本身一直在，不需要先切页面。
  const { element, rect } = isWindow ? windowCaptureRegion() : surfaceCaptureRegion(target)
  if (rect.width < 32 || rect.height < 32) throw new Error('SURFACE_NOT_VISIBLE')
  const providerId = observationProviderFor(target)
  const maskPolicyId = isWindow
    ? 'surface.mask_declared_fields' as const
    : getApplicationSurface(target)?.observationPolicy.maskPolicyId ?? 'surface.mask_declared_fields' as const
  const masks = maskRects(element, rect)
  logger.info('应用界面观察请求', {
    event: 'surface_observation.requested',
    target,
    providerId,
    purpose: input.purpose,
    width: rect.width,
    height: rect.height,
    maskCount: masks.length,
  })
  const captured = await getPlatform().media.captureApplicationSurface({
    schemaVersion: SURFACE_OBSERVATION_SCHEMA_VERSION,
    target: target as ApplicationObservationTarget,
    rect,
    masks,
    maskPolicyId,
  })
  if (signal.aborted) throw new DOMException('操作已取消', 'AbortError')
  const saved = await saveBase64ToUploads(captured.dataUrl)
  const collected = await addMediaReferenceToLibrary({
    filePath: saved.fullPath,
    mediaType: 'image',
    source: 'generated',
    displayName: `${target}-observation.png`,
  })
  const asset = await inspectAsset(collected.id)
  logger.info('应用界面观察完成', {
    event: 'surface_observation.completed',
    target,
    providerId,
    assetId: asset.id,
    maskCount: captured.maskedRegionCount,
  })
  return {
    target,
    providerId,
    sourceKind: sourceKindFor(target),
    verificationKind: 'visual_pending_model' as const,
    attachment: assetToAgentAttachment(asset),
    maskedRegionCount: captured.maskedRegionCount,
    capturedAt: new Date().toISOString(),
  }
}
