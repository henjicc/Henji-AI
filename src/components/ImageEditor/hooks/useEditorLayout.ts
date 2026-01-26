import { useEffect, useMemo, useRef, useState } from 'react'

import type { CanvasState } from '../types'

interface UseEditorLayoutParams {
    imageUrl: string
    originalSrc?: string
    canvas: CanvasState
    onImageLoaded?: (image: HTMLImageElement, size: { width: number; height: number }) => void
}

interface UseEditorLayoutResult {
    image: HTMLImageElement | null
    imageSize: { width: number; height: number }
    stageSize: { width: number; height: number }
    displaySize: { width: number; height: number; scale: number }
    baseScale: number
    containerRef: React.RefObject<HTMLDivElement>
}

export function useEditorLayout({
    imageUrl,
    originalSrc,
    canvas,
    onImageLoaded,
}: UseEditorLayoutParams): UseEditorLayoutResult {
    const [image, setImage] = useState<HTMLImageElement | null>(null)
    const [imageSize, setImageSize] = useState({ width: 0, height: 0 })
    const [stageSize, setStageSize] = useState({ width: 800, height: 600 })
    const containerRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        const img = new window.Image()
        img.crossOrigin = 'anonymous'
        img.src = originalSrc || imageUrl
        img.onload = () => {
            setImage(img)
            const size = { width: img.width, height: img.height }
            setImageSize(size)
            onImageLoaded?.(img, size)
        }
    }, [imageUrl, originalSrc, onImageLoaded])

    const baseScale = useMemo(() => {
        if (imageSize.width <= 0 || imageSize.height <= 0) return 1
        return Math.max(imageSize.width, imageSize.height) / 1000
    }, [imageSize])

    const displaySize = useMemo(() => {
        if (!image) return { width: 0, height: 0, scale: 1 }

        const rotation = canvas.rotation || 0
        const isRotated = rotation === 90 || rotation === 270
        const crop = canvas.cropRect

        let srcWidth = crop ? crop.width : image.width
        let srcHeight = crop ? crop.height : image.height

        if (isRotated) {
            ;[srcWidth, srcHeight] = [srcHeight, srcWidth]
        }

        return { width: srcWidth, height: srcHeight, scale: 1 }
    }, [image, canvas.rotation, canvas.cropRect])

    useEffect(() => {
        const updateSize = () => {
            if (!containerRef.current || !image) return
            const container = containerRef.current
            const containerWidth = container.clientWidth
            const containerHeight = container.clientHeight
            const padding = 10

            const { width: imgWidth, height: imgHeight } = displaySize
            if (imgWidth === 0 || imgHeight === 0) return

            const scaleX = (containerWidth - padding * 2) / imgWidth
            const scaleY = (containerHeight - padding * 2) / imgHeight
            const scale = Math.min(scaleX, scaleY, 1)

            setStageSize({
                width: Math.max(imgWidth * scale, 100),
                height: Math.max(imgHeight * scale, 100),
            })
        }

        updateSize()
        window.addEventListener('resize', updateSize)
        return () => window.removeEventListener('resize', updateSize)
    }, [image, displaySize])

    return {
        image,
        imageSize,
        stageSize,
        displaySize,
        baseScale,
        containerRef,
    }
}
