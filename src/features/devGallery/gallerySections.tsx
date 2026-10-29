import { UI_ICON_SIZE_CLASS } from '@/components/ui/styleTokens'
import { notificationMessage } from '@/i18n/notifications'
import { requestAlertConfirmation } from '@/stores/alertDialogStore'
import { useI18n } from '@/hooks/useI18n'
/**
 * 组件样张页的各分区（任务 5.11）。每个样本都直接用 `@/components/ui` 的正式组件与枚举，
 * 不在这里改任何外观；新增共享组件时在这里补一个样本（uiGalleryCoverage.test 会提醒）。
 */
import { useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { Bold, Check, Image as ImageIcon, Italic, Link, List, Pause, Play, Plus, Sparkles, Timer, Trash2 } from 'lucide-react'

import {
  AlertDialog,
  Dropdown,
  PanelTrigger,
  PromptDocumentStatic,
  PromptEditor,
  StackedMediaUploader,
  UiButton,
  UiSpinner,
  UiSkeleton,
  UiFieldMessage,
  UiInlineStatus,
  UiCheckbox,
  UiChipButton,
  UiColorInput,
  UiDatePicker,
  UiDisclosurePanel,
  UiEmpty,
  UiError,
  UiErrorBoundary,
  UiFieldLayoutContext,
  UiPropertyUnit,
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
  UiReadout,
  UiNumberStepper,
  UiOptionButton,
  UiOverflowRow,
  UiOverlayLayerProvider,
  UiPageHeader,
  UiPanel,
  UiRangeInput,
  UiAngleDial,
  UiPointPad,
  UiRangeSlider,
  UiGradientEditor,
  UiGradeWheel,
  UiCurveEditor,
  UiEasingEditor,
  UiSeedInput,
  UiSegmented,
  UiSpecialPanel,
  UiRegion,
  UiSearchInput,
  UiSelect,
  UiSwitch,
  UiTaskHistoryFilterBar,
  UiTextArea,
  UiTextToken,
  UiToast,
  UiToolbar,
  UiTooltipText,
  UiWindowControl,
  UI_COVER_FRAME_CLASS,
  UI_MODAL_SIZE_CLASS,
  type UiModalSize,
  type UiPanelFooterTool,
} from '@/components/ui'
import NumberInput from '@/components/ui/NumberInput'
import { ProgressBar } from '@/components/ui/ProgressBar'
import FileUploader from '@/components/ui/FileUploader'
import Tooltip, { TooltipContent } from '@/components/ui/Tooltip'
import ContextMenu from '@/components/ContextMenu'
import PriceEstimate from '@/components/ui/PriceEstimate'
import { registry } from '@/core/ModelRegistry'
import { readPriceEstimateDisplaySettings } from '@/core/pricing/priceDisplay'
import AudioPlayer from '@/components/AudioPlayer'
import { WaveformView } from '@/components/waveform/WaveformView'
import { TypographyPanel } from '@/components/typography/TypographyPanel'
import { PropertyHeading } from '@/components/ui/params/ParamList'
import { defaultTextStyle } from '@/core/imaging/vectorContent/text'
import { type ButtonSize } from '@/components/ui/primitiveInternals'
import { createPlainTextPromptDocument } from '@/core/inputs/promptDocument/types'
import { THEME_SEED_ACCENT_HEX } from '@/core/theme/colorTokens'

import { GalleryForce, GalleryRow, GallerySection } from './galleryLayout'
import { GALLERY_MATRIX_COLUMNS, type GalleryMatrixState } from './forcedPseudoStates'
import { GALLERY_CONTROL_SIZES, GALLERY_ICON_SIZES, GALLERY_SEGMENTED_SIZES, GALLERY_PARAMETER_SIZES } from './galleryIndex'

/** 七列只对组件支持的状态渲染样本；不支持的明确写“不适用”。 */
function GalleryMatrix({ rows }: { rows: readonly { label: string; states?: readonly GalleryMatrixState[]; render: (state: GalleryMatrixState) => ReactNode }[] }): JSX.Element {
  return <table className="w-full border-separate border-spacing-x-2 border-spacing-y-2">
    <thead><tr><th scope="col" className="text-left text-xs text-text2">档位</th>{GALLERY_MATRIX_COLUMNS.map(column => <th key={column.state} scope="col" className="text-left text-xs text-text2">{column.label}</th>)}</tr></thead>
    <tbody>{rows.map(row => <tr key={row.label}><th scope="row" className="text-left text-xs text-text2">{row.label}</th>{GALLERY_MATRIX_COLUMNS.map(column => {
      if (!(row.states ?? ['rest', 'hover', 'active', 'focus', 'disabled']).includes(column.state)) return <td key={column.state} className="text-2xs text-text3">不适用</td>
      const sample = row.render(column.state)
      const forced = column.state === 'hover' || column.state === 'active' || column.state === 'focus' ? column.state : undefined
      return <td key={column.state} data-gallery-state={column.state}>{forced && sample ? <GalleryForce state={forced}>{sample as ReactElement}</GalleryForce> : sample}</td>
    })}</tr>)}</tbody>
  </table>
}

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
    ['媒体', 'media'],
  ] as const
  return (
    <GallerySection title="按钮">
      <div className="contents" data-gallery-ignore-rules="multiplePrimary" data-gallery-ignore-reason="按钮状态矩阵并排展示主动作的全部视觉状态">
      <GalleryMatrix
        rows={variants.map(([label, variant]) => ({
          label,
          states: ['rest', 'hover', 'active', 'focus', 'disabled', 'loading'],
          render: (state) => (
            <UiButton variant={variant} size="sm" disabled={disabledAt(state)} loading={state === 'loading'}>
              {variant === 'link' ? '说明' : '保存'}
            </UiButton>
          ),
        }))}
 />
      <GalleryMatrix
        rows={[
          { label: '图标', render: (state) => <UiIconButton aria-label="加粗" disabled={disabledAt(state)}><Bold /></UiIconButton> },
          { label: '开启', render: (state) => <UiIconButton aria-label="斜体" on disabled={disabledAt(state)}><Italic /></UiIconButton> },
          { label: '无底', render: (state) => <UiIconButton aria-label="锁定比例" tone="bare" on disabled={disabledAt(state)}><Link /></UiIconButton> },
          { label: '强调', render: (state) => <UiIconButton aria-label="生成" tone="accent" disabled={disabledAt(state)}><Sparkles /></UiIconButton> },
          { label: '危险', render: (state) => <UiIconButton aria-label="删除" tone="danger" disabled={disabledAt(state)}><Trash2 /></UiIconButton> },
        ]}
 />
      </div>
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
        <UiRangeInput aria-label="强度" defaultValue={60} className="!w-24" />
        <UiColorInput aria-label="颜色" defaultValue={THEME_SEED_ACCENT_HEX.blue.toLowerCase()} />
      </GalleryRow>
      <GalleryRow label="日期">
        <UiSelect size="sm" aria-label="格式" className="w-24"><option>PNG</option></UiSelect>
        <UiDatePicker value={date} onChange={setDate} placeholder="选择日期" ariaLabel="开始日期" clearLabel="清除" todayLabel="今天" className="w-36" />
      </GalleryRow>
      <GalleryRow label="错误">
        <UiFormRow label="接口地址" error="地址格式不正确" className="min-w-0 flex-1">
          <UiInput size="sm" defaultValue="http:/bad" />
        </UiFormRow>
      </GalleryRow>
      <GalleryRow label="多行">
        <UiTextArea aria-label="描述" rows={2} defaultValue="多行文本" className="min-w-0 flex-1" />
        <UiTextArea aria-label="备注" rows={2} placeholder="空占位" className="min-w-0 flex-1" />
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
                <span>16:9</span><Check aria-hidden="true" className={`${UI_ICON_SIZE_CLASS.sm} text-accent-text`} />
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
  const [segment, setSegment] = useState('place')
  return (
    <GallerySection title="选项与分段">
      <GalleryRow label="统一分段">
        <UiSegmented ariaLabel="示范方式样张" size="sm" value={segment} onChange={setSegment} options={[{ value: 'place', label: '分时摆放' }, { value: 'record', label: '录制轨迹' }, { value: 'disabled', label: '禁用', disabled: true }]} />
      </GalleryRow>
      <p className="text-xs text-text2">分段选中：中性抬起底 + 强文字，最多 5 项；其他单选：中性选中底，靠强调文字或勾区分。</p>
      <GalleryRow label="网格">
        <UiOptionButton variant="grid" gridCell="tier" active aria-pressed className="justify-center">1K</UiOptionButton>
        <GalleryForce state="hover"><UiOptionButton variant="grid" gridCell="tier" aria-pressed={false} className="justify-center">2K</UiOptionButton></GalleryForce>
        <UiOptionButton variant="grid" gridCell="tier" aria-pressed={false} disabled className="justify-center">4K</UiOptionButton>
      </GalleryRow>
      <GalleryRow label="小样">
        <UiOptionButton variant="tile" active aria-pressed><ImageIcon className={`${UI_ICON_SIZE_CLASS.md}`} />石墨</UiOptionButton>
        <GalleryForce state="hover"><UiOptionButton variant="tile" aria-pressed={false}><ImageIcon className={`${UI_ICON_SIZE_CLASS.md}`} />纸白</UiOptionButton></GalleryForce>
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
                  <ImageIcon className={`${UI_ICON_SIZE_CLASS.md} text-text3`} aria-hidden="true" />
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
      <GalleryRow label="停靠面板里的开关">
        <UiSwitch appearance="checkbox" aria-label="关（停靠面板）" checked={false} />
        <UiSwitch appearance="checkbox" aria-label="开（停靠面板）" checked />
      </GalleryRow>
      <GalleryRow label="双段"><UiSwitch appearance="segmented" size="lg" checked onLabel="打开" offLabel="关闭" />
        <UiSwitch aria-label="模式" appearance="segmented" size="sm" offLabel="单张" onLabel="批量" checked={false} />
        <UiSwitch aria-label="模式（开）" appearance="segmented" size="sm" offLabel="单张" onLabel="批量" checked />
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
      <GalleryRow label="读数"><UiReadout size="sm">100%</UiReadout><UiReadout size="md">100%</UiReadout><UiReadout size="lg" tone="media">100%</UiReadout></GalleryRow>
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
  const [propertyOpen, setPropertyOpen] = useState(true)
  const idle = (): void => undefined
  const gesture = { onBegin: idle, onFinish: idle, onCancel: idle }
  const [angle, setAngle] = useState(30)
  const [point, setPoint] = useState({ x: 0.4, y: 0.6 })
  const [range, setRange] = useState<[number, number]>([20, 70])
  const [stops, setStops] = useState([{ at: 0, color: [0.1, 0.2, 0.6, 1] as [number, number, number, number] }, { at: 1, color: [0.9, 0.5, 0.2, 1] as [number, number, number, number] }])
  const [grade, setGrade] = useState({ hue: 200, strength: 0.3, luminance: 0.1 })
  const [points, setPoints] = useState([{ x: 0, y: 0 }, { x: 0.5, y: 0.6 }, { x: 1, y: 1 }])
  const [easing, setEasing] = useState<string | [number, number, number, number]>('ease')
  const [seed, setSeed] = useState(42)
  return (
    <GallerySection title="表单与分组">
      {/* 每个分组是独立样本，组间距交给 GallerySection，避免叠加 UiGroup 的相邻分区留白。 */}
      <div><UiGroup title="基础设置">
        <UiFormRow label={<UiTooltipText tooltip="影响界面与模型提示词">语言</UiTooltipText>} hint="不看会选错的常驻说明">
          <UiInput size="sm" defaultValue="简体中文" />
        </UiFormRow>
        <UiFormRow label="快速下载" inline>
          <UiSwitch checked />
        </UiFormRow>
      </UiGroup></div>
      {/* 属性面板（重要记录 019）：四列 箭头 / 秒表 / 名称 / 右对齐数值；单位挂进右侧单位道，下拉与勾选右缘对齐到道边。
          分组标题是同一套四列里的可折叠小标题（箭头落在秒表列）。 */}
      <UiPanel variant="bare" className="w-80"><UiFieldLayoutContext.Provider value="property">
        <PropertyHeading label="变换" name={`${propertyOpen ? '收起' : '展开'}变换`} open={propertyOpen} onToggle={() => setPropertyOpen(value => !value)} />
        {propertyOpen && <>
          <UiFormRow label="位置" leading={<UiIconButton size="2xs" on aria-label="关闭位置关键帧"><Timer /></UiIconButton>}>
            <NumberInput size="sm" align="right" value={960} onChange={noop} /><UiPropertyUnit hanging={false} />
            <NumberInput size="sm" align="right" value={540} onChange={noop} />
          </UiFormRow>
          <UiFormRow label="缩放"><NumberInput size="sm" align="right" value={100} onChange={noop} /><UiPropertyUnit>%</UiPropertyUnit></UiFormRow>
          <UiFormRow label="重复边缘像素"><UiCheckbox checked onCheckedChange={noop} aria-label="重复边缘像素" /></UiFormRow>
        </>}
      </UiFieldLayoutContext.Provider></UiPanel>
      <div><UiGroup divided titleTone="compact" title="紧凑分组" labelWidth={96}>
        <UiFormRow label="不透明度" density="compact">
          <UiRangeInput defaultValue={40} />
        </UiFormRow>
        <UiFormRow label="">
          <div className="flex items-center gap-2">
            <UiButton size="sm" onClick={() => setOpen(!open)}>{open ? '收起' : '展开'}</UiButton>
            <UiDisclosurePanel open={open}>
              <span className="text-xs text-text2">展开区内容</span>
            </UiDisclosurePanel>
          </div>
        </UiFormRow>
      </UiGroup></div>
      <div><UiGroup divided titleTone="compact" title="参数控件">
        <div className="grid grid-cols-2 gap-4">
          <UiAngleDial label="方向" value={angle} onChange={setAngle} defaultValue={0} {...gesture} />
          <UiPointPad label="中心" value={point} onChange={setPoint} aspect={16 / 9} {...gesture} />
          <UiRangeSlider label="色相范围" value={range} onChange={setRange} min={0} max={360} track="hue" {...gesture} />
          <UiGradientEditor label="渐变" value={stops} onChange={setStops} {...gesture} />
          <UiGradeWheel label="中间调" value={grade} onChange={setGrade} {...gesture} />
          <UiCurveEditor label="明暗曲线" value={points} onChange={setPoints} {...gesture} />
          <UiEasingEditor label="缓动" value={easing} onChange={setEasing} presets={[{ value: 'ease', label: '缓入缓出', curve: [0.42, 0, 0.58, 1] }, { value: 'linear', label: '线性', curve: [0, 0, 1, 1] }]} {...gesture} />
          <UiSeedInput label="种子" value={seed} onChange={setSeed} {...gesture} />
        </div>
      </UiGroup></div>
    </GallerySection>
  )
}

const OVERFLOW_ITEMS = ['模型', '比例', '时长', '分辨率', '数量'].map((label, index) => ({
  id: label,
  priority: index === 0 ? 10 : 5 - index,
  pinned: index === 0,
  node: <UiFieldTrigger size="sm" appearance="quiet">{label}</UiFieldTrigger>,
}))

const FOOTER_TOOLS: UiPanelFooterTool[] = [
  { kind: 'action', id: 'view', label: '视图与排序', icon: List, onSelect: noop },
  { kind: 'action', id: 'link', label: '链接选择', icon: Link, on: true, onSelect: noop },
  { kind: 'action', id: 'remove', label: '删除选中项', icon: Trash2, tone: 'danger', disabled: true, disabledReason: '先选中一项', onSelect: noop },
  { kind: 'action', id: 'create', label: '新建', icon: Plus, onSelect: noop },
]

export function ToolbarSection(): JSX.Element {
  const [mode, setMode] = useState('edit')
  return (
    <GallerySection title="命令带与页头">
      <UiPanel variant="bare" className="overflow-hidden">
        <UiToolbar
          variant="command"
          trailing={<UiButton variant="primary" size="md">导出</UiButton>}
          center={<UiSegmented ariaLabel="编辑模式" value={mode} onChange={setMode} options={[{ value: 'edit', label: '编辑' }, { value: 'preview', label: '预览' }]} />}
          subordinate={<span className="text-xs text-text2">从属参数带</span>}
 >
          <UiIconButton aria-label="添加"><Plus /></UiIconButton>
          <span data-user-content className="w-24 text-13 text-text1"><UiMarqueeText text="很长的文件名会滚动显示.mp4" className="w-full" /></span>
        </UiToolbar>
      </UiPanel>
      {/* 同一组底栏工具放在宽、窄两种面板里：窄的先截断状态文字，再从右往左收进“更多” */}
      {['w-80', 'w-40'].map((width) => <UiPanel key={width} variant="bare" className={`${width} overflow-hidden`}>
        <UiToolbar variant="footer" aria-label="面板底栏" tools={FOOTER_TOOLS}>8 项 · 已选 1</UiToolbar>
      </UiPanel>)}
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

function FeedbackSamples(): JSX.Element {
  const [loading, setLoading] = useState(false)
  return <>
    <GalleryRow label="加载切换"><UiButton loading={loading}>保存文件</UiButton><UiButton onClick={() => setLoading(value => !value)}>切换加载</UiButton><UiButton disabled disabledReason="先选择素材" tooltip="导出所选素材">导出</UiButton></GalleryRow>
    <GalleryRow label="行内加载">{GALLERY_ICON_SIZES.map(size => <UiSpinner key={size} size={size} />)}<UiSpinner tone="accent" /></GalleryRow>
    <GalleryRow label="骨架"><UiSkeleton shape="line" /><div className="w-24"><UiSkeleton shape="block" /></div><div className="w-16"><UiSkeleton shape="square" /></div></GalleryRow>
    <GalleryRow label="字段消息"><UiFieldMessage tone="error">名称已存在</UiFieldMessage><UiFieldMessage tone="hint">最多二十字</UiFieldMessage></GalleryRow>
    <GalleryRow label="行内反馈"><UiInlineStatus tone="error">保存未完成</UiInlineStatus><UiInlineStatus tone="warning">部分素材缺失</UiInlineStatus><UiInlineStatus tone="success">保存完成</UiInlineStatus></GalleryRow>
  </>
}

export function StateSection(): JSX.Element {
  return (
    <GallerySection title="空 / 加载 / 错误">
      <FeedbackSamples />
      <div className="grid grid-cols-2 gap-3">
        <UiEmpty size="xs" title="还没有供应商" description="先添加一个吧" />
        <UiLoading size="xs" message="生成中…"><ProgressBar progress={42} className="w-32" /></UiLoading>
        <UiError size="xs" message="网络连接超时" onRetry={noop} retryLabel="重试" />
        <UiEmpty size="node" icon={<ImageIcon className={`${UI_ICON_SIZE_CLASS.xl}`} />} title="等待结果" />
      </div>
      <ProgressBar progress={64} appearance="hairline" />
    </GallerySection>
  )
}

export function DialogSection(): JSX.Element {
  const { t } = useI18n('common')
  return (
    <GallerySection title="弹窗与通知">
      {/* 确认弹窗限定在容器内常开：危险确认按钮、次按钮与正文 */}
      <div className="relative h-44 overflow-hidden rounded-overlay" data-gallery-ignore-rules="overlayClipped" data-gallery-ignore-reason="容器内常开的确认弹窗示意随目录滚动，滚到目录边缘被滚动区裁掉是滚动，不是浮层越界">
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
        <UiToast placement="container" surface="solid" tone="success" message={notificationMessage('saved')} />
      </div>
      <div className="relative h-12">
        <UiToast placement="container" tone="error" message={notificationMessage('exportFailed')} />
      </div>
      <div className="relative h-20"><UiToast placement="container" tone="warning" action={{ label: '重试', onClick: noop }} message="需要重试" /></div>
      <UiGroup title="测试夹具：仅核对付费确认弹窗，不提交生成" titleTone="compact" data-gallery-fixture="paid-approval">
        <UiButton data-paid-approval-fixture onClick={() => { void requestAlertConfirmation({
          title: t('paidApproval.sendExplanation'), message: t('paidApproval.explanationContent', { count: 2, modelName: 'Example model' }),
          confirmLabel: t('paidApproval.allowOnce'), paidConfirmation: true,
          paidDetails: { estimatedCny: 1.25, dailySpentCny: 3, category: 'explanation', modelName: 'Example model' },
        }) }}>{t('paidApproval.allowOnce')}</UiButton>
      </UiGroup>
    </GallerySection>
  )
}

export function MediaSection(): JSX.Element {
  return (
    <GallerySection title="媒体叠层与玻璃">
      <div className="relative flex h-52 flex-col justify-between overflow-hidden rounded-overlay bg-media p-3">
        {/* 通知（玻璃）压在画面顶部居中：容器铺满整个画面，短文案不会被挤成竖排 */}
        <UiToast placement="container" surface="glass" tone="success" message={notificationMessage('copied')} />
        <div className="flex items-end justify-between gap-2 pt-12">
          <UiPanel variant="glass" className="flex flex-col gap-0.5 px-3 py-2">
            <span className="text-13 text-text1">主要文字</span>
            <span className="text-xs text-text2">次要文字</span>
            <span className="text-xs text-text3">辅助文字</span>
          </UiPanel>
          <div className="flex items-center gap-1.5">
            <UiIconButton tone="media" aria-label="播放"><Play /></UiIconButton>
            <GalleryForce state="hover"><UiIconButton tone="media" aria-label="暂停（悬停）"><Pause /></UiIconButton></GalleryForce>
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
      <PromptEditor value={prompt} onChange={setPrompt} ariaLabel="提示词" placeholder="描述画面" height="short" />
      <PromptEditor value={createPlainTextPromptDocument('')} onChange={noop} ariaLabel="提示词（错误）" placeholder="描述画面" error errorMessage="提示词不能为空" height="short" />
      <PromptDocumentStatic document={PROMPT_TEXT} ariaLabel="提示词只读" />
      <UiErrorBoundary loggerDomain="DevGallery" event="dev_gallery.render_failed" title="样张渲染失败">
        <StackedMediaUploader files={[]} fileTypes={['image']} onUpload={noop} onRemove={noop} hintText="拖入或点击上传图片" />
        <FileUploader files={[]} onUpload={noop} onRemove={noop} density="default" disabled />
        <FileUploader files={[]} onUpload={noop} onRemove={noop} density="compact" disabled />
      </UiErrorBoundary>
      <UiFormRow inline label="开关"><UiSwitch checked onCheckedChange={noop} /></UiFormRow>
      <UiFormRow inline label="文本"><UiInput value="镜头 01" onChange={noop} /></UiFormRow>
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

/** 读取当前真实枚举；4.2 调整命名后不需要再改中心页。 */
export function SizeLadderSection(): JSX.Element {
  return <GallerySection title="尺寸阶梯：同名档同一行核对高度">
    {GALLERY_CONTROL_SIZES.map(size => <div key={size} data-gallery-size={size} className="flex flex-wrap items-center gap-3 border-b border-line py-4">
      <code className="w-12 text-xs text-text2">{size}</code>
      <UiButton size={size as ButtonSize} variant="secondary">按钮</UiButton>
      <UiIconButton size={size} aria-label={`图标 ${size}`}><Plus /></UiIconButton>
      <UiReadout size={size}>100%</UiReadout>
      <UiNavButton size={size}>导航</UiNavButton>
      <UiSwitch size={size} appearance="segmented" checked offLabel="关" onLabel="开" />
      <UiSegmented size={size} ariaLabel={`同行分段 ${size}`} value="a" options={[{ value: 'a', label: '图片' }, { value: 'b', label: '视频' }]} onChange={noop} />
      <UiFieldTrigger size={size}>触发器</UiFieldTrigger>
      <Dropdown size={size} ariaLabel={`下拉 ${size}`} value="a" options={[{ value: 'a', label: '下拉' }]} onSelect={noop} />
      <UiInput size={size} aria-label={`输入 ${size}`} defaultValue="输入" className="w-24" />
      <UiSearchInput size={size} aria-label={`搜索 ${size}`} defaultValue="搜索" onClear={noop} clearLabel="清除" className="w-28" />
      <UiSelect size={size} aria-label={`原生选择 ${size}`}><option>选择</option></UiSelect>
      <NumberInput size={size} value={12} onChange={noop} ariaLabel={`数值 ${size}`} widthClassName="w-24" />
      <UiChipButton size={size}>标签</UiChipButton>
      <UiOptionButton size={size}>选项</UiOptionButton>
      <UiFontPicker size={size} value="sans-serif" onSelect={noop} ariaLabel={`字体 ${size}`} />
      <PanelTrigger size={size} appearance="field" surface="solid" display={`面板 ${size}`} panelPadding="content" renderPanel={() => <span>面板内容</span>} />
      <UiNumberStepper size={size} increaseLabel="增加" decreaseLabel="减少" canIncrease canDecrease onStep={noop} />
    </div>)}
    <GalleryMatrix rows={GALLERY_ICON_SIZES.map(size => ({ label: `图标 ${size}`, states: ['rest', 'hover', 'active', 'focus', 'selected', 'disabled', 'loading'], render: state => <UiIconButton size={size} on={state === 'selected'} disabled={state === 'disabled'} loading={state === 'loading'} aria-label={`添加 ${size} ${state}`} aria-busy={state === 'loading'}><Plus /></UiIconButton> }))} />
    {GALLERY_SEGMENTED_SIZES.map(size => <GalleryRow key={size} label={size}><UiSegmented size={size} fullWidth ariaLabel={`分段 ${size}`} value="a" options={[{ value: 'a', label: '图片' }, { value: 'b', label: '视频' }]} onChange={noop} /></GalleryRow>)}
  </GallerySection>
}

export function VariantSection(): JSX.Element {
  return <GallerySection title="补充变体（正式枚举）">
    <GalleryRow label="面板"><UiPanel variant="panel" className="p-3">浮层面板</UiPanel><UiPanel variant="inset" className="p-3">内嵌预览</UiPanel><UiPanel variant="bare">纯容器</UiPanel></GalleryRow>
    <GalleryRow label="选项"><UiOptionButton variant="default" selection="single">默认</UiOptionButton><UiOptionButton variant="card">内容卡</UiOptionButton><UiIconButton shape="square" tone="default" aria-label="方形"><Plus /></UiIconButton><UiIconButton shape="circle" aria-label="圆形"><Plus /></UiIconButton></GalleryRow>
    <GalleryRow label="格子"><UiOptionButton variant="grid" gridCell="ratio">16:9</UiOptionButton><UiOptionButton variant="grid" gridCell="tier-detail">2K · 精细</UiOptionButton><UiOptionButton variant="grid" gridCell="preset">预设 16:9</UiOptionButton><UiOptionButton variant="grid" size="sm" gridCell="ratio-md" className="justify-center">16:9</UiOptionButton><UiOptionButton variant="grid" size="sm" gridCell="ratio-sm" className="justify-center">21:9</UiOptionButton><UiOptionButton variant="grid" size="sm" gridCell="tier-compact" className="justify-center">1080P</UiOptionButton></GalleryRow>
    <GalleryRow label="特殊面板"><PanelTrigger panelSize="special" display="特殊面板" renderPanel={() => <UiSpecialPanel height="fit" header={<span>头部一行：搜索与筛选</span>} status="左边状态或出错原因" action={<UiButton variant="primary" size="sm">提交</UiButton>}>正文唯一滚动区</UiSpecialPanel>} /><PanelTrigger panelSize="special" display="带左栏、占满高度" renderPanel={() => <UiSpecialPanel height="fill" aside={<span>左栏</span>} bodyWidth={320}>长列表筛选时高度不跳</UiSpecialPanel>} /></GalleryRow>
    <GalleryRow label="表面"><Dropdown appearance="text" surface="solid" ariaLabel="静默下拉" value="a" options={[{ value: 'a', label: '静默' }]} onSelect={noop} /><Dropdown appearance="field" surface="glass" ariaLabel="玻璃下拉" value="a" options={[{ value: 'a', label: '玻璃' }]} onSelect={noop} /></GalleryRow>
    <GalleryRow label="字段"><UiInput frame="field" aria-label="外框输入" defaultValue="外框" /><UiInput frame="inner" aria-label="复合字段内层" defaultValue="内层" /><UiTextArea frame="field" aria-label="有框文本" defaultValue="文本" /><UiTextArea frame="none" aria-label="无框文本" defaultValue="原位编辑" /><UiFieldTrigger appearance="field">字段表面</UiFieldTrigger></GalleryRow>
    <GalleryRow label="浮层"><PanelTrigger appearance="quiet" surface="glass" display="玻璃面板触发器" panelPadding="content" renderPanel={() => <span>玻璃面板</span>} /></GalleryRow>
    <ProgressBar progress={40} appearance="default" />
    <PromptEditor value={PROMPT_TEXT} onChange={noop} frame="field" ariaLabel="有框提示词" />
    <PromptEditor value={PROMPT_TEXT} onChange={noop} frame="none" ariaLabel="原位提示词" />
    <GalleryRow label="轨道"><UiRangeInput trackTone="neutral" aria-label="中性轨道" /><UiRangeInput trackTone="hue" aria-label="色相轨道" /><UiRangeInput trackTone="lighting" aria-label="打光轨道" /></GalleryRow>
    <GalleryRow label="导航"><UiNavButton size="sm">紧凑</UiNavButton><UiNavButton size="lg">较大</UiNavButton><UiNavButton size="auto">两行内容<br />自动高度</UiNavButton><UiChipButton selectionAppearance="default">默认多选</UiChipButton><UiTextToken appearance="inline">行内</UiTextToken></GalleryRow>
    <GalleryRow label="双段"><UiSwitch appearance="pill" checked /><UiSwitch appearance="segmented" size="md" checked onLabel="打开" offLabel="关闭" /></GalleryRow>
    <UiToolbar variant="plain"><UiButton>普通动作组</UiButton></UiToolbar><UiPageHeader title="带分隔页头" divider />
    {([72, 96, 120] as const).map(labelWidth => <UiGroup key={labelWidth} labelWidth={labelWidth} title={`标签列 ${labelWidth}`} titleTone="overline" gap="row"><UiFormRow label="名称" labelWidth={labelWidth} density="default" labelColumn="panel"><UiInput defaultValue="镜头 01" /></UiFormRow><UiFormRow label="成对网格" labelColumn="auto"><div className="grid grid-cols-2 gap-3"><NumberInput value={1} onChange={noop} /><NumberInput value={2} onChange={noop} /></div></UiFormRow></UiGroup>)}
    <UiGroup titleTone="section" title="分区间距" gap="section"><span className="text-xs text-text2">分区</span><span className="text-xs text-text2">分区</span></UiGroup><UiGroup gap="stack"><span className="text-xs text-text2">堆叠间距</span></UiGroup><UiGroup gap="none"><span className="text-xs text-text2">无间距</span></UiGroup>
    {(['sm', 'md'] as const).map(size => <div key={size} className="grid grid-cols-3 gap-3"><UiEmpty size={size} title="没有结果" action={<UiButton>添加</UiButton>} /><UiLoading size={size} message="加载中" /><UiError size={size} message="读取失败" align="start" onRetry={noop} /></div>)}
  </GallerySection>
}

export function ModalSizeSection(): JSX.Element {
  return <GallerySection title="弹窗尺寸：静态常驻，每档读取真实宽高令牌">
    {(Object.keys(UI_MODAL_SIZE_CLASS) as UiModalSize[]).map(size => <UiGroup key={size} title={`${size} · ${UI_MODAL_SIZE_CLASS[size]}`} titleTone="compact"><ModalPreview size={size} surface="panel" /></UiGroup>)}
    <ModalPreview size="compact" surface="glass" />
  </GallerySection>
}

/** 按实际视口比例缩小整个预览，不裁掉 workspace/fullscreen，也不覆盖弹窗尺寸令牌。 */
function ModalPreview({ size, surface }: { size: UiModalSize; surface: 'panel' | 'glass' }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [geometry, setGeometry] = useState({ width: window.innerWidth, height: window.innerHeight, scale: 0 })
  useLayoutEffect(() => {
    const update = (): void => {
      const rect = ref.current?.getBoundingClientRect()
      if (!rect) return
      setGeometry({ width: window.innerWidth, height: window.innerHeight, scale: Math.min(rect.width / Math.max(1, window.innerWidth), rect.height / Math.max(1, window.innerHeight)) })
    }
    update()
    const observer = new ResizeObserver(update)
    if (ref.current) observer.observe(ref.current)
    window.addEventListener('resize', update)
    return () => { observer.disconnect(); window.removeEventListener('resize', update) }
  }, [])
  return <div ref={ref} data-gallery-ignore-rules="smallTargets overlayClipped horizontalOverflow" data-gallery-ignore-reason="完整视口按比例缩成静态弹窗示意，原始布局尺寸与滚动裁切不代表实际浮层" data-gallery-static="UiModal" className={`relative h-72 overflow-hidden rounded-overlay ${surface === 'glass' ? 'bg-media' : 'bg-window'}`}><div className="relative origin-top-left" style={{ width: geometry.width, height: geometry.height, transform: `scale(${geometry.scale})` }}>
    <UiModal isOpen scope="container" appear={false} size={size} surface={surface} title={`${size} 弹窗`} onClose={noop} headerActions={<UiButton size="sm">上下文</UiButton>} footer={<><UiButton variant="secondary">取消</UiButton><UiButton variant="primary">确定</UiButton></>}><UiFormRow label="名称" inline><UiInput defaultValue="作品" /></UiFormRow></UiModal>
  </div></div>
}

export function StaticOverlaySection(): JSX.Element {
  const top = useRef<HTMLSpanElement>(null)
  const left = useRef<HTMLSpanElement>(null)
  const solid = useRef<HTMLDivElement>(null)
  const glass = useRef<HTMLDivElement>(null)
  const [positions, setPositions] = useState<{ solid: { x: number; y: number }; glass: { x: number; y: number } } | null>(null)
  useLayoutEffect(() => {
    const update = (): void => {
      const a = solid.current?.getBoundingClientRect(), b = glass.current?.getBoundingClientRect()
      if (a && b) setPositions({ solid: { x: a.left, y: a.top }, glass: { x: b.left, y: b.top } })
    }
    update()
    window.addEventListener('resize', update); window.addEventListener('scroll', update, true)
    return () => { window.removeEventListener('resize', update); window.removeEventListener('scroll', update, true) }
  }, [])
  const items = [{ id: 'edit', label: '继续编辑', icon: <Plus className={`${UI_ICON_SIZE_CLASS.md}`} />, onClick: noop }, { id: 'copy', label: '复制', icon: <Plus className={`${UI_ICON_SIZE_CLASS.md}`} />, onClick: noop }, { id: 'remove', label: '删除（禁用）', icon: <Trash2 className={`${UI_ICON_SIZE_CLASS.md}`} />, disabled: true, onClick: noop }]
  return <GallerySection title="静态浮层：无需鼠标或计时器">
    <div className="flex h-32 items-center justify-around gap-6"><span ref={top} className="text-xs text-text2">上方锚点</span><span ref={left} className="text-xs text-text2">左侧锚点</span><Tooltip placement="top" content="正式悬停说明"><UiButton>上方说明</UiButton></Tooltip><Tooltip placement="left" content="正式悬停说明"><UiButton>左侧说明</UiButton></Tooltip></div>
    <GalleryRow label="标签"><UiTooltipText placement="top" tooltip="上方说明">参数名称</UiTooltipText><UiTooltipText placement="left" tooltip="左侧说明">参数名称</UiTooltipText></GalleryRow>
    <TooltipContent visible data-gallery-static="Tooltip" anchorRef={top} content="上方说明" placement="top" />
    <TooltipContent visible data-gallery-static="TooltipContent" anchorRef={left} content="左侧说明" placement="left" />
    <div data-gallery-static="ContextMenu" className="grid grid-cols-2 gap-6"><div ref={solid} className="h-52"><span className="text-xs text-text2">实底菜单</span></div><div ref={glass} className="h-52 rounded-overlay bg-media"><span className="text-xs text-on-media">媒体上的玻璃菜单</span></div></div>
    {positions && <><ContextMenu items={items} position={positions.solid} visible surface="solid" onClose={noop} /><ContextMenu items={items} position={positions.glass} visible surface="glass" onClose={noop} /></>}
  </GallerySection>
}

export function ParameterSizeSection(): JSX.Element {
  const gesture = { onBegin: noop, onFinish: noop, onCancel: noop }
  return <GallerySection title="参数原件：读取当前尺寸联合类型">{GALLERY_PARAMETER_SIZES.map(size => <UiGroup key={size} title={size} titleTone="compact"><div className="grid grid-cols-2 gap-4">
    <UiAngleDial size={size} label="角度" value={30} onChange={noop} {...gesture} />
    <UiPointPad size={size} label="中心" value={{ x: 0.5, y: 0.5 }} onChange={noop} {...gesture} />
    <UiRangeSlider size={size} label="区间" value={[20, 70]} onChange={noop} {...gesture} />
    <UiGradientEditor size={size} label="渐变" value={[]} onChange={noop} {...gesture} />
    <UiGradeWheel size={size} label="色轮" value={{ hue: 200, strength: 0.3, luminance: 0.1 }} onChange={noop} {...gesture} />
    <UiCurveEditor size={size} label="曲线" value={[{ x: 0, y: 0 }, { x: 1, y: 1 }]} onChange={noop} {...gesture} />
    <UiEasingEditor size={size} label="缓动" value="ease" onChange={noop} presets={[{ value: 'ease', label: '缓出', curve: [0, 0, 0.2, 1] }]} {...gesture} />
    <UiSeedInput size={size} label="种子" value={42} onChange={noop} {...gesture} />
  </div></UiGroup>)}</GallerySection>
}

export function SharedDomainSection(): JSX.Element {
  const model = registry.listAllModels().find(candidate => candidate.pricing.fixed !== undefined && !candidate.pricing.mediaContext)
  const priceVisible = readPriceEstimateDisplaySettings().showPriceEstimate
  const [textStyle, setTextStyle] = useState(() => defaultTextStyle(300))
  const [textError, setTextError] = useState('')
  return <GallerySection title="共享领域组件：只读样张，不读取素材或调用模型">
    <UiGroup title="PriceEstimate：读取已注册模型的静态价格" titleTone="compact">
      {model && priceVisible ? <><PriceEstimate providerId="" modelId={model.meta.id} params={{}} variant="panel" /><PriceEstimate providerId="" modelId={model.meta.id} params={{}} variant="badge" /></> : <UiEmpty size="xs" title="费用样张未显示" description={priceVisible ? '当前没有已注册的固定价格模型。' : '当前费用显示设置为关闭，本页不改用户设置。'} />}
    </UiGroup>
    <UiGroup title="AudioPlayer：受控播放条，无音频来源" titleTone="compact"><AudioPlayer src="" surface="plain" controlledPlayback={{ currentTime: 12, duration: 60, playing: false, volume: 0.8, disabled: true, onTogglePlay: noop, onSeek: noop, onVolume: noop }} /></UiGroup>
    <UiGroup title="WaveformView：正式空波形状态，无解码请求" titleTone="compact"><div className="h-20"><WaveformView waveform={{ status: 'idle' }} label="空波形样张" /></div></UiGroup>
    <UiGroup title="TypographyPanel：正式文字外观面板" titleTone="compact">{textError && <UiError size="xs" message={textError} />}<TypographyPanel style={textStyle} onChange={setTextStyle} onError={error => setTextError(error instanceof Error ? error.message : String(error))} fields="code-element" /></UiGroup>
  </GallerySection>
}
