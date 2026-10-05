import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, FolderPlus } from 'lucide-react'

import { UiButton, UiInput, UiModal, UiOptionButton, UI_TEXT_SECONDARY_CLASS } from '@/components/ui'
import { normalizeEntryName, MAX_ENTRY_NAME_LENGTH } from '@/core/documents/naming'
import type { ProjectSummary } from '@/core/documents/types'

import { toError } from './documentErrors'

/*
 * “移到项目…”的选项目对话框（存储底座 2.5）：列出已保存的项目（不含文档当前所在的），
 * 末尾“新建项目”就地起名（同名实时提示，不加后缀）。确认后由调用方执行移动，
 * 失败时显示原因并保持打开；移动遇到重名的询问由调用方在本对话框关闭后处理。
 */

const CHECK_DELAY_MS = 200

export type MoveToProjectChoice = { kind: 'existing'; project: ProjectSummary } | { kind: 'new'; name: string }

export interface MoveToProjectDialogProps {
  documentName: string
  projects: readonly ProjectSummary[]
  /** 新建项目名称检查：返回提示原因，null 表示可用。 */
  checkProjectName: (name: string) => Promise<string | null>
  /** 执行移动（含新建项目）；抛错时显示原因并保持打开。 */
  onConfirm: (choice: MoveToProjectChoice) => Promise<void>
  onClose: () => void
}

type NewProjectCheck = { status: 'idle' } | { status: 'checking' } | { status: 'done'; name: string; message: string | null }

export function MoveToProjectDialog({ documentName, projects, checkProjectName, onConfirm, onClose }: MoveToProjectDialogProps): JSX.Element {
  const { t } = useTranslation('ui')
  const [selected, setSelected] = useState<string | 'new' | null>(projects[0]?.id ?? (projects.length ? null : 'new'))
  const [newName, setNewName] = useState('')
  const [check, setCheck] = useState<NewProjectCheck>({ status: 'idle' })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const checkSeq = useRef(0)
  const local = normalizeEntryName(newName)

  useEffect(() => {
    const seq = ++checkSeq.current
    setError(null)
    if (selected !== 'new' || !local.ok) {
      setCheck({ status: 'idle' })
      return
    }
    setCheck({ status: 'checking' })
    const timer = setTimeout(() => {
      checkProjectName(local.name).then(
        (message) => { if (checkSeq.current === seq) setCheck({ status: 'done', name: local.name, message }) },
        (raw: unknown) => { if (checkSeq.current === seq) setCheck({ status: 'done', name: local.name, message: toError(raw).message }) },
      )
    }, CHECK_DELAY_MS)
    return () => clearTimeout(timer)
    // local 由 newName 推导
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newName, selected, checkProjectName])

  let message: string | null = error
  if (!message && selected === 'new') {
    if (!local.ok && local.reason !== 'empty') message = t(`documentSession.nameDialog.invalid.${local.reason}`, { max: MAX_ENTRY_NAME_LENGTH })
    else if (check.status === 'done' && local.ok && check.name === local.name) message = check.message
  }

  const newReady = selected === 'new' && local.ok && check.status === 'done' && check.name === local.name && check.message === null
  const canConfirm = !submitting && (newReady || (selected !== null && selected !== 'new'))

  const confirm = async (): Promise<void> => {
    if (!canConfirm) return
    const choice: MoveToProjectChoice | null = selected === 'new'
      ? (local.ok ? { kind: 'new', name: local.name } : null)
      : (() => { const project = projects.find((item) => item.id === selected); return project ? { kind: 'existing' as const, project } : null })()
    if (!choice) return
    setSubmitting(true)
    setError(null)
    try {
      await onConfirm(choice)
      onClose()
    } catch (raw) {
      setError(toError(raw).message)
      setSubmitting(false)
    }
  }

  return (
    <UiModal
      isOpen
      title={t('documentLibrary.move.title')}
      onClose={() => { if (!submitting) onClose() }}
      size="compact"
      footer={(
        <>
          <UiButton type="button" variant="secondary" disabled={submitting} onClick={onClose}>{t('documentLibrary.move.cancel')}</UiButton>
          <UiButton type="button" variant="primary" disabled={!canConfirm} onClick={() => void confirm()}>{t('documentLibrary.move.confirm')}</UiButton>
        </>
      )}
    >
      <div className="flex flex-col gap-1" data-move-document={documentName}>
        {projects.length === 0 ? <p className={`px-1 pb-1 ${UI_TEXT_SECONDARY_CLASS}`}>{t('documentLibrary.move.noProjects')}</p> : null}
        <div role="listbox" aria-label={t('documentLibrary.move.title')} className="flex max-h-72 flex-col gap-0.5 overflow-y-auto">
          {projects.map((project) => (
            <UiOptionButton
              key={project.id}
              type="button"
              role="option"
              variant="menu"
              aria-selected={selected === project.id}
              active={selected === project.id}
              disabled={submitting}
              className="w-full justify-between gap-2"
              onClick={() => setSelected(project.id)}
            >
              <span className="min-w-0 truncate">{project.name}</span>
              {selected === project.id ? <Check className="h-4 w-4 shrink-0 text-accent-text" aria-hidden="true" /> : null}
            </UiOptionButton>
          ))}
          <UiOptionButton
            type="button"
            role="option"
            variant="menu"
            aria-selected={selected === 'new'}
            active={selected === 'new'}
            disabled={submitting}
            className="w-full gap-2"
            onClick={() => setSelected('new')}
          >
            <FolderPlus className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="min-w-0 truncate">{t('documentLibrary.move.newProject')}</span>
          </UiOptionButton>
        </div>
        {selected === 'new' ? (
          <UiInput
            className="mt-2"
            value={newName}
            autoFocus
            maxLength={MAX_ENTRY_NAME_LENGTH * 2}
            disabled={submitting}
            placeholder={t('documentLibrary.move.newProjectName')}
            aria-label={t('documentLibrary.move.newProjectName')}
            aria-invalid={message ? true : undefined}
            onChange={(event) => setNewName(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') void confirm() }}
          />
        ) : null}
        {message ? <p role="alert" className="mt-1.5 text-xs text-danger-text">{message}</p> : null}
      </div>
    </UiModal>
  )
}
