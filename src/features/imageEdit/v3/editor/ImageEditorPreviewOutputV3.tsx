import { useEffect, useRef } from 'react'

import type { ImageEditorV3PreviewOutput } from './types'

export function ImageEditorFramePreviewV3({
  output,
  label,
}: {
  output: Extract<ImageEditorV3PreviewOutput, { kind: 'frame' }>
  label: string
}): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.width = output.width
    canvas.height = output.height
    const context = canvas.getContext('2d')
    context?.clearRect(0, 0, output.width, output.height)
    context?.drawImage(output.frame, 0, 0, output.width, output.height)
  }, [output])

  return <canvas ref={canvasRef} role="img" aria-label={label} className="block max-h-full max-w-full" />
}

export function ImageEditorUrlPreviewV3({
  output,
  label,
}: {
  output: Extract<ImageEditorV3PreviewOutput, { kind: 'url' }>
  label: string
}): JSX.Element {
  return (
    <img
      src={output.url}
      alt={label}
      className="block max-h-full max-w-full select-none object-contain"
      draggable={false}
    />
  )
}
