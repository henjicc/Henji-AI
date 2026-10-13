/** 设计系统中心：开发导航 dev.ui_gallery，目录单区展示并按分区截图。 */
import { useLayoutEffect, useRef, useState, type ComponentType } from 'react'
import { Dropdown, UiButton, UiEmpty, UiFormRow, UiNavButton, UiSearchInput, UiSegmented, UiSwitch, UiToolbar } from '@/components/ui'
import { THEME_PRESET_IDS, THEME_PRESETS, type ThemeMode, type ThemePresetId } from '@/core/theme/themeEngine'
import { UI_SCALE_MODES } from '@/core/theme/uiScale'
import type { UiRadiusPreset } from '@/core/theme/runtimeTheme'
import { DEVELOPMENT_LAUNCH_QUERY_KEYS, DEVELOPMENT_GALLERY_QUERY_KEYS } from '@/core/development/developmentLaunchContract'
import { installForcedPseudoStates } from './forcedPseudoStates'
import { previewGalleryTheme, searchGallery } from './galleryIndex'
import { ButtonSection, ContentSection, DialogSection, FieldSection, FilterSection, FormSection, MediaSection, MenuSection, NavigationSection, OptionSection, StateSection, ToggleSection, ToolbarSection, SizeLadderSection, VariantSection, ModalSizeSection, StaticOverlaySection, ParameterSizeSection, SharedDomainSection } from './gallerySections'
import { ColorTokensSection, TypeTokensSection, SpacingTokensSection, RadiusTokensSection, ShadowTokensSection, LayerTokensSection, HeightTokensSection, IconTokensSection, MotionTokensSection, SourceTokensSection } from './tokenSections'
import { PatternSection, RulesSection, LongListSection } from './patternSections'

const SECTIONS: Record<string, ComponentType> = {
  colors: ColorTokensSection, type: TypeTokensSection, spacing: SpacingTokensSection,
  radius: RadiusTokensSection, shadow: ShadowTokensSection, layers: LayerTokensSection,
  height: HeightTokensSection, icons: IconTokensSection, motion: MotionTokensSection,
  'source-tokens': SourceTokensSection, buttons: ButtonSection, fields: FieldSection,
  menus: MenuSection, options: OptionSection, toggles: ToggleSection, navigation: NavigationSection,
  forms: FormSection, toolbar: ToolbarSection, states: StateSection, dialogs: DialogSection,
  media: MediaSection, content: ContentSection, filters: FilterSection, sizes: SizeLadderSection,
  variants: VariantSection, 'static-overlays': StaticOverlaySection, patterns: PatternSection,
  'modal-sizes': ModalSizeSection, 'long-list': LongListSection, rules: RulesSection,
  parameters: ParameterSizeSection,
  'shared-domain': SharedDomainSection,
}

function GalleryContent(): JSX.Element {
  const params = new URLSearchParams(window.location.search)
  const initialPreset = params.get(DEVELOPMENT_LAUNCH_QUERY_KEYS.themePreset)
  const [preset, setPreset] = useState<ThemePresetId>(THEME_PRESET_IDS.includes(initialPreset as ThemePresetId) ? initialPreset as ThemePresetId : 'graphite')
  const [mode, setMode] = useState<ThemeMode>(THEME_PRESETS[preset].seed.mode)
  const [radius, setRadius] = useState<UiRadiusPreset>(() => {
    const value = document.documentElement.dataset.uiRadius
    return value === 'compact' || value === 'large' ? value : 'default'
  })
  const [blur, setBlur] = useState(document.documentElement.dataset.uiBlur !== 'off')
  const [scale, setScale] = useState('100')
  const [previewChanged, setPreviewChanged] = useState(false)
  const [query, setQuery] = useState('')
  const [issuesOnly, setIssuesOnly] = useState(false)
  // 保留现有 F2 付费确认验收的启动入口；夹具归于弹窗栏目，不再混在筛选条里。
  const [selected, setSelected] = useState(params.get(DEVELOPMENT_GALLERY_QUERY_KEYS.section) ?? 'dialogs')
  const scrollRef = useRef<HTMLDivElement>(null)
  const entries = searchGallery(query, issuesOnly)
  const current = entries.find(entry => entry.id === selected) ?? entries[0]
  const Section = current ? SECTIONS[current.id] : undefined

  useLayoutEffect(() => installForcedPseudoStates(document), [])
  useLayoutEffect(() => {
    if (!previewChanged) return
    return previewGalleryTheme(document.documentElement, { ...THEME_PRESETS[preset].seed, mode }, radius, blur)
  }, [preset, mode, radius, blur, previewChanged])
  useLayoutEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = 0 }, [current?.id])
  const selectSection = (id: string): void => {
    setSelected(id)
    const url = new URL(window.location.href)
    url.searchParams.set(DEVELOPMENT_GALLERY_QUERY_KEYS.section, id)
    window.history.replaceState(null, '', url)
  }
  const leave = (): void => {
    const url = new URL(window.location.href)
    url.searchParams.delete(DEVELOPMENT_LAUNCH_QUERY_KEYS.surface)
    url.searchParams.delete(DEVELOPMENT_GALLERY_QUERY_KEYS.section)
    window.location.assign(url)
  }
  return <div data-application-surface-id="dev.ui_gallery" className="flex min-h-0 flex-1 flex-col overflow-clip bg-window pt-10">
    <UiToolbar variant="command" center={<UiSearchInput aria-label="搜索设计系统" placeholder="组件、令牌、规范" value={query} onChange={event => setQuery(event.target.value)} onClear={() => setQuery('')} clearLabel="清除搜索" className="w-full" />} trailing={<UiButton onClick={leave}>返回工作台</UiButton>} subordinate={<div className="flex min-w-0 items-center gap-4 overflow-x-auto">
      <UiFormRow label="模式" inline><UiSegmented ariaLabel="主题深浅" size="sm" value={mode} onChange={next => { setMode(next); setPreviewChanged(true) }} options={[{ value: 'dark', label: '深色' }, { value: 'light', label: '浅色' }]} /></UiFormRow>
      <UiFormRow label="圆角" inline><UiSegmented ariaLabel="圆角预设" size="sm" value={radius} onChange={next => { setRadius(next); setPreviewChanged(true) }} options={[{ value: 'compact', label: '紧凑' }, { value: 'default', label: '标准' }, { value: 'large', label: '大' }]} /></UiFormRow>
      <UiFormRow label="样张缩放" inline><Dropdown size="sm" ariaLabel="样张缩放" value={scale} options={UI_SCALE_MODES.filter(value => value !== 'auto').map(value => ({ value, label: `${value}%` }))} onSelect={setScale} /></UiFormRow>
      <UiFormRow label="玻璃" inline><UiSwitch aria-label="毛玻璃预览" checked={blur} onCheckedChange={next => { setBlur(next); setPreviewChanged(true) }} /></UiFormRow>
      <UiFormRow label="只看问题" inline><UiSwitch aria-label="只看登记问题" checked={issuesOnly} onCheckedChange={setIssuesOnly} /></UiFormRow>
    </div>}>
      <span className="whitespace-nowrap text-sm font-medium text-text1">设计系统</span>
      <Dropdown size="sm" ariaLabel="主题预设" value={preset} options={THEME_PRESET_IDS.map(value => ({ value, label: THEME_PRESETS[value].name.zh }))} onSelect={next => { setPreset(next); setMode(THEME_PRESETS[next].seed.mode); setPreviewChanged(true) }} />
    </UiToolbar>
    <div className="flex min-h-0 flex-1">
      <nav aria-label="设计系统目录" className="w-48 shrink-0 overflow-y-auto px-3 py-4">
        {(['令牌', '组件', '界面模式', '规范速查'] as const).map(group => <div key={group} className="mb-6 flex flex-col gap-1">
          <h2 className="px-2 py-2 text-xs font-medium text-text2">{group}</h2>
          {entries.filter(entry => entry.group === group).map(entry => <UiNavButton key={entry.id} data-gallery-nav={entry.id} size="auto" active={current?.id === entry.id} aria-current={current?.id === entry.id ? 'page' : undefined} onClick={() => selectSection(entry.id)}>{entry.title}</UiNavButton>)}
        </div>)}
      </nav>
      <div ref={scrollRef} data-gallery-scroll className="min-h-0 min-w-0 flex-1 overflow-y-auto px-3 py-4">
        {Section && current ? <section key={current.id} data-gallery-section={current.id} className="flex flex-col gap-4" style={{ zoom: Number(scale) / 100 }}>
          <p className="text-xs text-text2">{current.group} / {current.title} · 搜索词：{current.keywords}</p>
          {current.issue && <p data-gallery-issue className="text-xs text-warning-text">登记问题：{current.issue}</p>}
          <Section />
        </section> : <UiEmpty size="sm" title="没有匹配的样本" description="修改搜索词，或关闭“只看登记问题”。" />}
      </div>
    </div>
  </div>
}

export function UiGalleryPage(): JSX.Element | null {
  // App 的启动参数分支不在本任务所有权内；本页自身拒绝正式构建挂载内容。
  // 与 App.tsx 同口径：开发运行或 --mode development 的巡检产物才渲染。
  if (!import.meta.env.DEV && import.meta.env.MODE !== 'development') return null
  return <GalleryContent />
}
