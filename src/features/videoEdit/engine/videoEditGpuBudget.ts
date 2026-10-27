/**
 * 剪辑合成的显存预算，预览与导出共用。2026-10-28 放宽：原来图片、文字与解码图片各按 256MiB 限制，
 * 4K 画布上几扇录屏加几层文字就超了（多画面拼接排不出来）。
 */
/** 上传的图片与文字层、解码好的图片、代码输入的定格画面（各自的驻留上限）。 */
export const VIDEO_EDIT_IMAGE_BUDGET_BYTES = 1024 ** 3
/** 代码素材借用的视频画面（解码器已在显卡上的画面，不上传）：4K 高精度约十四扇。 */
export const VIDEO_EDIT_CODE_PICTURE_BUDGET_BYTES = 2 * 1024 ** 3
/** 写进提示语的预算大小。 */
export const VIDEO_EDIT_IMAGE_BUDGET_LABEL = '1GiB'
export const VIDEO_EDIT_CODE_PICTURE_BUDGET_LABEL = '2GiB'
