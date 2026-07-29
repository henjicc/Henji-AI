import type { PromptEditorLayout } from './types'

export const PROMPT_EDITOR_CONTENT_CLASS = [
  'whitespace-pre-wrap break-words px-3 py-2.5 text-sm leading-6 text-text-dark outline-none',
  '[&_.is-editor-empty:first-child::before]:pointer-events-none',
  '[&_.is-editor-empty:first-child::before]:float-left',
  '[&_.is-editor-empty:first-child::before]:h-0',
  '[&_.is-editor-empty:first-child::before]:text-text-muted',
  '[&_.is-editor-empty:first-child::before]:content-[attr(data-placeholder)]',
].join(' ')

export const PROMPT_EDITOR_SHELL_CLASS =
  'rounded-lg border bg-surface-dark transition-shadow'

interface PromptEditorLayoutClasses {
  outer: string
  shell: string
  content: string
}

const PROMPT_EDITOR_LAYOUT_CLASSES: Record<PromptEditorLayout, PromptEditorLayoutClasses> = {
  auto: {
    outer: '',
    shell: '',
    content: 'min-h-[92px]',
  },
  'fill-scroll': {
    outer: 'flex min-h-0 min-w-0 flex-1 flex-col',
    shell: 'flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden',
    content: 'min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain',
  },
}

export function getPromptEditorLayoutClasses(
  layout: PromptEditorLayout,
): PromptEditorLayoutClasses {
  return PROMPT_EDITOR_LAYOUT_CLASSES[layout]
}

export const PROMPT_ATOM_CLASS =
  'mx-0.5 inline-flex h-[1lh] max-w-[180px] box-border select-none items-center whitespace-nowrap rounded-md border px-1.5 align-middle text-[length:inherit] leading-[inherit]'

export const PROMPT_MEDIA_ATOM_CLASS = `${PROMPT_ATOM_CLASS} gap-1`

export function getPromptEditorShellStateClass(error: boolean): string {
  return error
    ? 'border-red-500/70'
    : 'border-border-dark focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-accent'
}
