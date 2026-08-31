import { useEffect, useRef } from 'react'
import type { CSSProperties } from 'react'

import type { ImageEditorManagedViewportCompositeV3 } from '../execution/viewportCompositeClientV3'

function tileKey(
  tile: ImageEditorManagedViewportCompositeV3['tiles'][number],
): string {
  return `${tile.outputRect.x}:${tile.outputRect.y}:${tile.outputRect.width}:${tile.outputRect.height}`
}

function tileStyle(
  result: ImageEditorManagedViewportCompositeV3,
  tile: ImageEditorManagedViewportCompositeV3['tiles'][number],
): CSSProperties {
  const scale = 2 ** result.mip
  const left = tile.outputRect.x * scale
  const top = tile.outputRect.y * scale
  const right = Math.min(
    result.documentWidth,
    (tile.outputRect.x + tile.outputRect.width) * scale,
  )
  const bottom = Math.min(
    result.documentHeight,
    (tile.outputRect.y + tile.outputRect.height) * scale,
  )
  return {
    left: `${left / result.documentWidth * 100}%`,
    top: `${top / result.documentHeight * 100}%`,
    width: `${(right - left) / result.documentWidth * 100}%`,
    height: `${(bottom - top) / result.documentHeight * 100}%`,
  }
}

/** Bitmap 在首次绘制后立即关闭；各小 canvas 自己保留已提交像素。 */
export function ImageEditorViewportTilesV3({
  result,
  label,
}: {
  result: ImageEditorManagedViewportCompositeV3
  label: string
}): JSX.Element {
  const canvasesRef = useRef(new Map<string, HTMLCanvasElement>())
  const releasedResultRef = useRef<ImageEditorManagedViewportCompositeV3 | null>(null)

  useEffect(() => {
    if (releasedResultRef.current === result) return
    try {
      for (const tile of result.tiles) {
        const canvas = canvasesRef.current.get(tileKey(tile))
        if (!canvas) throw new Error('视口成品瓦片缺少显示画布')
        canvas.width = tile.outputRect.width
        canvas.height = tile.outputRect.height
        const context = canvas.getContext('2d')
        if (!context) throw new Error('无法创建视口成品瓦片显示上下文')
        context.clearRect(0, 0, canvas.width, canvas.height)
        context.drawImage(tile.bitmap, 0, 0, canvas.width, canvas.height)
      }
    } finally {
      result.release()
      releasedResultRef.current = result
    }
  }, [result])

  return (
    <div
      role="img"
      aria-label={label}
      data-viewport-tile-frame
      data-viewport-mip={result.mip}
      className="pointer-events-none absolute inset-0"
    >
      {result.tiles.map((tile) => {
        const key = tileKey(tile)
        return (
          <canvas
            key={key}
            ref={(canvas) => {
              if (canvas) canvasesRef.current.set(key, canvas)
              else canvasesRef.current.delete(key)
            }}
            data-viewport-tile={key}
            className="absolute block"
            style={tileStyle(result, tile)}
          />
        )
      })}
    </div>
  )
}
