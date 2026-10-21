export * from '../imaging/adjustments/colorGrade'
import { COLOR_GRADE_PARAMS } from '../imaging/adjustments/colorGrade'
import type { VideoEditBuiltinEffectDefinition } from './builtinEffects'

export const VIDEO_EDIT_COLOR_GRADE: VideoEditBuiltinEffectDefinition = { id: 'color_grade', name: '全能调色', group: 'color', tooltip: '白平衡、明暗、参数曲线、混色器、色轮、LUT、曲线、HSL 辅助与晕影集中调色', description: '顺序：输入LUT→白平衡(开尔文)/曝光→对比度/高光/阴影/白/黑/参数曲线→饱和度→Look LUT→淡化胶片→8色混色器→RGB/色相曲线→色轮(分级或一级LGG)→HSL辅助→锐化→晕影；默认中性。先曝光与白平衡(temperature_kelvin写光源色温，6500不变)，再反差与色彩。analyze_video_edit_color多帧自动校色或匹配参考后，经video_edit.effect.parameters通用写入。curve_*_points为0–100控制点JSON数组，整体动画用hold；空值使用五锚点数值曲线。LUT传文档color_luts引用及强度。HSL辅助只校正联合色相/饱和度/亮度选区：肤色参考15–50°、饱和度20–85%、亮度15–85%；天空190–250°；红色340–20°跨0回绕，需显示蒙版观察并微调。柔和度5–20，去噪/模糊按画面高度比例；hsl_show_mask检查完关闭，校正默认全0。', params: COLOR_GRADE_PARAMS }
