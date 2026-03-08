import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { UiButton, UiInput, UiPanel } from '@/components/ui';
import { UI_CONTENT_OVERLAY_INSET_CLASS, UI_DIALOG_TRANSITION_MS } from '@/components/ui/motion';
import { useDialogTransition } from '@/components/ui/useDialogTransition';

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
}: RenameDialogProps) {
  const { t } = useTranslation();
  const [name, setName] = useState(defaultValue);
  const { shouldRender, isVisible } = useDialogTransition(isOpen, UI_DIALOG_TRANSITION_MS);

  useEffect(() => {
    if (isOpen) {
      setName(defaultValue);
    }
  }, [isOpen, defaultValue]);

  const handleConfirm = () => {
    if (name.trim()) {
      onConfirm(name.trim());
      onClose();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleConfirm();
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  if (!shouldRender) return null;

  return (
    <div className={`fixed ${UI_CONTENT_OVERLAY_INSET_CLASS} z-[100] flex items-center justify-center`}>
      <div
        className={`absolute inset-0 bg-black/50 transition-opacity duration-200 ${isVisible ? 'opacity-100' : 'opacity-0'}`}
        onClick={onClose}
      />
      <UiPanel className={`relative w-80 p-6 transition-opacity duration-200 ${isVisible ? 'opacity-100' : 'opacity-0'}`}>
        <h2 className="text-lg font-semibold text-text-dark mb-4">{title}</h2>
        <UiInput
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t('project.namePlaceholder')}
          className="h-10"
          autoFocus
        />
        <div className="flex justify-end gap-2 mt-4">
          <UiButton
            onClick={onClose}
            variant="ghost"
            size="sm"
          >
            {t('common.cancel')}
          </UiButton>
          <UiButton
            onClick={handleConfirm}
            disabled={!name.trim()}
            variant="primary"
            size="sm"
          >
            {t('common.confirm')}
          </UiButton>
        </div>
      </UiPanel>
    </div>
  );
}
