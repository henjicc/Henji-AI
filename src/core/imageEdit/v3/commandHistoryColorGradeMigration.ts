import {
  COLOR_GRADE_V1_REMOVED_KEYS,
  hasColorGradeV1Keys,
  migrateColorGradeParamsV1,
  migrateImageColorGradeParamSetsV1,
} from '../../imaging/adjustments/colorGradeMigration';
import { COLOR_GRADE_PARAMETERS } from '../../imaging/adjustments/schema';

// 色温/色调调整图层的参数也叫 temperature、tint；参数命令不记录图层类型，还要带全能调色独有的键才能认定是全能调色。
const COLOR_GRADE_ONLY_KEYS = new Set<string>(
  [...COLOR_GRADE_V1_REMOVED_KEYS, ...COLOR_GRADE_PARAMETERS.map(parameter => parameter.key)]
    .filter(key => key !== 'temperature' && key !== 'tint'),
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isV1ColorGradeParams(params: unknown): params is Record<string, unknown> {
  return hasColorGradeV1Keys(params) && Object.keys(params).some(key => COLOR_GRADE_ONLY_KEYS.has(key));
}

/**
 * 历史页是内容寻址的不可变资源，没有自己的格式版本，全能调色参数 v2（2026-10-21）之前写下的命令仍带 v1 参数。
 * 读取时把带 v1 独有键的参数按工作副本同一迁移换算；结果只在内存里，页文件不改。没有 v1 独有键的命令原样返回。
 */
export function migrateImageEditHistoryCommandColorGradeV1(command: unknown): unknown {
  if (!isRecord(command)) return command;
  if (command.type === 'document.atomic' && Array.isArray(command.commands)) {
    const commands = command.commands.map(migrateImageEditHistoryCommandColorGradeV1);
    return commands.some((child, index) => child !== (command.commands as unknown[])[index]) ? { ...command, commands } : command;
  }
  if (command.type === 'layer.update-params') {
    return isV1ColorGradeParams(command.params) ? { ...command, params: migrateColorGradeParamsV1(command.params) } : command;
  }
  return migrateImageColorGradeParamSetsV1(command, hasColorGradeV1Keys);
}
