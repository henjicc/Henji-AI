import path from 'node:path'
import { createRequire } from 'node:module'
import { readFile,writeFile,mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
const [repo,out,ref,referenceRoot]=process.argv.slice(2),here=path.dirname(fileURLToPath(import.meta.url))
const require=createRequire(path.join(repo,'package.json')),{createServer}=require('vite'),{chromium}=require('playwright')
let cases=[
 {name:'image-code',precise:false,half:false,effects:false,warp:false,nested:false,par:false,motion:false,text:false},
 ...['text','effects','warp','nested','par','motion'].map(name=>({name,precise:false,half:false,effects:false,warp:false,nested:false,par:false,motion:false,text:false,[name]:true})),
 ...['text','effects','warp','nested','par','motion'].map(name=>({name:`half-${name}`,precise:true,half:true,effects:false,warp:false,nested:false,par:false,motion:false,text:false,[name]:true})),
 {name:'all-16',precise:true,half:false,effects:true,warp:false,nested:true,par:false,motion:true,text:true}
]
const loaders=await readFile(path.join(repo,'src/features/videoEdit/engine/shaderEngines/componentLoaders.generated.ts'),'utf8');const shaderDeps=[...loaders.matchAll(/import\('([^']+)'\)/g)].map(m=>m[1]);
await mkdir(out,{recursive:true});const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-webgpu','--disable-background-timer-throttling']})
if(process.argv[6]==='composite')cases=[false,true].flatMap(precise=>[false,true].map(half=>({name:`composite-${precise?16:8}-${half?'half':'full'}`,precise,half,effects:true,warp:false,nested:true,par:false,motion:true,text:true,composite:true})))
const records=[],pageErrors={}
const boundary=process.argv[6]==='boundary'
try {
 for(const [label,root,variants] of (boundary?[['task',repo,[false]]]:[['main',referenceRoot,[false]],['task',repo,[false,true]]])) {
 const server=await createServer({configFile:false,root,cacheDir:path.join(repo,'.tmp',`t16-p1-vite-${label}-${ref}`),optimizeDeps:{entries:[],include:[...shaderDeps,'shaders/core','shaders/std','signalsmith-stretch','mediabunny','@shiguredo/rnnoise-wasm','es-module-lexer/js','highs','uuid','diff','pinyin-pro','acorn','esbuild-wasm','typescript']},publicDir:path.join(root,'public'),resolve:{alias:{'@':path.join(root,'src')}},server:{hmr:false,host:'127.0.0.1',port:0,fs:{allow:[repo,here]}},plugins:[{name:'probe',resolveId(id){if(id==='virtual:video-edit-render-engine')return '\0p1-engine'},load(id){if(id==='\0p1-engine')return `export const VIDEO_EDIT_RENDER_ENGINE_VERSION='p1-fixed-engine'`},configureServer(s){s.middlewares.use((req,res,next)=>{if(req.url==='/probe.ts'){res.setHeader('Content-Type','text/javascript');s.transformRequest('/@fs/'+path.join(here,'entry.ts').replaceAll('\\','/')).then(r=>res.end(r.code));return}if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end('<html><head><link rel="icon" href="data:,"></head><body><script type="module" src="/probe.ts"></script></body></html>');return}next()})}}]})
 await server.listen();const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`,{waitUntil:'domcontentloaded',timeout:120000})
 try{
 await page.waitForFunction(()=>typeof globalThis.take==='function',null,{timeout:120000})
 if(boundary){
 const sharp=require('sharp'),config={...cases[1],effects:true,boundary:true},results=[]
 const base=await page.evaluate(config=>globalThis.take(config,false),config),pixels=Buffer.from(base.rgba,'base64')
 await sharp(pixels,{raw:{width:base.width,height:base.height,channels:4}}).png().toFile(path.join(out,'reference.png'))
 for(const epsilon of [1e-2,1e-4,1e-6,1e-8])for(const frame of [36,37,38]){
 const result=await page.evaluate(({config,epsilon,frame})=>globalThis.take(config,epsilon,frame),{config,epsilon,frame}),raw=Buffer.from(result.rgba,'base64');let differentPixels=0,maxChannelDifference=0
 for(let i=0;i<raw.length;i+=4){let changed=false;for(let c=0;c<4;c++){const delta=Math.abs(raw[i+c]-pixels[i+c]);changed ||= delta>0;maxChannelDifference=Math.max(maxChannelDifference,delta)}differentPixels+=Number(changed)}
 const name=`epsilon-${epsilon}-f${frame}.png`;await sharp(raw,{raw:{width:result.width,height:result.height,channels:4}}).png().toFile(path.join(out,name));results.push({epsilon,frame,name,differentPixels,maxChannelDifference});console.log(JSON.stringify(results.at(-1)))
 if(frame===37&&differentPixels)process.exitCode=1
 }
 if(errors.length)process.exitCode=1;console.log('GPU ERRORS',JSON.stringify(errors));await writeFile(path.join(out,'boundary.json'),JSON.stringify({commit:execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim(),chrome:browser.version(),config,results,errors},null,2));continue
 }
 for(const spatial of variants)for(const config of cases){console.log('START',label,config.name,spatial);let result;for(let attempt=0;attempt<4;attempt++){try{result=await page.evaluate(({config,spatial})=>globalThis.take(config,spatial),{config,spatial});break}catch(e){if(!String(e).includes('Execution context was destroyed')||attempt===3)throw e;await page.waitForFunction(()=>typeof globalThis.take==='function',null,{timeout:120000})}}const name=`${label}-${spatial?'identity':'plain'}-${config.name}`;for(const [field,ext]of [['rgba','rgba'],['half','half']])if(result[field])await writeFile(path.join(out,`${name}.${ext}`),Buffer.from(result[field],'base64'));const {rgba,half,...info}=result;records.push({name,config,spatial,...info,rawHalf:!!half});console.log(name)}
 if(errors.length)process.exitCode=1;pageErrors[label]=errors;
 }catch(e){console.log(label,errors);throw e}finally{await page.close();await server.close()}
 }
 if(!boundary){
 const diffs=[];for(const config of cases)for(const spatial of [false,true])for(const ext of ['rgba','half']){const base=path.join(out,`main-plain-${config.name}.${ext}`),target=path.join(out,`task-${spatial?'identity':'plain'}-${config.name}.${ext}`);let a,b;try{a=await readFile(base);b=await readFile(target)}catch(e){if(ext==='half'&&!config.precise)continue;throw e}let count=0,max=0,pixels=0;const viewA=ext==='half'?new Uint16Array(a.buffer,a.byteOffset,a.length/2):a,viewB=ext==='half'?new Uint16Array(b.buffer,b.byteOffset,b.length/2):b;for(let i=0;i<viewA.length;i+=4){let changed=false;for(let c=0;c<4;c++){const delta=Math.abs(viewA[i+c]-viewB[i+c]);if(delta){count++;changed=true}max=Math.max(max,delta)}if(changed)pixels++}diffs.push({case:config.name,spatial,format:ext,length:a.length,sameSize:a.length===b.length,differentPixels:pixels,differentChannels:count,maxChannelDifference:max});if(count||a.length!==b.length)process.exitCode=1}
 const fingerprints=cases.map(config=>{const main=records.find(r=>r.name===`main-plain-${config.name}`),task=records.find(r=>r.name===`task-plain-${config.name}`);const sameContentBytes=main.contentBytes===task.contentBytes,sameWindowSignature=main.windowSignature===task.windowSignature;if(!sameContentBytes||!sameWindowSignature)process.exitCode=1;return {case:config.name,sameContentBytes,sameWindowSignature}})
 await writeFile(path.join(out,'matrix.json'),JSON.stringify({main:ref,task:execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim(),chrome:browser.version(),records,diffs,fingerprints,pageErrors},null,2));console.log(JSON.stringify({diffs,fingerprints}))
 }
}finally{await browser.close()}
