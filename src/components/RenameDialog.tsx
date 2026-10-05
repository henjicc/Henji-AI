import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { UiButton, UiInput, UiModal } from '@/components/ui';

const VALIDATE_DELAY_MS = 200;

interface RenameDialogProps {
  isOpen: boolean;
  title: string;
  defaultValue?: string;
  placeholder?: string;
  onClose: () => void;
  /**
   * 确认名称。返回 Promise 时对话框等它完成再关闭；失败时显示原因并保持打开
   * （例如检查之后被别处抢先建了同名）。
   */
  onConfirm: (name: string) => void | Promise<void>;
  /**
   * 可选的实时检查（如同一文件夹里重名）：返回要提示的原因，null 表示可用。
   * 输入停顿 200ms 后检查；有原因或检查未完成时“确认”不可用。不传则只要求非空。
   */
  validate?: (name: string) => Promise<string | null>;
}

type ValidationState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'done'; name: string; message: string | null };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function RenameDialog({
  isOpen,
  title,
  defaultValue = '',
  placeholder,
  onClose,
  onConfirm,
  validate,
}: RenameDialogProps): JSX.Element {
  const { t } = useTranslation();
  const [name, setName] = useState(defaultValue);
  const [validation, setValidation] = useState<ValidationState>({ status: 'idle' });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const checkSeq = useRef(0);
  const trimmed = name.trim();

  useEffect(() => {
    if (isOpen) {
      setName(defaultValue);
      setSubmitting(false);
      setSubmitError(null);
    }
  }, [isOpen, defaultValue]);

  useEffect(() => {
    const seq = ++checkSeq.current;
    setSubmitError(null);
    if (!validate || !isOpen || !trimmed) {
      setValidation({ status: 'idle' });
      return;
    }
    setValidation({ status: 'checking' });
    const timer = setTimeout(() => {
      validate(trimmed).then(
        (message) => { if (checkSeq.current === seq) setValidation({ status: 'done', name: trimmed, message }); },
        (error: unknown) => { if (checkSeq.current === seq) setValidation({ status: 'done', name: trimmed, message: errorMessage(error) }); },
      );
    }, VALIDATE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [trimmed, validate, isOpen]);

  const validated = !validate || (validation.status === 'done' && validation.name === trimmed && validation.message === null);
  const canConfirm = Boolean(trimmed) && validated && !submitting;
  const message = submitError ?? (validation.status === 'done' && validation.name === trimmed ? validation.message : null);

  const handleConfirm = async (): Promise<void> => {
    if (!canConfirm) return;
    const result = onConfirm(trimmed);
    if (!result) {
      onClose();
      return;
    }
    setSubmitting(true);
    try {
      await result;
      onClose();
    } catch (error) {
      setSubmitError(errorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter') {
      void handleConfirm();
    }
  };

  return (
    <UiModal
      isOpen={isOpen}
      title={title}
      onClose={() => { if (!submitting) onClose(); }}
      size="compact"
      footer={
        <>
          <UiButton onClick={onClose} variant="secondary" disabled={submitting}>
            {t('common.cancel')}
          </UiButton>
          <UiButton onClick={() => void handleConfirm()} disabled={!canConfirm} variant="primary">
            {t('common.confirm')}
          </UiButton>
        </>
      }
    >
      <UiInput
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder ?? t('project.namePlaceholder')}
        aria-invalid={message ? true : undefined}
        disabled={submitting}
        autoFocus
      />
      {message ? <p role="alert" className="mt-1.5 text-xs text-danger-text">{message}</p> : null}
    </UiModal>
  );
}
