import { useSyncExternalStore } from 'react'
import { Circle, PenTool, RotateCcw, Square, Trash2 } from 'lucide-react'
import { Dropdown, UiIconButton, UiOptionButton, UiSwitch, UiTooltipText } from '@/components/ui'
import NumberInput from '@/components/ui/NumberInput'
import type { VideoEditBuiltinEffect } from '@/core/videoEdit/compositing'
import {
  createVideoEditMaskShape, isShapesMask, videoEditMaskShapeName, VIDEO_EDIT_MASK_DEFAULTS, VIDEO_EDIT_MASK_MODE_LABELS, VIDEO_EDIT_MASK_MODES, VIDEO_EDIT_MASK_OPACITY_RANGE,
  type VideoEditMaskMode, type VideoEditMaskShape,
} from '@/core/videoEdit/effectMasks'
import { SMART_REGION_EXPAND_RANGE, SMART_REGION_FEATHER_RANGE } from '@/core/videoEdit/smartRegions'
import type { VideoEditCompositeTarget } from '../application/videoEditCompositing'
import { getVideoEditMaskEditing, setVideoEditMaskEditing, subscribeVideoEditMaskEditing, videoEditMaskEditingRevision } from '../application/videoEditMaskEditing'
import type { VideoEditBuiltinParamGesture } from './useVideoEditBuiltinParamGesture'

/*
 * 效果控件里的手绘遮罩（任务 4.10，PR 效果下的“创建椭圆 / 4 点多边形 / 自由绘制贝塞尔”与每个遮罩的羽化、不透明度、扩展、反转）。
 * 点遮罩名称在节目监视器上显示控制柄；钢笔进入节目监视器逐点绘制。
 */

function without<T extends object, K extends keyof T>(value: T, key: K): Omit<T, K> { const { [key]: _removed, ...rest } = value; return rest }

function Row({ label, tooltip, children, reset }: { label: string; tooltip: string; children: React.ReactNode; reset?: { label: string; disabled: boolean; onReset: () => void } }): React.ReactElement {
  return <div className="flex min-h-8 items-center gap-1.5 pl-3" data-video-edit-mask-row={label}>
    <span className="min-w-0 flex-1 truncate text-xs text-text2"><UiTooltipText tooltip={tooltip}>{label}</UiTooltipText></span>
    {children}
    {reset ? <UiIconButton size="xs" aria-label={reset.label} title={reset.label} disabled={reset.disabled} onClick={reset.onReset}><RotateCcw size={12} /></UiIconButton> : <span className="w-5 shrink-0" aria-hidden="true" />}
  </div>
}

/** 创建遮罩的三个按钮（PR：椭圆、矩形、钢笔）。 */
export function VideoEditMaskCreateButtons({ target, effect, gesture }: { target: VideoEditCompositeTarget; effect: VideoEditBuiltinEffect; gesture: VideoEditBuiltinParamGesture }): React.ReactElement {
  useSyncExternalStore(subscribeVideoEditMaskEditing, videoEditMaskEditingRevision)
  const shapes = isShapesMask(effect.mask) ? effect.mask.shapes : []
  const editing = getVideoEditMaskEditing()
  const penOn = Boolean(editing?.pen && editing.effectId === effect.id && editing.clipId === target.clipId)
  const create = (kind: 'rect' | 'ellipse'): void => {
    const shape = createVideoEditMaskShape(kind)
    gesture.commit({ mask: { regionId: 'shapes', shapes: [...shapes, shape] } })
    setVideoEditMaskEditing({ ...target, effectId: effect.id, shapeId: shape.id })
  }
  return <span className="flex shrink-0 items-center gap-0.5" role="group" aria-label="创建遮罩">
    <UiIconButton size="sm" aria-label="创建椭圆遮罩" title="创建椭圆遮罩" onClick={() => create('ellipse')}><Circle size={14} /></UiIconButton>
    <UiIconButton size="sm" aria-label="创建矩形遮罩" title="创建矩形遮罩" onClick={() => create('rect')}><Square size={14} /></UiIconButton>
    <UiIconButton size="sm" aria-label="钢笔遮罩" title="钢笔遮罩：在节目画面上逐点绘制，按住拖出曲线，点回起点或按 Enter 闭合" on={penOn} aria-pressed={penOn}
      onClick={() => setVideoEditMaskEditing(penOn ? { ...target, effectId: effect.id, pen: false } : { ...target, effectId: effect.id, pen: true })}><PenTool size={14} /></UiIconButton>
  </span>
}

/** 每个遮罩一组：名称（点一下在节目监视器上编辑）、模式、删除，羽化、不透明度、扩展、反转。 */
export function VideoEditMaskShapeControls({ target, effect, gesture, trackAction }: { target: VideoEditCompositeTarget; effect: VideoEditBuiltinEffect; gesture: VideoEditBuiltinParamGesture; trackAction?: (shape: VideoEditMaskShape) => React.ReactNode }): React.ReactElement | null {
  useSyncExternalStore(subscribeVideoEditMaskEditing, videoEditMaskEditingRevision)
  if (!isShapesMask(effect.mask)) return null
  const shapes = effect.mask.shapes
  const editing = getVideoEditMaskEditing()
  const update = (shape: VideoEditMaskShape, next: VideoEditMaskShape): void => gesture.commit({ mask: { regionId: 'shapes', shapes: shapes.map(entry => entry.id === shape.id ? next : entry) } })
  const remove = (shape: VideoEditMaskShape): void => {
    const rest = shapes.filter(entry => entry.id !== shape.id)
    gesture.commit({ mask: rest.length ? { regionId: 'shapes', shapes: rest } : null })
    if (editing?.shapeId === shape.id) setVideoEditMaskEditing({ ...target, effectId: effect.id })
  }
  const scrub = (label: string, value: number, range: { min: number; max: number }, apply: (next: number) => void): React.ReactElement => <span className="flex shrink-0 items-center gap-1">
    <NumberInput ariaLabel={label} increaseLabel={`增加${label}`} decreaseLabel={`减少${label}`} size="sm" value={value} min={range.min} max={range.max} step={1} precision={0} widthClassName="w-20" align="right"
      onScrubStart={gesture.begin} onScrubEnd={cancelled => { if (cancelled) gesture.cancel(); else gesture.finish() }}
      onChange={next => { if (gesture.active() || Math.round(next) !== Math.round(value)) apply(Math.round(next)) }} />
    <span className="w-6" aria-hidden="true" />
  </span>
  return <div className="flex flex-col" data-video-edit-mask-shapes={shapes.length}>
    {shapes.map(shape => {
      const name = videoEditMaskShapeName(shapes, shape)
      const selected = editing?.effectId === effect.id && editing.clipId === target.clipId && editing.shapeId === shape.id
      return <div key={shape.id} className="flex flex-col" data-video-edit-mask-shape-controls={shape.id}>
        <div className="flex min-h-8 items-center gap-1.5">
          <span className="min-w-0 flex-1">
            <UiOptionButton variant="menu" size="sm" className="w-full" active={selected} aria-pressed={selected} title="在节目画面上显示控制柄，拖动顶点或整体移动"
              onClick={() => setVideoEditMaskEditing({ ...target, effectId: effect.id, shapeId: shape.id })}>
              <span className="truncate">{name}</span>
            </UiOptionButton>
          </span>
          <span className="w-20 shrink-0"><Dropdown<VideoEditMaskMode> ariaLabel={`${name}模式`} size="sm" value={shape.mode ?? 'add'} buttonClassName="w-full"
            options={VIDEO_EDIT_MASK_MODES.map(mode => ({ value: mode, label: VIDEO_EDIT_MASK_MODE_LABELS[mode] }))}
            onSelect={mode => update(shape, mode === 'add' ? without(shape, 'mode') : { ...shape, mode })} /></span>
          {trackAction?.(shape)}
          <UiIconButton size="xs" tone="danger" aria-label={`删除${name}`} title={`删除${name}`} onClick={() => remove(shape)}><Trash2 size={12} /></UiIconButton>
        </div>
        <Row label="羽化" tooltip="遮罩边缘的柔和过渡，100 约为画面高度的 10%" reset={{ label: `重置${name}羽化`, disabled: shape.feather === undefined, onReset: () => update(shape, without(shape, 'feather')) }}>
          {scrub(`${name}羽化`, shape.feather ?? VIDEO_EDIT_MASK_DEFAULTS.feather, SMART_REGION_FEATHER_RANGE, next => update(shape, { ...shape, feather: next }))}
        </Row>
        <Row label="不透明度" tooltip="遮罩的强度，100 为完全作用" reset={{ label: `重置${name}不透明度`, disabled: shape.opacity === undefined, onReset: () => update(shape, without(shape, 'opacity')) }}>
          {scrub(`${name}不透明度`, shape.opacity ?? VIDEO_EDIT_MASK_DEFAULTS.opacity, VIDEO_EDIT_MASK_OPACITY_RANGE, next => update(shape, { ...shape, opacity: next }))}
        </Row>
        <Row label="扩展" tooltip="正数把遮罩向外扩大，负数向内收缩，100 约为画面高度的 10%" reset={{ label: `重置${name}扩展`, disabled: shape.expand === undefined, onReset: () => update(shape, without(shape, 'expand')) }}>
          {scrub(`${name}扩展`, shape.expand ?? VIDEO_EDIT_MASK_DEFAULTS.expand, SMART_REGION_EXPAND_RANGE, next => update(shape, { ...shape, expand: next }))}
        </Row>
        <Row label="已反转" tooltip="作用到遮罩以外的部分">
          <span className="flex shrink-0 items-center"><UiSwitch aria-label={`反转${name}`} checked={Boolean(shape.invert)} onCheckedChange={checked => update(shape, checked ? { ...shape, invert: true } : without(shape, 'invert'))} /></span>
        </Row>
      </div>
    })}
  </div>
}
