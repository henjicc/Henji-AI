/**
 * CropOverlay - 裁剪覆盖层组件
 */
import React, { useState, useRef, useEffect, useCallback } from 'react'
import type { CropRect, CropRatio, CropOverlayProps } from './types'

const RATIO_OPTIONS: { label: string; value: CropRatio; ratio?: number }[] = [
    { label: '自由', value: 'free' },
    { label: '1:1', value: '1:1', ratio: 1 },
    { label: '4:3', value: '4:3', ratio: 4 / 3 },
    { label: '3:4', value: '3:4', ratio: 3 / 4 },
    { label: '16:9', value: '16:9', ratio: 16 / 9 },
    { label: '9:16', value: '9:16', ratio: 9 / 16 },
    { label: '3:2', value: '3:2', ratio: 3 / 2 },
    { label: '2:3', value: '2:3', ratio: 2 / 3 },
    { label: '21:9', value: '21:9', ratio: 21 / 9 },
    { label: '4:5', value: '4:5', ratio: 4 / 5 },
    { label: '2:1', value: '2:1', ratio: 2 / 1 },
    { label: '原图', value: 'original' },
]

type HandleType = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'move'

export const CropOverlay: React.FC<CropOverlayProps> = ({
    imageWidth,
    imageHeight,
    cropRect,
    cropRatio,
    onCropRectChange,
}) => {
    const [isDragging, setIsDragging] = useState(false)
    const [handleType, setHandleType] = useState<HandleType | null>(null)
    const startPosRef = useRef({ x: 0, y: 0 })
    const startRectRef = useRef<CropRect>({ x: 0, y: 0, width: 0, height: 0 })

    // 获取当前选中比例的数值
    const getCurrentRatio = useCallback((): number | null => {
        if (cropRatio === 'free') return null
        if (cropRatio === 'original') return imageWidth / imageHeight
        const option = RATIO_OPTIONS.find(o => o.value === cropRatio)
        return option?.ratio ?? null
    }, [cropRatio, imageWidth, imageHeight])

    // 限制裁剪框在图片范围内
    const constrainRect = useCallback((rect: CropRect): CropRect => {
        let { x, y, width, height } = rect

        // 限制最小尺寸
        width = Math.max(20, width)
        height = Math.max(20, height)

        // 限制在图片范围内
        x = Math.max(0, Math.min(x, imageWidth - width))
        y = Math.max(0, Math.min(y, imageHeight - height))
        width = Math.min(width, imageWidth - x)
        height = Math.min(height, imageHeight - y)

        return { x, y, width, height }
    }, [imageWidth, imageHeight])

    // 应用比例约束
    const applyRatioConstraint = useCallback((rect: CropRect, ratio: number | null, handle: HandleType): CropRect => {
        if (!ratio) return rect

        let { x, y, width, height } = rect

        // 根据拖拽的手柄决定如何调整
        if (handle === 'move') {
            return rect
        }

        // 以宽度为基准调整高度
        const newHeight = width / ratio

        // 如果是从底部拖拽，调整高度
        if (handle.includes('s')) {
            height = newHeight
        } else if (handle.includes('n')) {
            const oldY = y + height
            height = newHeight
            y = oldY - height
        } else {
            // 其他情况，保持中心点
            const centerY = y + height / 2
            height = newHeight
            y = centerY - height / 2
        }

        return constrainRect({ x, y, width, height })
    }, [constrainRect])

    // 鼠标按下
    const handleMouseDown = useCallback((e: React.MouseEvent, type: HandleType) => {
        e.preventDefault()
        e.stopPropagation()
        setIsDragging(true)
        setHandleType(type)
        startPosRef.current = { x: e.clientX, y: e.clientY }
        startRectRef.current = { ...cropRect }
    }, [cropRect])

    // 鼠标移动
    useEffect(() => {
        if (!isDragging || !handleType) return

        const handleMouseMove = (e: MouseEvent) => {
            const dx = e.clientX - startPosRef.current.x
            const dy = e.clientY - startPosRef.current.y
            const start = startRectRef.current
            let newRect: CropRect = { ...start }

            switch (handleType) {
                case 'move':
                    newRect.x = start.x + dx
                    newRect.y = start.y + dy
                    break
                case 'nw':
                    newRect.x = start.x + dx
                    newRect.y = start.y + dy
                    newRect.width = start.width - dx
                    newRect.height = start.height - dy
                    break
                case 'n':
                    newRect.y = start.y + dy
                    newRect.height = start.height - dy
                    break
                case 'ne':
                    newRect.y = start.y + dy
                    newRect.width = start.width + dx
                    newRect.height = start.height - dy
                    break
                case 'e':
                    newRect.width = start.width + dx
                    break
                case 'se':
                    newRect.width = start.width + dx
                    newRect.height = start.height + dy
                    break
                case 's':
                    newRect.height = start.height + dy
                    break
                case 'sw':
                    newRect.x = start.x + dx
                    newRect.width = start.width - dx
                    newRect.height = start.height + dy
                    break
                case 'w':
                    newRect.x = start.x + dx
                    newRect.width = start.width - dx
                    break
            }

            // 应用比例约束
            const ratio = getCurrentRatio()
            if (ratio && handleType !== 'move') {
                newRect = applyRatioConstraint(newRect, ratio, handleType)
            }

            // 限制在图片范围内
            newRect = constrainRect(newRect)
            onCropRectChange(newRect)
        }

        const handleMouseUp = () => {
            setIsDragging(false)
            setHandleType(null)
        }

        window.addEventListener('mousemove', handleMouseMove)
        window.addEventListener('mouseup', handleMouseUp)
        return () => {
            window.removeEventListener('mousemove', handleMouseMove)
            window.removeEventListener('mouseup', handleMouseUp)
        }
    }, [isDragging, handleType, getCurrentRatio, applyRatioConstraint, constrainRect, onCropRectChange])

    // 当比例改变时，调整裁剪框
    useEffect(() => {
        const ratio = getCurrentRatio()
        if (!ratio) return

        // 以当前裁剪框中心为基准，应用新比例
        const centerX = cropRect.x + cropRect.width / 2
        const centerY = cropRect.y + cropRect.height / 2

        let newWidth = cropRect.width
        let newHeight = newWidth / ratio

        // 如果高度超出图片范围，以高度为基准
        if (newHeight > imageHeight) {
            newHeight = imageHeight * 0.8
            newWidth = newHeight * ratio
        }

        // 如果宽度超出图片范围，以宽度为基准
        if (newWidth > imageWidth) {
            newWidth = imageWidth * 0.8
            newHeight = newWidth / ratio
        }

        const newRect = constrainRect({
            x: centerX - newWidth / 2,
            y: centerY - newHeight / 2,
            width: newWidth,
            height: newHeight,
        })

        onCropRectChange(newRect)
    }, [cropRatio])

    return (
        <>
            {/* 裁剪遮罩 SVG */}
            <svg
                className="crop-overlay"
                style={{ position: 'absolute', top: 0, left: 0, width: imageWidth, height: imageHeight }}
            >
                <defs>
                    <mask id="crop-mask">
                        <rect x="0" y="0" width={imageWidth} height={imageHeight} fill="white" />
                        <rect
                            x={cropRect.x}
                            y={cropRect.y}
                            width={cropRect.width}
                            height={cropRect.height}
                            fill="black"
                        />
                    </mask>
                </defs>
                <rect
                    x="0"
                    y="0"
                    width={imageWidth}
                    height={imageHeight}
                    fill="rgba(0, 0, 0, 0.6)"
                    mask="url(#crop-mask)"
                />
            </svg>

            {/* 裁剪框 */}
            <div
                className="crop-area"
                style={{
                    position: 'absolute',
                    left: cropRect.x,
                    top: cropRect.y,
                    width: cropRect.width,
                    height: cropRect.height,
                }}
                onMouseDown={(e) => handleMouseDown(e, 'move')}
            >
                {/* 角落手柄 */}
                <div className="crop-handle crop-handle-nw" onMouseDown={(e) => handleMouseDown(e, 'nw')} />
                <div className="crop-handle crop-handle-ne" onMouseDown={(e) => handleMouseDown(e, 'ne')} />
                <div className="crop-handle crop-handle-sw" onMouseDown={(e) => handleMouseDown(e, 'sw')} />
                <div className="crop-handle crop-handle-se" onMouseDown={(e) => handleMouseDown(e, 'se')} />

                {/* 边缘手柄 */}
                <div className="crop-handle crop-handle-n" onMouseDown={(e) => handleMouseDown(e, 'n')} />
                <div className="crop-handle crop-handle-s" onMouseDown={(e) => handleMouseDown(e, 's')} />
                <div className="crop-handle crop-handle-w" onMouseDown={(e) => handleMouseDown(e, 'w')} />
                <div className="crop-handle crop-handle-e" onMouseDown={(e) => handleMouseDown(e, 'e')} />
            </div>
        </>
    )
}

export default CropOverlay
