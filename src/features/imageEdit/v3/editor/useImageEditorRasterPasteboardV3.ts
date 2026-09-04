import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RefObject } from 'react'

import {
  createImageEditorV3RequestId,
  readImageEditorV3FastProxy,
  readImageEditorV3SourceMetadata,
} from '@/commands/imageEditorV3'
import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes'
import type { ImageEditRasterLayerV3 } from '@/core/imageEdit/v3/layerTypes'
import { createLogger } from '@/core/logging'
import type {
  ImageEditorV3FastProxy,
  ImageEditorV3ResourceDescriptor,
  ImageEditorV3SourceMetadata,
} from '@/platform/contracts/imageEditorV3'
import type { ImageEditorViewportDocumentFrameV3 } from './useImageEditorViewportLayoutV3'
import {
  imageEditorRasterPasteboardTransformV3,
  imageEditorRasterProxyTransformV3,
  resolveImageEditorRasterPasteboardLayerV3,
  resolveImageEditorRasterPasteboardResourceLayersV3,
  resolveImageEditorRasterPasteboardStackV3,
} from './rasterPasteboardV3'

const logger = createLogger('features.image_edit.v3.raster_pasteboard')
const RASTER_PASTEBOARD_PROXY_MAX_DIMENSION_V3 = 2_048
const RASTER_PASTEBOARD_RESOURCE_LOAD_CONCURRENCY_V3 = 1
const RASTER_PASTEBOARD_ADMISSION_RETRY_DELAYS_MS_V3 = [150, 350, 750] as const
const RASTER_PASTEBOARD_SAFE_SOURCE_FORMATS_V3 = new Set(['jpeg', 'jpg', 'png', 'webp'])

export interface ImageEditorRasterPasteboardEntryV3 {
  layer: ImageEditRasterLayerV3
  sourceUrl: string
  proxy: Pick<ImageEditorV3FastProxy, 'width' | 'height'> | null
  metadata: Pick<ImageEditorV3SourceMetadata, 'width' | 'height'> | null
}

interface LoadedRasterPasteboardResourceV3 {
  resourceId: string
  sourceUrl: string
  proxy: Pick<ImageEditorV3FastProxy, 'width' | 'height'>
  metadata: Pick<ImageEditorV3SourceMetadata, 'width' | 'height'>
}

interface RasterPasteboardResourcePlanV3 {
  resourceRef: string
  layerIds: string[]
}

interface RasterPasteboardReadyStateV3 {
  identity: string | null
  layerIds: ReadonlySet<string>
}

export interface ImageEditorRasterPasteboardV3State {
  rootRef: RefObject<HTMLDivElement>
  entries: readonly ImageEditorRasterPasteboardEntryV3[]
  sourceIdentity: string | null
  ready: boolean
  alwaysVisible: boolean
  bindLayerFeedbackRef: (layerId: string) => (element: HTMLDivElement | null) => void
  markReady: (layerId: string) => void
  markFailed: () => void
  acquireMoveFeedback: (layerId: string) => HTMLDivElement | null
  releaseMoveFeedback: (committed: boolean) => void
  clearMoveFeedback: () => void
  completeStableHandoff: () => void
  updateFrame: (frame: ImageEditorViewportDocumentFrameV3) => void
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

function createAbortErrorV3(): Error {
  const error = new Error('栅格拖动代理准备已取消')
  error.name = 'AbortError'
  return error
}

function isAdmissionConcurrencyErrorV3(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return error.message.includes('Image editor source.fast_proxy concurrency limit reached')
    || error.message.includes('Image editor request concurrency limit reached')
}

function waitForRasterPasteboardRetryV3(delayMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(createAbortErrorV3())
      return
    }
    const handle = setTimeout(() => {
      signal.removeEventListener('abort', abort)
      resolve()
    }, delayMs)
    const abort = (): void => {
      clearTimeout(handle)
      reject(createAbortErrorV3())
    }
    signal.addEventListener('abort', abort, { once: true })
  })
}

async function readRasterPasteboardFastProxyV3(
  resourceRef: `sha256:${string}`,
  signal: AbortSignal,
): Promise<ImageEditorV3FastProxy> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await readImageEditorV3FastProxy({
        requestId: createImageEditorV3RequestId('raster-pasteboard-proxy'),
        resourceRef,
        maxDimension: RASTER_PASTEBOARD_PROXY_MAX_DIMENSION_V3,
      }, signal)
    } catch (error) {
      if (signal.aborted) throw createAbortErrorV3()
      const delayMs = RASTER_PASTEBOARD_ADMISSION_RETRY_DELAYS_MS_V3[attempt]
      if (delayMs === undefined || !isAdmissionConcurrencyErrorV3(error)) {
        throw error
      }
      logger.debug('多图层拖动代理等待请求准入后重试', {
        event: 'image_editor_v3.raster_pasteboard.prepare.retry',
        context: { attempt: attempt + 1, reason: 'concurrency' },
      })
      await waitForRasterPasteboardRetryV3(delayMs, signal)
    }
  }
}

function createProxyObjectUrl(proxy: ImageEditorV3FastProxy): string {
  return URL.createObjectURL(new Blob([proxy.bytes], { type: proxy.mediaType }))
}

function hasSafeRasterPasteboardSourceMetadataV3(
  metadata: ImageEditorV3SourceMetadata,
): boolean {
  return metadata.format !== null
    && RASTER_PASTEBOARD_SAFE_SOURCE_FORMATS_V3.has(metadata.format.toLowerCase())
    && metadata.bitsPerSample > 0
    && metadata.bitsPerSample <= 8
    && !metadata.hdr
    && (metadata.pages === null || metadata.pages === 1)
}

function createRasterPasteboardResourcePlanJsonV3(
  layers: readonly ImageEditRasterLayerV3[],
): string | null {
  const resources = new Map<string, RasterPasteboardResourcePlanV3>()
  for (const layer of layers) {
    if (layer.source.kind !== 'resource') continue
    const resourceRef = layer.source.resourceId
    const existing = resources.get(resourceRef)
    if (existing) existing.layerIds.push(layer.id)
    else resources.set(resourceRef, { resourceRef, layerIds: [layer.id] })
  }
  return resources.size > 0 ? JSON.stringify([...resources.values()]) : null
}

export function useImageEditorRasterPasteboardV3(
  document: ImageEditDocumentV3,
  sourceImageUrl: string,
  documentWidth: number,
  enabled: boolean,
  resourceDescriptors: readonly ImageEditorV3ResourceDescriptor[],
  stableDisplayRef: RefObject<HTMLDivElement>,
  resourcePreparationReady = true,
): ImageEditorRasterPasteboardV3State {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const feedbackRefs = useRef(new Map<string, HTMLDivElement>())
  const feedbackRefBinders = useRef(new Map<
    string,
    (element: HTMLDivElement | null) => void
  >())
  const disposeResourceBatchRef = useRef<(() => void) | null>(null)
  const singleLayer = useMemo(
    () => enabled ? resolveImageEditorRasterPasteboardLayerV3(document) : null,
    [document, enabled],
  )
  const stackLayers = useMemo(
    () => enabled && !singleLayer
      ? resolveImageEditorRasterPasteboardStackV3(document, resourceDescriptors)
      : null,
    [document, enabled, resourceDescriptors, singleLayer],
  )
  const stackResourceLayers = useMemo(
    () => stackLayers
      ? resolveImageEditorRasterPasteboardResourceLayersV3(document, resourceDescriptors)
      : [],
    [document, resourceDescriptors, stackLayers],
  )
  const stackResourcePlanJson = stackLayers
    ? createRasterPasteboardResourcePlanJsonV3(stackResourceLayers)
    : null
  const [permittedResourcePlanJson, setPermittedResourcePlanJson] = useState<string | null>(null)
  const activeResourcePlanJson = permittedResourcePlanJson === stackResourcePlanJson
    ? permittedResourcePlanJson
    : null
  const [loadedStack, setLoadedStack] = useState<readonly LoadedRasterPasteboardResourceV3[] | null>(null)
  const [readyState, setReadyState] = useState<RasterPasteboardReadyStateV3>(() => ({
    identity: null,
    layerIds: new Set(),
  }))
  const [loadFailed, setLoadFailed] = useState(false)

  useEffect(() => {
    if (!stackResourcePlanJson) {
      setPermittedResourcePlanJson(null)
      return
    }
    if (resourcePreparationReady) setPermittedResourcePlanJson(stackResourcePlanJson)
  }, [resourcePreparationReady, stackResourcePlanJson])

  useEffect(() => {
    if (!activeResourcePlanJson) {
      setLoadedStack(null)
      setLoadFailed(false)
      return
    }
    const stackResourcePlan = JSON.parse(activeResourcePlanJson) as RasterPasteboardResourcePlanV3[]
    const abortController = new AbortController()
    const objectUrls = new Set<string>()
    const revokeObjectUrls = (): void => {
      for (const objectUrl of objectUrls) URL.revokeObjectURL(objectUrl)
      objectUrls.clear()
    }
    const disposeBatch = (): void => {
      abortController.abort()
      revokeObjectUrls()
    }
    disposeResourceBatchRef.current = disposeBatch
    setLoadedStack(null)
    setLoadFailed(false)
    logger.debug('多图层拖动代理开始准备', {
      event: 'image_editor_v3.raster_pasteboard.prepare.start',
      context: {
        documentId: document.id,
        layerCount: stackResourcePlan.reduce((count, resource) => count + resource.layerIds.length, 0),
        resourceCount: stackResourcePlan.length,
      },
    })
    const loadEntry = async ({
      resourceRef: rawResourceRef,
    }: RasterPasteboardResourcePlanV3): Promise<LoadedRasterPasteboardResourceV3> => {
      if (!rawResourceRef) throw new Error('栅格拖动代理缺少资源引用')
      const resourceRef = rawResourceRef as `sha256:${string}`
      const metadata = await readImageEditorV3SourceMetadata({
        requestId: createImageEditorV3RequestId('raster-pasteboard-metadata'),
        resourceRef,
      }, abortController.signal)
      if (abortController.signal.aborted) {
        const error = new Error('栅格拖动代理准备已取消')
        error.name = 'AbortError'
        throw error
      }
      if (
        metadata.resourceRef !== resourceRef
        || metadata.width <= 0
        || metadata.height <= 0
        || !hasSafeRasterPasteboardSourceMetadataV3(metadata)
      ) throw new Error('栅格拖动代理源格式不支持安全直显')
      const proxy = await readRasterPasteboardFastProxyV3(resourceRef, abortController.signal)
      if (abortController.signal.aborted) {
        throw createAbortErrorV3()
      }
      if (
        proxy.resourceRef !== resourceRef
        || proxy.width <= 0
        || proxy.height <= 0
      ) throw new Error('栅格拖动代理返回了不匹配的资源')
      const sourceUrl = createProxyObjectUrl(proxy)
      objectUrls.add(sourceUrl)
      return {
        resourceId: resourceRef,
        sourceUrl,
        proxy: { width: proxy.width, height: proxy.height },
        metadata: { width: metadata.width, height: metadata.height },
      }
    }
    const loadResourcePlan = async (): Promise<readonly LoadedRasterPasteboardResourceV3[]> => {
      const entries = new Array<LoadedRasterPasteboardResourceV3>(stackResourcePlan.length)
      let nextIndex = 0
      const worker = async (): Promise<void> => {
        while (nextIndex < stackResourcePlan.length) {
          const index = nextIndex
          nextIndex += 1
          entries[index] = await loadEntry(stackResourcePlan[index])
        }
      }
      await Promise.all(Array.from(
        { length: Math.min(RASTER_PASTEBOARD_RESOURCE_LOAD_CONCURRENCY_V3, stackResourcePlan.length) },
        () => worker(),
      ))
      return entries
    }
    void loadResourcePlan().then((entries) => {
      if (abortController.signal.aborted) return
      setLoadedStack(entries)
      logger.debug('多图层拖动代理准备完成', {
        event: 'image_editor_v3.raster_pasteboard.prepare.completed',
        context: {
          documentId: document.id,
          layerCount: stackResourcePlan.reduce((count, resource) => count + resource.layerIds.length, 0),
          resourceCount: entries.length,
        },
      })
    }).catch((error: unknown) => {
      disposeBatch()
      if (isAbortError(error)) return
      setLoadFailed(true)
      logger.warn('多图层拖动代理准备失败，继续使用受管合成', {
        event: 'image_editor_v3.raster_pasteboard.prepare.failed',
        context: {
          documentId: document.id,
          errorName: error instanceof Error ? error.name : 'UnknownError',
          errorCategory: isAdmissionConcurrencyErrorV3(error)
            ? 'admission_concurrency'
            : 'resource_prepare',
        },
      })
    })
    return () => {
      if (disposeResourceBatchRef.current === disposeBatch) {
        disposeResourceBatchRef.current = null
      }
      disposeBatch()
    }
  }, [activeResourcePlanJson, document.id])

  const entries = useMemo<readonly ImageEditorRasterPasteboardEntryV3[]>(() => {
    if (singleLayer) {
      return [{
        layer: singleLayer,
        sourceUrl: sourceImageUrl,
        proxy: null,
        metadata: null,
      }]
    }
    if (!stackLayers || !loadedStack || loadFailed) return []
    const loadedByResourceId = new Map(loadedStack.map((entry) => [entry.resourceId, entry]))
    const resolved = stackLayers.map((layer) => {
      if (layer.source.kind !== 'resource') return null
      const loaded = loadedByResourceId.get(layer.source.resourceId)
      if (!loaded) return null
      return {
        layer,
        sourceUrl: loaded.sourceUrl,
        proxy: loaded.proxy,
        metadata: loaded.metadata,
      }
    })
    return resolved.every((entry) => entry !== null)
      ? resolved as ImageEditorRasterPasteboardEntryV3[]
      : []
  }, [loadFailed, loadedStack, singleLayer, sourceImageUrl, stackLayers])
  const sourceIdentity = singleLayer?.source.kind === 'resource'
    ? `single:${singleLayer.source.resourceId}:${sourceImageUrl}`
    : stackLayers && entries.length > 0 ? `stack:${stackResourcePlanJson}` : null
  const ready = sourceIdentity !== null
    && readyState.identity === sourceIdentity
    && entries.length > 0
    && entries.every((entry) => readyState.layerIds.has(entry.layer.id))
  const alwaysVisible = Boolean(singleLayer)

  const bindLayerFeedbackRef = useCallback((layerId: string) => {
    const existing = feedbackRefBinders.current.get(layerId)
    if (existing) return existing
    const binder = (element: HTMLDivElement | null): void => {
      if (element) feedbackRefs.current.set(layerId, element)
      else feedbackRefs.current.delete(layerId)
    }
    feedbackRefBinders.current.set(layerId, binder)
    return binder
  }, [])
  const markReady = useCallback((layerId: string): void => {
    if (!sourceIdentity) return
    setReadyState((current) => {
      const currentLayerIds = current.identity === sourceIdentity
        ? current.layerIds
        : new Set<string>()
      if (currentLayerIds.has(layerId)) return current
      const next = new Set(currentLayerIds)
      next.add(layerId)
      return { identity: sourceIdentity, layerIds: next }
    })
  }, [sourceIdentity])
  const markFailed = useCallback((): void => {
    disposeResourceBatchRef.current?.()
    disposeResourceBatchRef.current = null
    setLoadedStack(null)
    setLoadFailed(true)
  }, [])

  const showStableDisplay = useCallback((): void => {
    if (stableDisplayRef.current) stableDisplayRef.current.style.visibility = 'visible'
  }, [stableDisplayRef])
  const hideStableDisplay = useCallback((): void => {
    if (stableDisplayRef.current) stableDisplayRef.current.style.visibility = 'hidden'
  }, [stableDisplayRef])
  const showStack = useCallback((): void => {
    if (rootRef.current) rootRef.current.style.visibility = 'visible'
  }, [])
  const hideStack = useCallback((): void => {
    if (rootRef.current && !alwaysVisible) rootRef.current.style.visibility = 'hidden'
  }, [alwaysVisible])
  const clearMoveFeedback = useCallback((): void => {
    for (const feedback of feedbackRefs.current.values()) feedback.style.transform = ''
  }, [])
  const acquireMoveFeedback = useCallback((layerId: string): HTMLDivElement | null => {
    if (!ready) return null
    const feedback = feedbackRefs.current.get(layerId) ?? null
    if (!feedback) return null
    if (!alwaysVisible) {
      hideStableDisplay()
      showStack()
    }
    return feedback
  }, [alwaysVisible, hideStableDisplay, ready, showStack])
  const releaseMoveFeedback = useCallback((committed: boolean): void => {
    if (committed) return
    clearMoveFeedback()
    hideStack()
    showStableDisplay()
  }, [clearMoveFeedback, hideStack, showStableDisplay])
  const completeStableHandoff = useCallback((): void => {
    clearMoveFeedback()
    if (alwaysVisible) {
      hideStableDisplay()
      showStack()
      return
    }
    hideStack()
    showStableDisplay()
  }, [alwaysVisible, clearMoveFeedback, hideStableDisplay, hideStack, showStableDisplay, showStack])

  const updateFrame = useCallback((frame: ImageEditorViewportDocumentFrameV3): void => {
    for (const entry of entries) {
      const feedback = feedbackRefs.current.get(entry.layer.id)
      if (!feedback) continue
      feedback.style.left = `${frame.left}px`
      feedback.style.top = `${frame.top}px`
      const image = feedback.querySelector('img')
      if (!(image instanceof HTMLImageElement)) continue
      image.style.transform = entry.proxy && entry.metadata
        ? imageEditorRasterProxyTransformV3(
            entry.layer.transform,
            frame.width,
            documentWidth,
            entry.proxy.width,
            entry.proxy.height,
            entry.metadata.width,
            entry.metadata.height,
          )
        : imageEditorRasterPasteboardTransformV3(
            entry.layer.transform,
            frame.width,
            documentWidth,
          )
    }
  }, [documentWidth, entries])

  return {
    rootRef,
    entries,
    sourceIdentity,
    ready,
    alwaysVisible,
    bindLayerFeedbackRef,
    markReady,
    markFailed,
    acquireMoveFeedback,
    releaseMoveFeedback,
    clearMoveFeedback,
    completeStableHandoff,
    updateFrame,
  }
}
