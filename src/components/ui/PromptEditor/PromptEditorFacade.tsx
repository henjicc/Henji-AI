import {
  forwardRef,
  lazy,
  Suspense,
  useImperativeHandle,
} from 'react'

import { PromptDocumentStatic } from './PromptDocumentStatic'
import {
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
    className = '',
    editorShellClassName = '',
    editorClassName = '',
    onActivate,
    references,
    variables,
    resolveReference,
    resolveVariable,
  }, ref): JSX.Element {
    useImperativeHandle(ref, () => ({
      focus: (): void => onActivate?.(),
      focusAtPoint: (point): void => onActivate?.(point),
      getDocument: () => value,
      replaceDocument: (document): void => onChange(document),
    }), [onActivate, onChange, value])

    return (
      <div className={className}>
        <div
          className={`${PROMPT_EDITOR_SHELL_CLASS} ${getPromptEditorShellStateClass(error)} ${editorShellClassName} ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
        >
          <PromptDocumentStatic
            document={value}
            ariaLabel={ariaLabel}
            placeholder={placeholder}
            disabled={disabled}
            className={editorClassName}
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
