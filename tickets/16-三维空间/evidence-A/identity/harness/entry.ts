import { videoEditRenderPictureClip, videoEditRenderWindowSet } from '@/core/videoEdit/renderCache'
import { installAuthorTrustGate, authorTrustContext } from '@/features/videoEdit/engine/videoEditAuthorTrust'
import { createVideoEditDocument, createVideoEditSequence, videoEditComposition, type VideoEditClip } from '@/core/videoEdit/document'
import { addressCodeMaterialFiles } from '@/core/videoEdit/codeMaterial/sources'
import { addLegacyVideoEditTracks } from '@/core/videoEdit/testFixtures'
import { textStyleSchema } from '@/core/imaging/vectorContent/text'
import { VideoEditRenderer } from '@/features/videoEdit/engine/videoEditRenderer'
import { mainDocument } from './comprehensive'
import { setVideoEditCodeGpuErrorObserver } from '@/features/videoEdit/engine/videoEditCodeGpu'

installAuthorTrustGate(async request=>{if((request.context??authorTrustContext(request.url??''))?.length)throw new Error('P1 只运行本脚本自创代码')})
const W=1920,H=1080
function card(id:string,kind:VideoEditClip['kind'],track:number):VideoEditClip { return {id,itemId:id,name:id,kind,track,start:0,duration:90,sourceInUs:0,sourceRemainder:{numerator:0,denominator:1},x:0,y:0,scale:1,rotation:0,opacity:1,volume:0,text:''} }
async function image(width=720,height=480):Promise<string> {
 const c=new OffscreenCanvas(width,height),x=c.getContext('2d')!; const g=x.createLinearGradient(0,0,width,height);g.addColorStop(0,'#163f6b');g.addColorStop(1,'#e7aa55');x.fillStyle=g;x.fillRect(0,0,width,height)
 x.fillStyle='#ffffff88';for(let i=0;i<12;i++)x.fillRect(i*63-12,31+i*7,34,360-i*19)
 const b=await c.convertToBlob();return await new Promise(resolve=>{const r=new FileReader();r.onload=()=>resolve(r.result as string);r.readAsDataURL(b)})
}
export async function take(config:{name:string;precise:boolean;half:boolean;effects:boolean;warp:boolean;nested:boolean;par:boolean;motion:boolean;text:boolean;boundary?:boolean;composite?:boolean}, spatial:boolean|number, at=37) {
 let d=createVideoEditDocument('P1'),s=createVideoEditSequence('identity');s.width=W;s.height=H;s.fps=30;s.frameRate={numerator:30,denominator:1};s.pixelAspectRatio=config.par?{numerator:4,denominator:3}:{numerator:1,denominator:1};s.motionBlur=config.motion;addLegacyVideoEditTracks(s);s.id='identity';d.sequences=[s]
 const path=await image();d.media=[{id:'media',name:'fixture',path,kind:'image',width:720,height:480,durationSeconds:3,hasAudio:false}];d.items=[{id:'picture',name:'picture',kind:'image',mediaId:'media'}]
 const p=card('picture','image',1);p.x=-.18;p.y=.08;p.scale=.72;p.anchorX=.27;p.anchorY=.63;p.rotation=13
 if(config.boundary){p.scale=.5;p.x=-.22;p.y=0}
 if(config.effects)p.effects=[{id:'blur',name:'blur',builtin:{id:'blur',params:{amount:7,mode:'uniform'}},enabled:true,amount:1} as never]
 if(config.warp)p.effects=[{id:'corner_pin',name:'pin',builtin:{id:'corner_pin',params:{tl_x:10,tl_y:5,tr_x:90,tr_y:0,br_x:100,br_y:95,bl_x:0,bl_y:100}},enabled:true,amount:1} as never]
 if(config.motion)p.curves={x:[{time:0,value:-.2,interpolation:'linear'},{time:60,value:.2,interpolation:'linear'}]}
 s.clips=[p]
 if(config.text){const t=card('text','text',2);t.text='三维空间 · IDENTITY 0123';t.x=.08;t.y=-.26;t.scale=.9;t.textStyle=textStyleSchema.parse({fontFamily:'HarmonyOS Sans SC',fontSize:72,fontWeight:700,fill:{enabled:true,color:'#ebddcc'}});s.clips.push(t)}
 const source=`export default {name:'alpha',width:1920,height:1080,draw(c,t){c.fillStyle='rgba(70,190,170,.35)';c.fillRect(1030,580,510,280);c.fillStyle='rgba(255,255,255,.7)';c.beginPath();c.arc(1380,480,100,0,Math.PI*2);c.fill()}}`
 const manifest=await addressCodeMaterialFiles(source);d.codeMaterials=[{id:'code',name:'alpha',defaultVersionId:'v',versions:[{id:'v',apiVersion:4,languageVersion:4,entry:manifest.entry,files:manifest.files}]}]
 const c=card('alpha','code',3);c.code={definitionId:'code',versionId:'v',parameters:{}}
 if(config.precise)c.effects=[{id:'glow',name:'high-precision-glow',builtin:{id:'glow',params:{strength:45,radius:15}},enabled:true,amount:1} as never]
 s.clips.push(c)
 if(config.nested){const child=createVideoEditSequence('child');child.id='child';child.width=W;child.height=H;child.fps=30;addLegacyVideoEditTracks(child);child.clips=[{...p,id:'child-picture',effects:undefined,curves:undefined,scale:.4,x:.25}];d.sequences.push(child);d.items.push({id:'nested',kind:'sequence',name:'nested',sequenceId:'child'});s.clips.push(card('nested','sequence',4))}
 if(config.composite){d=mainDocument(config.par,!config.precise);s=d.sequences[0];for(const media of d.media)media.path=await image(media.width,media.height);at=54}
 if(spatial){for(const sequence of d.sequences){for(const clip of sequence.clips){clip.spatial={enabled:true};clip.depth=0;clip.rotationX=0;clip.rotationY=0;clip.anchorDepth=0}sequence.spatialCamera={offsetX:0,offsetY:0,offsetZ:0,rotationX:0,rotationY:0,rotationZ:0,perspective:0,defocus:0}}}
 if(typeof spatial==='number'){
  const near=[{time:36,value:spatial,interpolation:'linear' as const},{time:37,value:0,interpolation:'linear' as const},{time:38,value:spatial,interpolation:'hold' as const}]
  for(const clip of s.clips)clip.curves={...clip.curves,depth:near.map(key=>({...key,value:key.value*clip.track})),rotationY:near}
  s.spatialCamera={curves:{offsetX:near,perspective:near,defocus:near.map(key=>({...key,value:Math.abs(key.value)}))}}
 }
 for(const sequence of d.sequences)for(const track of sequence.tracks)track.id=`${sequence.id}-track-${track.index}`
 const composition=videoEditComposition(d,s.id),r=new VideoEditRenderer(composition);if(config.half)r.setOutputScale(.5)
 const gpuErrors:string[]=[],restoreErrors=setVideoEditCodeGpuErrorObserver(message=>gpuErrors.push(message))
 try {
 let bitmap:Promise<ImageBitmap>|undefined;const capture=Object.assign((p:Promise<ImageBitmap>)=>{bitmap=p},{maxPixels:1920*1080*2});const result=await r.render(at,false,false,()=>true,undefined,undefined,'final',capture,true);await result.completion
 if(!result.presented||!bitmap)throw new Error('完整 Renderer 没有交付像素')
 const b=await bitmap,canvas=new OffscreenCanvas(b.width,b.height),ctx=canvas.getContext('2d')!;ctx.drawImage(b,0,0);b.close();const rgba=ctx.getImageData(0,0,canvas.width,canvas.height).data
 const internal=r as unknown as {compositor:{device:GPUDevice;precise?:{texture:GPUTexture;width:number;height:number}}};const precise=internal.compositor.precise;let raw:Uint8Array|undefined
 if(precise){const device=internal.compositor.device,bytesPerRow=Math.ceil(precise.width*8/256)*256,buffer=device.createBuffer({size:bytesPerRow*precise.height,usage:9}),enc=device.createCommandEncoder();enc.copyTextureToBuffer({texture:precise.texture},{buffer,bytesPerRow},[precise.width,precise.height]);device.queue.submit([enc.finish()]);await buffer.mapAsync(1);const mapped=new Uint8Array(buffer.getMappedRange());raw=new Uint8Array(precise.width*precise.height*8);for(let y=0;y<precise.height;y++)raw.set(mapped.subarray(y*bytesPerRow,y*bytesPerRow+precise.width*8),y*precise.width*8);buffer.unmap();buffer.destroy()}
 if(config.precise&&!raw)throw new Error('16 位夹具未经过高精度目标')
 if(gpuErrors.length)throw new Error(gpuErrors.join('\n'))
 const expectedWidth=Math.floor(composition.width*(config.half ? .5 : 1)),expectedHeight=config.half?540:1080;if(canvas.width!==expectedWidth||canvas.height!==expectedHeight)throw new Error(`原始像素尺寸错误 ${canvas.width}x${canvas.height}`)
 const encode=(a:Uint8Array|Uint8ClampedArray)=>{let out='';for(let i=0;i<a.length;i+=32768)out+=String.fromCharCode(...a.subarray(i,i+32768));return btoa(out)}
 return {contentBytes:JSON.stringify(composition.clips.map(videoEditRenderPictureClip)),windowSignature:videoEditRenderWindowSet(composition,{fontRevision:0,analysis:'P1'}).signature,width:canvas.width,height:canvas.height,rgba:encode(rgba),half:raw?encode(raw):null,precision:await r.precisionDiagnostics(),metrics:{gpuMs:result.gpuMs,decodeMs:result.decodeMs}}
 }finally{try{await r.dispose()}finally{restoreErrors()}}
}
Object.assign(globalThis,{take})
