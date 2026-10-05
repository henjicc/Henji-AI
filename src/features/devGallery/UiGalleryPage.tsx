/**
 * 组件样张页（任务 5.11）：`@/components/ui` 的全部共享组件与关键状态（静息、悬停、聚焦、选中、禁用、错误、加载、空）
 * 一页铺开。只经开发导航参数 `--dev-surface=dev.ui_gallery` 进入，正式界面、助手与 MCP 都没有入口。
 *
 * 改公共组件或语义令牌后的默认验收：本页四个预设各截一张（1440）+ 石墨 960 一张，配合 `check:ui-visual`
 * 规则与像素对比度、`src/core/theme/themeCombination.test.ts` 主题组合测试（skill henji-ui-surface references/review.md）。
 * 悬停、聚焦用强制状态类展示（forcedPseudoStates），不依赖鼠标。
 */
import { useLayoutEffect } from 'react'

import { installForcedPseudoStates } from './forcedPseudoStates'
import {
  ButtonSection,
  ContentSection,
  DialogSection,
  FieldSection,
  FilterSection,
  FormSection,
  MediaSection,
  MenuSection,
  NavigationSection,
  OptionSection,
  StateSection,
  ToggleSection,
  ToolbarSection,
} from './gallerySections'

/** 四列手工分配，让 1440×900 一屏放下；窄窗口按两列换行。 */
const COLUMNS = [
  [ButtonSection, ToggleSection, FormSection],
  [FieldSection, MenuSection],
  [OptionSection, NavigationSection],
  [MediaSection, DialogSection, StateSection],
  [ToolbarSection, ContentSection, FilterSection],
] as const

export function UiGalleryPage(): JSX.Element {
  useLayoutEffect(() => installForcedPseudoStates(document), [])
  // pt-10 让出应用标题栏（与 TabContainer 一致）；overflow-clip：确认弹窗自动聚焦时不滚动祖先
  return (
    <div data-application-surface-id="dev.ui_gallery" className="flex min-h-0 flex-1 flex-col overflow-clip bg-window pt-10">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="grid grid-cols-2 gap-x-6 gap-y-5 px-5 py-4 xl:grid-cols-5">
          {COLUMNS.map((sections, index) => (
            <div key={index} className="flex min-w-0 flex-col gap-5">
              {sections.map((Section, sectionIndex) => <Section key={sectionIndex} />)}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
