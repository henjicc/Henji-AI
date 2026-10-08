/**
 * `shaders` 组件在界面上的中文名称、悬停说明、参数名与选项名（数据在 zh.json，生成助手参考时脚本也读它）。
 * 只服务界面；助手读的语义说明保留框架原文（`components.generated.json` 的 description）。
 * 缺的条目界面回落为原文，升级框架后按需补齐。
 */
import data from './zh.json'

export const SHADER_COMPONENT_ZH = data.components as unknown as Readonly<Record<string, readonly [name: string, tooltip: string]>>
export const SHADER_LABEL_ZH: Readonly<Record<string, string>> = data.labels
export const SHADER_OPTION_ZH: Readonly<Record<string, string>> = data.options
