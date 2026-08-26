/**
 * 设置弹窗内容区的共享布局常量。
 *
 * 内容列必须限宽：表单铺满整屏时「界面语言」这种下拉会横跨全宽，看起来像坏掉了。
 * 表单型分区统一收在 `max-w-3xl`，只有模型管理这类需要横向铺开的分区例外。
 *
 * **左对齐，不要居中。** 左侧目录是左对齐的，内容再居中会和目录错开，观感更怪。
 * 右侧不该剩大片空白——那说明弹窗比内容需要的宽，应该去调
 * `UI_MODAL_SIZE_CLASS.settings` 的宽度，而不是把内容推到中间。
 * 这两个值是配套的：目录 `w-52`(13rem) + 内容 48rem + 左右 `px-4`，合计约 63rem。
 */
export const SETTINGS_CONTENT_MAX_WIDTH_CLASS = 'max-w-3xl'

/**
 * 内容区外框。
 *
 * 分节之间的距离与分隔线由 `SettingsSection` 自己负责（`border-t` + `pt-10`），
 * 这里不再给 `space-y-*`——两处都管间距时，改一处永远对不齐。
 */
export const SETTINGS_CONTENT_CLASS = 'px-4 pb-4 pt-5'

/**
 * 横向行（`UiFormRow inline`）右侧控件的宽度。
 *
 * 收敛成一个常量的理由：改造前下拉宽度有 `w-40` / `w-44` / `w-48` / `w-full` 四种，
 * 同一页里右边缘对不齐。控件本身的高度走 `UI_FIELD_CONTROL_HEIGHT_SM_CLASS`（38px），
 * 不要再在调用点写 `h-[34px]` 这类没登记的数字。
 *
 * 带 `!` 是必需的：`UiInput` / `UiRangeInput` 的基础类里都有 `w-full`，
 * 两个 `w-*` 抢同一个属性时胜负由 Tailwind 产物顺序决定，不加 `!` 会静默失效。
 */
export const SETTINGS_INLINE_CONTROL_CLASS = '!w-48'
