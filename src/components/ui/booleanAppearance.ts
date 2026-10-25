import { createContext } from 'react'

/**
 * 开关（UiSwitch）没写 appearance 时取哪种外观（重要记录 022）：
 * - `pill`：滑块开关，开着轨道铺强调色。设置页、表单、浮层、画布与生成参数这些地方的默认。
 * - `checkbox`：16px 中性方框。只给剪辑那类停靠工作区的面板（属性密、一列一列地排），由 `DockviewHost` 提供；
 *   从面板里弹出的对话框是表单，`UiModal` 重置回 `pill`。
 */
export type UiBooleanAppearance = 'pill' | 'checkbox'

export const UiBooleanAppearanceContext = createContext<UiBooleanAppearance>('pill')
