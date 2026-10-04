/**
 * 零装饰布局容器。
 *
 * 存在理由：项目此前的容器词汇表里只有 `UiPanel`（自带 border + bg + shadow 的卡片），
 * 想"把几个字段归成一组"没有任何官方写法，只能手写 `border + bg` 的 div——
 * 这是过度卡片化的直接成因。本文件补齐"区域 / 分组 / 分隔"三层表达，
 * 全部**不画边框、不画背景、不画阴影**，只负责间距与排版层级。
 *
 * 五级容器词汇表（详见 skill `henji-ui-surface`）：
 *   Region   UiRegion              无装饰，页面主区
 *   Group    UiGroup               无装饰，标题 + 间距分组（默认选择）
 *   Divided  UiGroup divided       仅一条分隔线
 *   Surface  UiPanel variant=inset 仅更暗底色
 *   Card     UiPanel               唯一允许画完整卡片的一层（浮层/弹窗/侧栏/画布节点）
 */
import { useId, type HTMLAttributes, type ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import Tooltip from './Tooltip';
import { UiIconButton } from './primitives';
import {
  UI_DIVIDER_CLASS,
  UI_ROW_GAP_CLASS,
  UI_STACK_GAP_CLASS,
  UI_TEXT_META_CLASS,
  UI_TEXT_PANEL_TITLE_CLASS, UI_TEXT_SECTION_CLASS,
  UI_TEXT_TITLE_CLASS,
} from './styleTokens';

interface UiRegionProps extends HTMLAttributes<HTMLDivElement> {
  /** 内容最大宽度，默认不限制 */
  maxWidthClassName?: string;
}

interface UiGroupProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  /** 分区标题；不传则是纯间距分组 */
  title?: ReactNode;
  /**
   * 标题下方的常驻说明。**判据同 `UiFormRow.hint`：不看会不会用错整组？**
   * 多数分组解释"是什么/怎么用"应该走 `info`，这里只留给真正常驻必要的那一句。
   */
  description?: ReactNode;
  /** 背景知识型说明：标题文字本身在悬停/聚焦时显示（不加 ⓘ 图标）。设置类分组的默认选择。 */
  info?: ReactNode;
  /** 标题行右侧操作区 */
  actions?: ReactNode;
  /** 在本组上方加一条分隔线（唯一允许的"画线分隔"写法） */
  divided?: boolean;
  /** 子项纵向间距档位 */
  gap?: 'row' | 'stack' | 'none';
  /**
   * 标题排版档位（刻意做成枚举而非任意 className，避免变体无限扩散）：
   * - `section`（默认）：常规分区标题
   * - `overline`：全大写字距加宽的弱化组标签，适合设置类分组
   * - `compact`：窄停靠面板（剪辑效果控件等）里的分组标题，12/600 次要文字、标题与内容间距收紧
   *   （设计稿 VideoEdit 效果控件；界面重设计 3.5 按 1.3 记录评估：16/600 区块标题在窄面板里过重）
   */
  titleTone?: 'section' | 'overline' | 'compact';
}

interface UiPageHeaderProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  title: ReactNode;
  /** 紧跟标题、与标题基线对齐的辅助信息（如“12 个项目”），辅助文字色、不进标题的无障碍名称。 */
  meta?: ReactNode;
  description?: ReactNode;
  /** 右侧操作区 */
  actions?: ReactNode;
  /**
   * 二级页面的返回入口，渲染在标题左侧。
   *
   * 全应用返回入口只有三种形态，判据是页面本身长什么样，不是哪个文件画的：
   * 有页面标题的二级页面 → 这里；自带命令带的全屏工作面 → 那条带的左端；
   * 没有命令带的全屏工作面（画布）→ 浮在内容上的玻璃按钮。
   * 不要再为返回单开一条横向条带——那会和应用标题栏叠成「双标题栏」。
   */
  onBack?: () => void;
  /** 返回按钮的无障碍名称与悬浮提示，如「返回工具」 */
  backLabel?: string;
}

interface UiFormRowProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  label: ReactNode;
  /**
   * 常驻说明。**判据：不看它会不会选错？**
   *
   * 会——放这里（会自动迁移数据、有费用、不可逆、影响其他设置的行为）。
   * 不会，只是解释"它具体怎么工作"——放 `info`，别占常驻行高。
   * 标签已经自解释的（「界面语言」「触发边缘」），两个都不要给。
   */
  hint?: ReactNode;
  /** 背景知识型说明：标签文字本身在悬停或聚焦时显示（不加 ⓘ 图标） */
  info?: ReactNode;
  /** 横向排列（标签左、控件右），默认纵向 */
  inline?: boolean;
  /**
   * 标签档位：`default` 面板标题档 14/500；`compact` 给窄停靠面板（剪辑效果控件等），12 次要文字，
   * 低于同面板 `UiGroup titleTone="compact"` 的分组标题（界面重设计 3.5）。
   */
  density?: 'default' | 'compact';
  children: ReactNode;
}

interface UiToolbarProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * - `plain`（默认）：横向排布容器，无边框无背景。
   * - `command`：工具页骨架的**命令带**（skill `henji-ui-surface`「页面骨架：横向条带」A 类）：
   *   44 高、面板底、下边一条间隙色发丝线。一个视图只有一条；返回、标题/文件上下文、主工具组、
   *   导出/保存全部进这一条，内层功能组件不得再长自己的头带（用 props 注入）。
   */
  variant?: 'plain' | 'command';
  /** 左侧内容（command：返回、文件上下文、主工具组） */
  children?: ReactNode;
  /**
   * 仅 command：中间区，占据两端之间的剩余宽度并居中（视图切换、路径上下文、随工具变化的参数）。
   * 内容超宽时由内容自己横向滚动（给它 `min-w-0 max-w-full overflow-x-auto`）。
   */
  center?: ReactNode;
  /**
   * 仅 command：中间区让位策略。`fill`（默认）中间区先收窄（内容自己横向滚动，如图片编辑的工具参数）；
   * `fit` 中间区保持内容宽度（如分段视图切换），窄窗口时由左端的文件名先截断。
   */
  centerLayout?: 'fill' | 'fit';
  /** 右侧内容（command：次要动作 + 唯一主动作） */
  trailing?: ReactNode;
  /**
   * 仅 command：从属参数带（B 类）——只随当前工具变化的参数，紧贴命令带下方，
   * 与命令带共用同一块底色和同一条下边框，自身不画底色与边框。
   */
  subordinate?: ReactNode;
  /** 仅 command：命令带那一行的附加属性（如 `data-*` 状态），不用于改外观。 */
  barProps?: HTMLAttributes<HTMLDivElement> & Record<`data-${string}`, string | number | undefined>;
}

interface UiTooltipTextProps {
  /** 给用户看的说明（参数 `tooltip`、设置项 `info`）；为空时只渲染普通文字，不制造伪交互。 */
  tooltip?: ReactNode;
  children: ReactNode;
  className?: string;
}

/**
 * 名称文字本身作为说明的触发器（skill `henji-ui-surface`「参数说明的受众」）：
 * 有说明时文字可聚焦、悬停或聚焦显示 tooltip，用一道点状下划线提示“这里有说明”；
 * 不在名称旁加 ⓘ / 问号图标，也不把整个控件包进 Tooltip。没有说明时就是普通文字。
 */
export function UiTooltipText({ tooltip, children, className = '' }: UiTooltipTextProps): JSX.Element {
  const tooltipId = useId();
  if (!tooltip) return className ? <span className={className}>{children}</span> : <>{children}</>;
  return (
    <Tooltip content={tooltip} contentId={tooltipId} delay={200}>
      <span
        tabIndex={0}
        aria-describedby={tooltipId}
        className={`cursor-help rounded-sm underline decoration-line-strong decoration-dotted underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-accent-ring ${className}`}
      >
        {children}
      </span>
    </Tooltip>
  );
}

function resolveGapClass(gap: UiGroupProps['gap']): string {
  if (gap === 'stack') return UI_STACK_GAP_CLASS;
  if (gap === 'none') return '';
  return UI_ROW_GAP_CLASS;
}

/**
 * 页面级区域容器：只负责外边距与内容最大宽度，无任何视觉装饰。
 */
export function UiRegion({
  className = '',
  maxWidthClassName = '',
  children,
  ...props
}: UiRegionProps): JSX.Element {
  return (
    <div className={`w-full ${maxWidthClassName} ${className}`} {...props}>
      {children}
    </div>
  );
}

/**
 * 内容分组：**普通内容分组的默认选择**。
 * 靠标题 + 间距建立层级，不画边框背景。需要更强切分时传 `divided`。
 */
export function UiGroup({
  className = '',
  title,
  description,
  info,
  actions,
  divided = false,
  gap = 'row',
  titleTone = 'section',
  children,
  ...props
}: UiGroupProps): JSX.Element {
  const hasHeader = Boolean(title || description || actions);
  const titleClass = titleTone === 'overline'
    ? 'text-xs font-medium uppercase tracking-wider text-text2'
    : titleTone === 'compact'
      ? 'text-xs font-semibold text-text2'
      : UI_TEXT_SECTION_CLASS;

  return (
    <div
      className={`${divided ? `${UI_DIVIDER_CLASS} ${titleTone === 'compact' ? 'pt-2.5' : 'pt-4'}` : ''} ${className}`}
      {...props}
    >
      {hasHeader && (
        <div className={`${titleTone === 'compact' ? 'mb-1.5 min-h-7 items-center' : 'mb-3 items-start'} flex justify-between gap-3`}>
          <div className="min-w-0">
            {title ? (
              <div className={`flex items-center gap-1 ${titleClass}`}>
                <UiTooltipText tooltip={info}>{title}</UiTooltipText>
              </div>
            ) : null}
            {description ? (
              <p className={`mt-1 ${UI_TEXT_META_CLASS}`}>{description}</p>
            ) : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </div>
      )}
      <div className={resolveGapClass(gap)}>{children}</div>
    </div>
  );
}

/**
 * 页面/面板标题区：标题 + 说明 + 右侧操作，无装饰。
 */
export function UiPageHeader({
  className = '',
  title,
  meta,
  description,
  actions,
  onBack,
  backLabel,
  ...props
}: UiPageHeaderProps): JSX.Element {
  return (
    // 没有说明行时标题只有一行，与右侧 32 高的动作垂直居中；有说明时标题区两行，动作贴顶。
    <div data-ui-page-header className={`flex ${description ? 'items-start' : 'items-center'} gap-2 ${className}`} {...props}>
      {onBack ? (
        // -ml-1.5 让图标的视觉左边缘与标题文字对齐（按钮自带内边距）
        <UiIconButton
          className="-ml-1.5 shrink-0"
          title={backLabel}
          aria-label={backLabel}
          onClick={onBack}
        >
          <ArrowLeft size={16} />
        </UiIconButton>
      ) : null}
      <div className="min-w-0 flex-1">
        {meta ? (
          <div className="flex min-w-0 items-baseline gap-2.5">
            <h2 data-ui-page-title className={`min-w-0 truncate ${UI_TEXT_TITLE_CLASS}`}>{title}</h2>
            <span className="shrink-0 text-13 tabular-nums text-text3">{meta}</span>
          </div>
        ) : (
          <h2 data-ui-page-title className={UI_TEXT_TITLE_CLASS}>{title}</h2>
        )}
        {description ? <p className={`mt-1 ${UI_TEXT_META_CLASS}`}>{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/**
 * 表单行：**一行设置的唯一写法**。统一标签与控件的对齐、间距和文字层级。
 * 控件本身自带边框是合理的（可输入语义），但这一行不再套框，也不画分隔线——
 * 行与行之间只靠间距，线只出现在分区之间。
 *
 * 排列规则：开关 / 下拉 / 滑块这类"值很短"的控件走 `inline`（标签左、控件右）；
 * 输入框、路径、多行文本走默认的纵向。不要按"这块看着挤"临时改。
 */
export function UiFormRow({
  className = '',
  label,
  hint,
  info,
  inline = false,
  density = 'default',
  children,
  ...props
}: UiFormRowProps): JSX.Element {
  const labelNode = <UiTooltipText tooltip={info}>{label}</UiTooltipText>;
  const labelClass = density === 'compact' ? 'text-xs text-text2' : UI_TEXT_PANEL_TITLE_CLASS;

  if (inline) {
    return (
      <div className={`flex items-center justify-between gap-4 ${className}`} {...props}>
        <div className="min-w-0">
          <div className={labelClass}>{labelNode}</div>
          {hint ? <p className={`mt-0.5 ${UI_TEXT_META_CLASS}`}>{hint}</p> : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">{children}</div>
      </div>
    );
  }

  return (
    <div className={className} {...props}>
      <div className={labelClass}>{labelNode}</div>
      {hint ? <p className={`mt-0.5 mb-1.5 ${UI_TEXT_META_CLASS}`}>{hint}</p> : <div className={density === 'compact' ? 'h-1' : 'h-1.5'} />}
      {children}
    </div>
  );
}

interface UiDisclosurePanelProps {
  open: boolean;
  children: ReactNode;
  className?: string;
}

/**
 * 折叠内容的展开动画外壳：grid-rows 撑高 + 轻微位移，折叠态不 unmount 只是收到 0 高。
 * 用于"默认收起、点了才看"的次要/进阶内容（如高级参数、技术性验证详情），
 * 不要在每个调用点各写一遍这段 grid-rows 过渡。
 */
export function UiDisclosurePanel({ open, children, className = '' }: UiDisclosurePanelProps): JSX.Element {
  return (
    <div
      className={`grid transition-[grid-template-rows,opacity] duration-180 ease-out ${
        open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
      }`}
    >
      <div className="min-h-0 overflow-hidden">
        <div className={`transition-transform duration-180 ease-out ${open ? 'translate-y-0' : '-translate-y-2'} ${className}`}>
          {children}
        </div>
      </div>
    </div>
  );
}

/**
 * 工具栏。
 *
 * - 默认 `plain`：横向排布容器，无边框无背景；需要与内容区分隔时用一条线，不要包成卡片。
 * - `command`：工具页统一骨架的命令带（口播剪辑、图片编辑、3D 镜头参考共用，界面重设计 3.4）。
 *   左端 / 中间 / 右端三段 + 可选从属参数带；横向内边距与其下内容区对齐（10px）。
 */
export function UiToolbar({
  className = '',
  variant = 'plain',
  children,
  center,
  centerLayout = 'fill',
  trailing,
  subordinate,
  barProps,
  ...props
}: UiToolbarProps): JSX.Element {
  if (variant === 'command') {
    const { className: barClassName = '', ...barRest } = barProps ?? {};
    return (
      <header
        data-command-stack
        className={`shrink-0 border-b border-gap bg-panel ${className}`}
        {...props}
      >
        <div
          data-command-bar
          className={`flex h-11 min-w-0 items-center gap-1.5 px-2.5 ${barClassName}`}
          {...barRest}
        >
          <div data-command-bar-leading className="flex min-w-0 shrink items-center gap-1.5">{children}</div>
          <div data-command-bar-center className={`flex flex-1 items-center justify-center ${centerLayout === 'fit' ? 'min-w-fit' : 'min-w-0'}`}>{center}</div>
          {trailing ? <div data-command-bar-trailing className="flex shrink-0 items-center gap-1.5">{trailing}</div> : null}
        </div>
        {subordinate ? (
          <div data-command-subordinate className="flex min-h-10 min-w-0 items-center gap-3 px-2.5 pb-1.5">
            {subordinate}
          </div>
        ) : null}
      </header>
    );
  }
  return (
    <div className={`flex items-center justify-between gap-3 ${className}`} {...props}>
      <div className="flex min-w-0 items-center gap-2">{children}</div>
      {trailing ? <div className="flex shrink-0 items-center gap-2">{trailing}</div> : null}
    </div>
  );
}
