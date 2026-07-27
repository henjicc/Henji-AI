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
import type { HTMLAttributes, ReactNode } from 'react';
import {
  UI_DIVIDER_CLASS,
  UI_ROW_GAP_CLASS,
  UI_STACK_GAP_CLASS,
  UI_TEXT_META_CLASS,
  UI_TEXT_SECTION_CLASS,
  UI_TEXT_TITLE_CLASS,
} from './styleTokens';

interface UiRegionProps extends HTMLAttributes<HTMLDivElement> {
  /** 内容最大宽度，默认不限制 */
  maxWidthClassName?: string;
}

interface UiGroupProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  /** 分区标题；不传则是纯间距分组 */
  title?: ReactNode;
  /** 标题下方的辅助说明 */
  description?: ReactNode;
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
   */
  titleTone?: 'section' | 'overline';
}

interface UiPageHeaderProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  title: ReactNode;
  description?: ReactNode;
  /** 右侧操作区 */
  actions?: ReactNode;
}

interface UiFormRowProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  label: ReactNode;
  /** 标签下方/右侧的辅助说明 */
  hint?: ReactNode;
  /** 横向排列（标签左、控件右），默认纵向 */
  inline?: boolean;
  children: ReactNode;
}

interface UiToolbarProps extends HTMLAttributes<HTMLDivElement> {
  /** 左侧内容 */
  children?: ReactNode;
  /** 右侧内容 */
  trailing?: ReactNode;
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
  actions,
  divided = false,
  gap = 'row',
  titleTone = 'section',
  children,
  ...props
}: UiGroupProps): JSX.Element {
  const hasHeader = Boolean(title || description || actions);
  const titleClass = titleTone === 'overline'
    ? 'text-xs font-medium uppercase tracking-wider text-text-muted'
    : UI_TEXT_SECTION_CLASS;

  return (
    <div
      className={`${divided ? `${UI_DIVIDER_CLASS} pt-4` : ''} ${className}`}
      {...props}
    >
      {hasHeader && (
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            {title ? <div className={titleClass}>{title}</div> : null}
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
  description,
  actions,
  ...props
}: UiPageHeaderProps): JSX.Element {
  return (
    <div data-ui-page-header className={`flex items-start justify-between gap-4 ${className}`} {...props}>
      <div className="min-w-0">
        <h2 data-ui-page-title className={UI_TEXT_TITLE_CLASS}>{title}</h2>
        {description ? <p className={`mt-1 ${UI_TEXT_META_CLASS}`}>{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/**
 * 表单行：统一标签与控件的对齐、间距和文字层级。
 * 控件本身自带边框是合理的（可输入语义），但这一行不再套框。
 */
export function UiFormRow({
  className = '',
  label,
  hint,
  inline = false,
  children,
  ...props
}: UiFormRowProps): JSX.Element {
  if (inline) {
    return (
      <div className={`flex items-center justify-between gap-4 ${className}`} {...props}>
        <div className="min-w-0">
          <div className={UI_TEXT_SECTION_CLASS}>{label}</div>
          {hint ? <p className={`mt-0.5 ${UI_TEXT_META_CLASS}`}>{hint}</p> : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">{children}</div>
      </div>
    );
  }

  return (
    <div className={className} {...props}>
      <div className={UI_TEXT_SECTION_CLASS}>{label}</div>
      {hint ? <p className={`mt-0.5 mb-1.5 ${UI_TEXT_META_CLASS}`}>{hint}</p> : <div className="h-1.5" />}
      {children}
    </div>
  );
}

/**
 * 工具栏：横向排布容器，无边框无背景。
 * 需要与内容区分隔时用 `divided` 一条线，不要包成卡片。
 */
export function UiToolbar({
  className = '',
  children,
  trailing,
  ...props
}: UiToolbarProps): JSX.Element {
  return (
    <div className={`flex items-center justify-between gap-3 ${className}`} {...props}>
      <div className="flex min-w-0 items-center gap-2">{children}</div>
      {trailing ? <div className="flex shrink-0 items-center gap-2">{trailing}</div> : null}
    </div>
  );
}
