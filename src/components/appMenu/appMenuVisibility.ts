import { createContext, useContext } from 'react'

/** 保持挂载的工作区隐藏时撤回菜单；弹窗通过 React 上下文继承所属工作区。 */
export const AppMenuVisibilityContext = createContext(true)
export function useAppMenuVisibility(): boolean { return useContext(AppMenuVisibilityContext) }
