import { useCallback, useEffect, useMemo, useRef } from 'react';

import { registry } from '@/core/ModelRegistry';
import { LinkageEngine } from '@/core/linkage';
import type { ParamDef } from '@/core/types';
import { extractDefaults } from '@/hooks/utils/defaultExtractor';
import {
  applyModelAliasParamDefaults,
  normalizeModelAliasParams,
} from '@/core/params/modelAliasDefaults';
import type { CanvasHistoryGroupOptions } from '@/stores/canvasStore';
import { reconcileDerivedMediaState } from '@/core/params/derivedMediaState';

export interface UseNodeModelParamsOptions {
  modelId: string;
  /** 节点 data 中持久化的参数（可为空，缺省时使用 schema 默认值） */
  storedParams: DynamicValueMap | undefined;
  /** 参数变化时回写节点 data（传入完整参数对象） */
  onParamsChange: (nextParams: DynamicValueMap, options?: CanvasHistoryGroupOptions) => void;
  /**
   * 当前生效的媒体内容（已连线优先，否则取本地内联上传，即 GenerationNodeShell 的
   * effectiveImages/effectiveVideos/effectiveAudios）。只用于合并进下面的 values 供
   * visible.condition/pricing.calculator/resolveInputLimits/linkage 在画布里实时读取
   * "是否已上传图片/视频"；不会被持久化进 data.params——媒体真值始终以 data.mediaInputs
   * 为准，避免两份拷贝不同步。
   */
  media?: {
    images?: string[];
    videos?: string[];
    audios?: string[];
  };
}

export interface UseNodeModelParamsResult {
  schema: ParamDef[];
  defaults: DynamicValueMap;
  /** 默认值、持久化参数与当前生效媒体合并后的运行时值 */
  values: DynamicValueMap;
  setParam: (key: string, value: DynamicValue, options?: CanvasHistoryGroupOptions) => void;
  setParams: (changes: DynamicValueMap, options?: CanvasHistoryGroupOptions) => void;
  resetParams: () => void;
}

const EMPTY_MEDIA: string[] = [];
const MEDIA_KEYS = ['images', 'videos', 'audios'] as const;

function stripMediaKeys(source: DynamicValueMap): DynamicValueMap {
  const next = { ...source };
  for (const key of MEDIA_KEYS) {
    delete next[key];
  }
  return next;
}

/**
 * 画布节点的受控模型参数 hook。
 *
 * 与对话模式的 useModelParams 区别：参数状态持久化在节点 data 中（随项目入库），
 * 本 hook 不持有内部 state，只负责合并默认值、当前生效媒体与执行联动。
 */
export function useNodeModelParams({
  modelId,
  storedParams,
  onParamsChange,
  media,
}: UseNodeModelParamsOptions): UseNodeModelParamsResult {
  const model = useMemo(() => registry.getModel(modelId), [modelId]);

  const schema = useMemo(() => registry.getSchema(modelId), [modelId]);

  const defaults = useMemo(
    () => applyModelAliasParamDefaults(modelId, model, schema, extractDefaults(schema)),
    [model, modelId, schema]
  );

  const linkageEngine = useMemo(() => {
    if (!model?.linkages || model.linkages.length === 0) {
      return null;
    }
    return new LinkageEngine(model.linkages);
  }, [model]);

  const hasMedia = media !== undefined;
  const mediaImages = media?.images ?? EMPTY_MEDIA;
  const mediaVideos = media?.videos ?? EMPTY_MEDIA;
  const mediaAudios = media?.audios ?? EMPTY_MEDIA;

  const values = useMemo(
    () => ({
      ...defaults,
      ...normalizeModelAliasParams(model, storedParams ?? {}),
      images: mediaImages,
      videos: mediaVideos,
      audios: mediaAudios,
    }),
    [defaults, model, storedParams, mediaImages, mediaVideos, mediaAudios]
  );

  const setParam = useCallback((key: string, value: DynamicValue, options?: CanvasHistoryGroupOptions) => {
    let nextValues: DynamicValueMap = { ...values, [key]: value };
    if (linkageEngine) {
      nextValues = linkageEngine.execute(key, nextValues, schema);
    }
    nextValues = reconcileDerivedMediaState(schema, nextValues);
    onParamsChange(stripMediaKeys(nextValues), options);
  }, [linkageEngine, onParamsChange, schema, values]);

  const setParams = useCallback((changes: DynamicValueMap, options?: CanvasHistoryGroupOptions) => {
    const changedKeys = Object.keys(changes);
    let nextValues: DynamicValueMap = { ...values, ...changes };
    if (linkageEngine) {
      for (const key of changedKeys) {
        nextValues = linkageEngine.execute(key, nextValues, schema);
      }
    }
    nextValues = reconcileDerivedMediaState(schema, nextValues);
    onParamsChange(stripMediaKeys(nextValues), options);
  }, [linkageEngine, onParamsChange, schema, values]);

  // 画布媒体行走独立的 mediaInputs 通路（见 GenerationNodeShell.handleMediaInputChange），
  // 不会像 NodeParamRows 里的标量参数那样自然调用 setParam/LinkageEngine.execute——
  // 这里在媒体内容变化时手动模拟 images/videos/audios 三个 trigger，让依赖它们的自动切换
  // （如"上传 2 张图 → 首尾帧"）也能在画布里跟对话面板一样生效。用 ref 读取最新
  // values/onParamsChange，使这个 effect 只在媒体内容真正变化时重跑，不会因为其他参数
  // 编辑或自身回写触发的重渲染而重复执行。
  const valuesRef = useRef(values);
  valuesRef.current = values;
  const onParamsChangeRef = useRef(onParamsChange);
  onParamsChangeRef.current = onParamsChange;

  useEffect(() => {
    // 没有调用方明确传 media（如 NodeModelParamsControls 这种共享同一份 storedParams 的
    // 次要参数面板实例）时不跑这个同步：它对媒体一无所知，images/videos/audios 会一直是
    // 空数组，如果照样跑 execute() 可能会把"没有媒体"误判成真实状态，反过来撤销另一个
    // 真正持有媒体信息的 useNodeModelParams 实例已经做出的自动切换。
    if (!hasMedia) return;
    const currentValues = valuesRef.current;
    let next: DynamicValueMap = currentValues;
    if (linkageEngine) {
      for (const key of MEDIA_KEYS) {
        next = linkageEngine.execute(key, next, schema);
      }
    }
    next = reconcileDerivedMediaState(schema, next);
    const cleanedNext = stripMediaKeys(next);
    const cleanedBefore = stripMediaKeys(currentValues);
    const changed = [...new Set([...Object.keys(cleanedBefore), ...Object.keys(cleanedNext)])]
      .some((key) => cleanedNext[key] !== cleanedBefore[key]);
    if (changed) {
      onParamsChangeRef.current(cleanedNext);
    }
  }, [linkageEngine, schema, hasMedia, mediaImages, mediaVideos, mediaAudios]);

  const resetParams = useCallback(() => {
    onParamsChange({});
  }, [onParamsChange]);

  return {
    schema,
    defaults,
    values,
    setParam,
    setParams,
    resetParams,
  };
}
