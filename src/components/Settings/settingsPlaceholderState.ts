/** 设置弹窗懒加载占位是否正在显示（已播过进入动画）。只读不清除：StrictMode 会重复调用初始化函数，由占位卸载时复位。 */
let placeholderShown = false
export function isSettingsPlaceholderShown(): boolean { return placeholderShown }
export function setSettingsPlaceholderShown(shown: boolean): void { placeholderShown = shown }
