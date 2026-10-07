/**
 * 组件样张页的各分区（任务 5.11）。每个样本都直接用 `@/components/ui` 的正式组件与枚举，
 * 不在这里改任何外观；新增共享组件时在这里补一个样本（uiGalleryCoverage.test 会提醒）。
 */
import { useState } from 'react'
import { Bold, Check, Image as ImageIcon, Italic, Link, Pause, Play, Plus, Sparkles, Trash2 } from 'lucide-react'

import {
  AlertDialog,
  Dropdown,
  PanelTrigger,
  PromptDocumentStatic,
  PromptEditor,
  StackedMediaUploader,
  UiButton,
  UiCheckbox,
  UiChipButton,
  UiColorInput,
  UiDatePicker,
  UiDisclosurePanel,
  UiEmpty,
  UiError,
  UiErrorBoundary,
  UiFieldLayoutContext,
  UiFieldTrigger,
  UiFontPicker,
  UiFormRow,
  UiGroup,
  UiIconButton,
  UiInput,
  UiLoading,
  UiModal,
  UiMarqueeText,
  UiNavButton,
  UiNumberStepper,
  UiOptionButton,
  UiOverflowRow,
  UiOverlayLayerProvider,
  UiPageHeader,
  UiPanel,
  UiRangeInput,
  UiColorWheel,
  UiToneCurve,
  UiRegion,
  UiSearchInput,
  UiSelect,
  UiSwitch,
  UiTaskHistoryFilterBar,
  UiTextArea,
  UiTextAreaField,
  UiTextToken,
  UiToast,
  UiToolbar,
  UiTooltipText,
  UiWindowControl,
  UI_COVER_FRAME_CLASS,
  UI_SEGMENTED_TRACK_CLASS,
} from '@/components/ui'
import NumberInput from '@/components/ui/NumberInput'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { createPlainTextPromptDocument } from '@/core/inputs/promptDocument/types'
import { THEME_SEED_ACCENT_HEX } from '@/core/theme/colorTokens'

import { GalleryForce, GalleryMatrix, GalleryRow, GallerySection, type GalleryMatrixState } from './galleryLayout'

const noop = (): void => undefined
const disabledAt = (state: GalleryMatrixState): boolean => state === 'disabled'

export function ButtonSection(): JSX.Element {
  const variants = [
    ['主', 'primary'],
    ['次', 'secondary'],
    ['静默', 'quiet'],
    ['危险', 'danger'],
    ['危险实底', 'dangerSolid'],
    ['链接', 'link'],
  ] as const
  return (
    <GallerySection title="按钮">
      <GalleryMatrix
        rows={variants.map(([label, variant]) => ({
          label,
          render: (state) => (
            <UiButton variant={variant} size="sm" disabled={disabledAt(state)}>
              {variant === 'link' ? '说明' : '保存'}
            </UiButton>
          ),
        }))}
      />
      <GalleryMatrix
        rows={[
          { label: '图标', render: (state) => <UiIconButton aria-label="加粗" disabled={disabledAt(state)}><Bold className="h-4 w-4" /></UiIconButton> },
          { label: '开启', render: (state) => <UiIconButton aria-label="斜体" on disabled={disabledAt(state)}><Italic className="h-4 w-4" /></UiIconButton> },
          { label: '无底', render: (state) => <UiIconButton aria-label="锁定比例" tone="bare" on disabled={disabledAt(state)}><Link className="h-4 w-4" /></UiIconButton> },
          { label: '强调', render: (state) => <UiIconButton aria-label="生成" tone="accent" disabled={disabledAt(state)}><Sparkles className="h-4 w-4" /></UiIconButton> },
          { label: '危险', render: (state) => <UiIconButton aria-label="删除" tone="danger" disabled={disabledAt(state)}><Trash2 className="h-4 w-4" /></UiIconButton> },
        ]}
      />
      <GalleryRow label="窗口">
        <UiWindowControl action="minimize" aria-label="最小化" />
        <UiWindowControl action="maximize" aria-label="最大化" />
        <GalleryForce state="hover"><UiWindowControl action="close" aria-label="关闭（悬停）" /></GalleryForce>
        <UiWindowControl action="close" platform="mac" aria-label="关闭" />
        <UiWindowControl action="minimize" platform="mac" aria-label="最小化" />
        <UiWindowControl action="restore" platform="mac" aria-label="还原" />
      </GalleryRow>
    </GallerySection>
  )
}

export function FieldSection(): JSX.Element {
  const [font, setFont] = useState('sans-serif')
  const [date, setDate] = useState('2026-10-05')
  return (
    // t63: font selector is a distinct value/preview interaction, using the same field surface.
    <GallerySection title="字段">
      <GalleryMatrix
        rows={[
          { label: '输入', render: (state) => <UiInput size="sm" aria-label="名称" defaultValue="镜头 01" disabled={disabledAt(state)} /> },
          { label: '搜索', render: (state) => <UiSearchInput size="sm" aria-label="搜索" placeholder="搜索" disabled={disabledAt(state)} /> },
          { label: '触发器', render: (state) => <UiFieldTrigger size="sm" disabled={disabledAt(state)}>16:9</UiFieldTrigger> },
          { label: '字体', render: (state) => <UiFontPicker value={font} onSelect={setFont} size="sm" disabled={disabledAt(state)} /> },
        ]}
      />
      <GalleryRow label="数值">
        <NumberInput ariaLabel="时长" value={5} onChange={noop} min={1} max={10} size="sm" widthClassName="w-20" />
        <GalleryForce state="focus"><NumberInput ariaLabel="时长（聚焦）" value={8} onChange={noop} size="sm" widthClassName="w-20" /></GalleryForce>
        <span className="inline-flex h-control-sm items-stretch overflow-hidden rounded-field bg-raised">
          <UiNumberStepper size="sm" increaseLabel="增加" decreaseLabel="减少" canIncrease canDecrease={false} onStep={noop} />
        </span>
        <UiRangeInput aria-label="强度" defaultValue={60} className="w-24" />
        <UiColorInput aria-label="颜色" defaultValue={THEME_SEED_ACCENT_HEX.blue.toLowerCase()} />
      </GalleryRow>
      <GalleryRow label="日期">
        <UiSelect size="sm" aria-label="格式" className="w-24"><option>PNG</option></UiSelect>
        <UiDatePicker value={date} onChange={setDate} placeholder="选择日期" ariaLabel="开始日期" clearLabel="清除" todayLabel="今天" className="w-36" />
      </GalleryRow>
      <GalleryRow label="错误">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <UiInput size="sm" aria-label="接口地址" aria-invalid="true" defaultValue="http:/bad" />
          <span className="text-xs text-danger-text">地址格式不正确</span>
        </div>
      </GalleryRow>
      <GalleryRow label="多行">
        <UiTextArea aria-label="描述" rows={2} defaultValue="多行文本" className="min-w-0 flex-1" />
        <UiTextAreaField aria-label="备注" rows={2} placeholder="空占位" className="min-w-0 flex-1" />
      </GalleryRow>
    </GallerySection>
  )
}

const RATIO_OPTIONS = [
  { label: '16:9', value: '16:9' },
  { label: '9:16', value: '9:16' },
  { label: '1:1', value: '1:1', disabled: true },
]

export function MenuSection(): JSX.Element {
  const [ratio, setRatio] = useState('16:9')
  const [anchor, setAnchor] = useState<HTMLSpanElement | null>(null)
  return (
    <GallerySection title="下拉与菜单">
      <GalleryRow label="下拉">
        <Dropdown size="sm" ariaLabel="比例" value={ratio} options={RATIO_OPTIONS} onSelect={setRatio} />
        <GalleryForce state="hover"><Dropdown size="sm" ariaLabel="比例（悬停）" value={ratio} options={RATIO_OPTIONS} onSelect={setRatio} /></GalleryForce>
        <Dropdown size="sm" ariaLabel="比例（禁用）" value={ratio} options={RATIO_OPTIONS} onSelect={setRatio} disabled />
      </GalleryRow>
      <UiFieldLayoutContext.Provider value="toolbar">
        <GalleryRow label="工具条">
          <Dropdown size="sm" label="比例" value={ratio} options={RATIO_OPTIONS} onSelect={setRatio} />
        </GalleryRow>
      </UiFieldLayoutContext.Provider>
      <GalleryRow label="打开">
        {/* 菜单常开：受控 open + 锚定到占位元素，展示正式浮层外壳与菜单项的选中 / 悬停 / 禁用 */}
        <span ref={(node) => { if (node && node !== anchor) setAnchor(node) }} className="h-control-sm w-px" />
        <PanelTrigger
          open
          onOpenChange={noop}
          anchor={anchor}
          panelPadding="menu"
          panelWidth="content"
          renderPanel={() => (
            <div role="listbox" aria-label="菜单样本" className="flex flex-col">
              <UiOptionButton role="option" aria-selected variant="menu" size="sm" active className="w-full justify-between gap-6">
                <span>16:9</span><Check aria-hidden="true" className="h-3.5 w-3.5 text-accent-text" />
              </UiOptionButton>
              <GalleryForce state="hover"><UiOptionButton role="option" aria-selected={false} variant="menu" size="sm" className="w-full">9:16（悬停）</UiOptionButton></GalleryForce>
              <UiOptionButton role="option" aria-selected={false} variant="menu" size="sm" className="w-full">4:3</UiOptionButton>
              <UiOptionButton role="option" aria-selected={false} variant="menu" size="sm" disabled className="w-full">1:1（禁用）</UiOptionButton>
            </div>
          )}
        >
          {() => null}
        </PanelTrigger>
      </GalleryRow>
      <div className="h-36" aria-hidden="true" />
    </GallerySection>
  )
}

export function OptionSection(): JSX.Element {
  return (
    <GallerySection title="选项与分段">
      <GalleryRow label="分段">
        <div className={UI_SEGMENTED_TRACK_CLASS}>
          <UiOptionButton variant="segment" active aria-pressed>图片</UiOptionButton>
          <GalleryForce state="hover"><UiOptionButton variant="segment" aria-pressed={false}>视频</UiOptionButton></GalleryForce>
          <GalleryForce state="focus"><UiOptionButton variant="segment" aria-pressed={false}>音频</UiOptionButton></GalleryForce>
          <UiOptionButton variant="segment" aria-pressed={false} disabled>3D</UiOptionButton>
        </div>
      </GalleryRow>
      <GalleryRow label="网格">
        <UiOptionButton variant="grid" gridCell="tier" active aria-pressed className="justify-center">1K</UiOptionButton>
        <GalleryForce state="hover"><UiOptionButton variant="grid" gridCell="tier" aria-pressed={false} className="justify-center">2K</UiOptionButton></GalleryForce>
        <UiOptionButton variant="grid" gridCell="tier" aria-pressed={false} disabled className="justify-center">4K</UiOptionButton>
      </GalleryRow>
      <GalleryRow label="小样">
        <UiOptionButton variant="tile" active aria-pressed><ImageIcon className="h-4 w-4" />石墨</UiOptionButton>
        <GalleryForce state="hover"><UiOptionButton variant="tile" aria-pressed={false}><ImageIcon className="h-4 w-4" />纸白</UiOptionButton></GalleryForce>
      </GalleryRow>
      <GalleryRow label="色样">
        <UiOptionButton variant="swatch" active aria-label="蓝" aria-pressed><span className="block h-full w-full rounded-full bg-accent" /></UiOptionButton>
        <GalleryForce state="hover"><UiOptionButton variant="swatch" aria-label="成功色" aria-pressed={false}><span className="block h-full w-full rounded-full bg-success-solid" /></UiOptionButton></GalleryForce>
        <UiOptionButton variant="swatch" aria-label="危险色" aria-pressed={false}><span className="block h-full w-full rounded-full bg-danger-solid" /></UiOptionButton>
      </GalleryRow>
      <GalleryRow label="多选">
        <UiOptionButton selection="multiple" size="sm" active aria-pressed>人像</UiOptionButton>
        <UiOptionButton selection="multiple" size="sm" aria-pressed={false}>风景</UiOptionButton>
        <UiOptionButton variant="flat" size="sm">上传音频</UiOptionButton>
      </GalleryRow>
      <GalleryRow label="封面">
        {[['已选', true, undefined], ['悬停', false, 'hover'], ['静息', false, undefined]].map(([name, active, state]) => (
          <GalleryForce key={String(name)} state={state as 'hover' | undefined}>
            <UiOptionButton variant="cover" active={Boolean(active)} aria-pressed={Boolean(active)} className="w-16">
              <span className={`${UI_COVER_FRAME_CLASS} aspect-[16/10] w-full`}>
                <span className="flex h-full w-full items-center justify-center">
                  <ImageIcon className="h-4 w-4 text-text3" aria-hidden="true" />
                </span>
              </span>
              <span className="truncate px-0.5 text-xs text-text1">{String(name)}</span>
            </UiOptionButton>
          </GalleryForce>
        ))}
      </GalleryRow>
    </GallerySection>
  )
}

export function ToggleSection(): JSX.Element {
  return (
    <GallerySection title="开关与复选">
      <GalleryRow label="开关">
        <UiSwitch aria-label="关" checked={false} />
        <UiSwitch aria-label="开" checked />
        <GalleryForce state="hover"><UiSwitch aria-label="关（悬停）" checked={false} /></GalleryForce>
        <GalleryForce state="focus"><UiSwitch aria-label="开（聚焦）" checked /></GalleryForce>
        <UiSwitch aria-label="禁用" checked disabled />
      </GalleryRow>
      <GalleryRow label="双段">
        <UiSwitch aria-label="模式" appearance="segmented" size="compact" offLabel="单张" onLabel="批量" checked={false} />
        <UiSwitch aria-label="模式（开）" appearance="segmented" size="compact" offLabel="单张" onLabel="批量" checked />
      </GalleryRow>
      <GalleryRow label="复选">
        <UiCheckbox aria-label="未选" checked={false} />
        <UiCheckbox aria-label="已选" checked />
        <GalleryForce state="hover"><UiCheckbox aria-label="未选（悬停）" checked={false} /></GalleryForce>
        <GalleryForce state="focus"><UiCheckbox aria-label="已选（聚焦）" checked /></GalleryForce>
        <UiCheckbox aria-label="禁用" checked disabled />
      </GalleryRow>
    </GallerySection>
  )
}

export function NavigationSection(): JSX.Element {
  return (
    <GallerySection title="标签与导航">
      <GalleryRow label="标签">
        <UiChipButton size="sm" active aria-pressed>已选</UiChipButton>
        <GalleryForce state="hover"><UiChipButton size="sm" aria-pressed={false}>悬停</UiChipButton></GalleryForce>
        <UiChipButton size="sm" aria-pressed={false}>静息</UiChipButton>
        <UiChipButton size="sm" aria-pressed={false} disabled>禁用</UiChipButton>
      </GalleryRow>
      <GalleryRow label="导航">
        <UiChipButton size="sm" selectionRole="navigation" active aria-current="page">生成</UiChipButton>
        <GalleryForce state="hover"><UiChipButton size="sm" selectionRole="navigation">画布</UiChipButton></GalleryForce>
        <UiChipButton size="sm" selectionRole="navigation">工具</UiChipButton>
      </GalleryRow>
      <GalleryRow label="面板">
        <UiChipButton size="sm" selectionRole="navigation" selectionAppearance="subtle" active aria-current="true">参数</UiChipButton>
        <UiChipButton size="sm" selectionRole="navigation" selectionAppearance="subtle">历史</UiChipButton>
      </GalleryRow>
      <GalleryRow label="工作区">
        <UiChipButton selectionRole="navigation" selectionAppearance="workspace" active aria-current="page">剪辑</UiChipButton>
        <UiChipButton selectionRole="navigation" selectionAppearance="workspace" on>资产</UiChipButton>
        <UiChipButton selectionRole="navigation" selectionAppearance="workspace" on={false}>助手</UiChipButton>
      </GalleryRow>
      <div className="flex flex-col gap-0.5">
        <UiNavButton size="md" active aria-current="page">通用</UiNavButton>
        <GalleryForce state="hover"><UiNavButton size="md">界面（悬停）</UiNavButton></GalleryForce>
        <UiNavButton size="md" disabled>供应商（禁用）</UiNavButton>
      </div>
      <GalleryRow label="词块">
        <span className="text-13">
          <UiTextToken current>正在</UiTextToken>
          <UiTextToken selected>选中</UiTextToken>
          <UiTextToken excluded>删除</UiTextToken>
          <UiTextToken flagged>待留意</UiTextToken>
          <UiTextToken>静息</UiTextToken>
        </span>
        <span className="inline-flex h-6 gap-1">
          <UiTextToken appearance="chip" selected>字幕</UiTextToken>
          <UiTextToken appearance="chip">字幕</UiTextToken>
        </span>
      </GalleryRow>
    </GallerySection>
  )
}

export function FormSection(): JSX.Element {
  const [open, setOpen] = useState(true)
  const [curve, setCurve] = useState<number[]>([0, 0.25, 0.5, 0.75, 1])
  const [wheel, setWheel] = useState({ hue: 30, strength: 0.4 })
  const idle = (): void => undefined
  return (
    <GallerySection title="表单与分组">
      <UiGroup title="基础设置">
        <UiFormRow label={<UiTooltipText tooltip="影响界面与模型提示词">语言</UiTooltipText>} hint="不看会选错的常驻说明">
          <UiInput size="sm" defaultValue="简体中文" />
        </UiFormRow>
        <UiFormRow label="快速下载" inline>
          <UiSwitch checked />
        </UiFormRow>
      </UiGroup>
      <UiGroup divided titleTone="compact" title="紧凑分组">
        <UiFormRow label="不透明度" density="compact">
          <UiRangeInput defaultValue={40} />
        </UiFormRow>
        <div className="flex items-center gap-2">
          <UiButton size="sm" onClick={() => setOpen(!open)}>{open ? '收起' : '展开'}</UiButton>
          <UiDisclosurePanel open={open}>
            <span className="text-xs text-text2">展开区内容</span>
          </UiDisclosurePanel>
        </div>
      </UiGroup>
      <UiGroup divided titleTone="compact" title="调色控件">
        <div className="flex items-center gap-4">
          <div className="w-40"><UiToneCurve label="RGB 曲线" values={curve} onChange={(point, value) => setCurve(current => current.map((item, index) => index === point ? value : item))} onBegin={idle} onFinish={idle} onCancel={idle} /></div>
          <div className="w-24"><UiColorWheel label="中间调" hue={wheel.hue} strength={wheel.strength} onChange={(hue, strength) => setWheel({ hue, strength })} onBegin={idle} onFinish={idle} onCancel={idle} /></div>
        </div>
      </UiGroup>
    </GallerySection>
  )
}

const OVERFLOW_ITEMS = ['模型', '比例', '时长', '分辨率', '数量'].map((label, index) => ({
  id: label,
  priority: index === 0 ? 10 : 5 - index,
  pinned: index === 0,
  node: <UiFieldTrigger size="sm" appearance="quiet">{label}</UiFieldTrigger>,
}))

export function ToolbarSection(): JSX.Element {
  return (
    <GallerySection title="命令带与页头">
      <UiPanel variant="bare" className="overflow-hidden">
        <UiToolbar
          variant="command"
          trailing={<UiButton variant="primary" size="sm">导出</UiButton>}
          center={<div className={UI_SEGMENTED_TRACK_CLASS}><UiOptionButton variant="segment" active aria-pressed>编辑</UiOptionButton><UiOptionButton variant="segment" aria-pressed={false}>预览</UiOptionButton></div>}
          subordinate={<span className="text-xs text-text2">从属参数带</span>}
        >
          <UiIconButton aria-label="添加"><Plus className="h-4 w-4" /></UiIconButton>
          <span data-user-content className="w-24 text-13 text-text1"><UiMarqueeText text="很长的文件名会滚动显示.mp4" className="w-full" /></span>
        </UiToolbar>
      </UiPanel>
      <UiOverflowRow
        items={OVERFLOW_ITEMS}
        renderOverflow={(hidden) => <UiFieldTrigger size="sm" appearance="quiet">更多 {hidden.length}</UiFieldTrigger>}
        className="w-64"
      />
      <UiRegion maxWidthClassName="max-w-full">
        <UiPageHeader title="生成记录" meta="128" description="页头：标题、数量与说明" onBack={noop} backLabel="返回" actions={<UiButton size="sm">清空</UiButton>} />
      </UiRegion>
    </GallerySection>
  )
}

export function StateSection(): JSX.Element {
  return (
    <GallerySection title="空 / 加载 / 错误">
      <div className="grid grid-cols-2 gap-3">
        <UiEmpty size="xs" title="还没有供应商" description="先添加一个吧" />
        <UiLoading size="xs" message="生成中…"><ProgressBar progress={42} className="w-32" /></UiLoading>
        <UiError size="xs" message="网络连接超时" onRetry={noop} retryLabel="重试" />
        <UiEmpty size="node" icon={<ImageIcon className="h-6 w-6" />} title="等待结果" />
      </div>
      <ProgressBar progress={64} appearance="hairline" />
    </GallerySection>
  )
}

export function DialogSection(): JSX.Element {
  return (
    <GallerySection title="弹窗与通知">
      {/* 确认弹窗限定在容器内常开：危险确认按钮、次按钮与正文 */}
      <div className="relative h-44 overflow-hidden rounded-overlay">
        <AlertDialog
          isOpen
          scope="container"
          type="warning"
          title="删除这个画布？"
          message="删除后无法恢复。"
          onClose={noop}
          closeLabel="取消"
          actions={[{ label: '删除', onClick: noop, tone: 'danger' }]}
        />
      </div>
      <div className="relative h-12">
        <UiToast placement="container" tone="success" message="已保存" />
      </div>
      <div className="relative h-12">
        <UiToast placement="container" tone="error" message="导出失败" />
      </div>
    </GallerySection>
  )
}

export function MediaSection(): JSX.Element {
  return (
    <GallerySection title="媒体叠层与玻璃">
      <div className="relative flex h-52 flex-col justify-between overflow-hidden rounded-overlay bg-media p-3">
        {/* 通知（玻璃）压在画面顶部居中：容器铺满整个画面，短文案不会被挤成竖排 */}
        <UiToast placement="container" surface="glass" tone="success" message="已复制" />
        <div className="flex items-end justify-between gap-2 pt-12">
          <UiPanel variant="glass" className="flex flex-col gap-0.5 px-3 py-2">
            <span className="text-13 text-text1">主要文字</span>
            <span className="text-xs text-text2">次要文字</span>
            <span className="text-xs text-text3">辅助文字</span>
          </UiPanel>
          <div className="flex items-center gap-1.5">
            <UiIconButton tone="media" aria-label="播放"><Play className="h-4 w-4" /></UiIconButton>
            <GalleryForce state="hover"><UiIconButton tone="media" aria-label="暂停（悬停）"><Pause className="h-4 w-4" /></UiIconButton></GalleryForce>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <UiButton variant="media" size="sm">替换</UiButton>
          <GalleryForce state="hover"><UiButton variant="media" size="sm">裁剪</UiButton></GalleryForce>
        </div>
      </div>
    </GallerySection>
  )
}

const PROMPT_TEXT = createPlainTextPromptDocument('一只橘猫坐在窗台上，午后阳光')

export function ContentSection(): JSX.Element {
  const [prompt, setPrompt] = useState(PROMPT_TEXT)
  return (
    <GallerySection title="内容输入">
      <PromptEditor value={prompt} onChange={setPrompt} ariaLabel="提示词" placeholder="描述画面" editorClassName="min-h-14" />
      <PromptEditor value={createPlainTextPromptDocument('')} onChange={noop} ariaLabel="提示词（错误）" placeholder="描述画面" error errorMessage="提示词不能为空" editorClassName="min-h-10" />
      <PromptDocumentStatic document={PROMPT_TEXT} ariaLabel="提示词只读" />
      <UiErrorBoundary loggerDomain="DevGallery" event="dev_gallery.render_failed" title="样张渲染失败">
        <StackedMediaUploader files={[]} fileTypes={['image']} onUpload={noop} onRemove={noop} hintText="拖入或点击上传图片" />
      </UiErrorBoundary>
    </GallerySection>
  )
}

export function FilterSection(): JSX.Element {
  const [keyword, setKeyword] = useState('')
  // UiModal 是视口级模态（焦点陷阱），不常开：点按钮打开后目视；截图里由常开的 AlertDialog 代表弹窗外观
  const [modalOpen, setModalOpen] = useState(false)
  return (
    <GallerySection title="筛选条">
      <UiOverlayLayerProvider id="dev-gallery-filter">
        <UiTaskHistoryFilterBar
          mode="always"
          keyword={keyword}
          providerId=""
          modelId=""
          mediaType="all"
          timePreset="all"
          startDate=""
          endDate=""
          providerOptions={[{ label: '全部供应商', value: '' }]}
          modelOptions={[{ label: '全部模型', value: '' }]}
          showMediaType={false}
          onKeywordChange={setKeyword}
          onProviderChange={noop}
          onModelChange={noop}
          onMediaTypeChange={noop}
          onTimePresetChange={noop}
          onStartDateChange={noop}
          onEndDateChange={noop}
        />
      </UiOverlayLayerProvider>
      <GalleryRow label="弹窗">
        <UiButton variant="secondary" size="sm" onClick={() => setModalOpen(true)}>打开弹窗</UiButton>
      </GalleryRow>
      <UiModal
        isOpen={modalOpen}
        title="弹窗样本"
        onClose={() => setModalOpen(false)}
        footer={<><UiButton variant="secondary" onClick={() => setModalOpen(false)}>取消</UiButton><UiButton variant="primary" onClick={() => setModalOpen(false)}>确定</UiButton></>}
      >
        <span className="text-13 text-text2">弹窗正文：标题栏、内容区与底部动作。</span>
      </UiModal>
    </GallerySection>
  )
}
