import React from 'react'
import { GenerationLifecycleContext, useGenerationLifecycle } from './generationLifecycle'

/** 单一应用生命周期；工作区只订阅，切页不会卸载执行器。 */
export function GenerationLifecycleProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const value = useGenerationLifecycle()
  return <GenerationLifecycleContext.Provider value={value}>{children}</GenerationLifecycleContext.Provider>
}
