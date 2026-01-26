export const TEXT_LINE_HEIGHT = 1.2

let measureContext: CanvasRenderingContext2D | null = null

function getMeasureContext(): CanvasRenderingContext2D | null {
    if (measureContext) return measureContext
    if (typeof document === 'undefined') return null
    const canvas = document.createElement('canvas')
    measureContext = canvas.getContext('2d')
    return measureContext
}

export function measureTextWidth(text: string, fontSize: number, fontFamily: string): number {
    const ctx = getMeasureContext()
    if (!ctx) return 0
    ctx.font = `${fontSize}px ${fontFamily}`
    return ctx.measureText(text).width
}
