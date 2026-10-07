import { expect, it, vi } from 'vitest'
import { VideoEditCodeSources } from './videoEditCodeSources'
import { compileCodeMaterial } from '@/core/videoEdit/codeMaterial/compiler'
import { createVideoEditTestDocument } from '@/core/videoEdit/testFixtures'
import { videoEditComposition } from '@/core/videoEdit/document'
import { BUILTIN_STYLE_KITS } from '@/core/videoEdit/styleKitPresets'
import { makeVideoEditItemClip } from '@/core/videoEdit/projectItems'
import type { VideoEditCodePicture } from './videoEditCodeGpu'
import type { CodeMaterialContext, CodeMaterialProgram } from '@/core/videoEdit/codeMaterial/contract'
it('静态生成器/滤镜按序列风格注入，覆盖优先，改令牌释放旧缓存但源码不重编译', async () => {
  const document = createVideoEditTestDocument('缓存风格')
  const source = 'export default {apiVersion:1,languageVersion:3,name:"静态风格",kind:"generator",mode:"static",width:1920,height:1080,durationSeconds:5,seed:1,parameters:{},render(ctx){return [rect({x:0,y:0,width:100,height:100,fill:ctx.style.palette.accent})];}}'
  const filter = source.replace('kind:"generator"', 'kind:"filter"').replace('return [rect({x:0,y:0,width:100,height:100,fill:ctx.style.palette.accent})]', 'return mix(sample(ctx.u,ctx.v),ctx.style.palette.accent,.5)')
  const program = compileCodeMaterial(source)
  document.codeMaterials = [{ id: 'code', name: '风格', defaultVersionId: 'v1', versions: [{ id: 'v1', apiVersion: 1, languageVersion: 3, source }, { id: 'fx', apiVersion: 1, languageVersion: 3, source: filter }] }]
  document.items = [{ id: 'item', name: '风格', kind: 'code', code: { definitionId: 'code', versionId: 'v1', parameters: {} } }]
  const sequence = document.sequences[0]; document.styleKits = structuredClone([BUILTIN_STYLE_KITS[0], BUILTIN_STYLE_KITS[1]]); sequence.styleKitId = document.styleKits[0].id
  const clip = makeVideoEditItemClip(document, 'item', sequence.id, { frame: 0 }, () => program); clip.effects = [{ id: 'effect', name: '染色', enabled: true, amount: 1, code: { definitionId: 'code', versionId: 'fx', parameters: {} } }]; sequence.clips = [clip]
  let composition = videoEditComposition(document, sequence.id)
  const generator = vi.fn(async (_key: string, _program: CodeMaterialProgram, _context: CodeMaterialContext) => ({ width: 1920, height: 1080 } as VideoEditCodePicture)); const releaseUnused = vi.fn((_keys: ReadonlySet<string>) => {}); const compile = vi.fn(async (code: string) => compileCodeMaterial(code))
  const sources = new VideoEditCodeSources(composition, async () => ({ generator, releaseUnused }), { compile, dispose() {} })
  try {
    const first = await sources.prepare(composition, composition.clips, 1, () => true)
    await sources.prepare(composition, composition.clips, 2, () => true)
    expect(generator).toHaveBeenCalledTimes(1)
    expect(generator.mock.calls[0][2]).toMatchObject({ style: document.styleKits[0].tokens })
    const fx = first.effects.get(clip.id)![0]; expect(fx.builtin).toBeUndefined(); expect(JSON.stringify(fx)).not.toContain('"kind":"style"')
    document.styleKits[0].tokens.palette.accent = [.1, .2, .3, 1]; document.styleKits[0].revision++
    composition = videoEditComposition(document, sequence.id); sources.updateDocument(composition)
    const changed = await sources.prepare(composition, composition.clips, 2, () => true)
    expect(generator).toHaveBeenCalledTimes(2); expect(compile).toHaveBeenCalledTimes(2)
    expect(changed.effects.get(clip.id)![0]).not.toEqual(fx)
    const previousKey = generator.mock.calls[0][0]; expect(releaseUnused.mock.calls.at(-1)![0].has(previousKey)).toBe(false)
    clip.styleKitId = document.styleKits[1].id; composition = videoEditComposition(document, sequence.id); sources.updateDocument(composition)
    await sources.prepare(composition, composition.clips, 3, () => true)
    expect(generator.mock.calls.at(-1)![2]).toMatchObject({ style: document.styleKits[1].tokens })
  } finally { await sources.dispose() }
})
