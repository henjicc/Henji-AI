import { describe, expect, it } from 'vitest'
import { renameCodeMaterialFile } from './fileEdits'
import { resolveAuthorProjectImport } from './authorModulePaths'
import { addressCodeMaterialFiles, codeFilesFromInput, collectCodeSourceTexts, documentCodeSourceResolver, mergeCodeSources, pruneCodeSources, resolveCodeMaterialFiles, verifyCodeSourceReferences } from './sources'
const main = `import { card, width as w } from './parts/card'
export default {apiVersion:1,languageVersion:3,name:'多文件',kind:'generator',mode:'static',width:100,height:100,durationSeconds:1,seed:1,parameters:{},render(ctx){return [card(w)];}}`
const card = `const width=20;
export const card = (size) => rect({x:0,y:0,width:size,height:width,fill:[1,0,0,1]});
export const width = 30;`
const validCard = card.replace('const width=20;', 'const height=20;').replace('height:width', 'height:height')
const input = (module = validCard) => ({ entry: 'main.ts', files: { 'main.ts': main, 'parts/card.ts': module } })
describe('代码多文件与内容寻址', () => {






  it('源码 UTF-8 SHA-256 去重、按哈希读回及无引用清理', async () => {
    const shared = 'export const color=[1,0,0,1];'; const addressed = await addressCodeMaterialFiles({ entry:'main.ts', files:{'main.ts':main,'a.ts':shared,'b.ts':shared} })
    expect(addressed.codeSources).toHaveLength(2); expect(addressed.files.find(file=>file.path==='a.ts')!.hash).toBe(addressed.files.find(file=>file.path==='b.ts')!.hash)
    const sources=mergeCodeSources(addressed.codeSources,addressed.codeSources)
    expect(resolveCodeMaterialFiles(addressed,documentCodeSourceResolver()).files['b.ts']).toBe(shared)
    const document={codeMaterials:[{versions:[{files:addressed.files.filter(file=>file.path==='main.ts')}]}]}
    expect(pruneCodeSources(document)).toBe(document)
    expect(pruneCodeSources({...document,codeMaterials:[]}).codeMaterials).toEqual([])
    await expect(verifyCodeSourceReferences(addressed,documentCodeSourceResolver())).resolves.toBeUndefined()
    await expect(verifyCodeSourceReferences(addressed,{read: hash => sources.find(value=>value.hash===hash)!.source+' '})).rejects.toThrow('哈希')
  })

  it('发给渲染 Worker 的源码按哈希只发一次，已发版本不重复读取', async () => {
    const version = await addressCodeMaterialFiles(input())
    const sent = new Set<string>()
    const first = await collectCodeSourceTexts([version, version], sent)
    expect(Object.keys(first).sort()).toEqual(version.files.map(file => file.hash).sort())
    expect(first[version.files[0].hash]).toBe(input().files[version.files[0].path as 'main.ts'])
    expect(await collectCodeSourceTexts([version], sent)).toEqual({})
  })
  it('source 简写与 main.ts 文件集合等价且写入二选一', async () => {
    const source=main.slice(main.indexOf('export default')).replace('[card(w)]','[]')
    expect(await addressCodeMaterialFiles(source)).toEqual(await addressCodeMaterialFiles(codeFilesFromInput({files:{'main.ts':source}})))
    expect(()=>codeFilesFromInput({source,files:{'main.ts':source}})).toThrow('其中一个')
    expect(()=>codeFilesFromInput({source,entry:'other.ts'})).toThrow('main.ts')
  })



})

it('移动作者模块同步静态导入、再导出、动态导入与固定组件映射', () => {
  const files = { entry: 'main.js', files: { 'main.js': 'export {x} from "./parts/a.js"; const later = () => import("./parts/a.js");', 'parts/a.js': 'import {y} from "../data.js"; export const x=y;', 'data.js': 'export const y=3;', 'shader.wgsl': 'fn main() {}' }, resolvedImports: { 'parts/a.js': { component: 'data.js' } } }
  const moved = renameCodeMaterialFile(files, 'parts/a.js', 'deep/nested/a.mjs')
  expect(moved.files['main.js']).toBe('export {x} from "./deep/nested/a.mjs"; const later = () => import("./deep/nested/a.mjs");')
  expect(moved.files['deep/nested/a.mjs']).toContain('../../data.js')
  expect(moved.files['shader.wgsl']).toBe(files.files['shader.wgsl'])
  expect(resolveAuthorProjectImport(moved, 'deep/nested/a.mjs', 'component')).toBe('data.js')
  expect(resolveAuthorProjectImport(moved, 'main.js', './data')).toBe('data.js')
  expect(resolveAuthorProjectImport(moved, 'main.js', '../data.js')).toBeUndefined()
})
