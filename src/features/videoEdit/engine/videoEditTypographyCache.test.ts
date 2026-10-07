import { afterEach, expect, it, vi } from 'vitest'
import { createVideoEditTestDocument } from '@/core/videoEdit/testFixtures'
import { createVideoEditGraphic } from '@/core/videoEdit/graphics'
import { videoEditComposition } from '@/core/videoEdit/document'
import { makeVideoEditItemClip } from '@/core/videoEdit/projectItems'
import { VideoEditCodeSources } from './videoEditCodeSources'
import { paintVideoEditGraphic } from './videoEditGraphicSurface'
const fontState = vi.hoisted(() => ({ revision: 0 }))
vi.mock('@/platform/fontFaces', () => ({ documentFontRevision: () => fontState.revision }))
vi.mock('./videoEditGraphicSurface', () => ({ paintVideoEditGraphic: vi.fn() }))
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); fontState.revision = 0 })
it('4K多层文字纹理跨帧及片段运动复用，样式/字体资源变化才重绘，淘汰与销毁关闭位图', async () => {
  class Bitmap { readonly close = vi.fn(); width = 3840; height = 2160 }
  vi.stubGlobal('ImageBitmap', Bitmap)
  vi.stubGlobal('OffscreenCanvas', class { constructor(public width: number, public height: number) {} getContext() { return {} } transferToImageBitmap() { return new Bitmap() } })
  const original = createVideoEditTestDocument('字体纹理缓存'); original.sequences[0].width = 3840; original.sequences[0].height = 2160
  const graphic = createVideoEditGraphic('text', 3840, 2160); graphic.objects[0].textStyle!.strokes = [{ enabled: true, color: graphic.objects[0].textStyle!.fill.color, width: 8, position: 'outside' }, { enabled: true, color: graphic.objects[0].textStyle!.background.color, width: 3, position: 'inside' }]
  graphic.objects[0].textStyle!.shadows = Array.from({ length: 4 }, (_, index) => ({ enabled: true, color: graphic.objects[0].textStyle!.background.color, opacity: .5, angle: index * 90, distance: 10, size: 2, blur: 8 }))
  original.items.push({ id: 'graphic', name: '多层文字', kind: 'graphic', graphic }); const clip = makeVideoEditItemClip(original, 'graphic', original.sequences[0].id, { frame: 0 }); original.sequences[0].clips.push(clip)
  let document = videoEditComposition(original, original.sequences[0].id)
  const runtime = { generator: vi.fn(), draw: vi.fn(), releaseUnused: vi.fn() }; const sources = new VideoEditCodeSources(document, async () => runtime)
  try {
    const first = await sources.prepare(document, document.clips, 0, () => true); const bitmap = first.pictures.get(clip.id) as unknown as Bitmap
    document = { ...document, clips: [{ ...document.clips[0], x: .2 }] }; sources.updateDocument(document)
    const second = await sources.prepare(document, document.clips, 1, () => true)
    expect(second.pictures.get(clip.id)).toBe(bitmap); expect(paintVideoEditGraphic).toHaveBeenCalledTimes(1); expect(runtime.draw).not.toHaveBeenCalled()
    const changed = structuredClone(document.clips[0].graphic!); changed.objects[0].textStyle!.tracking = 150
    document = { ...document, clips: [{ ...document.clips[0], graphic: changed }] }; sources.updateDocument(document)
    await sources.prepare(document, document.clips, 2, () => true); expect(bitmap.close).toHaveBeenCalledOnce(); expect(paintVideoEditGraphic).toHaveBeenCalledTimes(2)
    fontState.revision++; const third = await sources.prepare(document, document.clips, 3, () => true); expect(paintVideoEditGraphic).toHaveBeenCalledTimes(3)
    const current = third.pictures.get(clip.id) as unknown as Bitmap; await sources.dispose(); expect(current.close).toHaveBeenCalledOnce()
  } finally { await sources.dispose() }
})
