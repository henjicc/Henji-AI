import {
  forwardRef,
  lazy,
  Suspense,
  useImperativeHandle,
} from 'react'

import { PromptDocumentStatic } from './PromptDocumentStatic'
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
    className,
    onActivate,
  }, ref): JSX.Element {
    useImperativeHandle(ref, () => ({
      focus: (): void => onActivate?.(),
      getDocument: () => value,
      replaceDocument: (document): void => onChange(document),
    }), [onActivate, onChange, value])

    return (
      <PromptDocumentStatic
        document={value}
        ariaLabel={ariaLabel}
        placeholder={placeholder}
        disabled={disabled}
        className={className}
        onActivate={onActivate}
      />
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
        fallback={(
          <PromptDocumentStatic
            document={props.value}
            ariaLabel={props.ariaLabel}
            placeholder={props.placeholder}
            disabled={props.disabled}
            className={props.className}
          />
        )}
      >
        <LazyEditablePromptEditor ref={ref} {...props} />
      </Suspense>
    )
  },
)

PromptEditor.displayName = 'PromptEditor'
