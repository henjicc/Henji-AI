import { Plus, X } from 'lucide-react';
import { useRef, type MouseEvent, type PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { UiButton, UiIconButton, UiInput } from '@/components/ui';
import { resolveImageDisplayUrl } from '@/features/canvas/application/imageData';
import { createLogger } from '@/core/logging';
import { importLocalMedia } from '@/services/localMediaImport';

const logger = createLogger('features.canvas.cameraStage');

interface CameraStageEnvironmentChipProps {
  imageUrl: string | null;
  /** 环境图来自上游连线时只显示，换图要改上游。 */
  linked: boolean;
  /** 选中节点时“添加环境图”常显；否则只在悬停时出现。 */
  pinned: boolean;
  onChange: (imageUrl: string | null) => void;
}

/** 叠在画面左下角的环境图小样：有图显示缩略图，点它换图；没有图时悬停才出现添加入口。 */
export function CameraStageEnvironmentChip({ imageUrl, linked, pinned, onChange }: CameraStageEnvironmentChipProps): JSX.Element {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const stopCanvasGesture = {
    onPointerDown: (event: PointerEvent) => event.stopPropagation(),
    onDoubleClick: (event: MouseEvent) => event.stopPropagation(),
  };
  const reveal = imageUrl || pinned ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100';

  return (
    <div className={`nodrag nopan absolute bottom-2 left-2 z-raised flex items-center gap-0.5 transition-opacity duration-120 ${reveal}`} {...stopCanvasGesture}>
      <UiButton
        variant="media"
        size="sm"
        disabled={linked}
        tooltip={linked ? t('node.cameraStage.environmentFromLink') : imageUrl ? t('node.cameraStage.replaceEnvironment') : t('node.cameraStage.addEnvironmentHint')}
        onClick={() => inputRef.current?.click()}
      >
        {imageUrl ? (
          <img src={resolveImageDisplayUrl(imageUrl)} alt="" className="h-6 w-10 rounded object-cover" draggable={false} />
        ) : (
          <Plus />
        )}
        {imageUrl ? t('node.cameraStage.environment') : t('node.cameraStage.addEnvironment')}
      </UiButton>
      {imageUrl && !linked ? (
        <UiIconButton
          tone="media"
          size="xs"
          className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
          aria-label={t('node.cameraStage.removeEnvironment')}
          tooltip={t('node.cameraStage.removeEnvironment')}
          onClick={() => onChange(null)}
        >
          <X />
        </UiIconButton>
      ) : null}
      <UiInput
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (!file) return;
          void importLocalMedia(file, 'image')
            .then((imported) => onChange(imported.fullPath))
            .catch((error: unknown) => {
              logger.error('镜头参考环境图导入失败', error, { event: 'canvas.camera_stage.environment_import.failed' });
            });
        }}
      />
    </div>
  );
}
