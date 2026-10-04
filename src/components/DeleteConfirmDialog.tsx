import { UI_TEXT_BODY_CLASS, UiButton, UiModal } from '@/components/ui';

interface DeleteConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  cancelLabel: string;
  confirmLabel: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

/** 通用「删除确认」弹窗：单条或批量删除共用同一个组件，避免每处业务模块各写一份。 */
export function DeleteConfirmDialog({
  isOpen,
  title,
  message,
  cancelLabel,
  confirmLabel,
  busy = false,
  onCancel,
  onConfirm,
}: DeleteConfirmDialogProps): JSX.Element {
  return (
    <UiModal
      isOpen={isOpen}
      title={title}
      onClose={onCancel}
      footer={
        <>
          <UiButton variant="secondary" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </UiButton>
          <UiButton variant="dangerSolid"
            onClick={onConfirm}
            disabled={busy}
          >
            {confirmLabel}
          </UiButton>
        </>
      }
    >
      <div className={`whitespace-pre-line break-words ${UI_TEXT_BODY_CLASS}`}>{message}</div>
    </UiModal>
  );
}
