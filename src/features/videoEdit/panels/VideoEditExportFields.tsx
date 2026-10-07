import { useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight, Link, Unlink } from 'lucide-react'
import { Dropdown, UiButton, UiCheckbox, UiFormRow, UiGroup, UiIconButton, UiRangeInput, UiSwitch } from '@/components/ui'
import NumberInput from '@/components/ui/NumberInput'
import type { VideoEditExportSettings } from '@/core/videoEdit/exportPresets'
import { VIDEO_EDIT_SEQUENCE_LIMITS } from '@/core/videoEdit/sequenceSize'

export type ExportSection = 'video' | 'audio' | 'loudness' | 'captions' | 'general'
const expansion = new WeakMap<object, ExportSection[]>()
export function VideoEditExportField({ label, info, children, lock }: { label: string; info?: string; children: ReactNode; lock?: ReactNode }): React.ReactElement {
  return <UiFormRow label={label} info={info} inline density="compact"><div className="flex w-48 min-w-0 items-center gap-2"><div className="min-w-0 flex-1">{children}</div>{lock ?? <span className="w-7 shrink-0" />}</div></UiFormRow>
}
interface Props {
  viewer: object; settings: VideoEditExportSettings; busy: boolean; hasProxies: boolean
  patch: (patch: Partial<VideoEditExportSettings>) => void; matchSequence: () => void
  support: (codec: VideoEditExportSettings['codec'], preference: VideoEditExportSettings['encoderPreference'], mode: VideoEditExportSettings['bitrateMode']) => boolean
  probing: boolean
}
export function VideoEditExportFields({ viewer, settings: s, busy, hasProxies, patch, matchSequence, support, probing }: Props): React.ReactElement {
  const [expanded, setExpanded] = useState<ExportSection[]>(() => expansion.get(viewer) ?? ['video'])
  const resolutions = [{ value: '7680x4320', label: '7680 × 4320' }, { value: '3840x2160', label: '3840 × 2160' }, { value: '2560x1440', label: '2560 × 1440' }, { value: '1920x1080', label: '1920 × 1080' }, { value: '1280x720', label: '1280 × 720' }, { value: '1080x1920', label: '1080 × 1920' }]
  const [customSize, setCustomSize] = useState(false)
  const follow = (field: keyof VideoEditExportSettings['followSequence']): React.ReactNode => <UiIconButton size="sm" on={s.followSequence[field]} aria-label={`${{ resolution: '分辨率', fps: '帧率', sampleRate: '采样率', channels: '声道' }[field]}跟随序列`} aria-pressed={s.followSequence[field]} title={s.followSequence[field] ? '跟随序列；点击解锁' : '已解锁；点击跟随序列'} disabled={busy} onClick={() => patch({ followSequence: { ...s.followSequence, [field]: !s.followSequence[field] } })}>{s.followSequence[field] ? <Link className="h-4 w-4" /> : <Unlink className="h-4 w-4" />}</UiIconButton>
  const select = <T extends string | number>(label: string, value: T, options: { value: T; label: string; disabled?: boolean; tooltip?: string }[], onSelect: (value: T) => void, disabled = false): React.ReactNode => <Dropdown<T> ariaLabel={label} size="sm" value={value} options={options} onSelect={onSelect} disabled={busy || disabled} minWidthStrategy="none" />
  const section = (id: ExportSection, label: string, children: ReactNode, enabled?: boolean, toggle?: (enabled: boolean) => void, disabled = false): React.ReactNode => <UiGroup divided gap="none" titleTone="compact" key={id}>
    <div className="flex items-center gap-2 px-3 pb-2"><UiButton size="sm" className="flex-1 justify-start" aria-expanded={expanded.includes(id)} onClick={() => setExpanded(previous => { const next = previous.includes(id) ? previous.filter(value => value !== id) : [...previous, id]; expansion.set(viewer, next); return next })}>{expanded.includes(id) ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}{label}</UiButton>{toggle && <UiSwitch aria-label={`启用${label}`} checked={enabled ?? false} disabled={busy || disabled} onCheckedChange={toggle} />}</div>
    {expanded.includes(id) && (enabled === undefined || enabled) && <div className="space-y-2 px-3 pb-3">{children}</div>}
  </UiGroup>
  return <>
    {section('video', '视频', <>
      <div className="flex justify-end"><UiButton size="sm" disabled={busy} onClick={matchSequence}>匹配序列</UiButton></div>
      <VideoEditExportField label="分辨率" lock={follow('resolution')}>{select('导出分辨率', s.followSequence.resolution ? 'sequence' : customSize || !resolutions.some(value => value.value === `${s.width}x${s.height}`) ? 'custom' : `${s.width}x${s.height}`, [...(s.followSequence.resolution ? [{ value: 'sequence', label: `${s.width} × ${s.height}` }] : []), ...resolutions, { value: 'custom', label: '自定义…' }], value => { setCustomSize(value === 'custom'); if (value !== 'custom') { const [width, height] = value.split('x').map(Number); patch({ width, height }) } }, s.followSequence.resolution)}</VideoEditExportField>
      {!s.followSequence.resolution && (customSize || !resolutions.some(value => value.value === `${s.width}x${s.height}`)) && <VideoEditExportField label="宽高"><div className="flex min-w-0 items-center gap-1"><NumberInput size="sm" ariaLabel="导出宽度" value={s.width} min={VIDEO_EDIT_SEQUENCE_LIMITS.minDimension} max={VIDEO_EDIT_SEQUENCE_LIMITS.maxDimension} step={2} disabled={busy} widthClassName="w-16" onChange={width => patch({ width })} /><span className="text-text2">×</span><NumberInput size="sm" ariaLabel="导出高度" value={s.height} min={VIDEO_EDIT_SEQUENCE_LIMITS.minDimension} max={VIDEO_EDIT_SEQUENCE_LIMITS.maxDimension} step={2} disabled={busy} widthClassName="w-16" onChange={height => patch({ height })} /></div></VideoEditExportField>}
      <VideoEditExportField label="帧率" lock={follow('fps')}>{select('导出帧率', s.fps ?? 30, [...new Set([s.fps ?? 30, 120, 60, 50, 30, 30000 / 1001, 25, 24, 24000 / 1001])].map(value => ({ value, label: Number(value.toFixed(3)).toString() })), fps => patch({ fps }), s.followSequence.fps)}</VideoEditExportField>
      <VideoEditExportField label="画幅处理">{select('画幅处理', s.fit, [{ value: 'fit', label: '适合' }, { value: 'fill', label: '填充' }, { value: 'letterbox', label: '留黑边' }], fit => patch({ fit }))}</VideoEditExportField>
      <UiGroup title="编码" titleTone="compact">
        <VideoEditExportField label="性能">{select('编码性能', s.encoderPreference, ([{ value: 'hardware', label: '硬件加速' }, { value: 'software', label: '软件编码' }] as const).map(value => ({ ...value, disabled: probing || !support(s.codec, value.value, s.bitrateMode), tooltip: probing ? '正在检查设备支持…' : !support(s.codec, value.value, s.bitrateMode) ? '当前设备不支持此规格；请调整格式、分辨率或码率模式。' : value.value === 'hardware' ? '优先使用硬件加速，最终方式取决于设备支持。' : '优先使用软件编码，最终方式取决于设备支持。' })), encoderPreference => patch({ encoderPreference }))}</VideoEditExportField>
        <VideoEditExportField label="码率模式">{select('码率模式', s.bitrateMode, (['vbr', 'cbr'] as const).map(value => ({ value, label: value.toUpperCase(), disabled: probing || !support(s.codec, s.encoderPreference, value), tooltip: !support(s.codec, s.encoderPreference, value) ? '当前设备不支持所选规格的此码率模式。' : undefined })), bitrateMode => patch({ bitrateMode }))}</VideoEditExportField>
        <VideoEditExportField label="目标码率" info="按码率和时长估算大小；VBR 实际大小随画面变化。"><div className="flex min-w-0 items-center gap-1"><UiRangeInput aria-label="目标码率滑杆" min={.1} max={200} step={.1} value={s.videoBitrateMbps} disabled={busy} className="min-w-0 flex-1" onChange={event => patch({ videoBitrateMbps: Number(event.target.value) })} /><NumberInput size="sm" ariaLabel="目标码率 Mbps" value={s.videoBitrateMbps} min={.1} max={200} precision={1} step={1} disabled={busy} widthClassName="w-16" onChange={videoBitrateMbps => patch({ videoBitrateMbps })} /><span className="text-xs text-text2">Mbps</span></div></VideoEditExportField>
        <VideoEditExportField label="关键帧间隔">{select('关键帧间隔', String(s.keyframeInterval), [{ value: 'auto', label: '自动' }, { value: '1', label: '1 秒' }, { value: '2', label: '2 秒' }], value => patch({ keyframeInterval: value === 'auto' ? 'auto' : Number(value) as 1 | 2 }))}</VideoEditExportField>
      </UiGroup>
    </>, s.videoEnabled, videoEnabled => patch({ videoEnabled }))}
    {section('audio', '音频', <>
      <VideoEditExportField label="编码">{select('音频编码', s.audioCodec, [{ value: 'aac', label: 'AAC' }, { value: 'wav', label: 'WAV (PCM)' }], audioCodec => patch({ audioCodec }))}</VideoEditExportField>
      <VideoEditExportField label="采样率" lock={follow('sampleRate')}>{select('音频采样率', s.sampleRate, [48000, 44100].map(value => ({ value, label: `${value} Hz` })), value => patch({ sampleRate: value as 44100 | 48000 }), s.followSequence.sampleRate)}</VideoEditExportField>
      <VideoEditExportField label="声道" lock={follow('channels')}>{select('音频声道', s.channels, [{ value: 2, label: '立体声' }, { value: 1, label: '单声道' }], value => patch({ channels: value as 1 | 2 }), s.followSequence.channels)}</VideoEditExportField>
      {s.audioCodec === 'aac' && <VideoEditExportField label="码率">{select('音频码率', s.audioBitrateKbps, [...new Set([s.audioBitrateKbps, 320, 256, 192, 128])].map(value => ({ value, label: `${value} kbps` })), audioBitrateKbps => patch({ audioBitrateKbps }))}</VideoEditExportField>}
    </>, s.audioEnabled, audioEnabled => patch({ audioEnabled }), !s.videoEnabled)}
    {section('loudness', '响度', <>
      <VideoEditExportField label="目标">{select('响度目标', s.loudness?.targetLufs ?? -14, [{ value: -14, label: '-14 LUFS（流媒体）' }, { value: -16, label: '-16 LUFS' }, { value: -23, label: '-23 LUFS（广播）' }], targetLufs => patch({ loudness: { targetLufs, truePeakDbtp: s.loudness!.truePeakDbtp } }))}</VideoEditExportField>
      <VideoEditExportField label="真峰值">{select('响度真峰值', s.loudness?.truePeakDbtp ?? -1, [{ value: -1, label: '-1 dBTP' }, { value: -2, label: '-2 dBTP' }], truePeakDbtp => patch({ loudness: { targetLufs: s.loudness!.targetLufs, truePeakDbtp } }))}</VideoEditExportField>
    </>, Boolean(s.loudness), enabled => patch({ loudness: enabled ? { targetLufs: -14, truePeakDbtp: -1 } : null }), !s.audioEnabled)}
    {section('captions', '字幕', <VideoEditExportField label="方式">{select('字幕方式', s.captionMode, [{ value: 'burn', label: '烧录到画面', disabled: !s.videoEnabled, tooltip: !s.videoEnabled ? '烧录字幕需要启用视频。' : undefined }, { value: 'srt', label: '单独的 SRT 文件' }, { value: 'vtt', label: '单独的 WebVTT 文件' }], captionMode => patch({ captionMode }))}</VideoEditExportField>, s.captionMode !== 'none', enabled => patch({ captionMode: enabled ? s.videoEnabled ? 'burn' : 'srt' : 'none' }))}
    {section('general', '常规', <>
      <UiFormRow label="导出后导入到项目" inline density="compact"><UiCheckbox aria-label="导出后导入到项目" checked={s.importToProject} disabled={busy} onCheckedChange={importToProject => patch({ importToProject })} /></UiFormRow>
      <UiFormRow label="加入资产库" inline density="compact"><UiCheckbox aria-label="加入资产库" checked={s.addToLibrary} disabled={busy} onCheckedChange={addToLibrary => patch({ addToLibrary })} /></UiFormRow>
      <UiFormRow label="使用代理导出" info={hasProxies ? '使用已有代理画面，速度更快、画质较低；声音仍使用原片。' : '此序列尚无可用代理，请先在素材箱创建代理。'} inline density="compact"><UiCheckbox aria-label="使用代理导出" checked={s.useProxies} disabled={busy || !hasProxies} onCheckedChange={useProxies => patch({ useProxies })} /></UiFormRow>
    </>)}
  </>
}
