import { useEffect, useMemo, useState } from 'react'

import { createLogger } from '@/core/logging'
import type { ImageEditCommandBusSnapshotV3 } from '../application/imageEditCommandBus'
import {
  ImageEditorPreviewClientV3,
  ImageEditorPreviewSupersededErrorV3,
  type ImageEditorManagedPreviewResultV3,
} from './imageEditorPreviewClientV3'
import {
  IMAGE_EDITOR_PREVIEW_DRAFT_MAX_EDGE_V3,
  IMAGE_EDITOR_PREVIEW_STABLE_MAX_EDGE_V3,
  projectImageEditorPreviewDocumentV3,
} from './previewDocumentV3'

const logger = createLogger('image_editor_v3.preview')

export interface ManagedImageEditorPreviewStateV3 {
  result: ImageEditorManagedPreviewResultV3 | null
  diagnostic: string | null
  rendering: boolean
}

export function useManagedImageEditorPreviewV3(
  sessionId: string,
  snapshot: ImageEditCommandBusSnapshotV3,
  enabled: boolean,
): ManagedImageEditorPreviewStateV3 {
  const client = useMemo(() => new ImageEditorPreviewClientV3({ sessionId }), [sessionId])
  const [state, setState] = useState<ManagedImageEditorPreviewStateV3>({
    result: null,
    diagnostic: null,
    rendering: enabled,
  })

  useEffect(() => () => client.dispose(), [client])

  useEffect(() => {
    setState({ result: null, diagnostic: null, rendering: enabled })
  }, [client, enabled])

  useEffect(() => {
    if (!enabled) {
      setState({ result: null, diagnostic: null, rendering: false })
      return
    }
    if (typeof Worker === 'undefined') {
      setState((current) => ({
        ...current,
        diagnostic: '当前环境不支持图片预览 Worker',
        rendering: false,
      }))
      return
    }
    let acceptsResult = true
    const document = projectImageEditorPreviewDocumentV3(snapshot)
    const quality = Object.keys(snapshot.previewOverrides).length > 0 ? 'draft' : 'stable'
    const maxDimension = quality === 'draft'
      ? IMAGE_EDITOR_PREVIEW_DRAFT_MAX_EDGE_V3
      : IMAGE_EDITOR_PREVIEW_STABLE_MAX_EDGE_V3
    setState((current) => ({ ...current, rendering: true }))
    void client.render({ document, quality, maxDimension }).then((result) => {
      if (!acceptsResult) {
        result.release()
        return
      }
      setState({
        result,
        diagnostic: result.diagnostics.length > 0 ? result.diagnostics.join('\n') : null,
        rendering: false,
      })
    }).catch((error: unknown) => {
      if (!acceptsResult || error instanceof ImageEditorPreviewSupersededErrorV3) return
      const message = error instanceof Error ? error.message : String(error)
      logger.warn('图片编辑 V3 预览失败，保留上一稳定帧', {
        event: 'image_editor_v3.preview.failed',
        context: {
          documentId: snapshot.document.id,
          revision: snapshot.document.revision,
          message,
        },
      })
      setState((current) => ({ ...current, diagnostic: message, rendering: false }))
    })
    return () => {
      acceptsResult = false
    }
  }, [client, enabled, snapshot])

  return state
}
