import { describe, expect, it } from 'vitest'
import { renderMemoryContext, INLINE_LAYER_CHARACTERS } from './memoryContext'
import { keywordOverlap, rankByKeywords } from '../search/keywordSearch'
import type { MemoryEntry } from './memoryEntries'

const entry = (id: string, content: string, extra: Partial<MemoryEntry> = {}): MemoryEntry => ({ id, content, source: 'user', updatedAt: '2026-11-09T00:00:00.000Z', revision: 1, section: 'creative', ...extra })

describe('关键词检索', () => {
  it('中文两字词能命中，按相关度排序', () => {
    const ranked = rankByKeywords(['花字要正着放', '片头用思源黑体做字体', '背景用中性灰'], '换个字体')
    expect(ranked[0].index).toBe(1)
    expect(rankByKeywords(['背景用中性灰'], '字体')).toEqual([])
  })

  it('几乎重复的句子重合度高', () => {
    expect(keywordOverlap('片头字体用思源黑体', '片头的字体用思源黑体')).toBeGreaterThan(0.5)
    expect(keywordOverlap('片头字体用思源黑体', '背景用中性灰')).toBeLessThan(0.2)
  })
})

describe('记忆进上下文', () => {
  it('总量不大时全部列出，不带元数据', () => {
    const text = renderMemoryContext({ global: [entry('a', '背景用中性灰')] }, '做片头')
    expect(text).toContain('- [创作偏好] 背景用中性灰')
    expect(text).not.toContain('revision')
  })

  it('记忆很多时只列常驻与相关条目，其余给出条数和查法', () => {
    const filler = Array.from({ length: 400 }, (_, index) => entry(`f${index}`, `第${index}条关于转场节奏的零散偏好记录`))
    const global = [entry('font', '中文默认思源黑体', { value: { key: 'font.zh', fonts: ['思源黑体'] } }), entry('me', '我是科技区 UP 主', { section: 'about' }), entry('red', '品牌色用红色做强调'), ...filler]
    expect(global.reduce((sum, value) => sum + value.content.length, 0)).toBeGreaterThan(INLINE_LAYER_CHARACTERS.global)
    const text = renderMemoryContext({ global }, '这期的品牌色怎么定')
    expect(text).toContain('中文默认思源黑体 {font.zh: 思源黑体}')
    expect(text).toContain('我是科技区 UP 主')
    expect(text).toContain('品牌色用红色做强调')
    expect(text).toContain('text 写关键词')
    expect(text.length).toBeLessThan(3000)
  })

  it('全局很多时项目记忆仍整层列出，定过优先级的条目常驻，新的排在前面', () => {
    const filler = Array.from({ length: 400 }, (_, index) => entry(`f${index}`, `第${index}条关于转场节奏的零散偏好记录`))
    const decided = entry('serif', '标题用宋体', { precedence: 'preference' })
    const text = renderMemoryContext({ global: [...filler, decided], project: [entry('old', '这期品牌色用蓝色', { section: undefined }), entry('new', '这期品牌色用红色', { section: undefined, updatedAt: '2026-11-10T00:00:00.000Z' })] }, '做个片头')
    expect(text).toContain('标题用宋体（冲突时听偏好）')
    expect(text.indexOf('这期品牌色用红色')).toBeLessThan(text.indexOf('这期品牌色用蓝色'))
  })
})
