import { vi } from 'vitest'

function createCanvasContextStub(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const state: Record<PropertyKey, unknown> = { canvas }
  return new Proxy(state, {
    get(target, key) {
      if (key === 'measureText') {
        return (value: string) => ({
          width: value.length * 10,
          actualBoundingBoxAscent: 8,
          actualBoundingBoxDescent: 2,
        })
      }
      if (key === 'getImageData') {
        return () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 })
      }
      if (key === 'createImageData') {
        return (width: number, height: number) => ({
          data: new Uint8ClampedArray(width * height * 4),
          width,
          height,
        })
      }
      if (key === 'createLinearGradient' || key === 'createRadialGradient') {
        return () => ({ addColorStop: () => undefined })
      }
      if (key === 'createPattern') return () => null
      if (key === 'getTransform') {
        return () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 })
      }
      if (key === 'isPointInPath' || key === 'isPointInStroke') return () => false
      if (key in target) return target[key]
      return () => undefined
    },
    set(target, key, value) {
      target[key] = value
      return true
    },
  }) as unknown as CanvasRenderingContext2D
}

export function installKonvaCanvasTestContext(): void {
  const contexts = new WeakMap<HTMLCanvasElement, CanvasRenderingContext2D>()
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function getContext(
    this: HTMLCanvasElement,
    contextId: string,
  ) {
    if (contextId !== '2d') return null
    const existing = contexts.get(this)
    if (existing) return existing
    const context = createCanvasContextStub(this)
    contexts.set(this, context)
    return context
  } as unknown as typeof HTMLCanvasElement.prototype.getContext)
}

export function mockKonvaViewportRect(): void {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 400,
    bottom: 225,
    width: 400,
    height: 225,
    toJSON: () => ({}),
  })
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(400)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(225)
}
