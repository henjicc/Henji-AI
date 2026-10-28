import { describe, expect, it } from 'vitest'
import { parseCodeMaterialV3Parameters } from './codeMaterial/parameterTypes'
import { videoEditCodeAuthorParameters, videoEditCodeInputParameters, videoEditCodeInputs, videoEditCodeSceneUserMessages } from './codeInputParameters'
import type { CodeMaterialInstance } from './codeMaterialPersistence'
import type { VideoEditMedia } from './document'
import { GOLDEN_SCENE_DECLARATION, goldenScene } from './scene/sceneTestFixtures'
import type { VideoEditScene } from './scene/sceneSchema'

const declarations = parseCodeMaterialV3Parameters({ film: { type: 'scene', title: '片子', schema: GOLDEN_SCENE_DECLARATION }, amount: { type: 'number', title: '强度', default: 0.5, min: 0, max: 1, step: 0.01 } }, {}, 5)
const read = (): typeof declarations => declarations
const media: VideoEditMedia[] = [{ id: 'screen', name: '录屏', kind: 'video', path: '/screen.mp4', durationSeconds: 60, width: 1920, height: 1080 }]
const filmCode = (): CodeMaterialInstance => ({ definitionId: 'film', versionId: 'v5', parameters: { film: { kind: 'scene', sceneId: 'golden-scene' }, amount: 0.25 } })

describe('代码实例的合成参数', () => {
  it('scene 参数：派生的取帧参数按解析结果的 input 键并进合成参数，作者 params 拿到解析结果；同一文档版本内是同一个对象，片子数据换了对象才重新解析', () => {
    const document = { media, scenes: [goldenScene('screen')] }
    const code = filmCode()
    const inputs = videoEditCodeInputs(document, code, read)!
    const film = inputs.scenes.film
    const key = film.timetables[0].shots[0].input
    // 停住的第二项从剪切前一直放到时刻上限（窗口没有结束时刻），与代码片子原来的 winInputs 一致
    expect(inputs.derived).toEqual({ [key]: { kind: 'video', mediaId: 'screen', spans: [{ from: 0, to: 1.5, src: 0 }, { from: 1.5, to: 86_400, src: 1.2, rate: 0 }] } })
    expect(videoEditCodeInputParameters(document, code, read)).toEqual({ ...code.parameters, [key]: inputs.derived[key] })
    const author = videoEditCodeAuthorParameters(inputs.parameters, inputs)
    expect(author.film).toBe(film)
    expect(author.amount).toBe(0.25)
    expect(Object.hasOwn(author, key)).toBe(false)
    // 同一份片子数据与素材（参数更新只换片段，不换片子数据）：不重算
    expect(videoEditCodeInputs({ ...document }, code, read)).toBe(inputs)
    // Worker 每次编辑收到的是新对象：内容相同也重新解析，结果对象随之换新
    const next = structuredClone(document)
    const again = videoEditCodeInputs(next, code, read)!
    expect(again.scenes.film).not.toBe(film)
    expect(again.derived).toEqual(inputs.derived)
  })

  it('没有 scene 参数的实例原样返回存的参数；声明还没读到时不派生，scene 参数给作者 null', () => {
    const document = { media, scenes: [goldenScene('screen')] }
    const plain: CodeMaterialInstance = { definitionId: 'plain', versionId: 'v4', parameters: { amount: 0.5, picture: { kind: 'video', mediaId: 'screen' } } }
    expect(videoEditCodeInputs(document, plain, read)).toBeUndefined()
    expect(videoEditCodeInputParameters(document, plain, read)).toBe(plain.parameters)
    expect(videoEditCodeAuthorParameters(plain.parameters, undefined)).toBe(plain.parameters)
    const code = filmCode()
    const pending = videoEditCodeInputs(document, code, () => undefined)!
    expect(pending.derived).toEqual({}); expect(pending.unresolved).toEqual(['film'])
    expect(pending.parameters).toBe(code.parameters)
    expect(videoEditCodeAuthorParameters(pending.parameters, pending).film).toBeNull()
  })

  it('取帧车道超过 512 段时报给用户看的问题，文字带上片子数据名称，只在截断以后缺画面的时刻报', () => {
    const golden = goldenScene('screen')
    const shots = Array.from({ length: 600 }, (_, index) => ({ id: `shot-${index}`, kind: 'shot', parent: 'win-demo', values: { at: index * 0.01, media: 'screen', src: index } }))
    const scene: VideoEditScene = { ...golden, records: [...golden.records.filter(record => record.kind !== 'shot'), ...shots] }
    const inputs = videoEditCodeInputs({ media, scenes: [scene] }, filmCode(), read)!
    const messages = videoEditCodeSceneUserMessages(inputs)
    expect(messages).toHaveLength(1)
    expect(messages[0]).toContain(scene.name)
    // 保留的 512 段放到 5.12 秒，之前的画面完整
    expect(videoEditCodeSceneUserMessages(inputs, 1)).toEqual([])
    expect(videoEditCodeSceneUserMessages(inputs, 5.5)).toEqual(messages)
    expect(videoEditCodeSceneUserMessages(videoEditCodeInputs({ media, scenes: [golden] }, filmCode(), read))).toEqual([])
  })
})
