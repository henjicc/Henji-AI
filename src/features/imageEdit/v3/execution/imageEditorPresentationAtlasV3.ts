export const IMAGE_EDITOR_PRESENTATION_ATLAS_PAGE_SIZE_V3 = 4_096
export const IMAGE_EDITOR_PRESENTATION_ATLAS_GUTTER_V3 = 2
export const IMAGE_EDITOR_PRESENTATION_ATLAS_TILE_SIZE_V3 = 512
export const IMAGE_EDITOR_PRESENTATION_ATLAS_MAX_PAGES_V3 = 4

const CELL_SIZE = IMAGE_EDITOR_PRESENTATION_ATLAS_TILE_SIZE_V3
  + IMAGE_EDITOR_PRESENTATION_ATLAS_GUTTER_V3 * 2
const CELLS_PER_ROW = Math.floor(IMAGE_EDITOR_PRESENTATION_ATLAS_PAGE_SIZE_V3 / CELL_SIZE)
const SLOTS_PER_PAGE = CELLS_PER_ROW ** 2

interface AtlasPageV3 {
  canvas: HTMLCanvasElement
  context: CanvasRenderingContext2D
}

interface AtlasSlotV3 {
  pageIndex: number
  slotIndex: number
}

interface AtlasEntryV3 extends AtlasSlotV3 {
  key: string
  width: number
  height: number
  touchedAt: number
}

export interface ImageEditorPresentationAtlasRegionV3 {
  source: HTMLCanvasElement
  sourceX: number
  sourceY: number
  width: number
  height: number
}

export interface ImageEditorPresentationAtlasSnapshotV3 {
  pageCount: number
  entryCount: number
  estimatedBytes: number
}

/** 固定 4096 页、固定 512 槽位的成品图集；页面创建后永不 resize。 */
export class ImageEditorPresentationAtlasV3 {
  private readonly pages: AtlasPageV3[] = []
  private readonly freeSlots: AtlasSlotV3[] = []
  private readonly entries = new Map<string, AtlasEntryV3>()
  private sequence = 0
  private disposed = false

  store(key: string, bitmap: ImageBitmap): ImageEditorPresentationAtlasRegionV3 {
    if (this.disposed) throw new Error('图片编辑 Presentation atlas 已释放')
    if (!key) throw new Error('图片编辑 Presentation atlas key 不能为空')
    if (bitmap.width <= 0 || bitmap.height <= 0
      || bitmap.width > IMAGE_EDITOR_PRESENTATION_ATLAS_TILE_SIZE_V3
      || bitmap.height > IMAGE_EDITOR_PRESENTATION_ATLAS_TILE_SIZE_V3) {
      throw new Error('图片编辑成品瓦片超过固定 atlas 槽位')
    }
    const existing = this.entries.get(key)
    if (existing) {
      existing.touchedAt = ++this.sequence
      return this.region(existing)
    }
    const slot = this.takeSlot()
    const entry: AtlasEntryV3 = {
      ...slot,
      key,
      width: bitmap.width,
      height: bitmap.height,
      touchedAt: ++this.sequence,
    }
    this.upload(entry, bitmap)
    this.entries.set(key, entry)
    return this.region(entry)
  }

  snapshot(): ImageEditorPresentationAtlasSnapshotV3 {
    return {
      pageCount: this.pages.length,
      entryCount: this.entries.size,
      estimatedBytes: this.pages.length * IMAGE_EDITOR_PRESENTATION_ATLAS_PAGE_SIZE_V3 ** 2 * 4,
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.entries.clear()
    this.freeSlots.length = 0
    for (const page of this.pages) {
      page.canvas.width = 1
      page.canvas.height = 1
    }
    this.pages.length = 0
  }

  private takeSlot(): AtlasSlotV3 {
    const free = this.freeSlots.pop()
    if (free) return free
    if (this.pages.length < IMAGE_EDITOR_PRESENTATION_ATLAS_MAX_PAGES_V3) {
      return this.createPage()
    }
    let oldest: AtlasEntryV3 | null = null
    for (const entry of this.entries.values()) {
      if (!oldest || entry.touchedAt < oldest.touchedAt) oldest = entry
    }
    if (!oldest) throw new Error('图片编辑 Presentation atlas 无可用槽位')
    this.entries.delete(oldest.key)
    return { pageIndex: oldest.pageIndex, slotIndex: oldest.slotIndex }
  }

  private createPage(): AtlasSlotV3 {
    const canvas = document.createElement('canvas')
    canvas.width = IMAGE_EDITOR_PRESENTATION_ATLAS_PAGE_SIZE_V3
    canvas.height = IMAGE_EDITOR_PRESENTATION_ATLAS_PAGE_SIZE_V3
    const context = canvas.getContext('2d')
    if (!context) throw new Error('无法创建图片编辑 Presentation atlas 页面')
    const pageIndex = this.pages.length
    this.pages.push({ canvas, context })
    for (let slotIndex = SLOTS_PER_PAGE - 1; slotIndex >= 1; slotIndex -= 1) {
      this.freeSlots.push({ pageIndex, slotIndex })
    }
    return { pageIndex, slotIndex: 0 }
  }

  private upload(entry: AtlasEntryV3, bitmap: ImageBitmap): void {
    const page = this.pages[entry.pageIndex]
    if (!page) throw new Error('图片编辑 Presentation atlas 页面不存在')
    const { x, y } = this.slotOrigin(entry.slotIndex)
    const gutter = IMAGE_EDITOR_PRESENTATION_ATLAS_GUTTER_V3
    const context = page.context
    context.imageSmoothingEnabled = false
    context.clearRect(x, y, CELL_SIZE, CELL_SIZE)
    context.drawImage(bitmap, x + gutter, y + gutter)
    context.drawImage(bitmap, 0, 0, 1, bitmap.height, x, y + gutter, gutter, bitmap.height)
    context.drawImage(bitmap, bitmap.width - 1, 0, 1, bitmap.height, x + gutter + bitmap.width, y + gutter, gutter, bitmap.height)
    context.drawImage(bitmap, 0, 0, bitmap.width, 1, x + gutter, y, bitmap.width, gutter)
    context.drawImage(bitmap, 0, bitmap.height - 1, bitmap.width, 1, x + gutter, y + gutter + bitmap.height, bitmap.width, gutter)
    context.drawImage(bitmap, 0, 0, 1, 1, x, y, gutter, gutter)
    context.drawImage(bitmap, bitmap.width - 1, 0, 1, 1, x + gutter + bitmap.width, y, gutter, gutter)
    context.drawImage(bitmap, 0, bitmap.height - 1, 1, 1, x, y + gutter + bitmap.height, gutter, gutter)
    context.drawImage(bitmap, bitmap.width - 1, bitmap.height - 1, 1, 1, x + gutter + bitmap.width, y + gutter + bitmap.height, gutter, gutter)
  }

  private region(entry: AtlasEntryV3): ImageEditorPresentationAtlasRegionV3 {
    const page = this.pages[entry.pageIndex]
    if (!page) throw new Error('图片编辑 Presentation atlas 页面已释放')
    const { x, y } = this.slotOrigin(entry.slotIndex)
    return {
      source: page.canvas,
      sourceX: x + IMAGE_EDITOR_PRESENTATION_ATLAS_GUTTER_V3,
      sourceY: y + IMAGE_EDITOR_PRESENTATION_ATLAS_GUTTER_V3,
      width: entry.width,
      height: entry.height,
    }
  }

  private slotOrigin(slotIndex: number): { x: number; y: number } {
    return {
      x: (slotIndex % CELLS_PER_ROW) * CELL_SIZE,
      y: Math.floor(slotIndex / CELLS_PER_ROW) * CELL_SIZE,
    }
  }
}
