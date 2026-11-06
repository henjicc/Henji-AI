/** 三档的运动模糊开关：片段、代码元素共用同一组选项。“自动”是不写开关，跟随上一层。 */
export type VideoEditMotionBlurChoice = 'auto' | 'on' | 'off'
export const VIDEO_EDIT_MOTION_BLUR_OPTIONS = [{ value: 'auto', label: '自动' }, { value: 'on', label: '开' }, { value: 'off', label: '关' }] as const
export const videoEditMotionBlurChoice = (value: boolean | undefined): VideoEditMotionBlurChoice => value === undefined ? 'auto' : value ? 'on' : 'off'
export const videoEditMotionBlurValue = (choice: VideoEditMotionBlurChoice): boolean | undefined => choice === 'auto' ? undefined : choice === 'on'
