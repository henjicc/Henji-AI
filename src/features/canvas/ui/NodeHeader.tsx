import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { UI_FIELD_FOCUS_CLASS, UI_FIELD_SURFACE_CLASS, UiButton, UiInput } from '@/components/ui';

type HeaderAdjust = {
  x?: number;
  y?: number;
  scale?: number;
};

type NodeHeaderProps = {
  icon?: ReactNode;
  titleText?: string;
  metaText?: string;
  title?: ReactNode;
  meta?: ReactNode;
  subtitle?: ReactNode;
  rightSlot?: ReactNode;
  className?: string;
  iconClassName?: string;
  toneClassName?: string;
  titleClassName?: string;
  metaClassName?: string;
  titleRowClassName?: string;
  subtitleClassName?: string;
  headerAdjust?: HeaderAdjust;
  iconAdjust?: HeaderAdjust;
  titleAdjust?: HeaderAdjust;
  rightSlotAdjust?: HeaderAdjust;
  editable?: boolean;
  onTitleChange?: (value: string) => void;
};

// 统一控制点：所有节点的"图标+名称"整体相对于节点的位置微调。
// 只改这一处数值即可同时影响全部节点；x/y 单位为 px，scale 为缩放比例。
export const NODE_HEADER_ICON_TITLE_ADJUST: HeaderAdjust = { x: -8, y: 8, scale: 1 };
// 统一控制点：所有节点右上角价格徽标（PriceEstimate）相对于节点的位置微调。
// 只改这一处数值即可同时影响全部节点；x/y 单位为 px，scale 为缩放比例。
export const NODE_HEADER_PRICE_ADJUST: HeaderAdjust = { x: -8, y: 0, scale: 1 };

export const NODE_HEADER_TONE_CLASS = 'text-white/55';
export const NODE_HEADER_TITLE_CLASS = 'text-[14px] font-normal';
export const NODE_HEADER_META_CLASS = 'text-xs text-text-muted';
export const NODE_HEADER_FLOATING_POSITION_CLASS = 'absolute -top-8 left-2 right-2 z-20';
// 标题不再用 max-w-[60%] 限宽：百分比宽度作用在"宽度由内容撑出"的祖先链上时
// 解析不稳定（浏览器常把它解析成一个很小的值），改用逐层 min-w-0 + flex-1 的
// flex 分配方式，宽度始终由实际可用空间精确推算，不依赖任何百分比。
const NODE_HEADER_TITLE_FLEX_CLASS = 'min-w-0 flex-1';
// 纯透明度遮罩，颜色值无意义，使用关键字避免颜色字面量
const NODE_HEADER_TITLE_FADE_STYLE: CSSProperties = {
  WebkitMaskImage: 'linear-gradient(to right, black 0%, black 82%, transparent 100%)',
  maskImage: 'linear-gradient(to right, black 0%, black 82%, transparent 100%)',
};

function composeTransformStyle(adjust?: HeaderAdjust): CSSProperties | undefined {
  if (!adjust) {
    return undefined;
  }

  const x = adjust.x ?? 0;
  const y = adjust.y ?? 0;
  const scale = adjust.scale ?? 1;

  if (x === 0 && y === 0 && scale === 1) {
    return undefined;
  }

  return {
    transform: `translate(${x}px, ${y}px) scale(${scale})`,
    transformOrigin: 'center',
  };
}

function joinClasses(...classes: Array<string | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

function sanitizeTitle(value: string | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function NodeHeader({
  icon,
  titleText,
  metaText,
  title,
  meta,
  subtitle,
  rightSlot,
  className,
  iconClassName,
  toneClassName,
  titleClassName,
  metaClassName,
  titleRowClassName,
  subtitleClassName,
  headerAdjust = NODE_HEADER_ICON_TITLE_ADJUST,
  iconAdjust,
  titleAdjust,
  rightSlotAdjust = NODE_HEADER_PRICE_ADJUST,
  editable = false,
  onTitleChange,
}: NodeHeaderProps) {
  const tone = toneClassName ?? NODE_HEADER_TONE_CLASS;
  const canEditTitle = editable && typeof titleText === 'string' && typeof onTitleChange === 'function';
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [draftTitle, setDraftTitle] = useState(() => sanitizeTitle(titleText));

  useEffect(() => {
    if (isEditingTitle) {
      return;
    }
    setDraftTitle(sanitizeTitle(titleText));
  }, [isEditingTitle, titleText]);

  useEffect(() => {
    if (!isEditingTitle) {
      return;
    }
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [isEditingTitle]);

  const commitTitle = useCallback(() => {
    if (!canEditTitle || !onTitleChange) {
      setIsEditingTitle(false);
      return;
    }

    const fallbackTitle = sanitizeTitle(titleText);
    const nextTitle = sanitizeTitle(draftTitle) || fallbackTitle;

    if (nextTitle && nextTitle !== fallbackTitle) {
      onTitleChange(nextTitle);
    }

    setDraftTitle(nextTitle || fallbackTitle);
    setIsEditingTitle(false);
  }, [canEditTitle, draftTitle, onTitleChange, titleText]);

  const cancelTitleEdit = useCallback(() => {
    setDraftTitle(sanitizeTitle(titleText));
    setIsEditingTitle(false);
  }, [titleText]);

  const resolvedTitle = useMemo(() => {
    if (!canEditTitle) {
      if (titleText) {
        return (
          <span
            title={titleText}
            className={joinClasses(
              'block overflow-hidden whitespace-nowrap cursor-grab select-none active:cursor-grabbing',
              NODE_HEADER_TITLE_FLEX_CLASS,
              NODE_HEADER_TITLE_CLASS,
              tone,
              titleClassName
            )}
            style={NODE_HEADER_TITLE_FADE_STYLE}
          >
            {titleText}
          </span>
        );
      }
      return title;
    }

    if (isEditingTitle) {
      return (
        <UiInput
          ref={inputRef}
          value={draftTitle}
          onChange={(event) => setDraftTitle(event.target.value)}
          onBlur={commitTitle}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              commitTitle();
              return;
            }
            if (event.key === 'Escape') {
              event.preventDefault();
              cancelTitleEdit();
            }
          }}
          className={joinClasses(
            `nodrag nowheel h-6 min-w-[70px] w-full max-w-full rounded border px-2 text-[13px] font-normal ${UI_FIELD_SURFACE_CLASS} ${UI_FIELD_FOCUS_CLASS}`,
            titleClassName
          )}
        />
      );
    }

    return (
      <UiButton
        type="button"
        variant="ghost"
        size="sm"
        className={joinClasses(
          '!h-auto !min-h-0 !rounded-none !border-0 !bg-transparent !px-0 !py-0 hover:!bg-transparent',
          '!justify-start overflow-hidden whitespace-nowrap cursor-grab select-none text-left active:cursor-grabbing',
          NODE_HEADER_TITLE_FLEX_CLASS,
          NODE_HEADER_TITLE_CLASS,
          tone,
          titleClassName
        )}
        style={NODE_HEADER_TITLE_FADE_STYLE}
        title={titleText}
        onClick={(event) => event.stopPropagation()}
        onDoubleClick={(event) => {
          event.stopPropagation();
          setIsEditingTitle(true);
        }}
      >
        {titleText}
      </UiButton>
    );
  }, [
    canEditTitle,
    cancelTitleEdit,
    commitTitle,
    draftTitle,
    isEditingTitle,
    title,
    titleClassName,
    titleText,
    tone,
  ]);

  const resolvedMeta = metaText
    ? <span className={joinClasses(NODE_HEADER_META_CLASS, metaClassName)}>{metaText}</span>
    : meta;

  return (
    <div className={joinClasses('flex w-full max-w-full items-start justify-between gap-2', className)}>
      <div className="min-w-0 flex-1" style={composeTransformStyle(headerAdjust)}>
        <div className={joinClasses('flex w-full items-center gap-1', titleRowClassName)}>
          {icon ? (
            <span
              className={joinClasses('inline-flex shrink-0 items-center justify-center', tone, iconClassName)}
              style={composeTransformStyle(iconAdjust)}
            >
              {icon}
            </span>
          ) : null}
          <div className="flex min-w-0 flex-1 items-baseline gap-2" style={composeTransformStyle(titleAdjust)}>
            {resolvedTitle}
            {resolvedMeta}
          </div>
        </div>
        {subtitle ? (
          <div className={joinClasses('text-[11px] text-text-muted/80', subtitleClassName)}>
            {subtitle}
          </div>
        ) : null}
      </div>
      {rightSlot ? (
        <div className="shrink-0" style={composeTransformStyle(rightSlotAdjust)}>
          {rightSlot}
        </div>
      ) : null}
    </div>
  );
}
