import { useCallback, useMemo } from 'react';

import { registry } from '@/core/ModelRegistry';
import { LinkageEngine } from '@/core/linkage';
import type { ParamDef } from '@/core/types';
import { extractDefaults } from '@/hooks/utils/defaultExtractor';

export interface UseNodeModelParamsOptions {
  modelId: string;
  /** 节点 data 中持久化的参数（可为空，缺省时使用 schema 默认值） */
  storedParams: Record<string, unknown> | undefined;
  /** 参数变化时回写节点 data（传入完整参数对象） */
  onParamsChange: (nextParams: Record<string, unknown>) => void;
}

export interface UseNodeModelParamsResult {
  schema: ParamDef[];
  defaults: Record<string, unknown>;
  /** 默认值与持久化参数合并后的运行时值 */
  values: Record<string, unknown>;
  setParam: (key: string, value: unknown) => void;
  resetParams: () => void;
}

/**
 * 画布节点的受控模型参数 hook。
 *
 * 与对话模式的 useModelParams 区别：参数状态持久化在节点 data 中（随项目入库），
 * 本 hook 不持有内部 state，只负责合并默认值与执行联动。
 */
export function useNodeModelParams({
  modelId,
  storedParams,
  onParamsChange,
}: UseNodeModelParamsOptions): UseNodeModelParamsResult {
  const model = useMemo(() => registry.getModel(modelId), [modelId]);

  const schema = useMemo(() => registry.getSchema(modelId), [modelId]);

  const defaults = useMemo(() => extractDefaults(schema), [schema]);

  const linkageEngine = useMemo(() => {
    if (!model?.linkages || model.linkages.length === 0) {
      return null;
    }
    return new LinkageEngine(model.linkages);
  }, [model]);

  const values = useMemo(
    () => ({ ...defaults, ...(storedParams ?? {}) }),
    [defaults, storedParams]
  );

  const setParam = useCallback(
    (key: string, value: unknown) => {
      let nextValues: Record<string, unknown> = { ...values, [key]: value };
      if (linkageEngine) {
        nextValues = linkageEngine.execute(key, nextValues, schema);
      }
      onParamsChange(nextValues);
    },
    [linkageEngine, onParamsChange, schema, values]
  );

  const resetParams = useCallback(() => {
    onParamsChange({});
  }, [onParamsChange]);

  return {
    schema,
    defaults,
    values,
    setParam,
    resetParams,
  };
}
