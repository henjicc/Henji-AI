import type { PointerEvent } from 'react';
import { RotateCcw, Trash2 } from 'lucide-react';
import {
  createDefaultBlurOperationParams,
  IMAGE_BLUR_ALGORITHMS,
  IMAGE_EDIT_OPERATION_IDS,
  type BlurOperationParams,
} from '@/core/imageEdit';
import {
  UI_TEXT_META_CLASS,
  UI_TEXT_SECTION_CLASS,
  UiChipButton,
  UiError,
  UiGroup,
  UiOptionButton,
  UiRangeInput,
  UiSwitch,
} from '@/components/ui';
import { useImageEditorDocumentController } from '@/features/imageEdit/editor/ImageEditorDocumentContext';

export function BlurInspector(): JSX.Element {
  const controller = useImageEditorDocumentController();
  const operation = controller.getOperation<BlurOperationParams>(IMAGE_EDIT_OPERATION_IDS.blur);
  const params = operation?.params ?? createDefaultBlurOperationParams();
  const update = (patch: (current: BlurOperationParams) => BlurOperationParams): void => {
    controller.updateOperation<BlurOperationParams>(IMAGE_EDIT_OPERATION_IDS.blur, patch);
  };
  const commitRange = (_event: PointerEvent<HTMLInputElement>): void => controller.commitTransaction();

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-3">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <h2 className={UI_TEXT_SECTION_CLASS}>模糊</h2>
          <p className={`mt-1 leading-5 ${UI_TEXT_META_CLASS}`}>柔化整张图片的细节</p>
        </div>
        <UiSwitch
          checked={operation?.enabled ?? false}
          onCheckedChange={(enabled) => controller.setOperationEnabled(IMAGE_EDIT_OPERATION_IDS.blur, enabled)}
          aria-label="启用模糊"
        />
      </div>

      <fieldset disabled={!operation?.enabled} className="m-0 min-w-0 space-y-4 border-0 p-0 disabled:opacity-60">
        <UiGroup title="算法" titleTone="overline">
          <div className="grid grid-cols-1 gap-2">
            {IMAGE_BLUR_ALGORITHMS.map((algorithm) => (
              <UiOptionButton
                key={algorithm.id}
                type="button"
                variant="flat"
                active={params.algorithm === algorithm.id}
                className="justify-center text-xs"
                onClick={() => update((current) => ({
                  ...current,
                  algorithm: algorithm.id,
                }))}
              >
                {algorithm.label}
              </UiOptionButton>
            ))}
          </div>
        </UiGroup>

        <UiGroup divided>
          <label className="block space-y-1.5">
            <span className={`flex items-center justify-between gap-3 ${UI_TEXT_META_CLASS}`}>
              <span>强度</span>
              <span className="shrink-0 text-text-dark">{Math.round(params.strength * 100)}%</span>
            </span>
            <UiRangeInput
              value={params.strength}
              min={0}
              max={1}
              step={0.01}
              onFocus={controller.beginTransaction}
              onPointerDown={controller.beginTransaction}
              onPointerUp={commitRange}
              onPointerCancel={controller.cancelTransaction}
              onBlur={controller.commitTransaction}
              onChange={(event) => update((current) => ({
                ...current,
                strength: Number(event.currentTarget.value),
              }))}
            />
          </label>
        </UiGroup>
      </fieldset>

      {operation?.enabled && controller.previewState?.phase === 'failed' ? (
        <UiError
          size="xs"
          title="模糊预览失败"
          message={controller.previewState.message ?? '请调整参数后重试'}
        />
      ) : null}

      <div className="mt-4 flex gap-2">
        <UiChipButton
          type="button"
          className="!h-8 flex-1 !justify-center !text-xs"
          onClick={() => controller.resetOperation(IMAGE_EDIT_OPERATION_IDS.blur)}
        >
          <RotateCcw className="h-3.5 w-3.5" />
          重置
        </UiChipButton>
        <UiChipButton
          type="button"
          className="!h-8 flex-1 !justify-center !text-xs"
          disabled={!operation}
          onClick={() => controller.removeOperation(IMAGE_EDIT_OPERATION_IDS.blur)}
        >
          <Trash2 className="h-3.5 w-3.5" />
          移除
        </UiChipButton>
      </div>
    </div>
  );
}
