import React from 'react'
import {
  UI_FORM_ROW_GAP_CLASS,
  UI_GLASS_ADAPTIVE_DIVIDER_CLASS,
  UI_TEXT_TITLE_CLASS,
} from '@/components/ui'
import { useI18n } from '@/hooks/useI18n'
import { SETTINGS_SECTION_ATTR } from '../hooks/useSettingsScrollSpy'

interface SettingsSectionProps {
  /** 与左侧目录的分节 id 一致，滚动定位、高亮和标题文案都靠它 */
  id: string
  /** 分节说明，只在整节都需要一句话前提时给（如密钥的存储方式） */
  description?: React.ReactNode
  children: React.ReactNode
}

/**
 * 设置弹窗里的一个分节。**它是内容区唯一的分组层级。**
 *
 * 两个设计决定：
 *
 * 1. **标题必须渲染出来。** 目录里写着「基础设置」，内容区以前从来不出现这四个字——
 *    一次只渲染一个分节时还能忍，改成单页滚动后滚到一半就完全读不出自己在哪一节。
 *    标题文案和目录共用 `navSections` 的同一个 key，不会再出现两边对不上的情况。
 *
 * 2. **分隔线只画在这一层。** 行与行之间、小分类之间一律不画线，只用间距。
 *    这样"线的位置"和"目录条目"一一对应，滚动时那条线就是「进入下一个目录条目」的信号。
 *    以前 8 处 `border-t` 散在 5 个分区文件里、切的位置各凭手感，就是割裂感的来源。
 */
const SettingsSection: React.FC<SettingsSectionProps> = ({ id, description, children }) => {
  const { t } = useI18n('settings')

  return (
    <section
      id={id}
      {...{ [SETTINGS_SECTION_ATTR]: id }}
      /*
       * 第一节不画线：它上面就是内容区顶部，画线等于给页面加了一条无意义的横杠。
       *
       * 颜色只由 `ui-glass-adaptive-divider` 给，**不能再叠 `UI_DIVIDER_CLASS`**——
       * 那个类带的 `border-border-dark/60` 是 utilities 层，会盖掉自适应规则，
       * 深色线压在半透明玻璃上几乎看不见（实测截图里这条线是完全隐形的）。
       *
       * `mt-10` 与 `pt-10` 必须成对出现。`border-t` 画在 section 盒子的上沿，
       * 只写 `pt-10` 时线的**上方没有任何留白**——上一节最后一个控件的下边框
       * 直接贴着这条线，读起来像给那个控件加了第二条底边，而不是两节之间的分界。
       * 分隔线属于两节之间的空白，两侧留白必须相等，它才落在中间。
       */
      className={`mt-10 border-t ${UI_GLASS_ADAPTIVE_DIVIDER_CLASS} pt-10 first:mt-0 first:border-t-0 first:pt-0`}
    >
      <h3 className={UI_TEXT_TITLE_CLASS}>{t(`navSections.${id}`)}</h3>
      {description ? <p className="mt-1 text-xs text-text-muted">{description}</p> : null}
      <div className={`mt-5 ${UI_FORM_ROW_GAP_CLASS}`}>{children}</div>
    </section>
  )
}

export default SettingsSection
