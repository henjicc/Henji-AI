import { createContext } from 'react'

/** 命令带组合处决定宿主主动作是否让位；默认保持调用方声明的层级。 */
export const UiPrimaryActionContext = createContext(true)
