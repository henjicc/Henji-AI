import { expect, it } from 'vitest'
import { resolveVoiceFeatureTags } from './voiceFeatureTags'

it('从真实描述提取性别、语言和方言，中文英语标签不依赖英文词边界', () => {
  const tags = resolveVoiceFeatureTags([], { description: '女 · 青年，英语中文，重庆话 宁波话 韩语 印尼语' })
  expect(tags.gender).toBe('female')
  expect(tags.age).toBe('youth')
  expect(tags.languages).toEqual(expect.arrayContaining(['en', 'zh', 'zh-chongqing', 'zh-ningbo', 'ko', 'id']))
})
it('尊重结构化标签，普通描述标签可补充缺失信息，不按职业猜年龄', () => {
  expect(resolveVoiceFeatureTags(['gender:male', 'age:senior', 'lang:en'], { description: '女 青年 中文' })).toMatchObject({ gender: 'male', age: 'senior', languages: ['en'] })
  expect(resolveVoiceFeatureTags(['女声', '老年', '日文'])).toMatchObject({ gender: 'female', age: 'senior', languages: ['ja'] })
  expect(resolveVoiceFeatureTags([], { voiceName: 'Human', description: '稳重主播，支持30+语种识别' })).toMatchObject({ gender: undefined, age: undefined, languages: [] })
})
