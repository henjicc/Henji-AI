import type {
  ImageEditorPresentationSurfaceElementsV3,
  ImageEditorPresentationSurfaceTransferV3,
} from './imageEditorPresentationSurfaceV3'

/** 主线程唯一的 transferControlToOffscreen 所有权边界。 */
export class ImageEditorDirectPresentationSurfaceV3 {
  private generation = 0
  private transferredCanvas: HTMLCanvasElement | null = null
  private activeGeneration = 0
  private elements: ImageEditorPresentationSurfaceElementsV3 | null = null

  attach(
    elements: ImageEditorPresentationSurfaceElementsV3,
  ): ImageEditorPresentationSurfaceTransferV3 | null {
    const gpu = elements.gpu
    const sameCanvas = Boolean(gpu) && this.transferredCanvas === gpu
    if (!sameCanvas) this.deactivate(this.elements)
    this.elements = elements
    this.setVisibility(elements, sameCanvas && this.activeGeneration > 0)
    if (!gpu) return null
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
    this.setVisibility(elements, true)
    this.activeGeneration = generation
    return true
  }

  deactivate(elements: ImageEditorPresentationSurfaceElementsV3 | null): void {
    if (elements) this.setVisibility(elements, false)
    this.activeGeneration = 0
  }

  dispose(): void {
    this.deactivate(this.elements)
    this.elements = null
    this.transferredCanvas = null
    this.activeGeneration = 0
  }

  private setVisibility(elements: ImageEditorPresentationSurfaceElementsV3, gpuActive: boolean): void {
    // GPU透明像素必须直接透出文档背景，不能透出旧CPU稳定帧；仅隐藏，不丢弃回退像素。
    elements.front.style.visibility = gpuActive ? 'hidden' : 'visible'
    // front 已是完整合成结果；备用副本不可再次叠加，否则半透明像素会被重复合成。
    elements.safety.style.visibility = 'hidden'
    if (elements.gpu) elements.gpu.style.visibility = gpuActive ? 'visible' : 'hidden'
  }
}
