/** 上传的图片与文字层、解码好的图片、代码输入的定格画面（缓存与前视预算，解码图片同时作为驻留上限）。 */
export const VIDEO_EDIT_IMAGE_BUDGET_BYTES = 1024 ** 3
/** 写进提示语的预算大小。 */
export const VIDEO_EDIT_IMAGE_BUDGET_LABEL = '1GiB'

/** 网页、视频输入与嵌套画面的历史和前视预算；当前帧必需输入不受此值限制。 */
export const VIDEO_EDIT_INPUT_BUDGET_BYTES = 512 * 1024 ** 2

/** 代码生成器及效果的驻留容量基准；三维空间使用独立的工作集预算。 */
export const VIDEO_EDIT_CODE_RESIDENT_BUDGET_BYTES = 512 * 1024 ** 2

/** 三维空间推近升档的工作集预算：卡片材料面、景深、组画面目标与 three 内部目标之和。一倍栅格不受此限。 */
export const VIDEO_EDIT_SPATIAL_WORKING_SET_BYTES = 2 * 1024 ** 3

/** 受管 three 的颜色、四样本颜色与深度目标；宿主借给它的输出纹理另计。 */
export function videoEditThreeTargetBytes(width: number, height: number, backend: 'webgpu' | 'webgl'): number {
  return width * height * (backend === 'webgpu' ? 8 * 6 + 4 * 4 : 4 * 6 + 4 * 4)
}
