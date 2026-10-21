import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AppWindow, Monitor, RefreshCw } from 'lucide-react'
import { UiButton, UiEmpty, UiLoading, UiOptionButton, UiSearchInput, UiSegmented } from '@/components/ui'
import { UI_COVER_FRAME_CLASS, UI_ICON_SIZE_CLASS, UI_TEXT_TIMECODE_CLASS } from '@/components/ui/styleTokens'
import type { CaptureSource } from '@/core/screenRecording/contracts'
import { FULL_REGION, orderedScreens, type RecordingRangeMode, type RecordingRegion } from './recordingSetupModel'

const ASPECTS = { free: 0, '16:9': 16 / 9, '9:16': 9 / 16, '1:1': 1, '4:3': 4 / 3 } as const
type Aspect = keyof typeof ASPECTS
const MIN_REGION = 0.05

export function RecordingSourcePicker({ sources, loading, mode, sourceId, region, onModeChange, onSourceChange, onRegionChange, onRefresh }: {
  sources: CaptureSource[]; loading: boolean; mode: RecordingRangeMode; sourceId: string; region: RecordingRegion
  onModeChange(mode: RecordingRangeMode): void; onSourceChange(id: string): void; onRegionChange(region: RecordingRegion): void; onRefresh(): void
}): React.ReactElement {
  const { t } = useTranslation('ui')
  const screens = useMemo(() => orderedScreens(sources), [sources])
  const windows = useMemo(() => sources.filter(source => source.kind === 'window'), [sources])
  const label = (source: CaptureSource): string => t('recording.screenNumber', { index: screens.indexOf(source) + 1 })
  return <div className="flex min-h-0 flex-1 flex-col" data-recording-source-picker={mode}>
    <div className="flex items-center gap-3 px-4 py-3">
      <UiSegmented ariaLabel={t('recording.rangeMode')} value={mode} onChange={onModeChange} options={[
        { value: 'screen', label: t('recording.range_screen') }, { value: 'window', label: t('recording.range_window') }, { value: 'region', label: t('recording.range_region') },
      ]} />
      <span className="flex-1" />
      <UiButton disabled={loading} disabledReason={t('recording.refreshing')} onClick={onRefresh}><RefreshCw />{t('recording.refresh')}</UiButton>
    </div>
    {loading && !sources.length ? <UiLoading /> : mode === 'window'
      ? <WindowGrid windows={windows} sourceId={sourceId} onSelect={onSourceChange} />
      : !screens.length ? <UiEmpty title={t('recording.noSources')} />
      : mode === 'screen'
        ? <DisplayMap screens={screens} sourceId={sourceId} label={label} onSelect={onSourceChange} />
        : <RegionStage screens={screens} sourceId={sourceId} region={region} label={label} onSelect={onSourceChange} onRegionChange={onRegionChange} />}
  </div>
}

/** Monitors drawn at their real desktop arrangement, so "which screen" is answered by position, not by a name. */
function DisplayMap({ screens, sourceId, label, onSelect }: { screens: CaptureSource[]; sourceId: string; label(source: CaptureSource): string; onSelect(id: string): void }): React.ReactElement {
  const { t } = useTranslation('ui')
  const rects = screens.map(source => source.display ?? { x: 0, y: 0, width: 1920, height: 1080, scaleFactor: 1, primary: false })
  const left = Math.min(...rects.map(r => r.x)), top = Math.min(...rects.map(r => r.y))
  const width = Math.max(...rects.map(r => r.x + r.width)) - left, height = Math.max(...rects.map(r => r.y + r.height)) - top
  return <div className="flex min-h-0 flex-1 items-center justify-center bg-gap p-8">
    <div className="flex h-full w-full items-center justify-center" style={{ containerType: 'size' }}>
    <div className="relative" style={{ width: `min(100cqw, 100cqh * ${width / height})`, aspectRatio: `${width} / ${height}` }}>
      {screens.map((source, index) => {
        const rect = rects[index]
        return <div key={source.id} className="absolute p-1" style={{ left: `${(rect.x - left) / width * 100}%`, top: `${(rect.y - top) / height * 100}%`, width: `${rect.width / width * 100}%`, height: `${rect.height / height * 100}%` }}>
          <UiOptionButton variant="cover" active={source.id === sourceId} aria-label={source.name} className="h-full w-full" onClick={() => onSelect(source.id)}>
          <div className={`${UI_COVER_FRAME_CLASS} relative h-full w-full overflow-hidden bg-media`}>
            {source.thumbnailUrl && <img src={source.thumbnailUrl} alt="" className="h-full w-full object-cover" />}
            <span className="absolute bottom-2 left-2 flex items-center gap-1.5 rounded-md bg-media-scrim px-2 py-1 text-xs text-on-media">
              <Monitor className={UI_ICON_SIZE_CLASS.sm} aria-hidden />{label(source)}{rect.primary ? ` · ${t('recording.primaryScreen')}` : ''}
              <span className={`${UI_TEXT_TIMECODE_CLASS} opacity-80`}>{Math.round(rect.width * rect.scaleFactor)}×{Math.round(rect.height * rect.scaleFactor)}</span>
            </span>
          </div>
          </UiOptionButton>
        </div>
      })}
    </div>
    </div>
  </div>
}

function WindowGrid({ windows, sourceId, onSelect }: { windows: CaptureSource[]; sourceId: string; onSelect(id: string): void }): React.ReactElement {
  const { t } = useTranslation('ui')
  const [query, setQuery] = useState('')
  const visible = windows.filter(source => source.name.toLowerCase().includes(query.trim().toLowerCase()))
  return <div className="flex min-h-0 flex-1 flex-col">
    <div className="px-4 pb-3"><UiSearchInput size="sm" className="w-72" value={query} onChange={event => setQuery(event.target.value)} onClear={() => setQuery('')} clearLabel={t('recording.clearSearch')} placeholder={t('recording.searchWindows')} /></div>
    <div className="min-h-0 flex-1 overflow-auto px-4 pb-4">
      {visible.length ? <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4">
        {visible.map(source => <UiOptionButton key={source.id} variant="cover" active={source.id === sourceId} aria-label={source.name} className="min-w-0" onClick={() => onSelect(source.id)}>
          <div className={`${UI_COVER_FRAME_CLASS} aspect-video w-full overflow-hidden bg-media`}>{source.thumbnailUrl && <img src={source.thumbnailUrl} alt="" className="h-full w-full object-contain" data-recording-source-thumbnail />}</div>
          <span className="flex w-full min-w-0 items-center gap-2 pt-2 text-13" data-recording-source-caption>
            {source.iconUrl ? <img src={source.iconUrl} alt="" className="h-4 w-4 shrink-0" /> : <AppWindow className={`${UI_ICON_SIZE_CLASS.sm} shrink-0 text-text3`} aria-hidden />}
            <span className="truncate" data-recording-source-title>{source.name}</span>
          </span>
        </UiOptionButton>)}
      </div> : <UiEmpty title={query ? t('recording.noWindowMatch') : t('recording.noWindows')} />}
    </div>
  </div>
}

/** Drag on the screen picture to draw the area; drag inside to move it, drag a corner to resize. */
function RegionStage({ screens, sourceId, region, label, onSelect, onRegionChange }: { screens: CaptureSource[]; sourceId: string; region: RecordingRegion; label(source: CaptureSource): string; onSelect(id: string): void; onRegionChange(region: RecordingRegion): void }): React.ReactElement {
  const { t } = useTranslation('ui')
  const current = screens.find(source => source.id === sourceId) ?? screens[0]
  const display = current.display ?? { x: 0, y: 0, width: 1920, height: 1080, scaleFactor: 1, primary: false }
  const [aspect, setAspect] = useState<Aspect>('free')
  const stage = useRef<HTMLDivElement>(null)
  const gesture = useRef<{ kind: 'draw' | 'move' | 'resize'; start: { x: number; y: number }; origin: RecordingRegion } | null>(null)
  const point = (event: React.PointerEvent): { x: number; y: number } => {
    const box = stage.current!.getBoundingClientRect()
    return { x: Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)), y: Math.min(1, Math.max(0, (event.clientY - box.top) / box.height)) }
  }
  // Aspect presets are in output pixels, so convert through the display's own shape.
  const ratio = ASPECTS[aspect] ? ASPECTS[aspect] * display.height / display.width : 0
  const fit = (anchor: { x: number; y: number }, end: { x: number; y: number }): RecordingRegion => {
    let width = Math.abs(end.x - anchor.x), height = Math.abs(end.y - anchor.y)
    if (ratio) { if (width / height > ratio) width = height * ratio; else height = width / ratio }
    width = Math.max(MIN_REGION, width); height = Math.max(MIN_REGION, height)
    const x = end.x < anchor.x ? anchor.x - width : anchor.x, y = end.y < anchor.y ? anchor.y - height : anchor.y
    return clampRegion({ x, y, width, height })
  }
  const down = (kind: 'draw' | 'move' | 'resize') => (event: React.PointerEvent): void => {
    event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId)
    const start = point(event)
    gesture.current = { kind, start: kind === 'resize' ? { x: region.x, y: region.y } : start, origin: region }
  }
  const move = (event: React.PointerEvent): void => {
    const active = gesture.current
    if (!active) return
    const now = point(event)
    if (active.kind === 'move') onRegionChange(clampRegion({ ...active.origin, x: active.origin.x + now.x - active.start.x, y: active.origin.y + now.y - active.start.y }))
    else onRegionChange(fit(active.start, now))
  }
  const up = (): void => { gesture.current = null }
  const choose = (next: Aspect): void => {
    setAspect(next)
    const nextRatio = ASPECTS[next] ? ASPECTS[next] * display.height / display.width : 0
    if (!nextRatio) return
    let width = region.width, height = width / nextRatio
    if (height > 1) { height = 1; width = nextRatio }
    onRegionChange(clampRegion({ x: region.x + (region.width - width) / 2, y: region.y + (region.height - height) / 2, width, height }))
  }
  const pixels = { width: Math.round(display.width * display.scaleFactor * region.width / 2) * 2, height: Math.round(display.height * display.scaleFactor * region.height / 2) * 2 }
  return <div className="flex min-h-0 flex-1 flex-col">
    <div className="flex flex-wrap items-center gap-3 px-4 pb-3">
      {screens.length > 1 && <UiSegmented ariaLabel={t('recording.regionScreen')} size="sm" value={current.id} onChange={id => { onSelect(id); onRegionChange(FULL_REGION) }} options={screens.map(source => ({ value: source.id, label: label(source) }))} />}
      <UiSegmented ariaLabel={t('recording.regionAspect')} size="sm" value={aspect} onChange={choose} options={(Object.keys(ASPECTS) as Aspect[]).map(value => ({ value, label: value === 'free' ? t('recording.aspectFree') : value }))} />
      <span className="flex-1" />
      <span className={`${UI_TEXT_TIMECODE_CLASS} text-xs text-text2`} aria-live="polite">{pixels.width} × {pixels.height}</span>
    </div>
    <div className="flex min-h-0 flex-1 items-center justify-center bg-gap p-6" style={{ containerType: 'size' }}>
      <div ref={stage} className="relative touch-none select-none overflow-hidden bg-media" style={{ width: `min(100cqw, 100cqh * ${display.width / display.height})`, aspectRatio: `${display.width} / ${display.height}` }}
        onPointerDown={down('draw')} onPointerMove={move} onPointerUp={up} onPointerCancel={up} data-recording-region-stage>
        {current.thumbnailUrl && <img src={current.thumbnailUrl} alt="" draggable={false} className="pointer-events-none h-full w-full object-cover" />}
        <div className="pointer-events-none absolute inset-0 bg-media-scrim" style={{ clipPath: `polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 ${region.y * 100}%, ${region.x * 100}% ${region.y * 100}%, ${region.x * 100}% ${(region.y + region.height) * 100}%, ${(region.x + region.width) * 100}% ${(region.y + region.height) * 100}%, ${(region.x + region.width) * 100}% ${region.y * 100}%, 0 ${region.y * 100}%)` }} />
        <div role="group" aria-label={t('recording.regionArea')} className="absolute cursor-move border-2 border-accent"
          style={{ left: `${region.x * 100}%`, top: `${region.y * 100}%`, width: `${region.width * 100}%`, height: `${region.height * 100}%` }} onPointerDown={down('move')}>
          <span className="absolute -bottom-1.5 -right-1.5 h-3 w-3 cursor-nwse-resize rounded-sm bg-accent" onPointerDown={down('resize')} />
        </div>
      </div>
    </div>
  </div>
}

function clampRegion(region: RecordingRegion): RecordingRegion {
  const width = Math.min(1, Math.max(MIN_REGION, region.width)), height = Math.min(1, Math.max(MIN_REGION, region.height))
  return { x: Math.min(1 - width, Math.max(0, region.x)), y: Math.min(1 - height, Math.max(0, region.y)), width, height }
}
