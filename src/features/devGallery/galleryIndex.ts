import { UI_CONTROL_HEIGHT_CLASS } from '@/components/ui/styleTokens'
import * as styleTokens from '@/components/ui/styleTokens'
import * as motion from '@/components/ui/motion'
import * as icons from '@/core/theme/icons'
import type { IconButtonSize, UiControlSize } from '@/components/ui/primitiveInternals'
import { buildThemeCssVariables, THEME_COMPONENT_CSS_VARS, THEME_TOKEN_CSS_VARS } from '@/core/theme/themeCssVars'
import type { Config } from 'tailwindcss'
// @ts-expect-error 仓库唯一 Tailwind 配置是 JS；只读数据，不复制令牌映射。
import tailwindConfig from '../../../tailwind.config.js'
import { deriveThemeTokens, type ThemeSeed } from '@/core/theme/themeEngine'
import { getThemeTokens, publishThemeTokens } from '@/core/theme/themeTokenStore'
import type { UiRadiusPreset } from '@/core/theme/runtimeTheme'

// 尺寸定义是只读源码资产，不作为 JS 模块执行；Vite 正式 raw glob 与依赖图的代码语义一致。
const enumSources = import.meta.glob<string>([
  '/src/components/ui/primitiveInternals.ts',
  '/src/components/ui/UiSegmented.tsx',
  '/src/components/ui/parameterControl.ts',
], { as: 'raw', eager: true })
function enumSource(file: string): string {
  const source = enumSources[file]
  if (typeof source !== 'string') throw new Error(`设计系统枚举源码未找到：${file}`)
  return source
}
const primitiveSource = enumSource('/src/components/ui/primitiveInternals.ts')
const segmentedSource = enumSource('/src/components/ui/UiSegmented.tsx')
const parameterSource = enumSource('/src/components/ui/parameterControl.ts')

/** 源码只用作开发页的枚举数据，不打包第二份控件尺寸定义。覆盖测试用 TS AST 核对。 */
export function readLiteralUnion(source: string, name: string, seen = new Set<string>()): string[] {
  if (seen.has(name)) throw new Error(`设计系统枚举存在循环别名：${name}`)
  const clean = source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '')
  const body = clean.match(new RegExp(`(?:export\\s+)?type\\s+${name}\\s*=([\\s\\S]*?)(?:;|\\n\\s*(?:export\\s+)?(?:type|interface|const|function)\\b|$)`))?.[1]
  if (!body) throw new Error(`设计系统枚举未找到：${name}`)
  const values = body.split('|').map(part => part.trim()).filter(Boolean).flatMap(part => {
    const literal = part.match(/^['"]([^'"]+)['"]$/)
    if (literal) return [literal[1]]
    if (/^[A-Za-z][A-Za-z0-9_]*$/.test(part)) return readLiteralUnion(clean, part, new Set([...seen, name]))
    throw new Error(`设计系统枚举无法读取：${name} / ${part}`)
  })
  if (!values.length) throw new Error(`设计系统枚举无法读取：${name}`)
  return values
}
export const GALLERY_CONTROL_SIZES = Object.keys(UI_CONTROL_HEIGHT_CLASS) as UiControlSize[]
const iconSizeType = primitiveSource.match(/export interface UiIconButtonProps[\s\S]*?\n}/)?.[0].match(/\bsize\?:\s*([A-Za-z0-9_]+)/)?.[1]
if (!iconSizeType) throw new Error('图标按钮 size 属性未找到')
export const GALLERY_ICON_SIZES = readLiteralUnion(primitiveSource, iconSizeType) as IconButtonSize[]
export function readSizeUnion(source: string): string[] {
  const declaration = source.match(/size\??:\s*([^\n;]+)/)?.[1]
  if (!declaration) throw new Error('组件 size 枚举未找到')
  if (declaration.trim() === 'UiControlSize') return GALLERY_CONTROL_SIZES
  const values = [...declaration.matchAll(/'([^']+)'/g)].map(match => match[1])
  if (!values.length) throw new Error(`组件 size 枚举无法读取：${declaration}`)
  return values
}
export const GALLERY_SEGMENTED_SIZES = readSizeUnion(segmentedSource) as UiControlSize[]
export const GALLERY_PARAMETER_SIZES = readSizeUnion(parameterSource) as UiControlSize[]
export const GALLERY_STYLE_TOKENS = Object.entries(styleTokens).filter(([name]) => name.startsWith('UI_'))
export const GALLERY_TEXT_TOKENS = GALLERY_STYLE_TOKENS.filter(([name, value]) => name.startsWith('UI_TEXT_') && name.endsWith('_CLASS') && typeof value === 'string')
export const GALLERY_SPACING_KEYS = ['1', '2', '3', '4', '6', '8'] as const
export const GALLERY_ICON_TOKENS = Object.entries(icons).filter(([name]) => name.startsWith('ICON_')) as Array<[string, typeof icons.ICON_ASSET_LIBRARY]>
/** icons.ts 中的尺寸、描边等数值令牌（非图形登记），在图标栏目逐项展示原值。 */
export const GALLERY_ICON_METRIC_TOKENS = Object.entries(icons).filter(([name]) => !name.startsWith('ICON_'))
export const GALLERY_MOTION_TOKENS = Object.entries(motion).filter(([name]) => name.startsWith('UI_'))
export const GALLERY_SKILL_SOURCE = 'https://github.com/henjicc/Henji-AI/blob/main/.codex/skills/henji-ui-surface/SKILL.md'
export const GALLERY_TAILWIND_CONFIG = tailwindConfig as Config
export const GALLERY_COLOR_CLASSES_BY_VARIABLE = new Map<string, string[]>()
function collectColorClasses(value: unknown, prefix = ''): void {
  if (typeof value === 'string') {
    const variable = value.match(/var\((--[\w-]+)\)/)?.[1]?.replace(/-rgb$/, '')
    if (variable) GALLERY_COLOR_CLASSES_BY_VARIABLE.set(variable, [...(GALLERY_COLOR_CLASSES_BY_VARIABLE.get(variable) ?? []), prefix])
  } else if (value && typeof value === 'object') {
    Object.entries(value).forEach(([key, entry]) => collectColorClasses(entry, key === 'DEFAULT' ? prefix : [prefix, key].filter(Boolean).join('-')))
  }
}
collectColorClasses(GALLERY_TAILWIND_CONFIG.theme?.extend?.colors)

export interface GalleryEntry {
  id: string
  group: '令牌' | '组件' | '界面模式' | '规范速查'
  title: string
  keywords: string
  /** 只看问题以明确记录的缺口为准，不伪造运行时门禁结果。 */
  issue?: string
}

export const GALLERY_INDEX: readonly GalleryEntry[] = [
  ...[
    ['colors', '颜色', 'THEME_COLOR_TOKEN_NAMES 表面 文字 强调 状态 媒体 对比度'],
    ['type', '排版', 'UI_TEXT 字号 行高 Geist'],
    ['spacing', '间距', 'UI_STACK_GAP UI_ROW_GAP UI_SECTION_STACK spacing'],
    ['radius', '圆角', 'UI_RADIUS compact default large'],
    ['shadow', '阴影', 'boxShadow 浮层 特效'],
    ['layers', '层级', 'Z_LAYERS zIndex'],
    ['height', '控件高度', 'UI_CONTROL_HEIGHT 同名档同高'],
    ['icons', '图标', 'ICON 图形 概念 尺寸'],
    ['motion', '动效', 'UI_DURATION UI_EASE 弹窗 浮层 重放 减少动态'],
    ['source-tokens', '令牌清单', 'styleTokens 全部导出 唯一源'],
  ].map(([id, title, keywords]) => ({ id, title, keywords, group: '令牌' as const, issue: id === 'icons' ? '登记表存在同形多义；图标尺寸令牌尚未落地，需要任务 4.2 接入。' : undefined })),
  ...[
    ['buttons', '按钮', 'UiButton UiIconButton UiWindowControl 静息 悬停 按下 聚焦 禁用 加载'],
    ['fields', '字段', 'UiInput UiSearchInput UiFieldTrigger NumberInput UiFontPicker UiDatePicker UiSelect UiTextArea UiTextAreaField UiNumberStepper UiColorInput'],
    ['menus', '下拉与菜单', 'Dropdown PanelTrigger'],
    ['options', '选项与分段', 'UiOptionButton UiSegmented 中性抬起底 强文字 最多5项'],
    ['toggles', '开关与复选', 'UiSwitch UiCheckbox'],
    ['navigation', '标签与导航', 'UiChipButton UiNavButton UiTextToken'],
    ['forms', '表单与分组', 'UiFormRow UiGroup UiTooltipText UiDisclosurePanel UiColorWheel UiToneCurve 参数原件'],
    ['toolbar', '命令带与页头', 'UiToolbar UiPageHeader UiRegion UiOverflowRow UiMarqueeText'],
    ['states', '空 / 加载 / 错误', 'UiEmpty UiLoading UiError ProgressBar'],
    ['dialogs', '弹窗与通知', 'AlertDialog UiToast 付费确认测试夹具'],
    ['media', '媒体叠层与玻璃', 'UiPanel media glass'],
    ['content', '内容输入', 'PromptEditor PromptDocumentStatic StackedMediaUploader FileUploader Toggle TextInput UiErrorBoundary'],
    ['filters', '筛选条', 'UiTaskHistoryFilterBar'],
    ['sizes', '尺寸阶梯', 'size sm md lg UiIconButton 实际枚举 基线'],
    ['variants', '补充变体', 'variant tone shape frame gridCell labelWidth gap appearance'],
    ['static-overlays', '静态浮层', 'Tooltip TooltipContent ContextMenu top left solid glass'],
    ['parameters', '参数尺寸', 'UiAngleDial UiPointPad UiRangeSlider UiGradientEditor UiGradeWheel UiCurveEditor UiEasingEditor UiSeedInput'],
    ['shared-domain', '共享领域组件', 'PriceEstimate AudioPlayer WaveformView TypographyPanel'],
  ].map(([id, title, keywords]) => ({ id, title, keywords, group: '组件' as const, issue: id === 'content' ? 'Toggle / TextInput 老包装的统一迁移在本任务所有权外。' : id === 'sizes' ? '当前图标按钮同名档高度与其他控件不同，任务 4.2 负责尺寸迁移；本页展示当前真值。' : undefined })),
  { id: 'patterns', group: '界面模式', title: '界面语法', keywords: 'G1 G2 G3 G4 G5 表单 成对网格 记录列表 设置分区 命令带 从属带 正例 禁止写法' },
  { id: 'modal-sizes', group: '界面模式', title: '弹窗尺寸', keywords: 'UiModal compact form editor settings workspace headerActions footer glass' },
  { id: 'long-list', group: '界面模式', title: '长列表', keywords: 'react-virtuoso 1000 滚动 帧率' },
  { id: 'rules', group: '规范速查', title: '规范速查', keywords: '三条铁律 五级容器 动作层级 选中态 skill henji-ui-surface' },
]

export function searchGallery(query: string, issuesOnly = false): readonly GalleryEntry[] {
  const terms = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean)
  const tokenKeywords: Record<string, string> = {
    colors: [...Object.keys(THEME_TOKEN_CSS_VARS), ...Object.values(THEME_TOKEN_CSS_VARS), ...GALLERY_COLOR_CLASSES_BY_VARIABLE.values()].flat().join(' '),
    type: GALLERY_TEXT_TOKENS.map(([name, value]) => `${name} ${value}`).join(' '),
    spacing: GALLERY_STYLE_TOKENS.filter(([name]) => /GAP_CLASS|STACK_CLASS/.test(name)).map(([name, value]) => `${name} ${value}`).join(' '),
    radius: `UI_RADIUS_CLASS ${Object.entries(styleTokens.UI_RADIUS_CLASS).flat().join(' ')}`,
    shadow: Object.keys(GALLERY_TAILWIND_CONFIG.theme?.extend?.boxShadow ?? {}).map(name => `boxShadow.${name} shadow-${name}`).join(' '),
    layers: Object.keys(GALLERY_TAILWIND_CONFIG.theme?.extend?.zIndex ?? {}).map(name => `z-${name} ${name}`).join(' '),
    icons: [...GALLERY_ICON_TOKENS, ...GALLERY_ICON_METRIC_TOKENS].map(([name]) => name).join(' '),
    motion: `${GALLERY_MOTION_TOKENS.map(([name]) => name).join(' ')} ${Object.keys(motion.UI_DURATION).map(name => `UI_DURATION.${name}`).join(' ')}`,
    'source-tokens': GALLERY_STYLE_TOKENS.map(([name]) => name).join(' '),
  }
  return GALLERY_INDEX.filter(entry => (!issuesOnly || !!entry.issue) && terms.every(term =>
    `${entry.title} ${entry.keywords} ${entry.group} ${tokenKeywords[entry.id] ?? ''}`.toLocaleLowerCase().includes(term)))
}

/** 临时预览复用正式引擎与变量映射；不调用会写首帧缓存的 applyRuntimeTheme。 */
export function previewGalleryTheme(root: HTMLElement, seed: ThemeSeed, radius: UiRadiusPreset, blur: boolean): () => void {
  const tokensBefore = getThemeTokens()
  const tokens = deriveThemeTokens(seed)
  const vars = buildThemeCssVariables(tokens)
  const names = [...Object.keys(vars), ...THEME_COMPONENT_CSS_VARS.map(item => item.name)]
  const previous = names.map(name => [name, root.style.getPropertyValue(name), root.style.getPropertyPriority(name)] as const)
  const colorScheme = root.style.colorScheme
  const radiusBefore = root.getAttribute('data-ui-radius')
  const blurBefore = root.getAttribute('data-ui-blur')
  THEME_COMPONENT_CSS_VARS.forEach(item => root.style.removeProperty(item.name))
  Object.entries(vars).forEach(([name, value]) => root.style.setProperty(name, value))
  root.style.colorScheme = tokens.colorScheme
  if (radius === 'default') root.removeAttribute('data-ui-radius')
  else root.setAttribute('data-ui-radius', radius)
  if (blur) root.removeAttribute('data-ui-blur')
  else root.setAttribute('data-ui-blur', 'off')
  publishThemeTokens(tokens)
  return () => {
    previous.forEach(([name, value, priority]) => value ? root.style.setProperty(name, value, priority) : root.style.removeProperty(name))
    root.style.colorScheme = colorScheme
    if (radiusBefore === null) root.removeAttribute('data-ui-radius'); else root.setAttribute('data-ui-radius', radiusBefore)
    if (blurBefore === null) root.removeAttribute('data-ui-blur'); else root.setAttribute('data-ui-blur', blurBefore)
    publishThemeTokens(tokensBefore)
  }
}
