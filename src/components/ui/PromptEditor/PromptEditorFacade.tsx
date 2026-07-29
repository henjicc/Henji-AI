import {
  forwardRef,
  lazy,
  Suspense,
  useImperativeHandle,
  useRef,
} from 'react'

import { PromptDocumentStatic } from './PromptDocumentStatic'
import {
  getPromptEditorLayoutClasses,
  getPromptEditorShellStateClass,
  PROMPT_EDITOR_SHELL_CLASS,
} from './promptEditorStyles'
import type { PromptEditorHandle, PromptEditorProps } from './types'

const LazyEditablePromptEditor = lazy(async () => {
  const module = await import('./PromptEditor')
  return { default: module.PromptEditor }
})

const StaticPromptEditor = forwardRef<PromptEditorHandle, PromptEditorProps>(
  function StaticPromptEditor({
    value,
    onChange,
    ariaLabel,
    placeholder,
    disabled = false,
    error = false,
    layout = 'auto',
    className = '',
    editorShellClassName = '',
    editorClassName = '',
    onActivate,
    references,
    variables,
    resolveReference,
    resolveVariable,
  }, ref): JSX.Element {
    const contentRef = useRef<HTMLDivElement | null>(null)
    const layoutClasses = getPromptEditorLayoutClasses(layout)

    useImperativeHandle(ref, () => ({
      focus: (): void => onActivate?.(),
      focusAtPoint: (point): void => onActivate?.(point),
      getScrollTop: (): number => contentRef.current?.scrollTop ?? 0,
      setScrollTop: (scrollTop): void => {
        if (contentRef.current) contentRef.current.scrollTop = scrollTop
      },
      getDocument: () => value,
      replaceDocument: (document): void => onChange(document),
    }), [onActivate, onChange, value])

    return (
      <div className={`${layoutClasses.outer} ${className}`}>
        <div
          className={`${PROMPT_EDITOR_SHELL_CLASS} ${getPromptEditorShellStateClass(error)} ${layoutClasses.shell} ${editorShellClassName} ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
        >
          <PromptDocumentStatic
            ref={contentRef}
            document={value}
            ariaLabel={ariaLabel}
            placeholder={placeholder}
            disabled={disabled}
            className={`${layoutClasses.content} ${editorClassName}`}
            onActivate={onActivate}
            references={references}
            variables={variables}
            resolveReference={resolveReference}
            resolveVariable={resolveVariable}
          />
        </div>
      </div>
    )
  },
)

StaticPromptEditor.displayName = 'StaticPromptEditor'

export const PromptEditor = forwardRef<PromptEditorHandle, PromptEditorProps>(
  function PromptEditor(props, ref): JSX.Element {
    if (props.mode === 'static') {
      return <StaticPromptEditor ref={ref} {...props} />
    }

    return (
      <Suspense
        fallback={<StaticPromptEditor {...props} />}
      >
        <LazyEditablePromptEditor ref={ref} {...props} />
      </Suspense>
    )
  },
)

PromptEditor.displayName = 'PromptEditor'
