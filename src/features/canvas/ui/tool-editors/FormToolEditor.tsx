import { useCallback } from 'react';

import type { ToolFieldSchema, ToolOptions } from '@/features/canvas/tools';
import { UiColorInput, UiFormRow, UiInput, UiSelect } from '@/components/ui';
import NumberField from '@/components/ui/NumberInput';
import type { FormToolEditorProps } from './types';

function readTextOption(options: ToolOptions, key: string): string {
  const value = options[key];
  return typeof value === 'string' ? value : String(value ?? '');
}

function readNumberOption(options: ToolOptions, key: string): number {
  const value = options[key];
  return typeof value === 'number' ? value : Number(value ?? 0);
}

/**
 * 没有专属编辑器的节点工具用的通用表单（扩展点）。字段统一走 `UiFormRow` 与默认尺寸档：
 * 数值用带拖动的 `NumberInput`，不再用原生数字框；颜色、下拉不在调用点改高度（任务 5.4）。
 */
export function FormToolEditor({ fields, options, onOptionsChange }: FormToolEditorProps) {
  const updateOption = useCallback(
    (key: string, value: string | number) => {
      onOptionsChange({
        ...options,
        [key]: value,
      });
    },
    [onOptionsChange, options]
  );

  const renderField = useCallback(
    (field: ToolFieldSchema) => {
      if (field.type === 'text') {
        return (
          <UiInput
            type="text"
            value={readTextOption(options, field.key)}
            onChange={(event) => updateOption(field.key, event.target.value)}
            textHistory={{ onValueChange: (value) => updateOption(field.key, value) }}
            placeholder={field.placeholder}
            aria-label={field.label}
          />
        );
      }

      if (field.type === 'number') {
        return (
          <NumberField
            value={readNumberOption(options, field.key)}
            min={field.min}
            max={field.max}
            step={field.step ?? 1}
            ariaLabel={field.label}
            onChange={(value) => updateOption(field.key, value)}
          />
        );
      }

      if (field.type === 'color') {
        return (
          <UiColorInput
            value={readTextOption(options, field.key)}
            onChange={(event) => updateOption(field.key, event.target.value)}
            aria-label={field.label}
          />
        );
      }

      return (
        <UiSelect
          value={readTextOption(options, field.key)}
          onChange={(event) => updateOption(field.key, event.target.value)}
          aria-label={field.label}
        >
          {field.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </UiSelect>
      );
    },
    [options, updateOption]
  );

  return (
    <div className="space-y-4">
      {fields.map((field) => (
        <UiFormRow key={field.key} label={field.label} inline={field.type === 'color'}>
          {renderField(field)}
        </UiFormRow>
      ))}
    </div>
  );
}
