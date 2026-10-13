import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import zhSettings from '@/i18n/locales/zh-CN/settings.json'
import enSettings from '@/i18n/locales/en-US/settings.json'
import zhOnboarding from '@/i18n/locales/zh-CN/onboarding.json'
import enOnboarding from '@/i18n/locales/en-US/onboarding.json'
import { SETTINGS_SECTION_IDS } from '@/core/types/settingsNavigation'
import { SETTINGS_SEARCH_INDEX, searchSettings } from './settingsSearchIndex'

type Messages = Record<string, unknown>
const bundles: Record<string, Record<string, Messages>> = {
  zh: { settings: zhSettings, onboarding: zhOnboarding },
  en: { settings: enSettings, onboarding: enOnboarding },
}

function lookup(lang: 'zh' | 'en', key: string): string | undefined {
  const [ns, path] = key.includes(':') ? key.split(':') : ['settings', key]
  const value = path.split('.').reduce<unknown>((node, part) => (node as Messages | undefined)?.[part], bundles[lang][ns])
  return typeof value === 'string' ? value : undefined
}

const translate = (lang: 'zh' | 'en') => (key: string): string => lookup(lang, key) ?? key

describe('设置搜索索引', () => {
  it('所有分区的字面量表单行标签都有索引', () => {
    const directory = join(process.cwd(), 'src/components/Settings/sections')
    const missing: string[] = []
    for (const filename of readdirSync(directory).filter(name => name.endsWith('Section.tsx'))) {
      const source = readFileSync(join(directory, filename), 'utf8')
      for (const match of source.matchAll(/<UiFormRow\b[\s\S]*?label=\{t\(['"]([^'"]+)['"]/g)) {
        const key = /useI18n\('onboarding'\)/.test(source) ? `onboarding:${match[1]}` : match[1]
        if (!SETTINGS_SEARCH_INDEX.some(entry => entry.labelKey === key)) missing.push(`${filename}: ${key}`)
      }
    }
    expect(missing).toEqual([])
  })
  it.each(['素材箱', '重复文件', '触发边缘', '唤起前等待', '移出后等待', '授权方式', '单次自动通过', '全部第三方组件', '连接名称'])('可以搜索 %s 且不显示插值占位符', query => {
    const results = searchSettings(query, translate('zh'))
    expect(results.length).toBeGreaterThan(0)
    expect(results.every(item => !item.label.includes('{{'))).toBe(true)
  })
  it('每条标签在中英文里都有文案，每个分区至少能搜到一条', () => {
    for (const entry of SETTINGS_SEARCH_INDEX) {
      expect(lookup('zh', entry.labelKey), entry.labelKey).toBeTypeOf('string')
      expect(lookup('en', entry.labelKey), entry.labelKey).toBeTypeOf('string')
    }
    for (const sectionId of SETTINGS_SECTION_IDS) {
      expect(SETTINGS_SEARCH_INDEX.some((entry) => entry.sectionId === sectionId), sectionId).toBe(true)
    }
  })

  it('按标签、关键词与分区名匹配，标签命中排在前面', () => {
    const zh = translate('zh')
    expect(searchSettings('汇率', zh)[0]).toMatchObject({ tab: 'workspace', entry: { sectionId: 'workspace-generation' } })
    expect(searchSettings('API Key', zh)[0]).toMatchObject({ tab: 'providers' })
    expect(searchSettings('快捷键', zh)[0]).toMatchObject({ label: '剪辑快捷键', entry: { sectionId: 'workspace-video-edit' } })
    expect(searchSettings('别名', zh)[0]).toMatchObject({ entry: { labelKey: 'providerCenter.actions.renameModel' } })
    expect(searchSettings('  ', zh)).toEqual([])
    // 有直接命中时不混入只靠大类名命中的条目；没有直接命中时按分区名兜底
    // “下载”同时命中下载分区与本地模型的“下载源”，都在文件与下载大类里
    expect(searchSettings('下载', zh).every((item) => ['files-download', 'files-models'].includes(item.entry.sectionId))).toBe(true)
    expect(searchSettings('下载', zh)[0]).toMatchObject({ entry: { sectionId: 'files-download' } })
    expect(searchSettings('工作区', zh).length).toBeGreaterThan(0)
    expect(searchSettings('exchange', translate('en'))[0]).toMatchObject({ entry: { labelKey: 'sections.display.exchangeRateLabel' } })
  })
})
