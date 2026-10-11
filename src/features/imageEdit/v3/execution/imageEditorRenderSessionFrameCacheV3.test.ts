import { describe, expect, it, vi } from 'vitest'
import { createImageEditDocumentV3, createImageEditRasterLayerV3 } from '@/core/imageEdit/v3/documentFactory'
import { ImageEditorRenderSessionFrameCacheV3 } from './imageEditorRenderSessionFrameCacheV3'
import type { ImageEditorRenderSnapshotV3 } from './imageEditorRenderSessionContractsV3'
import type { ImageEditorManagedViewportCompositeV3 } from './viewportCompositeTypesV3'

function fixture() {
  const document = createImageEditDocumentV3({width:4,height:4,documentId:'cache'})
  const layer=createImageEditRasterLayerV3('a','主图')
  layer.source = {kind:'resource',resourceId:`sha256:${'a'.repeat(64)}`}
  document.layers = [layer]
  const snapshot: ImageEditorRenderSnapshotV3 = {document,renderGeneration:1,geometryHash:'4x4',quality:'stable',resourceDescriptors:[]}
  const result: ImageEditorManagedViewportCompositeV3 = {documentId:document.id,revision:0,renderGeneration:1,cameraSequence:1,geometryHash:'4x4',geometry:document.geometry,viewportKey:'view',coverage:'viewport',mip:0,documentWidth:4,documentHeight:4,diagnostics:[],tiles:[{bitmap:{width:4,height:4} as ImageBitmap,outputRect:{x:0,y:0,width:4,height:4}}],release:vi.fn()}
  return {snapshot,result}
}

describe('静态候选清晰帧缓存', () => {
  it('元数据升版可复用像素，但姿态、视口或资源额度描述变化必须重新求值', () => {
    const cache = new ImageEditorRenderSessionFrameCacheV3(), {snapshot,result}=fixture()
    const active = cache.store(cache.key(snapshot,'view'),result)
    const next = {...snapshot,document:{...snapshot.document,revision:2},renderGeneration:3}
    const reused = cache.read(cache.key(next,'view'),next,4)!
    expect(reused).toMatchObject({revision:2,renderGeneration:3,cameraSequence:4})
    expect(reused.tiles).toBe(result.tiles)
    const moved=structuredClone(next);moved.document.layers[0].transform=[1,0,0,1,2,0]
    expect(cache.read(cache.key(moved,'view'),moved,4)).toBeNull()
    expect(cache.read(cache.key(next,'pan'),next,4)).toBeNull()
    const resources:ImageEditorRenderSnapshotV3={...next,resourceDescriptors:[{resourceRef:`sha256:${'a'.repeat(64)}`,byteLength:16,mediaType:'image/png'}]}
    expect(cache.read(cache.key(resources,'view'),resources,4)).toBeNull()
    const metadata:ImageEditorRenderSnapshotV3={...next,resourceDescriptors:[{resourceRef:`sha256:${'b'.repeat(64)}`,byteLength:20,mediaType:'application/json'}]}
    const metadataFrame=cache.read(cache.key(metadata,'view'),metadata,4)!
    expect(metadataFrame.tiles).toBe(result.tiles)
    cache.clear(); expect(result.release).not.toHaveBeenCalled()
    active.release(); reused.release(); reused.release(); metadataFrame.release()
    expect(result.release).toHaveBeenCalledOnce()
  })
  it('按字节淘汰，仍在显示的租约不被关闭；超预算帧照常显示且不缓存', () => {
    const cache=new ImageEditorRenderSessionFrameCacheV3(64),a=fixture(),b=fixture(),big=fixture()
    const active=cache.store('a',a.result),other=cache.store('b',b.result)
    expect(cache.read('a',a.snapshot,1)).toBeNull()
    expect(a.result.release).not.toHaveBeenCalled()
    active.release();expect(a.result.release).toHaveBeenCalledOnce()
    big.result.tiles[0].bitmap={width:8,height:8} as ImageBitmap
    expect(cache.store('big',big.result)).toBe(big.result)
    expect(cache.read('big',big.snapshot,1)).toBeNull()
    other.release();cache.clear();expect(b.result.release).toHaveBeenCalledOnce()
  })
})
