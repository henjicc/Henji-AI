import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { UiButton, UiInput, UiModal } from '@/components/ui';

interface RenameDialogProps {
  isOpen: boolean;
  title: string;
  defaultValue?: string;
  placeholder?: string;
  onClose: () => void;
  onConfirm: (name: string) => void;
}

export function RenameDialog({
  isOpen,
  title,
  defaultValue = '',
  placeholder,
  onClose,
  onConfirm,
}: RenameDialogProps): JSX.Element {
  const { t } = useTranslation();
  const [name, setName] = useState(defaultValue);

  useEffect(() => {
    if (isOpen) {
      setName(defaultValue);
    }
  }, [isOpen, defaultValue]);

  const handleConfirm = (): void => {
    if (name.trim()) {
      onConfirm(name.trim());
      onClose();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter') {
      handleConfirm();
    }
  };

  return (
    <UiModal
      isOpen={isOpen}
      title={title}
      onClose={onClose}
      size="compact"
      footer={
        <>
          <UiButton onClick={onClose} variant="secondary">
            {t('common.cancel')}
          </UiButton>
          <UiButton onClick={handleConfirm} disabled={!name.trim()} variant="primary">
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
        autoFocus
      />
    </UiModal>
  );
}
