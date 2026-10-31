/** 上传的图片与文字层、解码好的图片、代码输入的定格画面（缓存与前视预算，解码图片同时作为驻留上限）。 */
export const VIDEO_EDIT_IMAGE_BUDGET_BYTES = 1024 ** 3
/** 写进提示语的预算大小。 */
export const VIDEO_EDIT_IMAGE_BUDGET_LABEL = '1GiB'

/** 网页、视频输入与嵌套画面的历史和前视预算；当前帧必需输入不受此值限制。 */
export const VIDEO_EDIT_INPUT_BUDGET_BYTES = 512 * 1024 ** 2
