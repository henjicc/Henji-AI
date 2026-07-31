/**
 * 设置弹窗内容区的共享布局常量。
 *
 * 内容列必须限宽：弹窗宽度是 `min(90vw, 1200px)`，减掉目录后内容区接近 1000px，
 * 而「界面语言」这种下拉一旦铺满就会横跨整屏，看起来像坏掉了。
 * 表单型分区统一收在 `max-w-3xl`，只有模型管理这类需要横向铺开的分区例外。
 */
export const SETTINGS_CONTENT_MAX_WIDTH_CLASS = 'max-w-3xl'

/**
 * 分节之间的间距。分节内部是 `UI_SECTION_STACK_CLASS`（space-y-8），
 * 分节之间必须更宽，否则连排后读不出「这里换了一节」。
 */
export const SETTINGS_CONTENT_CLASS = 'p-4 space-y-12'
