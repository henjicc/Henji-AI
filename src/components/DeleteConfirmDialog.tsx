import { UiButton, UiModal } from '@/components/ui';

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
          <UiButton variant="ghost" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </UiButton>
          <UiButton
            className="border-red-500/40 bg-red-600/80 text-white hover:bg-red-600"
            onClick={onConfirm}
            disabled={busy}
          >
            {confirmLabel}
          </UiButton>
        </>
      }
    >
      <div className="text-sm text-text-dark">{message}</div>
    </UiModal>
  );
}
