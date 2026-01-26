import type {
    Annotation,
    ArrowAnnotation,
    BrushAnnotation,
    CircleAnnotation,
    RectAnnotation,
    TextAnnotation,
    ToolSettings,
} from '../types'

export function createAnnotationId(): string {
    return `ann_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
}

interface PointsBounds {
    minX: number
    minY: number
}

function getPointsBounds(points: number[]): PointsBounds {
    const xs = points.filter((_, i) => i % 2 === 0)
    const ys = points.filter((_, i) => i % 2 === 1)
    return {
        minX: Math.min(...xs),
        minY: Math.min(...ys),
    }
}

export function updateAnnotationPosition(annotation: Annotation, newX: number, newY: number): Annotation {
    if (annotation.type === 'arrow') {
        const arrow = annotation as ArrowAnnotation
        const { minX, minY } = getPointsBounds(arrow.points)
        const dx = newX - minX
        const dy = newY - minY
        return {
            ...arrow,
            points: arrow.points.map((p, i) => (i % 2 === 0 ? p + dx : p + dy)),
        }
    }

    if (annotation.type === 'brush') {
        const brush = annotation as BrushAnnotation
        const { minX, minY } = getPointsBounds(brush.points)
        const dx = newX - minX
        const dy = newY - minY
        return {
            ...brush,
            points: brush.points.map((p, i) => (i % 2 === 0 ? p + dx : p + dy)),
        }
    }

    return {
        ...annotation,
        x: newX,
        y: newY,
    }
}

export function updateAnnotationTransform(
    annotation: Annotation,
    newX: number,
    newY: number,
    scaleX: number,
    scaleY: number
): Annotation {
    if (annotation.type === 'rect') {
        const rect = annotation as RectAnnotation
        return {
            ...rect,
            x: newX,
            y: newY,
            width: Math.max(5, rect.width * scaleX),
            height: Math.max(5, rect.height * scaleY),
        }
    }

    if (annotation.type === 'circle') {
        const circle = annotation as CircleAnnotation
        return {
            ...circle,
            x: newX,
            y: newY,
            radiusX: Math.max(3, circle.radiusX * scaleX),
            radiusY: Math.max(3, circle.radiusY * scaleY),
        }
    }

    if (annotation.type === 'text') {
        const text = annotation as TextAnnotation
        return {
            ...text,
            x: newX,
            y: newY,
            fontSize: Math.max(8, Math.round(text.fontSize * Math.max(scaleX, scaleY))),
        }
    }

    if (annotation.type === 'arrow') {
        const arrow = annotation as ArrowAnnotation
        const { minX, minY } = getPointsBounds(arrow.points)
        const newPoints = arrow.points.map((p, i) => {
            if (i % 2 === 0) {
                return newX + (p - minX) * scaleX
            }
            return newY + (p - minY) * scaleY
        })
        return {
            ...arrow,
            points: newPoints,
        }
    }

    if (annotation.type === 'brush') {
        const brush = annotation as BrushAnnotation
        const { minX, minY } = getPointsBounds(brush.points)
        const newPoints = brush.points.map((p, i) => {
            if (i % 2 === 0) {
                return newX + (p - minX) * scaleX
            }
            return newY + (p - minY) * scaleY
        })
        return {
            ...brush,
            points: newPoints,
        }
    }

    return annotation
}

export function updateAnnotationWithSettings(
    annotation: Annotation,
    settings: Partial<ToolSettings>
): Annotation {
    if (annotation.type === 'text') {
        const text = annotation as TextAnnotation
        return {
            ...text,
            fill: settings.strokeColor !== undefined ? settings.strokeColor : text.fill,
            fontSize: settings.fontSize !== undefined ? settings.fontSize : text.fontSize,
        }
    }

    if (
        annotation.type === 'rect' ||
        annotation.type === 'circle' ||
        annotation.type === 'arrow' ||
        annotation.type === 'brush'
    ) {
        const stroke = settings.strokeColor !== undefined ? settings.strokeColor : annotation.stroke
        const strokeWidth = settings.strokeWidth !== undefined ? settings.strokeWidth : annotation.strokeWidth
        return {
            ...annotation,
            stroke,
            strokeWidth,
        }
    }

    return annotation
}

export function isAnnotationValid(annotation: Annotation): boolean {
    if (annotation.type === 'rect') {
        const rect = annotation as RectAnnotation
        return rect.width > 5 && rect.height > 5
    }

    if (annotation.type === 'circle') {
        const circle = annotation as CircleAnnotation
        return circle.radiusX > 3 && circle.radiusY > 3
    }

    if (annotation.type === 'arrow') {
        const arrow = annotation as ArrowAnnotation
        const dx = arrow.points[2] - arrow.points[0]
        const dy = arrow.points[3] - arrow.points[1]
        return Math.sqrt(dx * dx + dy * dy) > 10
    }

    if (annotation.type === 'brush') {
        const brush = annotation as BrushAnnotation
        return brush.points.length > 4
    }

    return false
}
