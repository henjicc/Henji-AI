import { createContext } from 'react'

/** 生成参数浮层共享行语法；底栏和媒体上传仍保留各自布局。 */
export const ParamPanelRowsContext = createContext(false)

/**
 * 参数行里的选项直接摊开（生成页左侧输入面板）：短选项是分段，多一些的是一排小格，
 * 太多或太长才退回下拉。上下空间够时点一下就选，不用先打开浮层。
 */
export const ParamChoicesExpandedContext = createContext(false)
