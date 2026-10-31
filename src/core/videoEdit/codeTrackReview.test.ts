import ts from 'typescript'
import { expect, it } from 'vitest'
import { reviewCodeTrackSeparation } from './codeTrackReview'

const backdrop = '{id:"backdrop",name:"台面",draw(ctx){ctx.fillStyle="black";ctx.fillRect(0,0,1920,1080)}}'
const corner = '{id:"note",name:"角注",draw(ctx){ctx.fillStyle="gray";ctx.font="24px sans-serif";ctx.fillText("演示画面",40,1040)}}'
const source = (layer: string, extra = ''): string => `export default {width:1920,height:1080,${extra}layers(){return [${layer},${corner}]}}`
const review = (text: string) => reviewCodeTrackSeparation(ts.createSourceFile('main.ts', text, ts.ScriptTarget.Latest, true))
it('只建议明确独立的全幅层与常驻角注，给出源码与层身份', () => {
  expect(review(source(backdrop))).toMatchObject([{ file: 'main.ts', line: 1, layerId: 'backdrop', name: '台面' }, { layerId: 'note', name: '角注' }])
})
it('随镜头位姿、读取其他层、时间、参数、工厂、共享排版或不明合成的层不硬判', () => {
  for (const layer of [
    backdrop.replace('draw(ctx)', 'pose(t){return {x:t}},draw(ctx)'),
    backdrop.replace('1920,1080', 'camera.width,1080'),
    backdrop.replace('ctx.fillRect', 'other(ctx);ctx.fillRect'),
    backdrop.replace('"black"', 'params.color'),
    backdrop.replace('"black"', 'time>1?"red":"blue"'),
    backdrop.replace('ctx.fillRect(0,0,1920,1080)', 'ctx.drawImage(assets.under,0,0)'),
    backdrop.replace('id:"backdrop"', '...shared,id:"backdrop"'),
    backdrop.replace('ctx.fillStyle=', 'ctx.globalCompositeOperation="multiply";ctx.fillStyle='),
  ]) expect(review(source(layer)).map(value => value.layerId)).not.toContain('backdrop')
  expect(review(source(backdrop, 'createWebGPU(){},'))).toEqual([])
  expect(review(source(backdrop).replace('layers(){return', 'layers(){ const x=1; return'))).toEqual([])
})
it('兄弟层挖洞或不透明 helper 可能依赖背景，整组不给拆轨建议；独立位姿可保留', () => {
  for (const draw of ['ctx.globalCompositeOperation="destination-out";ctx.fillRect(0,0,100,100)', 'paint(ctx)', 'const c=ctx;c.fillRect(0,0,100,100)', 'ctx["globalCompositeOperation"]="source-in"', 'ctx.save();ctx.translate(100,0)', 'ctx.restore();ctx.globalAlpha=.5']) {
    const text = `export default {width:1920,height:1080,layers(){return [${backdrop},{id:"content",draw(ctx){${draw}}}]}}`
    expect(review(text)).toEqual([])
  }
  const text = `export default {width:1920,height:1080,layers(){return [${backdrop},{id:"content",pose(t){return {x:t}},draw(ctx){ctx.fillStyle="red";ctx.fillRect(100,100,200,200)}}]}}`
  expect(review(text).map(value => value.layerId)).toEqual(['backdrop'])
})
