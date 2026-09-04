import type {
  ImageEditorPresentationSurfaceElementsV3,
  ImageEditorPresentationSurfaceTransferV3,
} from './imageEditorPresentationSurfaceV3'

/** 主线程唯一的 transferControlToOffscreen 所有权边界。 */
export class ImageEditorDirectPresentationSurfaceV3 {
  private generation = 0
  private transferredCanvas: HTMLCanvasElement | null = null
  private activeGeneration = 0

  attach(
    elements: ImageEditorPresentationSurfaceElementsV3,
  ): ImageEditorPresentationSurfaceTransferV3 | null {
    const gpu = elements.gpu
    if (!gpu) return null
    gpu.style.visibility = this.activeGeneration > 0 ? 'visible' : 'hidden'
    if (this.transferredCanvas === gpu) return null
    const transfer = gpu.transferControlToOffscreen
    if (typeof transfer !== 'function') return null
    try {
      const canvas = transfer.call(gpu)
      this.transferredCanvas = gpu
      this.generation += 1
      return { surfaceGeneration: this.generation, canvas }
    } catch {
      return null
    }
  }

  accepts(elements: ImageEditorPresentationSurfaceElementsV3, generation: number): boolean {
    return Boolean(elements.gpu)
      && this.transferredCanvas === elements.gpu
      && generation === this.generation
  }

  activate(elements: ImageEditorPresentationSurfaceElementsV3, generation: number): boolean {
    if (!this.accepts(elements, generation)) return false
    elements.gpu!.dataset.surfaceGeneration = String(generation)
    elements.gpu!.style.visibility = 'visible'
    this.activeGeneration = generation
    return true
  }

  deactivate(elements: ImageEditorPresentationSurfaceElementsV3 | null): void {
    if (elements?.gpu) elements.gpu.style.visibility = 'hidden'
    this.activeGeneration = 0
  }

  dispose(): void {
    this.transferredCanvas = null
    this.activeGeneration = 0
  }
}
