import { describe, expect, it } from 'vitest'
import { compileCodeMaterial } from './compiler'
import { evaluateCodeMaterial } from './evaluate'
import { CodeMaterialError } from './contract'
import { renameCodeMaterialFile } from './fileEdits'
import { addressCodeMaterialFiles, codeFilesFromInput, documentCodeSourceResolver, mergeCodeSources, pruneCodeSources, resolveCodeMaterialFiles, verifyCodeSourceReferences } from './sources'
import { codeElementAtSource, prepareCodeElementIndex } from '../codeElementSelection'
const main = `import { card, width as w } from './parts/card'
export default {apiVersion:1,languageVersion:3,name:'多文件',kind:'generator',mode:'static',width:100,height:100,durationSeconds:1,seed:1,parameters:{},render(ctx){return [card(w)];}}`
const card = `const width=20;
export const card = (size) => rect({x:0,y:0,width:size,height:width,fill:[1,0,0,1]});
export const width = 30;`
const validCard = card.replace('const width=20;', 'const height=20;').replace('height:width', 'height:height')
const input = (module = validCard) => ({ entry: 'main.ts', files: { 'main.ts': main, 'parts/card.ts': module } })
describe('代码多文件与内容寻址', () => {
  it('相对导入、别名、helper、不同文件同名隔离，元素保留模块位置', () => {
    const files = input(); files.files['main.ts'] = main.replace('export default', 'const height=90; export default')
    const program = compileCodeMaterial(files)
    const result = evaluateCodeMaterial(program, { time: 0, localTime: 0, sequenceTime: 0, width: 100, height: 100, frame: 0, fps: 30 })
    expect(result[0]).toMatchObject({ width: 30, height: 20, sourceSpan: { file: 'parts/card.ts', startLine: 2 } })
  })
  it.each([
    ['import {x} from "./card"; export const width=x; export const card=(x)=>x', '循环依赖'],
    ['export default {};', '禁止默认导出'],
    ['console.log(1);', '副作用'],
    ['export const card=(x)=>x;', '可用导出'],
  ])('拒绝模块错误并带文件名：%s', (source, expected) => {
    expect(() => compileCodeMaterial(input(source))).toThrow(expected)
    try { compileCodeMaterial(input(source)) } catch (error) { expect(error).toBeInstanceOf(CodeMaterialError); expect((error as CodeMaterialError).sourceSpan?.file).toBe(expected === '可用导出' ? 'main.ts' : 'parts/card.ts') }
  })
  it.each([['../outside', '根目录'], ['./missing', '可用文件'], ['typescript', '相对路径']])('拒绝无效导入 %s', (path, message) => { const files=input(); files.files['main.ts']=main.replace('./parts/card',path); expect(()=>compileCodeMaterial(files)).toThrow(message) })
  it('入口静态 parameters/types/shaders 可引用模块的嵌套字面量', () => {
    const files = { entry: 'main.ts', files: { 'main.ts': `import {params, types, shaders} from './defs'; export default {apiVersion:1,languageVersion:3,name:'静态声明',kind:'generator',mode:'static',width:100,height:100,durationSeconds:1,seed:1,parameters:params,types:types,shaders:shaders,render(ctx){return []}}`, 'defs.ts': `export const types={}; export const params={size:{type:'number',title:'尺寸',default:20,min:1,max:100,step:1}}; export const shaders={};` } }
    expect(compileCodeMaterial(files).parameters[0]).toMatchObject({ key: 'size', default: 20 })
  })
  it('WGSL导入字符串映射回模块行，并允许超过CPU字符串预算的静态着色器正文', () => {
    const files = { entry:'main.ts',files:{'main.ts':`import {wgsl} from './shader';export default {apiVersion:1,languageVersion:3,name:'WGSL',kind:'generator',mode:'static',width:100,height:100,durationSeconds:1,seed:1,parameters:{},shaders:{glow:{kind:'generator',wgsl:wgsl}},render(ctx){return [shader({name:'glow',x:0,y:0,width:100,height:100,time:0})]}}`, 'shader.ts':'\nexport const wgsl=`' + '// text\n'.repeat(600) + 'return vec4f(1.0);`;' } }
    expect(compileCodeMaterial(files).shaders?.[0]).toMatchObject({sourceFile:'shader.ts',sourceLine:2})
  })
  it('重命名与移动文件同步导入；错误定位与元素光标区分同偏移的文件', () => {
    const renamed=renameCodeMaterialFile(input(),'parts/card.ts','other/卡片.ts')
    expect(renamed.files['main.ts']).toContain('./other/卡片'); expect(compileCodeMaterial(renamed).languageVersion).toBe(3)
    const program=compileCodeMaterial(input());const index=prepareCodeElementIndex(program,{time:0,localTime:0,sequenceTime:0,width:100,height:100,frame:0,fps:30},{},()=>{throw new Error('无文字')})
    const span=index.bounds[0].sourceSpan!
    expect(codeElementAtSource(index,span.start,'parts/card.ts')).toBeDefined();expect(codeElementAtSource(index,span.start,'main.ts')).toBeUndefined()
    const broken=input(validCard.replace('width:size','width:1/0'))
    expect(()=>evaluateCodeMaterial(compileCodeMaterial(broken),{time:0,localTime:0,sequenceTime:0,width:100,height:100,frame:0,fps:30})).toThrow('parts/card.ts')
  })
  it('源码 UTF-8 SHA-256 去重、按哈希读回及无引用清理', async () => {
    const shared = 'export const color=[1,0,0,1];'; const addressed = await addressCodeMaterialFiles({ entry:'main.ts', files:{'main.ts':main,'a.ts':shared,'b.ts':shared} })
    expect(addressed.codeSources).toHaveLength(2); expect(addressed.files.find(file=>file.path==='a.ts')!.hash).toBe(addressed.files.find(file=>file.path==='b.ts')!.hash)
    const sources=mergeCodeSources(addressed.codeSources,addressed.codeSources)
    expect(resolveCodeMaterialFiles(addressed,documentCodeSourceResolver({codeSources:sources})).files['b.ts']).toBe(shared)
    const document={codeSources:sources,codeMaterials:[{versions:[{files:addressed.files.filter(file=>file.path==='main.ts')}]}]}
    expect(pruneCodeSources(document).codeSources).toHaveLength(1)
    expect(pruneCodeSources({...document,codeMaterials:[]}).codeSources).toHaveLength(0)
    await expect(verifyCodeSourceReferences(addressed,documentCodeSourceResolver({codeSources:sources}))).resolves.toBeUndefined()
    await expect(verifyCodeSourceReferences(addressed,documentCodeSourceResolver({codeSources:sources.map(value=>({...value,source:value.source+' '}))}))).rejects.toThrow('哈希')
  })
  it('source 简写与 main.ts 文件集合等价且写入二选一', async () => {
    const source=main.slice(main.indexOf('export default')).replace('[card(w)]','[]')
    expect(await addressCodeMaterialFiles(source)).toEqual(await addressCodeMaterialFiles(codeFilesFromInput({files:{'main.ts':source}})))
    expect(()=>codeFilesFromInput({source,files:{'main.ts':source}})).toThrow('其中一个')
    expect(()=>codeFilesFromInput({source,entry:'other.ts'})).toThrow('main.ts')
  })
  it('支持嵌套入口、../与.ts扩展名，移动模块同步其依赖；v1/v2不能使用多文件', () => {
    const files={entry:'root/entry.ts',files:{'root/entry.ts':main.replace('./parts/card','../parts/card.ts'),'parts/card.ts':'import {ink} from "../ink";'+validCard.replace('[1,0,0,1]','ink'),'ink.ts':'export const ink=[1,0,0,1];'}}
    const moved=renameCodeMaterialFile(files,'parts/card.ts','nested/deep/card.ts')
    expect(moved.files['nested/deep/card.ts']).toContain('../../ink')
    expect(compileCodeMaterial(moved).languageVersion).toBe(3)
    expect(()=>compileCodeMaterial({entry:'main.ts',files:{'main.ts':main.slice(main.indexOf('export default')).replace('languageVersion:3,','').replace('[card(w)]','[]'),'x.ts':'export const x=1;'}})).toThrow('v1/v2')
    expect(()=>compileCodeMaterial(input().files['main.ts'].replace('export default','export default {}; export default'))).toThrow('最后一个')
  })
  it('不按文件个数限额，跨文件累计AST预算', () => {
    const entry=main.slice(main.indexOf('export default')).replace('[card(w)]','[]')
    const files={entry:'main.ts',files:{'main.ts':entry,...Object.fromEntries(Array.from({length:100},(_,i)=>[`parts/m${i}.ts`,'export const x=1;']))}}
    expect(compileCodeMaterial(files).languageVersion).toBe(3)
    const large={...files,files:{...files.files,...Object.fromEntries(Array.from({length:1000},(_,i)=>[`more/m${i}.ts`,Array.from({length:10},(_,j)=>`export const x${j}=${j};`).join('')]))}}
    expect(()=>compileCodeMaterial(large)).toThrow('全部文件的 AST')
  })

})
