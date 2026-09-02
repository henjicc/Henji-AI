import { useId, useLayoutEffect, useRef } from 'react'

import type { ImageEditorRenderSessionV3 } from '../execution/imageEditorRenderSessionV3'
import type { ImageEditorViewportLayoutV3 } from './useImageEditorViewportLayoutV3'

/** React 只负责一次性挂载前表面和安全表面，像素与相机合成都由 RenderSession 持有。 */
export function ImageEditorViewportTilesV3({
  session,
  layout,
  label,
}: {
  session: ImageEditorRenderSessionV3
  layout: ImageEditorViewportLayoutV3 | null
  label: string
}): JSX.Element {
  const surfaceId = useId()
  const frontRef = useRef<HTMLCanvasElement | null>(null)
  const safetyRef = useRef<HTMLCanvasElement | null>(null)

  useLayoutEffect(() => {
    const front = frontRef.current
    const safety = safetyRef.current
    if (!front || !safety) return
    return session.attachSurface({ surfaceId, front, safety })
  }, [session, surfaceId])

  useLayoutEffect(() => {
    if (layout) session.updateViewport(layout)
  }, [layout, session])

  return (
    <div
      role="img"
      aria-label={label}
      data-presentation-surface={surfaceId}
      className="pointer-events-none absolute inset-0 overflow-hidden"
    >
      <canvas
        ref={safetyRef}
        data-presentation-safety-surface
        className="absolute inset-0 block h-full w-full"
      />
      <canvas
        ref={frontRef}
        data-presentation-front-surface
        className="absolute inset-0 block h-full w-full"
      />
    </div>
  )
}
