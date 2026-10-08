import { Dropdown, UiEasingEditor } from '@/components/ui'
import { VIDEO_EDIT_DEFAULT_BEZIER, type VideoEditBezier, type VideoEditInterpolation } from '@/core/videoEdit/keyframeInterpolation'

interface Props {
  label: string
  interpolation: VideoEditInterpolation
  bezier?: VideoEditBezier
  onChange: (value: { interpolation: VideoEditInterpolation; bezier?: VideoEditBezier }) => void
  onBegin: () => void
  onFinish: () => void
  onCancel: () => void
}

/** One interpolation/easing editor for frame and source-time tracks. */
export function VideoEditKeyframeInterpolation({ label, interpolation, bezier, onChange, onBegin, onFinish, onCancel }: Props): React.ReactElement {
  return <div className="flex flex-col gap-2">
    <Dropdown size="sm" ariaLabel={`${label}插值`} value={interpolation} options={[{ value: 'linear', label: '线性' }, { value: 'hold', label: '定格' }, { value: 'ease', label: '缓入缓出' }, { value: 'bezier', label: '自定义贝塞尔' }]}
      onSelect={next => onChange({ interpolation: next, ...(next === 'bezier' ? { bezier: bezier ?? [...VIDEO_EDIT_DEFAULT_BEZIER] } : {}) })} />
    {interpolation === 'bezier' && <UiEasingEditor label={`${label}缓动`} value={bezier ?? [...VIDEO_EDIT_DEFAULT_BEZIER]} presets={[]} defaultValue={[...VIDEO_EDIT_DEFAULT_BEZIER]}
      onBegin={onBegin} onFinish={onFinish} onCancel={onCancel} onChange={value => { if (Array.isArray(value)) onChange({ interpolation: 'bezier', bezier: value }) }} />}
  </div>
}
