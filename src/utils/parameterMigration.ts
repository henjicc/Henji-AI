/**
 * 参数重构数据迁移工具
 * 用于迁移 localStorage 中的历史记录和预设数据
 *
 * 使用方法：
 * 1. 将此文件放到 src/utils/parameterMigration.ts
 * 2. 在 App.tsx 的开头调用 migrateAllData()
 */

// 参数重命名映射表
const PARAM_RENAME_MAP: Record<string, Record<string, string>> = {
  "fal-ai-bytedance-seedance-v1": {
    "videoDuration": "falSeedanceV1VideoDuration"
  },
  "fal-ai-bytedance-seedream-v4": {
    "numImages": "falSeedream40NumImages"
  },
  "fal-ai-kling-image-o1": {
    "num_images": "falKlingImageO1Num_images",
    "aspectRatio": "falKlingImageO1AspectRatio"
  },
  "fal-ai-kling-video-v2.6-pro": {
    "videoDuration": "falKlingV26ProVideoDuration"
  },
  "fal-ai-ltx-2": {
    "videoDuration": "falLtx2VideoDuration"
  },
  "fal-ai-nano-banana-pro": {
    "num_images": "falNanoBananaProNum_images",
    "aspectRatio": "falNanoBananaProAspectRatio"
  },
  "fal-ai-nano-banana": {
    "num_images": "falNanoBananaNum_images",
    "aspectRatio": "falNanoBananaAspectRatio"
  },
  "fal-ai-pixverse-v5.5": {
    "videoDuration": "falPixverse55VideoDuration"
  },
  "fal-ai-sora-2": {
    "videoDuration": "falSora2VideoDuration"
  },
  "fal-ai-veo-3.1": {
    "videoDuration": "falVeo31VideoDuration"
  },
  "fal-ai-vidu-q2": {
    "videoDuration": "falViduQ2VideoDuration"
  },
  "fal-ai-wan-25-preview": {
    "videoDuration": "falWan25VideoDuration"
  },
  "fal-ai-z-image-turbo": {
    "imageSize": "falZImageTurboImageSize",
    "numImages": "falZImageTurboNumImages"
  },
  "kling-2.5-turbo": {
    "videoDuration": "ppioKling25VideoDuration",
    "videoAspectRatio": "ppioKling25VideoAspectRatio"
  },
  "minimax-hailuo-2.3": {
    "videoDuration": "ppioHailuo23VideoDuration",
    "videoResolution": "ppioHailuo23VideoResolution"
  },
  "pixverse-v4.5": {
    "videoAspectRatio": "ppioPixverse45VideoAspectRatio",
    "videoResolution": "ppioPixverse45VideoResolution"
  },
  "seedance-v1": {
    "videoDuration": "ppioSeedanceV1VideoDuration"
  },
  "wan-2.5-preview": {
    "videoDuration": "ppioWan25VideoDuration"
  }
};

/**
 * 迁移单个任务的参数
 */
function migrateTaskParams(task: any): any {
  if (!task || !task.model) return task;

  const modelId = task.model;
  const renameMap = PARAM_RENAME_MAP[modelId];

  if (!renameMap || !task.options) return task;

  // 创建新的 options 对象
  const newOptions = { ...task.options };

  // 重命名参数
  for (const [oldName, newName] of Object.entries(renameMap)) {
    if (oldName in newOptions) {
      newOptions[newName] = newOptions[oldName];
      delete newOptions[oldName];
    }
  }

  return {
    ...task,
    options: newOptions
  };
}

/**
 * 迁移历史记录
 */
function migrateHistory(): void {
  try {
    const historyStr = localStorage.getItem('generationTasks');
    if (!historyStr) return;

    const history = JSON.parse(historyStr);
    if (!Array.isArray(history)) return;

    // 迁移每个任务
    const migratedHistory = history.map(migrateTaskParams);

    // 保存迁移后的数据
    localStorage.setItem('generationTasks', JSON.stringify(migratedHistory));

    console.log('✅ 历史记录迁移完成');
  } catch (error) {
    console.error('❌ 历史记录迁移失败:', error);
  }
}

/**
 * 迁移预设数据
 */
function migratePresets(): void {
  try {
    const presetsStr = localStorage.getItem('presets');
    if (!presetsStr) return;

    const presets = JSON.parse(presetsStr);
    if (!Array.isArray(presets)) return;

    // 迁移每个预设
    const migratedPresets = presets.map((preset: any) => {
      if (!preset.model || !preset.params) return preset;

      const modelId = preset.model.modelId;
      const renameMap = PARAM_RENAME_MAP[modelId];

      if (!renameMap) return preset;

      // 重命名参数
      const newParams = { ...preset.params };
      for (const [oldName, newName] of Object.entries(renameMap)) {
        if (oldName in newParams) {
          newParams[newName] = newParams[oldName];
          delete newParams[oldName];
        }
      }

      return {
        ...preset,
        params: newParams
      };
    });

    // 保存迁移后的数据
    localStorage.setItem('presets', JSON.stringify(migratedPresets));

    console.log('✅ 预设数据迁移完成');
  } catch (error) {
    console.error('❌ 预设数据迁移失败:', error);
  }
}

/**
 * 执行所有数据迁移
 * 在应用启动时调用一次
 */
export function migrateAllData(): void {
  // 检查是否已经迁移过
  const migrated = localStorage.getItem('params_migrated_v1');
  if (migrated === 'true') {
    return;
  }

  console.log('🔄 开始数据迁移...');

  migrateHistory();
  migratePresets();

  // 标记为已迁移
  localStorage.setItem('params_migrated_v1', 'true');

  console.log('✅ 所有数据迁移完成');
}
