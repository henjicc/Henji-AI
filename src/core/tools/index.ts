/**
 * 工具节点入口
 *
 * 自动导入和注册所有工具节点
 */

// 图片处理
export * from './image/CropImageNode'
export * from './image/ResizeImageNode'

// 文本处理
export * from './text/PromptTemplateNode'
export * from './text/ConcatTextNode'

// 逻辑控制
export * from './logic/ConditionalNode'

// 数据转换
export * from './data/ConvertTypeNode'

// 自动注册（在模块加载时）
import './image/CropImageNode'
import './image/ResizeImageNode'
import './text/PromptTemplateNode'
import './text/ConcatTextNode'
import './logic/ConditionalNode'
import './data/ConvertTypeNode'
