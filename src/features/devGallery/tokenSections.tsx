import { UiSpinner, UiSkeleton } from '@/components/ui'
import { createPlainTextPromptDocument } from '@/core/inputs/promptDocument'
import { UI_ICON_SIZE_CLASS } from '@/components/ui/styleTokens'
import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { Play, Square } from 'lucide-react'
import '@/features/canvas/storyboard.css'
import resolveConfig from 'tailwindcss/resolveConfig'
import * as styleTokens from '@/components/ui/styleTokens'
import * as motion from '@/components/ui/motion'
import { Z_LAYERS } from '@/core/theme/zLayers'
import { THEME_COLOR_TOKEN_NAMES } from '@/core/theme/themeEngine'
import { THEME_TOKEN_CSS_VARS } from '@/core/theme/themeCssVars'
import { contrastRatio } from '@/core/theme/themeColor'
import { useThemeTokens } from '@/hooks/useThemeTokens'
import { Dropdown, PanelTrigger, UiButton, UiDisclosurePanel, UiGroup, UiModal, UiPanel, UiSwitch, UiToast, UiToolbar, PromptEditor, UiTextArea, UI_TEXT_META_CLASS } from '@/components/ui'
import { TooltipContent } from '@/components/ui/Tooltip'
import { GALLERY_STYLE_TOKENS, GALLERY_TEXT_TOKENS, GALLERY_SPACING_KEYS, GALLERY_ICON_TOKENS, GALLERY_ICON_METRIC_TOKENS, GALLERY_MOTION_TOKENS, GALLERY_TAILWIND_CONFIG, GALLERY_COLOR_CLASSES_BY_VARIABLE } from './galleryIndex'

const config = resolveConfig(GALLERY_TAILWIND_CONFIG)
const extension = GALLERY_TAILWIND_CONFIG.theme?.extend

function valueText(value: unknown): string { return typeof value === 'string' ? value : JSON.stringify(value) }

function TypeSample({ name, className }: { name: string; className: string }): JSX.Element {
  const ref = useRef<HTMLSpanElement>(null)
  const [measure, setMeasure] = useState('')
  useLayoutEffect(() => {
    if (!ref.current) return
    const computed = getComputedStyle(ref.current)
    setMeasure(`${computed.fontSize} / 行高 ${computed.lineHeight}`)
  }, [className])
  return <div data-gallery-token={name} className="flex flex-col gap-2 py-3">
    <code className={UI_TEXT_META_CLASS}>{name} · {measure}</code>
    <span ref={ref} className={className}>痕迹 AI · Henji 012345 · 创作工作台</span>
  </div>
}

export function ColorTokensSection(): JSX.Element {
  const { colors } = useThemeTokens()
  return <UiGroup title="语义颜色：当前值与表面对比度" titleTone="compact">
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {THEME_COLOR_TOKEN_NAMES.map(name => <div key={name} data-gallery-token={name} className="flex min-w-0 flex-col gap-2 py-2">
        <div className="flex items-center gap-2">
          <span aria-hidden className="h-8 w-12 shrink-0 rounded-control" style={{ backgroundColor: `var(${THEME_TOKEN_CSS_VARS[name]})` }} />
          <div className="min-w-0"><code className="break-all text-xs text-text1">{THEME_TOKEN_CSS_VARS[name]}</code><p className="break-all text-xs text-text2">{colors[name]}</p><p className="break-all text-xs text-text2">Tailwind：{GALLERY_COLOR_CLASSES_BY_VARIABLE.get(THEME_TOKEN_CSS_VARS[name])?.join(' / ') ?? '组件 CSS 变量'}</p></div>
        </div>
        {(['window', 'panel', 'raised'] as const).map(surface => <div key={surface} className="flex items-center gap-3 rounded-control px-3 py-2" style={{ backgroundColor: colors[surface] }}>
          <span className="text-xs text-text2">{surface}</span>
          {(['text1', 'text2', 'text3'] as const).map(text => <span key={text} className="text-xs" style={{ color: colors[text] }}>{text} {contrastRatio(colors[text], colors[surface]).toFixed(2)}:1</span>)}
        </div>)}
      </div>)}
    </div>
  </UiGroup>
}

export function TypeTokensSection(): JSX.Element {
  return <UiGroup title="排版阶梯" titleTone="compact">{GALLERY_TEXT_TOKENS.map(([name, value]) => <TypeSample key={name} name={name} className={String(value)} />)}</UiGroup>
}

export function SpacingTokensSection(): JSX.Element {
  return <UiGroup title="间距刻度：纵横共用 2 / 4 / 6 / 8 / 12 / 16 / 20 / 24 / 32" titleTone="compact">
    {(['micro', 'tight', 'control', 'group', 'row', 'section'] as const).map(gap => <UiToolbar key={gap} gap={gap}><code>{gap}</code><UiButton size="sm">动作一</UiButton><UiButton size="sm">动作二</UiButton></UiToolbar>)}
    {GALLERY_SPACING_KEYS.map(key => <div key={key} className="flex items-center gap-4 py-2"><code className="w-32 text-xs text-text2">spacing.{key} · {String(config.theme.spacing?.[key])}</code><span className="h-6 bg-accent" style={{ width: String(config.theme.spacing?.[key]) }} /></div>)}
    {GALLERY_STYLE_TOKENS.filter(([name]) => /GAP_CLASS|STACK_CLASS/.test(name)).map(([name, value]) => <p key={name} data-gallery-token={name} className="break-all text-xs text-text2">{name} · {valueText(value)}</p>)}
  </UiGroup>
}

export function RadiusTokensSection(): JSX.Element {
  return <UiGroup title="圆角：使用命令带切换紧凑 / 标准 / 大圆角" titleTone="compact">
    <div className="flex flex-wrap gap-6">{Object.entries(styleTokens.UI_RADIUS_CLASS).map(([name, cls]) => <div key={name} data-gallery-token={`UI_RADIUS_CLASS.${name}`} className="flex flex-col gap-2"><span className={`block h-24 w-32 bg-control ${cls}`} /><code className="text-xs text-text2">{name} · {cls}</code></div>)}</div>
    <TokenMapping category="borderRadius" values={GALLERY_TAILWIND_CONFIG.theme?.borderRadius} />
  </UiGroup>
}

function TokenMapping({ category, values }: { category: string; values: unknown }): JSX.Element {
  return <div className="flex flex-col gap-3">{Object.entries((values ?? {}) as Record<string, unknown>).map(([name, value]) => <div key={name} data-gallery-token={`${category}.${name}`} className="flex flex-col gap-2"><code className="break-all text-xs text-text2">{category}.{name} · {valueText(value)}</code></div>)}</div>
}

export function ShadowTokensSection(): JSX.Element {
  return <UiGroup title="阴影：仅浮层与具名特效" titleTone="compact"><div className="grid grid-cols-2 gap-8 py-6">{Object.entries((GALLERY_TAILWIND_CONFIG.theme?.boxShadow ?? {}) as Record<string, string>).map(([name, value]) => <div key={name} data-gallery-token={`boxShadow.${name}`} className="flex flex-col gap-4"><UiPanel data-gallery-ignore-rules="shadowOutsideOverlay" data-gallery-ignore-reason="阴影令牌独立展示，不代表生产页面的表面层级" className="p-4" style={{ boxShadow: value }}>{name}</UiPanel><code className="break-all text-xs text-text2">{value}</code></div>)}</div></UiGroup>
}

export function LayerTokensSection(): JSX.Element {
  return <UiGroup title="全局层级（与 Tailwind 映射对照）" titleTone="compact">{Object.entries(Z_LAYERS).map(([name, value]) => <p key={name} data-gallery-token={`Z_LAYERS.${name}`} className="text-13 text-text2">{name} · {value} · z-{name}</p>)}<TokenMapping category="zIndex" values={extension?.zIndex} /></UiGroup>
}

export function HeightTokensSection(): JSX.Element {
  return <UiGroup title="控件高度：当前令牌枚举" titleTone="compact">{Object.entries(styleTokens.UI_CONTROL_HEIGHT_CLASS).map(([name, cls]) => <div key={name} data-gallery-token={`UI_CONTROL_HEIGHT_CLASS.${name}`} className="flex items-center gap-4 py-3"><code className="w-40 text-xs text-text2">{name} · {cls}</code><span className={`w-40 bg-control ${cls}`} /></div>)}<TokenMapping category="height" values={extension?.height} />
    {Object.entries(styleTokens.UI_BAND_HEIGHT_CLASS).map(([name, cls]) => <div key={name} data-gallery-token={`UI_BAND_HEIGHT_CLASS.${name}`} className={`flex items-center bg-control px-3 ${cls}`}>{name} · {cls}</div>)}
    {(['short', 'medium', 'tall'] as const).map(height => <div key={height} className="grid grid-cols-2 gap-4"><PromptEditor height={height} ariaLabel={`${height} 提示词`} value={createPlainTextPromptDocument('文本高度')} onChange={() => undefined} /><UiTextArea height={height} aria-label={`${height} 文本`} defaultValue={height} /></div>)}
    {(['menu', 'compact', 'wide', 'workspace', 'special'] as const).map(panelSize => <PanelTrigger key={panelSize} panelSize={panelSize} display={panelSize} renderPanel={() => <div><p>{panelSize} · 响应式宽高</p><Dropdown panelSize={panelSize} display={panelSize} renderPanel={() => <p>下拉面板 {panelSize}</p>} /></div>} />)}
    {(['default', 'none', 'spacious'] as const).map(contentPadding => <div key={contentPadding} data-gallery-ignore-rules="overlayClipped" data-gallery-ignore-reason="正文留白与滚动档位的容器内弹窗样本随目录滚动，不是视口浮层" className="relative h-60"><UiModal scope="container" isOpen title={contentPadding} contentPadding={contentPadding} contentScroll="auto" onClose={() => undefined}>正文留白 {contentPadding}</UiModal></div>)}
    <div data-gallery-ignore-rules="overlayClipped" data-gallery-ignore-reason="正文留白与滚动档位的容器内弹窗样本随目录滚动，不是视口浮层" className="relative h-60"><UiModal scope="container" isOpen title="编辑器自管滚动" contentScroll="none" onClose={() => undefined}>自管滚动</UiModal></div></UiGroup>
}

export function IconTokensSection(): JSX.Element {
  const groups = new Map<unknown, string[]>()
  GALLERY_ICON_TOKENS.forEach(([name, Icon]) => groups.set(Icon, [...(groups.get(Icon) ?? []), name]))
  return <UiGroup title="登记图标：同形多义标黄，仅作为设计审查提示" titleTone="compact"><div className="grid grid-cols-1 gap-4 lg:grid-cols-2">{GALLERY_ICON_TOKENS.map(([name, Icon]) => <div key={name} data-gallery-token={name} className="flex items-center gap-3 py-3"><Icon className={`${UI_ICON_SIZE_CLASS.md} shrink-0 text-text1`} /><span className={`break-all text-xs ${(groups.get(Icon)?.length ?? 0) > 1 ? 'text-warning-text' : 'text-text2'}`}>{name}<br />{(groups.get(Icon)?.length ?? 0) > 1 ? `共用图形：${groups.get(Icon)?.join('、')}` : '独立图形'}</span></div>)}</div><div className="flex flex-wrap items-end gap-4">{Object.entries(styleTokens.UI_ICON_SIZE_CLASS).map(([name, className]) => <div key={name} data-gallery-token={`UI_ICON_SIZE_CLASS.${name}`} className="flex flex-col items-center gap-2"><Play className={className} /><code className="text-xs text-text2">{name}</code></div>)}</div><div className="flex flex-col gap-1">{GALLERY_ICON_METRIC_TOKENS.map(([name, value]) => <code key={name} data-gallery-token={name} className="break-all text-xs text-text2">{name} = {valueText(value)}</code>)}</div><p className="text-xs text-text2">按钮自动提供子图标尺寸，描边沿用 lucide 默认 2；窗口控件仅使用登记的 1.5 描边例外。</p></UiGroup>
}

function MotionSample({ name, duration, reduced }: { name: string; duration: number; reduced: boolean }): JSX.Element {
  const ref = useRef<HTMLSpanElement>(null)
  const [elapsed, setElapsed] = useState<number | null>(null)
  const animationRef = useRef<Animation | null>(null)
  useLayoutEffect(() => () => animationRef.current?.cancel(), [])
  return <div data-gallery-token={name} className="flex items-center gap-4 py-3">
    <code className="w-56 text-xs text-text2">{name} · {duration}ms{elapsed === null ? '' : ` · 实测 ${elapsed}ms`}</code>
    <span ref={ref} className="h-8 w-8 rounded-control bg-accent" />
    <UiButton size="sm" onClick={() => {
      animationRef.current?.cancel()
      const start = performance.now()
      const animation = ref.current?.animate([{ opacity: 0, transform: 'translateX(-100%)' }, { opacity: 1, transform: 'translateX(0)' }], { duration: reduced ? 0 : duration, easing: motion.UI_EASE })
      animationRef.current = animation ?? null
      if (animation) animation.onfinish = () => setElapsed(Math.round(performance.now() - start))
    }}><Play />重放</UiButton>
  </div>
}

function TransitionExamples(): JSX.Element {
  const [open, setOpen] = useState(true)
  const [panelOpen, setPanelOpen] = useState(false)
  const tooltipAnchor = useRef<HTMLSpanElement>(null)
  return <UiGroup title="正式组件开合：点击收起 / 展开后观察实际过渡" titleTone="compact">
    <UiButton size="sm" onClick={() => setOpen(value => !value)}>{open ? '收起组件' : '展开组件'}</UiButton>
    <UiDisclosurePanel open={open}><p className="py-3 text-xs text-text2">UiDisclosurePanel · {motion.UI_DURATION.base}ms</p></UiDisclosurePanel>
    <div data-gallery-ignore-rules="overlayClipped" data-gallery-ignore-reason="容器内动效样本随目录滚动，不是视口浮层" className="relative h-56"><UiModal scope="container" isOpen={open} title="弹窗过渡" onClose={() => setOpen(false)}>UI_DIALOG_TRANSITION_MS · {motion.UI_DIALOG_TRANSITION_MS}ms</UiModal></div>
    <div className="relative h-20"><UiToast placement="container" tone="success" visible={open} message="通知过渡样本" /></div>
    <div className="flex h-24 items-center justify-between gap-4"><span ref={tooltipAnchor} className="text-xs text-text2">提示锚点</span><TooltipContent anchorRef={tooltipAnchor} visible={open} content="Tooltip 进场过渡" /><Dropdown ariaLabel="下拉过渡样本" value="a" options={[{ value: 'a', label: '下拉过渡' }, { value: 'b', label: '另一个选项' }]} onSelect={() => undefined} /><PanelTrigger display="浮层过渡" open={panelOpen} onOpenChange={setPanelOpen} renderPanel={() => <span className="text-xs text-text2">UI_POPOVER_TRANSITION_MS · {motion.UI_POPOVER_TRANSITION_MS}ms</span>} /></div>
  </UiGroup>
}

function LoopSample({ name, reduced }: { name: keyof typeof motion.UI_LOOP_MS; reduced: boolean }): JSX.Element {
  const [running, setRunning] = useState(false)
  const [replay, setReplay] = useState(0)
  const active = running && !reduced
  return <div data-gallery-token={`UI_LOOP_MS.${name}`} className="flex items-center gap-4 py-3">
    <code className="w-56 text-xs text-text2">UI_LOOP_MS.{name} · {motion.UI_LOOP_MS[name]}ms</code>
    <div key={replay} className={`relative h-8 w-8 ${name === 'executing' && active ? 'canvas-node-paint-frame--executing' : ''}`}
      style={{ '--canvas-node-paint-top': '0px', '--canvas-node-paint-right': '0px', '--canvas-node-paint-bottom': '0px', '--canvas-node-paint-left': '0px' } as CSSProperties}>
      {name === 'spin' ? <UiSpinner size="xl" tone="accent" active={active} />
        : <UiSkeleton shape="square" active={name === 'pulse' && active} />}
    </div>
    <UiButton size="sm" onClick={() => { setRunning(true); setReplay(value => value + 1) }}><Play />重放循环</UiButton>
    <UiButton size="sm" disabled={!running} onClick={() => setRunning(false)}><Square />停止</UiButton>
  </div>
}

export function MotionTokensSection(): JSX.Element {
  const [reduced, setReduced] = useState(false)
  return <UiGroup title="动效：实际时长与正式缓动" titleTone="compact">
    <div className="flex items-center gap-3"><span className="text-xs text-text2">模拟减少动态（仅本栏回放）</span><UiSwitch aria-label="模拟减少动态" checked={reduced} onCheckedChange={setReduced} /></div>
    {Object.entries(motion.UI_DURATION).map(([name, duration]) => <MotionSample key={name} name={`UI_DURATION.${name}`} duration={duration} reduced={reduced} />)}
    {Object.entries(motion.UI_LOOP_MS).map(([name]) => <LoopSample key={name} name={name as keyof typeof motion.UI_LOOP_MS} reduced={reduced} />)}
    {GALLERY_MOTION_TOKENS.filter(([, value]) => typeof value === 'number').map(([name, value]) => <MotionSample key={name} name={name} duration={Number(value)} reduced={reduced} />)}
    <p className="break-all text-xs text-text2">UI_EASE · {motion.UI_EASE}<br />UI_EASE_STACK · {motion.UI_EASE_STACK}</p>
    <TokenMapping category="motion" values={Object.fromEntries(GALLERY_MOTION_TOKENS)} />
    <TransitionExamples />
  </UiGroup>
}

export function SourceTokensSection(): JSX.Element {
  return <UiGroup title="styleTokens 全部导出（新增令牌自动出现）" titleTone="compact">{GALLERY_STYLE_TOKENS.map(([name, value]) => <div key={name} data-gallery-token={name} className="flex flex-col gap-2 border-b border-line py-3"><code className="text-xs text-text1">{name}</code><code className="break-all text-xs text-text2">{valueText(value)}</code></div>)}</UiGroup>
}
