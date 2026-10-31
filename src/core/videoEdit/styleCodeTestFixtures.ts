import { createHash } from 'node:crypto'
import { videoEditEffectPresetSchema } from './effectPresets'
import { styleCodeDeclarations } from './styleCodeSnapshot'
import { testCodeMetadata } from './codeMaterial/sourceTestFixtures'

export function styleCodeFixture(): ReturnType<typeof videoEditEffectPresetSchema.parse> {
  const source = 'export default {name:"滤镜",kind:"filter",mode:"static",params:[{key:"gain",title:"强度",type:"number",default:.5,min:0,max:1,step:.01,animatable:true}],createWebGPU(){return {draw(){}}}}'
  const hash = createHash('sha256').update(source).digest('hex')
  const metadata = testCodeMetadata({ name: '滤镜', kind: 'filter', parameters: { gain: { title: '强度', type: 'number', default: .5, min: 0, max: 1, step: .01, animatable: true } } })
  return videoEditEffectPresetSchema.parse({ id: 'code-piece', name: '代码滤镜', media: 'video', effects: [{ id: 'code', name: '滤镜', enabled: true, amount: .8, code: { definitionId: 'filter', versionId: 'filter-version', parameters: { gain: .5 }, curves: { gain: [{ id: 'gain-key', sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, value: .8, interpolation: 'linear' }] } } }], codeSnapshots: { code: { version: { id: 'filter-version', apiVersion: 4, languageVersion: 4, entry: 'main.ts', files: [{ path: 'main.ts', location: `asset:${hash}`, hash }] }, codeSources: [{ hash, source }], ...styleCodeDeclarations(metadata) } }, knobs: [{ key: 'strength', name: '强度', min: 0, max: 100, default: 50, mappings: [{ effectId: 'code', parameter: 'gain', points: [{ input: 0, output: 0 }, { input: 100, output: 1 }] }] }] })
}
