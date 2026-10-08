import { describe, expect, it, vi } from 'vitest'
import { compileCodeMaterial } from './compiler'
import { expandPinnedCodeComponents, portableCodeComponentFiles, pinCodeComponentImports, packageComponentSource, rewriteCodeComponentImports, componentSourceMetadata, type CodeComponent } from './components'
import { addressCodeMaterialFiles, codeComponentPinsSchema, componentFileReferences, codeVersionContentKey, documentCodeSourceResolver, installCodeSourceReader, loadCodeSourceReferences, type CodeComponentPin } from './sources'
import { renameCodeMaterialFile } from './fileEdits'

const entry = 'export default {languageVersion:3,apiVersion:1,name:"组件",kind:"generator",mode:"static",width:16,height:16,durationSeconds:1,seed:1,parameters:{},render(ctx){return [latest(),old()]}}'
describe('位置解析与固定组件依赖', () => {
  it('共享依赖只读取一次；过大依赖树在递归解析前按内存预算明确拒绝', () => {
    const leaf: CodeComponentPin = { name: '共用', version: 1, location: '/项目/代码/组件库/共用/v1.ts', hash: 'a'.repeat(64), imports: [] }
    const top = { ...leaf, name: '父组件', location: '/项目/代码/组件库/父组件/v1.ts', hash: 'b'.repeat(64), imports: [leaf, leaf] }
    expect(componentFileReferences([top, leaf])).toHaveLength(2)
    expect(codeComponentPinsSchema.parse([top])).toHaveLength(1)
    let shared = leaf
    for (let depth = 0; depth < 18; depth++) shared = { ...leaf, name: `层${depth}`, imports: [shared, shared] }
    expect(() => codeComponentPinsSchema.parse([shared])).toThrow('32MiB')
    const cyclic = { ...leaf }; cyclic.imports = [cyclic]
    expect(() => codeComponentPinsSchema.parse([cyclic])).toThrow('循环')
  })
  it('按 hash 复用内容，但每次读取核对位置；移动只改变位置不改变版本身份', async () => {
    const addressed = await addressCodeMaterialFiles('export const value=1;')
    const version = { entry: addressed.entry, files: addressed.files.map(file => ({ ...file, location: '/项目/代码/素材/v1/main.ts' })) }
    const read = vi.fn(async () => addressed.codeSources[0].source); installCodeSourceReader(read)
    await loadCodeSourceReferences(version); await loadCodeSourceReferences(version)
    expect(read).toHaveBeenCalledTimes(2); expect(documentCodeSourceResolver().read(version.files[0].hash)).toBe('export const value=1;')
    const moved = { ...version, files: version.files.map(file => ({ ...file, location: '/另一个项目/代码/素材/v1/main.ts' })) }
    expect(codeVersionContentKey(moved)).toBe(codeVersionContentKey(version)); await loadCodeSourceReferences(moved)
    read.mockResolvedValue('外部修改'); await expect(loadCodeSourceReferences(version)).rejects.toThrow('main.ts 已被外部修改')
    read.mockRejectedValue(new Error('main.ts 缺失，请恢复备份')); await expect(loadCodeSourceReferences(version)).rejects.toThrow('main.ts 缺失')
  })
  it('同名组件的旧版本和最新版本同时导入时分别钉住、重写和链接；文件移动保留组件导入', async () => {
    const versions = []
    for (const version of [1, 2]) {
      const source = packageComponentSource(`export const draw=()=>rect({x:0,y:0,width:${version},height:1,fill:[1,0,0,1]});`, { name: '人名条', version, description: '', exports: ['draw'], imports: [] })
      const addressed = await addressCodeMaterialFiles(source)
      versions.push({ name: '人名条', version, source, exports: ['draw'], description: '', imports: [], location: addressed.files[0].location, hash: addressed.files[0].hash })
    }
    const library: CodeComponent[] = [{ name: '人名条', latestVersion: 2, versions }]
    const source = 'import {draw as old} from "@组件/人名条@1";import {draw as latest} from "@组件/人名条";' + entry
    const files = { entry: 'main.ts', files: { 'main.ts': source } }
    const pins = pinCodeComponentImports(files, library)
    expect(pins.map(pin => pin.version)).toEqual([1, 2])
    const compilation = expandPinnedCodeComponents(files, pins, documentCodeSourceResolver())
    expect(compilation.resolvedImports!['main.ts']['@组件/人名条']).toBe('项目组件/人名条/v2.ts')
    expect(compileCodeMaterial(compilation).name).toBe('组件')
    expect(compileCodeMaterial(portableCodeComponentFiles(compilation)).name).toBe('组件')
    const replacements: CodeComponentPin[] = pins.map(pin => ({ ...pin, name: '导入的人名条' }))
    expect(rewriteCodeComponentImports(source, pins, replacements)).toContain('@组件/导入的人名条@2')
    expect(renameCodeMaterialFile(files, 'main.ts', 'nested/main.ts').files['nested/main.ts']).toBe(source)
    expect(() => pinCodeComponentImports(files, [], '人名条')).toThrow('不存在')
    expect(() => pinCodeComponentImports(files, library, '人名条')).toThrow('循环')
    expect(() => componentSourceMetadata('// henji-component broken')).toThrow('说明损坏')
  })
})
