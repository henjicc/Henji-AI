import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { AlignCenter, AlignLeft, AlignRight, AlignJustify, Bold, Italic, CaseUpper, CaseSensitive, Superscript, Subscript, Underline, AlignVerticalJustifyStart, AlignVerticalJustifyCenter, AlignVerticalJustifyEnd, Pipette, Plus, Trash2, Wrench } from 'lucide-react'
import { Dropdown, PanelTrigger, UiButton, UiCheckbox, UiColorInput, UiError, UiFontPicker, UiFormRow, UiGroup, UiIconButton, UiInput, UiRangeInput } from '@/components/ui'
import NumberInput from '@/components/ui/NumberInput'
import { defaultVideoEditTextStyle, videoEditTextStyleSchema, type VideoEditTextStyle } from '@/core/videoEdit/text'
import { BLACK_HEX } from '@/core/theme/colorTokens'
import { fontLibrarySnapshot, subscribeFontLibrary, resolveFont, readFontPayload } from '@/platform/fonts'
import { loadDocumentFont } from '@/platform/fontFaces'
import { subscribeVideoEditDomain, videoEditDomainRevision } from '../application/videoEditService'
import { videoEditTextPresetLibrary } from '../application/videoEditTextPresets'

export interface VideoEditTypographyPanelProps {
  style: VideoEditTextStyle
  onChange: (style: VideoEditTextStyle) => void
  onError: (error: unknown) => void
  onBegin?: () => void
  onEnd?: (commit: boolean) => void
  onFontPreview?: (font: string | null) => void
  projectFonts?: readonly string[]
  fontLabel?: string
  transform?: ReactNode
}
/** All four hosts edit this schema; placement is supplied only by hosts that support it. */
export function VideoEditTypographyPanel({ style, onChange, onError, onBegin, onEnd, onFontPreview, projectFonts, fontLabel = '文字字体', transform }: VideoEditTypographyPanelProps): React.ReactElement {
  const library = useSyncExternalStore(subscribeFontLibrary, fontLibrarySnapshot)
  useSyncExternalStore(subscribeVideoEditDomain, videoEditDomainRevision)
  const styleRef = useRef(style); styleRef.current = style
  const [presetId, setPresetId] = useState(''); const [name, setName] = useState('')
  const alive = useRef(true); const fontEpoch = useRef(0)
  const endRef = useRef(onEnd); endRef.current = onEnd
  useEffect(() => { alive.current = true; return () => { alive.current = false; endRef.current?.(false) } }, [])
  const write = (patch: Partial<VideoEditTextStyle>): void => { try { onChange(videoEditTextStyleSchema.parse({ ...styleRef.current, ...patch })) } catch (error) { onEnd?.(false); onError(error) } }
  const run = (action: () => void): void => { try { onEnd?.(true); action() } catch (error) { onError(error) } }
  const number = (label: string, value: number, change: (value: number) => void, min = 0, max = 8192, step = 1): React.ReactElement => <NumberInput ariaLabel={label} size="sm" value={value} min={min} max={max} step={step} precision={step < 1 ? 2 : 1} widthClassName="w-20" onChange={change} onScrubStart={onBegin} onScrubEnd={cancelled => onEnd?.(!cancelled)} />
  const row = (label: string, children: ReactNode): React.ReactElement => <UiFormRow key={label} label={label} density="compact">{children}</UiFormRow>
  const color = (label: string, value: string, change: (value: string) => void): React.ReactElement => <span className="flex items-center gap-1">
    <UiColorInput aria-label={label} value={value} onPointerDown={onBegin} onFocus={onBegin} onBlur={() => onEnd?.(true)} onChange={event => change(event.target.value)} />
    <UiIconButton size="sm" aria-label={`吸取${label}`} title={`吸取${label}`} onClick={() => {
      const Constructor = (globalThis as typeof globalThis & { EyeDropper?: new () => { open: () => Promise<{ sRGBHex: string }> } }).EyeDropper
      if (!Constructor) { onError(new Error('此窗口无法取色，请使用颜色选择器。')); return }
      onEnd?.(true)
      const baseline = styleRef.current
      void new Constructor().open().then(result => { if (alive.current && styleRef.current === baseline) change(result.sRGBHex) }, error => { if (alive.current && !(error instanceof DOMException && error.name === 'AbortError')) onError(error) })
    }}><Pipette size={14} /></UiIconButton>
  </span>
  const toggles = [
    ['fauxBold', '仿粗体', Bold], ['fauxItalic', '仿斜体', Italic], ['allCaps', '全部大写', CaseUpper], ['smallCaps', '小型大写', CaseSensitive], ['superscript', '上标', Superscript], ['subscript', '下标', Subscript], ['underline', '下划线', Underline],
  ] as const
  const currentFont = resolveFont(style.fontFamily)
  // t63 registers an exact full-name alias at 400/normal; its file already encodes the chosen face.
  // Requesting 700/italic again would synthesize it a second time. Family-name writes may still use CSS weight/style.
  const faces = library.faces.filter(face => face.family === currentFont?.family && !face.id.startsWith('generic:'))
  const selectedFace = faces.find(face => face.fullName === style.fontFamily) ?? faces.find(face => face.weight === style.fontWeight && face.italic === (style.fontStyle !== 'normal')) ?? currentFont
  const presets = videoEditTextPresetLibrary.list()
  const selectedPreset = presets.find(preset => preset.id === presetId)
  return <div className="flex min-w-0 flex-col gap-3" data-video-edit-typography>
    <UiGroup title="文本" titleTone="compact" actions={<PanelTrigger panelWidth="content" renderPanel={() => <UiButton size="sm" onClick={() => write(defaultVideoEditTextStyle(style.fontSize * 15))}>重置文字样式</UiButton>}>{({ togglePanel, open }) => <UiIconButton size="sm" aria-label="文本设置" aria-expanded={open} data-panel-trigger-button onClick={togglePanel}><Wrench size={14} /></UiIconButton>}</PanelTrigger>}>
      {row('字体', <UiFontPicker size="sm" ariaLabel={fontLabel} value={style.fontFamily} projectFonts={projectFonts} onPreview={face => onFontPreview?.(face?.fullName ?? null)} onSelect={fontFamily => { onEnd?.(false); write({ fontFamily, fontWeight: 400, fontStyle: 'normal' }) }} />)}
      {row('字形样式', faces.length ? <Dropdown size="sm" ariaLabel="字形样式" value={selectedFace?.fullName ?? style.fontFamily} options={faces.map(face => ({ value: face.fullName, label: face.style }))} onSelect={value => {
        const face = faces.find(face => face.fullName === value); if (!face) return
        const epoch = ++fontEpoch.current; const baseline = styleRef.current
        void readFontPayload(face).then(loadDocumentFont).then(() => { if (alive.current && epoch === fontEpoch.current && styleRef.current === baseline) write({ fontFamily: face.fullName, fontWeight: 400, fontStyle: 'normal' }) }, error => { if (alive.current && epoch === fontEpoch.current) onError(error) })
      }} /> : <Dropdown size="sm" ariaLabel="字形样式" value={`${style.fontWeight}:${style.fontStyle}`} options={[{ value: '400:normal', label: 'Regular' }, { value: '700:normal', label: 'Bold' }, { value: '400:italic', label: 'Italic' }, { value: '700:italic', label: 'Bold Italic' }]} onSelect={value => { const [weight, variant] = value.split(':'); write({ fontWeight: Number(weight), fontStyle: variant === 'italic' ? 'italic' : 'normal' }) }} />)}
      <div className="flex flex-wrap items-center gap-1">{toggles.map(([key, label, Icon]) => <UiIconButton key={key} size="sm" on={style[key]} aria-pressed={style[key]} aria-label={label} title={label} onClick={() => write({ [key]: !style[key], ...(key === 'superscript' && !style[key] ? { subscript: false } : key === 'subscript' && !style[key] ? { superscript: false } : {}) })}><Icon size={14} /></UiIconButton>)}</div>
      {row('字号', <span className="flex items-center gap-2"><UiRangeInput aria-label="字号滑杆" min={1} max={Math.max(256, style.fontSize)} value={style.fontSize} onPointerDown={onBegin} onPointerUp={() => onEnd?.(true)} onPointerCancel={() => onEnd?.(false)} onBlur={() => onEnd?.(true)} onChange={event => write({ fontSize: Number(event.target.value) })} />{number('文字字号', style.fontSize, fontSize => write({ fontSize }), 1)}</span>)}
      {row('段落对齐', <div className="flex flex-wrap gap-1">{([['left', '左对齐', AlignLeft], ['center', '居中', AlignCenter], ['right', '右对齐', AlignRight], ['justify', '两端对齐末行左', AlignJustify], ['justify-center', '两端对齐末行中', AlignCenter], ['justify-right', '两端对齐末行右', AlignRight], ['justify-all', '全部两端对齐', AlignJustify]] as const).map(([align, label, Icon]) => <UiIconButton key={align} size="sm" on={style.align === align} aria-label={label} title={label} onClick={() => write({ align })}><Icon size={14} /></UiIconButton>)}</div>)}
      {row('垂直对齐', <div className="flex gap-1">{([['top', '顶部对齐', AlignVerticalJustifyStart], ['middle', '垂直居中', AlignVerticalJustifyCenter], ['bottom', '底部对齐', AlignVerticalJustifyEnd]] as const).map(([verticalAlign, label, Icon]) => <UiIconButton key={verticalAlign} size="sm" on={style.verticalAlign === verticalAlign} aria-label={label} title={label} onClick={() => write({ verticalAlign })}><Icon size={14} /></UiIconButton>)}</div>)}
      {row('字距', number('字距', style.tracking, tracking => write({ tracking }), -1000, 10000))}
      {row('字偶间距', <span className="flex flex-wrap items-center gap-2"><Dropdown size="sm" ariaLabel="字偶间距方式" value={style.kerning === 'auto' ? 'auto' : 'manual'} options={[{ value: 'auto', label: '自动' }, { value: 'manual', label: '数值' }]} onSelect={value => write({ kerning: value === 'auto' ? 'auto' : 0 })} />{typeof style.kerning === 'number' && number('字偶间距', style.kerning, kerning => write({ kerning }), -1000, 10000)}</span>)}
      {row('行距', number('行距（0为自动）', style.leading, leading => write({ leading })))}
      {row('基线偏移', number('基线偏移', style.baselineShift, baselineShift => write({ baselineShift }), -8192))}
      {row('比例间距（%）', number('比例间距百分比', style.tsume, tsume => write({ tsume }), 0, 100))}
      {row('文字框宽（%）', number('文字框宽百分比', style.boxWidth * 100, value => write({ boxWidth: value / 100 }), 0, 100))}
      {row('文字框高（%）', number('文字框高百分比', style.boxHeight * 100, value => write({ boxHeight: value / 100 }), 0, 100))}
    </UiGroup>
    <UiGroup title="外观" titleTone="compact" divided>
      {row('填充', <span className="flex items-center gap-2"><UiCheckbox aria-label="启用填充" checked={style.fill.enabled} onCheckedChange={enabled => write({ fill: { ...style.fill, enabled } })} />{color('文字填充颜色', style.fill.color, value => write({ fill: { ...style.fill, color: value } }))}</span>)}
      <UiGroup title="描边" titleTone="compact" actions={<UiIconButton size="sm" aria-label="添加描边" onClick={() => write({ strokes: [...style.strokes, { enabled: true, color: BLACK_HEX, width: 2, position: 'outside' }] })}><Plus size={14} /></UiIconButton>}>
        {style.strokes.map((stroke, index) => <div key={index} className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2"><UiCheckbox aria-label={`启用描边${index + 1}`} checked={stroke.enabled} onCheckedChange={enabled => write({ strokes: style.strokes.map((entry, i) => i === index ? { ...entry, enabled } : entry) })} />{color(`描边${index + 1}颜色`, stroke.color, value => write({ strokes: style.strokes.map((entry, i) => i === index ? { ...entry, color: value } : entry) }))}{number(`描边${index + 1}宽度`, stroke.width, width => write({ strokes: style.strokes.map((entry, i) => i === index ? { ...entry, width } : entry) }))}<UiIconButton size="sm" tone="danger" aria-label={`删除描边${index + 1}`} onClick={() => write({ strokes: style.strokes.filter((_, i) => i !== index) })}><Trash2 size={14} /></UiIconButton></div>
          <Dropdown size="sm" ariaLabel={`描边${index + 1}位置`} value={stroke.position} options={[{ value: 'outside', label: '外侧' }, { value: 'inside', label: '内侧' }, { value: 'center', label: '居中' }]} onSelect={position => write({ strokes: style.strokes.map((entry, i) => i === index ? { ...entry, position } : entry) })} />
        </div>)}
      </UiGroup>
      {row('背景', <span className="flex items-center gap-2"><UiCheckbox aria-label="启用背景" checked={style.background.enabled} onCheckedChange={enabled => write({ background: { ...style.background, enabled } })} />{color('背景颜色', style.background.color, value => write({ background: { ...style.background, color: value } }))}</span>)}
      {style.background.enabled && <>{row('背景不透明度（%）', number('背景不透明度百分比', style.background.opacity * 100, value => write({ background: { ...style.background, opacity: value / 100 } }), 0, 100))}{row('背景大小', number('背景内边距', style.background.padding, padding => write({ background: { ...style.background, padding } })))}{row('背景圆角', number('背景圆角', style.background.radius, radius => write({ background: { ...style.background, radius } })))}</>}
      <UiGroup title="阴影" titleTone="compact" actions={<UiIconButton size="sm" aria-label="添加阴影" onClick={() => write({ shadows: [...style.shadows, { enabled: true, color: BLACK_HEX, opacity: .7, angle: 45, distance: 4, size: 0, blur: 4 }] })}><Plus size={14} /></UiIconButton>}>
        {style.shadows.map((shadow, index) => {
          const change = (patch: Partial<typeof shadow>): void => write({ shadows: style.shadows.map((entry, i) => i === index ? { ...entry, ...patch } : entry) })
          return <div key={index} className="flex flex-col gap-2"><div className="flex items-center gap-2"><UiCheckbox aria-label={`启用阴影${index + 1}`} checked={shadow.enabled} onCheckedChange={enabled => change({ enabled })} />{color(`阴影${index + 1}颜色`, shadow.color, color => change({ color }))}<UiIconButton size="sm" tone="danger" aria-label={`删除阴影${index + 1}`} onClick={() => write({ shadows: style.shadows.filter((_, i) => i !== index) })}><Trash2 size={14} /></UiIconButton></div>
            {shadow.enabled && <>{row('不透明度（%）', number(`阴影${index + 1}不透明度百分比`, shadow.opacity * 100, value => change({ opacity: value / 100 }), 0, 100))}{row('角度', number(`阴影${index + 1}角度`, shadow.angle, angle => change({ angle }), -360, 360))}{(['distance', 'size', 'blur'] as const).map((key, i) => row(['距离', '大小', '模糊'][i], number(`阴影${index + 1}${['距离', '大小', '模糊'][i]}`, shadow[key], value => change({ [key]: value }))))}</>}
          </div>
        })}
      </UiGroup>
    </UiGroup>
    {transform && <UiGroup title="对齐并变换" titleTone="compact" divided>{transform}</UiGroup>}
    <UiGroup title="链接样式" titleTone="compact" divided>
      {row('样式预设', <Dropdown size="sm" ariaLabel="文字样式预设" value={presetId} options={[{ value: '', label: '选择预设' }, ...presets.map(preset => ({ value: preset.id, label: preset.name }))]} onSelect={id => { setPresetId(id); const preset = presets.find(entry => entry.id === id); if (preset) { setName(preset.name); run(() => onChange(preset.style)) } }} />)}
      {row('名称', <UiInput size="sm" aria-label="文字样式预设名称" value={name} maxLength={200} onChange={event => setName(event.target.value)} />)}
      <div className="flex flex-wrap gap-1"><UiButton size="sm" disabled={!name.trim()} onClick={() => run(() => setPresetId(videoEditTextPresetLibrary.save(name, style).id))}>保存当前样式</UiButton><UiButton size="sm" disabled={!selectedPreset || !name.trim()} onClick={() => run(() => { videoEditTextPresetLibrary.update(presetId, { name }); })}>重命名</UiButton><UiButton size="sm" variant="danger" disabled={!selectedPreset} onClick={() => run(() => { videoEditTextPresetLibrary.remove(presetId); setPresetId(''); setName('') })}>删除预设</UiButton></div>
      {videoEditTextPresetLibrary.loadError() && <UiError size="xs" message={videoEditTextPresetLibrary.loadError()} />}
    </UiGroup>
  </div>
}
