import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  UI_GLASS_ADAPTIVE_DIVIDER_CLASS,
  UI_GLASS_ADAPTIVE_REGION_CLASS,
  UI_GLASS_ADAPTIVE_SURFACE_CLASS,
  UI_TEXT_TITLE_CLASS,
  UiIconButton,
  UiModal,
  UiNavButton,
} from '@/components/ui'
import { UI_DIALOG_TRANSITION_MS } from '@/components/ui/motion'
import { KeyRound, LayoutGrid, Settings2, SlidersHorizontal, X } from 'lucide-react'
import GeneralTab from './tabs/GeneralTab'
import ApiKeysTab from './tabs/ApiKeysTab'
import InterfaceTab from './tabs/InterfaceTab'
import ModelsTab from './tabs/ModelsTab'
import { useSettingsScrollSpy } from './hooks/useSettingsScrollSpy'
import { useI18n } from '@/hooks/useI18n'
import { resolveSettingsSurfaceId } from '@/features/navigation/application/surfaceCatalog'
import type { SettingsNavigationTarget, SettingsTabId } from '@/core/types/settingsNavigation'

interface SettingsModalProps {
  onClose: () => void
  /** 由 uiStore 传入的定位目标（如错误弹窗「去设置」直达平台密钥）；省略则用默认分节 */
  target?: SettingsNavigationTarget | null
}

type SettingsTab = SettingsTabId

/*
 * 静态导航结构，提到模块作用域后初始 state 可以直接查表定位到目标分节。
 * 只存 id：标题文案统一由 `navSections.<id>` 提供，目录和内容区标题共用同一个 key，
 * 不会再出现两边对不上、或者内容区根本没有标题的情况。
 */
const SECTION_MAP: Record<SettingsTab, string[]> = {
  general: ['general-basic', 'general-storage', 'general-behavior', 'general-maintenance'],
  api: ['api-keys', 'api-upload', 'api-llm', 'api-agent-preferences'],
  interface: ['interface-layout', 'interface-assets', 'interface-canvas', 'interface-theme'],
  models: ['models-visibility']
}

/** 切换大类后，异步加载的分区（密钥状态、LLM 配置）会改变上方高度，需要补一次定位 */
const DEEP_LINK_RESCROLL_MS = 320

const SettingsModal: React.FC<SettingsModalProps> = ({ onClose, target }) => {
  const { t } = useI18n('settings')
  const initialTab: SettingsTab = target?.tab ?? 'general'
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab)
  const [activeSectionId, setActiveSectionId] = useState<string>(
    target?.sectionId ?? SECTION_MAP[initialTab][0] ?? ''
  )
  const [closing, setClosing] = useState(false)
  const contentRef = useRef<HTMLDivElement | null>(null)
  // 切大类时要跳到的分节。跨大类点击目录时目标分节还没挂载，只能等这一帧渲染完再滚。
  const pendingScrollRef = useRef<string | null>(target?.sectionId ?? null)
  // 每次目录导航自增。延迟补位的定位只有在"期间没有更新的导航"时才允许生效，
  // 否则用户刚点的目标会被上一次跳转的补位动作拽回去。
  const navTokenRef = useRef(0)

  // 关闭分两步：先让 UiModal 播完淡出，再由 App 卸载本组件。
  // 等待时长必须跟着 UiModal 的过渡走，此前写死 300ms 比实际过渡长 120ms，
  // 那段时间里弹窗已经全透明却还占着 DOM。
  const handleClose = () => {
    setClosing(true)
    setTimeout(onClose, UI_DIALOG_TRANSITION_MS)
  }

  const tabs = [
    { id: 'general' as const, label: t('tabs.general.label'), icon: Settings2, component: GeneralTab },
    { id: 'api' as const, label: t('tabs.api.label'), icon: KeyRound, component: ApiKeysTab },
    { id: 'interface' as const, label: t('tabs.interface.label'), icon: LayoutGrid, component: InterfaceTab },
    { id: 'models' as const, label: t('tabs.models.label'), icon: SlidersHorizontal, component: ModelsTab }
  ]

  const ActiveTabComponent = tabs.find(tab => tab.id === activeTab)?.component
  // 分区与 Surface 的对应关系只在 surfaceCatalog 维护，这里不再复制一份映射表，
  // 否则新增设置分区会通过能力门禁却观察到错误的 Surface。
  const activeSurfaceId = resolveSettingsSurfaceId(activeTab, activeSectionId) ?? undefined

  const { scrollToSection, tailSpacerHeight } = useSettingsScrollSpy({
    containerRef: contentRef,
    sectionIds: SECTION_MAP[activeTab],
    onActiveSectionChange: setActiveSectionId,
  })

  // 切换大类后归位：有跨大类跳转目标就滚到目标，否则回到顶部。
  //
  // 这里刻意**不用 requestAnimationFrame 推迟**：新大类的 DOM 在本 effect 运行时已经提交，
  // 同步就能量到位置。推迟一帧会和「用户紧接着点了同大类的另一个分节」撞车——
  // 那次点击已经开始平滑滚动，随后补上的 scrollTop = 0 会把它拽回顶部（实测复现过）。
  useEffect(() => {
    const token = (navTokenRef.current += 1)
    const pending = pendingScrollRef.current
    pendingScrollRef.current = null
    const container = contentRef.current
    if (!container) return
    if (!pending) {
      container.scrollTop = 0
      return
    }
    scrollToSection(pending, 'auto')
    // 密钥状态、LLM 配置这类分区是异步加载的，落位后上方高度会变，补一次定位
    const timer = window.setTimeout(() => {
      if (navTokenRef.current === token) {
        scrollToSection(pending, 'auto')
      }
    }, DEEP_LINK_RESCROLL_MS)
    return () => window.clearTimeout(timer)
  }, [activeTab, scrollToSection])

  const handleSectionSelect = useCallback(
    (tabId: SettingsTab, sectionId: string): void => {
      navTokenRef.current += 1
      setActiveSectionId(sectionId)
      if (tabId === activeTab) {
        scrollToSection(sectionId)
        return
      }
      pendingScrollRef.current = sectionId
      setActiveTab(tabId)
    },
    [activeTab, scrollToSection]
  )

  return (
    <UiModal
      isOpen={!closing}
      title={t('title')}
      onClose={handleClose}
      hideHeader
      // 设置弹窗铺满 90vw，背后压着的是画布/生成结果这类用户内容而不是纯色 UI，
      // 所以整块走玻璃；内部区域、目录与中性控件由 UI_GLASS_ADAPTIVE_* 跟随开关退化。
      surface="glass"
      // 只给内边距，不要在这里再铺一层底色：UiModal 内部已经有一层会做淡入淡出的
      // 遮罩，外层再叠 bg-black/70 会（1）把背景压到近 86% 黑，(2) 因为外层没有过渡，
      // 打开时先闪一帧纯黑、关闭时黑幕又突然消失。
      overlayClassName="p-4"
      widthClassName="flex w-[min(90vw,1200px)] overflow-hidden"
      contentClassName="flex min-h-0 flex-1"
    >
      {/* relative：让内容压在 .ui-glass::after 的噪点层同一层，避免文字被颗粒扰动 */}
      <div
        data-application-surface-id={activeSurfaceId}
        className={`relative flex w-full flex-col ${UI_GLASS_ADAPTIVE_REGION_CLASS}`}
        style={{ height: 'calc(76vh - 72px)', minHeight: '440px', maxHeight: '868px' }}
      >
        <div className={`flex h-14 shrink-0 items-center justify-between border-b px-4 ${UI_GLASS_ADAPTIVE_DIVIDER_CLASS}`}>
          <h2 className={UI_TEXT_TITLE_CLASS}>{t('title')}</h2>
          <UiIconButton
            onClick={handleClose}
            aria-label={t('actions.close')}
            showBorder={false}
            appearance="hover-only"
            className="!h-9 !w-9 rounded-lg text-text-soft hover:text-white"
          >
            <X className="h-5 w-5" />
          </UiIconButton>
        </div>

        <div className="flex min-h-0 flex-1">
          {/*
            常驻目录：所有大类的分节一直展开，不再「先点大类才看得到子项」。
            它只负责定位，不再决定右侧渲染什么——右侧是当前大类的一整页内容。
          */}
          <nav
            aria-label={t('title')}
            className={`ui-scrollbar w-52 shrink-0 overflow-y-auto border-r p-2 ${UI_GLASS_ADAPTIVE_DIVIDER_CLASS} ${UI_GLASS_ADAPTIVE_SURFACE_CLASS}`}
          >
            <div className="space-y-1">
              {tabs.map(tab => {
                const sections = SECTION_MAP[tab.id]
                const isCurrentTab = activeTab === tab.id
                // 只有一个分节的大类，大类本身就是叶子：再画一条只有一项的子列表是纯噪音
                const isLeafGroup = sections.length <= 1
                const firstSectionId = sections[0] ?? ''
                return (
                  <div key={tab.id}>
                    <UiNavButton
                      active={isLeafGroup && isCurrentTab}
                      onClick={() => handleSectionSelect(tab.id, firstSectionId)}
                      className={`!h-10 !rounded-lg !px-3 ${!isLeafGroup && isCurrentTab ? '!text-text-dark' : ''}`}
                    >
                      <tab.icon className="h-[18px] w-[18px] shrink-0" />
                      <span className="ml-2 text-left text-sm font-medium leading-none">{tab.label}</span>
                    </UiNavButton>
                    {isLeafGroup ? null : (
                      <div className="space-y-1 py-1">
                        {sections.map(sectionId => (
                          <UiNavButton
                            key={sectionId}
                            active={isCurrentTab && activeSectionId === sectionId}
                            onClick={() => handleSectionSelect(tab.id, sectionId)}
                            className="!h-9 !rounded-lg !pl-11 !pr-3 text-sm"
                          >
                            {t(`navSections.${sectionId}`)}
                          </UiNavButton>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </nav>

          <div ref={contentRef} className="settings-scroll-body min-w-0 flex-1 overflow-y-auto">
            {ActiveTabComponent && <ActiveTabComponent />}
            {/* 没有这段占位，最后一个分节永远滚不到顶，点目录最后一项会像「没反应」 */}
            <div aria-hidden style={{ height: tailSpacerHeight }} />
          </div>
        </div>
      </div>
    </UiModal>
  )
}

export default SettingsModal
