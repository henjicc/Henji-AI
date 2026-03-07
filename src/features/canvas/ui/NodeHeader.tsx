import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

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
  editable?: boolean;
  onTitleChange?: (value: string) => void;
};

export const NODE_HEADER_TONE_CLASS = 'text-white/55';
export const NODE_HEADER_TITLE_CLASS = 'text-[14px] font-normal';
export const NODE_HEADER_META_CLASS = 'text-xs text-text-muted';
export const NODE_HEADER_FLOATING_POSITION_CLASS = 'absolute -top-7 left-1 z-10';

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
  headerAdjust,
  iconAdjust,
  titleAdjust,
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
          <span className={joinClasses('cursor-grab select-none active:cursor-grabbing', NODE_HEADER_TITLE_CLASS, tone, titleClassName)}>
            {titleText}
          </span>
        );
      }
      return title;
    }

    if (isEditingTitle) {
      return (
        <input
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
            'nodrag nowheel h-6 min-w-[70px] rounded border border-[rgba(255,255,255,0.24)] bg-black/30 px-2 text-[13px] font-normal text-text-dark outline-none focus:border-accent/70',
            titleClassName
          )}
        />
      );
    }

    return (
      <button
        type="button"
        className={joinClasses(
          'inline-flex cursor-grab select-none items-center rounded px-0 text-left active:cursor-grabbing',
          NODE_HEADER_TITLE_CLASS,
          tone,
          titleClassName
        )}
        title={titleText}
        onClick={(event) => event.stopPropagation()}
        onDoubleClick={(event) => {
          event.stopPropagation();
          setIsEditingTitle(true);
        }}
      >
        {titleText}
      </button>
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
    <div className={joinClasses('flex items-start justify-between gap-2', className)}>
      <div className="min-w-0" style={composeTransformStyle(headerAdjust)}>
        <div className={joinClasses('flex items-center gap-1', titleRowClassName)}>
          {icon ? (
            <span
              className={joinClasses('inline-flex items-center justify-center', tone, iconClassName)}
              style={composeTransformStyle(iconAdjust)}
            >
              {icon}
            </span>
          ) : null}
          <div className="flex items-baseline gap-2" style={composeTransformStyle(titleAdjust)}>
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
      {rightSlot}
    </div>
  );
}
