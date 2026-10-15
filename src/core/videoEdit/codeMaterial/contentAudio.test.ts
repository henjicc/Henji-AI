import { expect, it } from 'vitest'
import { compileCodeMaterial } from './compiler'
import { evaluateCodeMaterial } from './evaluate'
import { evaluateCodeFrameExpressions } from './evaluateV3'
import { codeFilterFrameExpressions } from './filterFrameExpressions'
import { emitCodeMaterialFilter } from '@/features/videoEdit/engine/codeGpuFilter'
import { validateCodeMaterialParameters } from './parameters'
import type { AudioContentAnalysis } from '../../audioAnalysis/contentAnalysis'
const source = (body: string, kind = 'generator', parameters = '{}'): string => `export default {apiVersion:1,languageVersion:3,name:'audio',kind:'${kind}',mode:'dynamic',width:64,height:64,durationSeconds:10,seed:1,parameters:${parameters},render(ctx){${body}}}`
const data: AudioContentAnalysis = { fps: 2, duration: 2, levels: [.1, .2, .3, .4], bands: { bass: [.2, .3, .4, .5], mid: [0, 0, 0, 0], treble: [0, 0, 0, 0] }, beats: [0, .5, 1, 1.5], onsets: [.1, .6], bpm: 120, beatsPerBar: 4, barOrigin: 0 }
const context = { time: .75, localTime: .75, sequenceTime: 10.75, width: 64, height: 64, frame: 43, fps: 4, audio: data }
it('生成器音频默认当前帧、相对寻帧、数组读取与小节相位确定', () => {
  const program = compileCodeMaterial(source('return [rect({x:ctx.audio.level(),y:ctx.audio.level(.5),width:ctx.audio.band("bass"),height:ctx.audio.beats.length,fill:[ctx.audio.beatPhase(),ctx.audio.barPhase(),ctx.audio.onsets[0],1]})];'))
  const first = evaluateCodeMaterial(program, context)
  evaluateCodeMaterial(program, { ...context, localTime: 0 })
  expect(evaluateCodeMaterial(program, context)).toEqual(first)
  expect(first[0]).toMatchObject({ x: .2, y: .3, width: .3, height: 4, fill: [.5, .375, .1, 1] })
})
it('无音频返回零和空数组；滤镜音频只提升为帧级 uniform', () => {
  const program = compileCodeMaterial(source('return mix(sample(ctx.u,ctx.v),[0,0,0,1],ctx.audio.level());', 'filter'))
  expect(emitCodeMaterialFilter(program)).toContain('frame')
  const expressions = codeFilterFrameExpressions(program)
  expect(evaluateCodeFrameExpressions(program, expressions, context, {})).toContain(.2)
  expect(evaluateCodeFrameExpressions(program, expressions, { ...context, audio: undefined }, {})).toContain(0)
  expect(() => compileCodeMaterial(source('return mix(sample(ctx.u,ctx.v),[0,0,0,1],ctx.audio.level(ctx.u));', 'filter'))).toThrow('帧级')
  expect(() => compileCodeMaterial(source('return [rect({x:ctx.audio.band("bad"),y:0,width:1,height:1,fill:[1,1,1,1]})];'))).toThrow('频段')
})
it('audio 参数校验媒体身份；image 参数接受视频时间和下方画面', () => {
  const program = compileCodeMaterial(source('return [image({source:ctx.params.picture,x:0,y:0,width:64,height:64})];', 'generator', '{sound:{type:"audio",title:"声音",default:null},picture:{type:"image",title:"画面",default:null}}'))
  expect(validateCodeMaterialParameters(program, { sound: { kind: 'audio', mediaId: 'music' }, picture: { kind: 'video', mediaId: 'movie', time: 2 } }).picture).toEqual({ kind: 'video', mediaId: 'movie', time: 2 })
  expect(validateCodeMaterialParameters(program, { picture: { kind: 'sequence', mediaId: 'below' } }).picture).toEqual({ kind: 'sequence', mediaId: 'below' })
  expect(() => validateCodeMaterialParameters(program, { sound: { kind: 'audio', mediaId: 'music', path: 'C:/a.wav' } })).toThrow()
  expect(() => validateCodeMaterialParameters(program, { picture: { kind: 'video', mediaId: 'movie', time: -1 } })).toThrow()
})
