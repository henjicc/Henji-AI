import type { VideoEditBuiltinEffectDefinition } from './builtinEffects'
import { RECORDING_CURSOR_EFFECT } from './recordingCursor'

export const RECORDING_CURSOR_DEFINITION: VideoEditBuiltinEffectDefinition = {
  id: RECORDING_CURSOR_EFFECT, name: '录制光标', group: 'frame',
  tooltip: '平滑重绘录屏光标，并突出鼠标点击',
  description: '由屏幕素材绑定的采集事件日志驱动的独立光标层，自动跟随片段的源时间、剪切、移动、速度、倒放与缩放。原片含光标时只提供点击提示；没有事件日志的素材不可用。建议放在效果链最前，随后效果会同时处理光标和原片。',
  params: [
    { key: 'size', name: '光标大小', type: 'number', unit: 'percent', min: 0.5, max: 10, step: 0.1, default: 3, tooltip: '占屏幕画面高度的比例', description: '光标高度占源画面高度的百分比，默认3%；推近同步放大且保持清晰。' },
    { key: 'style', name: '光标样式', type: 'enum', default: 'light', options: [{ value: 'light', label: '浅色' }, { value: 'dark', label: '深色' }], tooltip: '使用带反差描边的浅色或深色光标', description: 'light 浅色黑边；dark 深色白边；形状跟随录制时的箭头、文本、手形等状态。' },
    { key: 'smoothing', name: '平滑强度', type: 'number', unit: 'strength', min: 0, max: 100, step: 1, default: 40, tooltip: '减少轨迹抖动，点击时仍对准点击位置', description: '0 线性插值；100 使用前后80毫秒的平滑窗口。拖动定位和倒放结果相同。' },
    { key: 'hide_after', name: '静止后隐藏（秒）', type: 'number', unit: 'value', min: 0, max: 30, step: 0.5, default: 3, tooltip: '静止多少秒后隐藏，0 表示始终显示', description: '按原录制时间计秒，0 不自动隐藏，活动后恢复。' },
    { key: 'click_style', name: '点击效果', type: 'enum', default: 'ripple', options: [{ value: 'ripple', label: '涟漪' }, { value: 'highlight', label: '高亮圈' }, { value: 'none', label: '关闭' }], tooltip: '每次按下时显示，持续半秒', description: 'ripple 向外扩散，highlight 固定高亮圈，none 不显示。按下触发一次，松开不重复；持续0.5秒源时间。' },
    { key: 'distinguish_buttons', name: '区分鼠标按键', type: 'boolean', default: true, tooltip: '用不同颜色区分左键、右键和中键', description: 'true 左键蓝、右键橙、中键紫；false 都用蓝色。' },
  ],
}
