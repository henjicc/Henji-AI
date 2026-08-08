import type { ApplicationStoreActionLedger } from '@/core/application-control'

import type { useThemeStore } from '@/stores/themeStore'

type State = ReturnType<typeof useThemeStore.getState>
type ActionName = {
  [K in keyof State]-?: State[K] extends (...args: never[]) => unknown ? K : never
}[keyof State]

/*
 * themeStore 是死代码：全仓库除它自己的定义外没有任何消费方（已用 grep 确认，界面的明暗/色调
 * 主题走 settingsStore 的 interface.theme_* 字段，早就注册进 settings.registry）。这里先如实
 * 登记为 excluded，不在建账任务里顺手删文件；是否删除交给专门的清理任务处理。
 */
const DEAD_CODE_REASON = 'themeStore 未被任何组件或服务引用，是死代码；界面真正的主题设置'
  + '（明暗、色调、强调色）由 settingsStore 承载，已通过 settings.registry 的 interface.theme_*'
  + ' 属性对助手开放。'

export const THEME_STORE_LEDGER: ApplicationStoreActionLedger<ActionName> = {
  storeId: 'themeStore',
  title: '主题（死代码）',
  entries: {
    setTheme: { kind: 'excluded', category: 'internal', reason: DEAD_CODE_REASON },
    toggleTheme: { kind: 'excluded', category: 'internal', reason: DEAD_CODE_REASON },
  },
}
