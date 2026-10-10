import { mapAffine, type Affine, type Point } from '@/core/imaging/transforms'
import { createImageEditorV3RequestId, readImageEditorV3SourceMetadata, readImageEditorV3SourceTile, readImageEditorV3BrushTiles } from '@/commands/imageEditorV3'
import type { ImageEditRasterLayerV3, ImageEditSmartLayerV3 } from '@/core/imageEdit/v3/layerTypes'

/** Keep the exact four support points in the requested world axes, with bounded pixel working memory. */
export class ImageLayoutAlphaSupport {
  private points:Point[]=[]
  private extremes=[Infinity,-Infinity,Infinity,-Infinity]
  constructor(private readonly matrix:Affine){}
  rectangle(x:number,y:number,w:number,h:number):void {
    for(const p of [[x,y],[x+w,y],[x+w,y+h],[x,y+h]] as Point[]) {
      const q=mapAffine(this.matrix,p),values=[q[0],q[0],q[1],q[1]]
      for(let i=0;i<4;i++) if(i%2?values[i]>this.extremes[i]:values[i]<this.extremes[i]){this.extremes[i]=values[i];this.points[i]=p}
    }
  }
  scan(width:number,height:number,alpha:(index:number)=>number,x=0,y=0):void {
    for(let row=0;row<height;row++) {
      let first=-1,last=-1
      for(let col=0;col<width;col++) if(alpha(row*width+col)>0){if(first<0)first=col;last=col}
      if(first>=0)this.rectangle(x+first,y+row,last-first+1,1)
    }
  }
  result():Point[]{return this.points.length===4?this.points:[]}
}

export async function measureImageLayoutRaster(layer:ImageEditRasterLayerV3|ImageEditSmartLayerV3,matrix:Affine,signal:AbortSignal,byteSizes:Readonly<Record<string,number>>):Promise<Point[]> {
  signal.throwIfAborted()
  const support=new ImageLayoutAlphaSupport(matrix)
  const keys=new Set(Object.keys(layer.tiles))
  if(layer.source.kind==='resource') {
    const resourceRef=layer.source.resourceId as `sha256:${string}`
    const metadata=await readImageEditorV3SourceMetadata({requestId:createImageEditorV3RequestId('layout-alpha'),resourceRef},signal)
    signal.throwIfAborted()
    if(!metadata.hasAlpha&&!keys.size){support.rectangle(0,0,metadata.width,metadata.height);return support.result()}
    for(let y=0;y<Math.ceil(metadata.height/512);y++)for(let x=0;x<Math.ceil(metadata.width/512);x++) {
      signal.throwIfAborted();if(keys.has(`0/${x}/${y}`))continue
      const tile=await readImageEditorV3SourceTile({requestId:createImageEditorV3RequestId('layout-alpha-tile'),resourceRef,mip:0,tileX:x,tileY:y,halo:0,bitDepth:32},signal)
      if(tile.bitDepth!==32||tile.pixels.byteLength!==tile.width*tile.height*16)throw new Error('图层边缘像素契约不符')
      // The formal tile contract is little-endian RGBA float32; do not quantize small nonzero alpha away.
      const rgba=new DataView(tile.pixels)
      support.scan(tile.width,tile.height,i=>rgba.getFloat32(i*16+12,true),tile.originX,tile.originY)
      await new Promise<void>(resolve=>setTimeout(resolve,0))
    }
  }
  for(const [key,resourceId]of Object.entries(layer.tiles)) {
    signal.throwIfAborted();const [mip,x,y]=key.split('/').map(Number);if(mip!==0)continue
    const byteSize=byteSizes[resourceId];if(!Number.isSafeInteger(byteSize)||byteSize<=0)throw new Error('图层边缘资源未就绪，请重试')
    const reply=await readImageEditorV3BrushTiles({requestId:createImageEditorV3RequestId('layout-brush-alpha'),tiles:[{tileKey:key,resource:{resourceId,byteSize}}]},signal)
    const tile=reply.tiles[0]?.tile
    if(!tile||tile.storage!=='rgba-float32')throw new Error('图层边缘瓦片损坏')
    support.scan(tile.width,tile.height,i=>tile.data[i*4+3],x*512,y*512)
  }
  return support.result()
}
