import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { UiButton, UiInput, UiModal } from '@/components/ui';

interface RenameDialogProps {
  isOpen: boolean;
  title: string;
  defaultValue?: string;
  onClose: () => void;
  onConfirm: (name: string) => void;
}

export function RenameDialog({
  isOpen,
  title,
  defaultValue = '',
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
      hideHeader
      widthClassName="w-80"
      contentClassName="p-6"
      footer={
        <>
          <UiButton onClick={onClose} variant="ghost" size="sm">
            {t('common.cancel')}
          </UiButton>
          <UiButton onClick={handleConfirm} disabled={!name.trim()} variant="primary" size="sm">
            {t('common.confirm')}
          </UiButton>
        </>
      }
    >
      <h2 className="mb-4 text-lg font-semibold text-text-dark">{title}</h2>
      <UiInput
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={t('project.namePlaceholder')}
        className="h-10"
        autoFocus
      />
    </UiModal>
  );
}
