import { useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight, RotateCcw } from 'lucide-react'
import { Dropdown, UiButton, UiFormRow, UiGroup, UiIconButton, UiSegmented, useUiFieldLayout, useUiPropertyMenu } from '@/components/ui'
import { UI_ICON_SIZE } from '@/core/theme/icons'
import type { ImagingParam } from '@/core/imaging/parameterDefinition'
import {
  COLOR_GRADE_BASIC_PARAMS, COLOR_GRADE_CREATIVE_PARAMS, COLOR_GRADE_CURVE_CHANNELS, COLOR_GRADE_HSL_PARAMS, COLOR_GRADE_HUE_CURVES, COLOR_GRADE_HUE_CURVE_NAMES,
  COLOR_GRADE_LUT_PARAMS, COLOR_GRADE_MIXER_PARAMS, COLOR_GRADE_POINT_PARAMS, COLOR_GRADE_TONE_PARAMS, COLOR_GRADE_VIGNETTE_PARAMS, COLOR_GRADE_WHEEL_PARAMS,
  COLOR_GRADE_WHEEL_REGIONS,
} from '@/core/imaging/adjustments/colorGrade'
import { COLOR_GRADE_SECTIONS, isColorGradeSectionModified } from './colorGradeSectionParams'
import { COLOR_GRADE_STYLES, scaleColorGradeStyle } from '@/core/imaging/adjustments/colorGradeStyles'
import { colorGradeDefaults } from '@/core/imaging/adjustments/schema'

/**
 * Section structure of the 全能调色 panel, shared by the video effect panel and the image adjustment layer.
 * Hosts own values, gestures, keyframes and resources; this component owns order, grouping and section-level reset.
 * Order follows Lightroom/ACR: basic → curves → mixer → color grading → creative/LUT → secondary → vignette.
 */
export interface ColorGradeSectionsHost {
  /** Current (evaluated) parameter values, including legacy five-anchor curve keys when present. */
  values: Readonly<Record<string, unknown>>
  renderRows: (params: readonly ImagingParam[]) => ReactNode
  /** One atomic write that restores the given parameters to their defaults. */
  resetParams: (params: readonly ImagingParam[]) => void
  /** One atomic write of absolute values (style recipes); keys not listed keep their value. */
  applyParams: (values: Readonly<Record<string, number>>) => void
  /** Live preview of candidate values while hovering a style; `null` restores the committed grade. */
  previewParams?: (values: Readonly<Record<string, number>> | null) => void
  /** Host LUT chooser (project LUT list for video, imported resources for images). */
  renderLut: (stage: 'input' | 'look') => ReactNode
  /** Optional rows shown first in 基本 (automatic correction for this host). */
  basicActions?: ReactNode
  /** Optional scopes section body, rendered first when present. */
  scopes?: ReactNode
  disabled?: boolean
}

const param = (key: string): ImagingParam[] => [...COLOR_GRADE_LUT_PARAMS].filter(value => value.key === key)
// Short labels keep the segmented control (Han labels over four characters fall back to a dropdown).
const CURVE_CHANNEL_LABELS = ['RGB', '红', '绿', '蓝']
const MIXER_CHANNELS = [{ value: 'hue', label: '色相' }, { value: 'saturation', label: '饱和度' }, { value: 'luminance', label: '明亮度' }] as const

function Section({ title, params, host, open: initiallyOpen = false, children }: { title: string; params: readonly ImagingParam[]; host: ColorGradeSectionsHost; open?: boolean; children: () => ReactNode }): React.ReactElement {
  const [open, setOpen] = useState(initiallyOpen)
  const modified = params.length > 0 && isColorGradeSectionModified(params, host.values)
  const layout = useUiFieldLayout(); const menu = useUiPropertyMenu()
  // 属性排布（剪辑效果控件与全能调色面板，重要记录 019 / 020）：区块头与属性行同一网格，箭头在第一列、名称对齐属性名，
  // 重置进名称上的右键菜单；其余宿主（图片调整层）仍用分组标题 + 行尾重置。
  if (layout === 'property') return <section className="border-t border-line pb-1.5 pt-1 first:border-t-0" data-color-grade-section={title}>
    <div className="mx-1 grid min-h-control-sm grid-cols-property-row items-center gap-x-1 pr-2"
      onContextMenu={menu && params.length ? event => menu(event, [{ id: 'reset', label: `重置${title}`, icon: <RotateCcw size={UI_ICON_SIZE.sm} />, disabled: host.disabled || !modified, onClick: () => host.resetParams(params) }]) : undefined}>
      <UiIconButton size="2xs" tone="bare" aria-expanded={open} aria-label={`${open ? '收起' : '展开'}${title}`} tooltip={`${open ? '收起' : '展开'}${title}`} onClick={() => setOpen(!open)}>{open ? <ChevronDown /> : <ChevronRight />}</UiIconButton>
      <span className="col-span-3 truncate text-xs font-semibold text-text1">{title}</span>
    </div>
    {open && children()}
  </section>
  return <UiGroup titleTone="compact" gap="none"
    title={<UiButton size="sm" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? <ChevronDown /> : <ChevronRight />}{title}</UiButton>}
    actions={modified ? <UiIconButton size="xs" tooltip={`重置${title}`} aria-label={`重置${title}`} disabled={host.disabled} disabledReason="当前不可编辑" onClick={() => host.resetParams(params)}><RotateCcw /></UiIconButton> : undefined}>
    {open && children()}
  </UiGroup>
}

export function ColorGradeSections({ host }: { host: ColorGradeSectionsHost }): React.ReactElement {
  const [channel, setChannel] = useState<string>('master')
  const [hueCurve, setHueCurve] = useState<string>('hue_sat')
  const [mixer, setMixer] = useState<string>('saturation')
  const primary = host.values.wheel_mode === 'primary'
  return <>
    {host.scopes && <Section title="示波器" params={[]} host={host}>{() => <>{host.scopes}</>}</Section>}
    <Section title="基本" params={COLOR_GRADE_SECTIONS.basic} host={host} open>{() => <>
      {host.basicActions}
      {host.renderRows(COLOR_GRADE_BASIC_PARAMS)}
    </>}</Section>
    <Section title="曲线" params={COLOR_GRADE_SECTIONS.curves} host={host}>{() => <>
      {host.renderRows(COLOR_GRADE_TONE_PARAMS)}
      <UiFormRow label="点曲线" density="compact" labelColumn="panel"><UiSegmented ariaLabel="曲线通道" size="sm" fullWidth value={channel} onChange={setChannel} options={COLOR_GRADE_CURVE_CHANNELS.map((value, i) => ({ value, label: CURVE_CHANNEL_LABELS[i] }))} /></UiFormRow>
      {host.renderRows(COLOR_GRADE_POINT_PARAMS.filter(value => value.key === `curve_${channel}_points`))}
      <UiFormRow label="色相曲线" density="compact" labelColumn="panel"><Dropdown ariaLabel="色相曲线类型" size="sm" value={hueCurve} onSelect={setHueCurve} options={COLOR_GRADE_HUE_CURVES.map((value, i) => ({ value, label: COLOR_GRADE_HUE_CURVE_NAMES[i] }))} /></UiFormRow>
      {host.renderRows(COLOR_GRADE_POINT_PARAMS.filter(value => value.key === `curve_${hueCurve}_points`))}
    </>}</Section>
    <Section title="混色器" params={COLOR_GRADE_SECTIONS.mixer} host={host}>{() => <>
      <UiFormRow label="调整" density="compact" labelColumn="panel"><UiSegmented ariaLabel="混色器调整" size="sm" fullWidth value={mixer} onChange={setMixer} options={MIXER_CHANNELS} /></UiFormRow>
      {host.renderRows(COLOR_GRADE_MIXER_PARAMS.filter(value => value.key.endsWith(`_${mixer}`)))}
    </>}</Section>
    <Section title="色彩分级" params={COLOR_GRADE_SECTIONS.grading} host={host}>{() => <>
      {host.renderRows(COLOR_GRADE_WHEEL_PARAMS.filter(value => value.key === 'wheel_mode' || !primary && value.key.startsWith('grade_')))}
      <div className="flex flex-wrap gap-2">{COLOR_GRADE_WHEEL_REGIONS.map(region => <div key={region} className="min-w-0 basis-40 flex-1">
        {host.renderRows(COLOR_GRADE_WHEEL_PARAMS.filter(value => value.key.startsWith(`${region}_`)))}
      </div>)}</div>
    </>}</Section>
    <Section title="创意" params={COLOR_GRADE_SECTIONS.creative} host={host}>{() => <>
      <UiFormRow label="风格" density="compact" labelColumn="panel"><Dropdown ariaLabel="套用风格" size="sm" display="选择风格" disabled={host.disabled} disabledReason="当前不可编辑" options={COLOR_GRADE_STYLES.map(style => ({ value: style.id, label: style.name }))}
        onPreview={id => { const style = COLOR_GRADE_STYLES.find(value => value.id === id); host.previewParams?.(style ? scaleColorGradeStyle(style, 1, colorGradeDefaults()) : null) }}
        onSelect={id => { const style = COLOR_GRADE_STYLES.find(value => value.id === id); host.previewParams?.(null); if (style) host.applyParams(scaleColorGradeStyle(style, 1, colorGradeDefaults())) }} /></UiFormRow>
      {host.renderLut('input')}{host.renderRows(param('input_lut_strength'))}
      {host.renderLut('look')}{host.renderRows(param('look_lut_strength'))}
      {host.renderRows(COLOR_GRADE_CREATIVE_PARAMS)}
    </>}</Section>
    <Section title="HSL 辅助" params={COLOR_GRADE_SECTIONS.secondary} host={host}>{() => <>{host.renderRows(COLOR_GRADE_HSL_PARAMS)}</>}</Section>
    <Section title="晕影" params={COLOR_GRADE_SECTIONS.vignette} host={host}>{() => <>{host.renderRows(COLOR_GRADE_VIGNETTE_PARAMS)}</>}</Section>
  </>
}
