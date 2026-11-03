const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),assert=require('node:assert/strict'),sharp=require('sharp'),{randomUUID}=require('node:crypto')
// 小短片「星核」：正式应用里经助手接口建场景、开泛光/遮蔽/反射，逐帧取节目画面。T35_FRAMES=逗号列表 只取部分帧；T35_PROJECT 保留工程。
const root=process.cwd(),out=path.resolve(process.argv[2]),here=__dirname
const {launchElectronApp,waitForApp}=require(path.join(root,'scripts/lib/electronLaunch.cjs'))
const {assignIsolatedMcpPort,authorizeMcpConnection,connectMcpClient,callTool,operationEnvelope,readAllMedia,disableMcp}=require(path.join(root,'scripts/lib/uiInspectionMcpClient.cjs'))
const {seedVideoEditProject,readVideoEditFile}=require(path.join(root,'scripts/lib/uiInspectionVideoEditDocuments.cjs'))
function loadFixture(){const name=path.join(here,'film-fixture.ts'),result=require('esbuild').buildSync({entryPoints:[name],bundle:true,format:'cjs',platform:'node',write:false,packages:'external',alias:{'@':path.join(root,'src')},define:{'import.meta.env':'{"DEV":false,"PROD":true,"MODE":"production"}'},logLevel:'silent'}),mod=new Module(name,module);mod.filename=name;mod.paths=Module._nodeModulePaths(root);mod._compile(result.outputFiles[0].text,name);return mod.exports.buildDocument}
;(async()=>{
 fs.mkdirSync(out,{recursive:true});const bg=path.join(out,'background.png')
 await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080"><defs><radialGradient id="g" cx="50%" cy="45%" r="75%"><stop offset="0" stop-color="#0d0d14"/><stop offset="1" stop-color="#040406"/></radialGradient></defs><rect width="1920" height="1080" fill="url(#g)"/></svg>')).png().toFile(bg)
 const fixture=loadFixture()([bg])
 const session=await launchElectronApp({mainEntry:path.join(root,'out/main/index.cjs'),appPath:root,cwd:root,isolateUserData:true,useElectronApi:true,skipOnboarding:true,extraArgs:['--background','--enable-unsafe-webgpu']});let client
 try{
 const page=session.page;page.on('pageerror',e=>console.error(e.stack));page.on('console',m=>{if(m.type()==='error'||m.type()==='warning')console.error('[c]',m.text().slice(0,600))})
 await waitForApp(page);await assignIsolatedMcpPort(page);const seeded=await seedVideoEditProject(page,fixture)
 const identity=await authorizeMcpConnection(page,{name:'ticket 35 小短片'});client=await connectMcpClient(identity.config,'ticket35 film')
 const documentRef={kind:'video_edit.document',id:seeded.documentId},sequenceRef={kind:'video_edit.sequence',id:`${seeded.documentId}:main`}
 const invoke=(name,args)=>callTool(client,name,args)
 await invoke('open_document',operationEnvelope([],{documentId:seeded.documentId}))
 const change=(summary,changes)=>invoke('change_application_entities',operationEnvelope([],{summary,changes}))
 const source=fs.readFileSync(path.join(here,'../harness/film-scene.ts'),'utf8')
 await change('创建三维场景',[{kind:'create_items',entityType:'video_edit.code_material',parent:documentRef,items:[{properties:{'video_edit.code_material.source':source}}]}])
 const item=readVideoEditFile(seeded.file).items.find(item=>item.kind==='code'&&item.name==='星核短片');assert.ok(item)
 await change('放置场景',[{kind:'create_items',entityType:'video_edit.clip',parent:sequenceRef,items:[{properties:{'video_edit.clip.item_id':item.id,'video_edit.clip.kind':'code','video_edit.clip.name':'星核','video_edit.clip.track':2,'video_edit.clip.start':0,'video_edit.clip.duration':300}}]}])
 await change('三维效果',[{kind:'set_properties',entityType:sequenceRef.kind,target:sequenceRef,properties:{'video_edit.sequence.space_bloom':Number(process.env.T35_BLOOM??.9),'video_edit.sequence.space_ambient_occlusion':.6,'video_edit.sequence.space_reflections':.8}}])
 const frames=process.env.T35_FRAMES?process.env.T35_FRAMES.split(',').map(Number):Array.from({length:300},(_,i)=>i)
 for(const frame of frames){const result=await invoke('observe_video_edit_frame',{documentRef,target:{kind:'program',sequenceRef,frame},maxWidth:1920,saveToAssets:true});const data=result.data;assert.ok(data.verification.verified,JSON.stringify(data));const media=await readAllMedia(client,data.resultRef,{chunkBytes:262144});fs.writeFileSync(path.join(out,`f${String(frame).padStart(3,'0')}.png`),media.bytes);console.log(frame)}
 if(process.env.T35_PROJECT){let projectRoot=path.dirname(seeded.file);while(!fs.existsSync(path.join(projectRoot,'.henji','project.json'))&&path.dirname(projectRoot)!==projectRoot)projectRoot=path.dirname(projectRoot);fs.rmSync(process.env.T35_PROJECT,{recursive:true,force:true});fs.cpSync(projectRoot,process.env.T35_PROJECT,{recursive:true})}
 }finally{await client?.close().catch(()=>{});await disableMcp(session.page).catch(()=>{});await session.close()}
})().catch(e=>{console.error(e);process.exitCode=1})
