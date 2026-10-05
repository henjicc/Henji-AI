import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { UiButton, UiFormRow, UiInput, UiModal, UI_TEXT_SECONDARY_CLASS } from '@/components/ui'
import { MAX_ENTRY_NAME_LENGTH, normalizeEntryName } from '@/core/documents/naming'
import type { EntryNameInvalidReason, NameCheckResult } from '@/core/documents/types'
import { openDialog } from '@/platform/desktopApi'

import { toError } from './documentErrors'
import type { DocumentSaveNamePromptInfo } from './documentSessionTypes'

/*
 * 草稿第一次保存时的起名对话框（实施方案 2.8 保存位置与同名检测，重要记录 015）：
 * - 名称实时检查：非法或同一文件夹里重名时提示原因，不能保存，不偷偷加后缀。
 * - 位置默认就是草稿所在的文件夹；可“更改位置…”另选文件夹（整体移过去并登记为外部位置）。
 * - 保存失败（例如检查后被别处抢先建了同名）时显示原因并保持打开。
 */

const CHECK_DELAY_MS = 200

type CheckState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'done'; name: string; folder: string | null; result: NameCheckResult }
  | { status: 'error' }

export interface DocumentSaveNameDialogProps {
  info: DocumentSaveNamePromptInfo
  onDone: (saved: boolean) => void
  /** 选择文件夹；省略时用系统对话框。 */
  pickFolder?: (defaultPath: string) => Promise<string | null>
}

async function pickFolderWithSystemDialog(defaultPath: string): Promise<string | null> {
  const selected = await openDialog({ directory: true, multiple: false, defaultPath })
  return typeof selected === 'string' ? selected : null
}

export function DocumentSaveNameDialog({ info, onDone, pickFolder = pickFolderWithSystemDialog }: DocumentSaveNameDialogProps): JSX.Element {
  const { t } = useTranslation('ui')
  const [name, setName] = useState(info.initialName)
  const [folder, setFolder] = useState<string | null>(null)
  const [check, setCheck] = useState<CheckState>({ status: 'idle' })
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const checkSeq = useRef(0)
  const isProject = info.subject.type === 'project'

  const local = normalizeEntryName(name)

  useEffect(() => {
    const seq = ++checkSeq.current
    setSubmitError(null)
    if (!local.ok) {
      setCheck({ status: 'idle' })
      return
    }
    setCheck({ status: 'checking' })
    const timer = setTimeout(() => {
      info.check(local.name, folder).then(
        (result) => { if (checkSeq.current === seq) setCheck({ status: 'done', name: local.name, folder, result }) },
        () => { if (checkSeq.current === seq) setCheck({ status: 'error' }) },
      )
    }, CHECK_DELAY_MS)
    return () => clearTimeout(timer)
    // local 由 name 推导；只在名称或位置变化时检查
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, folder, info])

  const invalidMessage = (reason: EntryNameInvalidReason | 'location'): string =>
    t(`documentSession.nameDialog.invalid.${reason}`, { max: MAX_ENTRY_NAME_LENGTH })

  let message: string | null = null
  if (!local.ok) message = local.reason === 'empty' ? null : invalidMessage(local.reason)
  else if (check.status === 'error') message = t('documentSession.nameDialog.checkFailed')
  else if (check.status === 'done' && check.result.status === 'duplicate') {
    message = t(isProject ? 'documentSession.nameDialog.duplicateProject' : 'documentSession.nameDialog.duplicateDocument')
  } else if (check.status === 'done' && check.result.status === 'invalid') message = invalidMessage(check.result.reason)
  if (submitError) message = submitError

  const available = check.status === 'done'
    && check.result.status === 'available'
    && local.ok
    && check.name === local.name
    && check.folder === folder
  const canSubmit = available && !submitting

  const submit = async (event?: FormEvent): Promise<void> => {
    event?.preventDefault()
    if (!canSubmit || check.status !== 'done' || check.result.status !== 'available') return
    setSubmitting(true)
    setSubmitError(null)
    try {
      await info.submit(check.result.name, folder)
      onDone(true)
    } catch (error) {
      setSubmitError(t('documentSession.nameDialog.saveFailed', { message: toError(error).message }))
      setSubmitting(false)
    }
  }

  const changeLocation = async (): Promise<void> => {
    const selected = await pickFolder(folder ?? info.defaultFolder)
    if (selected) setFolder(selected === info.defaultFolder ? null : selected)
  }

  const cancel = (): void => {
    if (!submitting) onDone(false)
  }

  const location = folder ?? info.defaultFolder

  return (
    <UiModal
      isOpen
      title={t(isProject ? 'documentSession.nameDialog.titleProject' : 'documentSession.nameDialog.titleDocument')}
      onClose={cancel}
      size="form"
      footer={(
        <>
          <UiButton type="button" variant="secondary" disabled={submitting} onClick={cancel}>
            {t('documentSession.nameDialog.cancel')}
          </UiButton>
          <UiButton type="button" variant="primary" disabled={!canSubmit} onClick={() => void submit()}>
            {t('documentSession.nameDialog.confirm')}
          </UiButton>
        </>
      )}
    >
      <form className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
        <UiFormRow label={t('documentSession.nameDialog.nameLabel')}>
          <UiInput
            value={name}
            autoFocus
            maxLength={MAX_ENTRY_NAME_LENGTH * 2}
            disabled={submitting}
            aria-invalid={message ? true : undefined}
            onChange={(event) => setName(event.target.value)}
            onFocus={(event) => event.currentTarget.select()}
          />
          {message ? <p role="alert" className="mt-1.5 text-xs text-danger-text">{message}</p> : null}
        </UiFormRow>
        <UiFormRow label={t('documentSession.nameDialog.locationLabel')}>
          <div className="flex min-w-0 items-center gap-2">
            <span className={`min-w-0 flex-1 truncate ${UI_TEXT_SECONDARY_CLASS}`} title={location}>{location}</span>
            {folder ? (
              <UiButton type="button" size="sm" disabled={submitting} onClick={() => setFolder(null)}>
                {t('documentSession.nameDialog.defaultLocation')}
              </UiButton>
            ) : null}
            <UiButton type="button" variant="secondary" size="sm" disabled={submitting} onClick={() => void changeLocation()}>
              {t('documentSession.nameDialog.changeLocation')}
            </UiButton>
          </div>
        </UiFormRow>
      </form>
    </UiModal>
  )
}
