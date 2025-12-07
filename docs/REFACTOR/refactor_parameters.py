#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
参数重构自动化脚本
用于解决不同供应商模型之间的参数ID冲突问题

使用方法：
1. 备份项目：git commit -am "backup before refactor"
2. 运行脚本：python refactor_parameters.py
3. 检查生成的报告：refactor_report.md
4. 测试应用是否正常工作
"""

import os
import re
import json
import sys
from pathlib import Path
from typing import Dict, List, Tuple, Set
from dataclasses import dataclass, asdict
from collections import defaultdict

# 设置标准输出编码为 UTF-8
if sys.platform == 'win32':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

# ============================================================================
# 配置区域
# ============================================================================

PROJECT_ROOT = Path(__file__).parent
SRC_DIR = PROJECT_ROOT / "src"

# 模型ID到前缀的映射规则
MODEL_PREFIX_MAP = {
    # 派欧云模型
    'seedream-4.0': 'ppioSeedream40',
    'vidu-q1': 'ppioViduQ1',
    'kling-2.5-turbo': 'ppioKling25',
    'minimax-hailuo-2.3': 'ppioHailuo23',
    'minimax-hailuo-02': 'ppioHailuo02',
    'pixverse-v4.5': 'ppioPixverse45',
    'wan-2.5-preview': 'ppioWan25',
    'seedance-v1': 'ppioSeedanceV1',
    'minimax-speech-2.6': 'ppioSpeech26',

    # Fal模型
    'fal-ai-nano-banana': 'falNanoBanana',
    'fal-ai-nano-banana-pro': 'falNanoBananaPro',
    'fal-ai-veo-3.1': 'falVeo31',
    'fal-ai-bytedance-seedream-v4': 'falSeedream40',
    'fal-ai-bytedance-seedream-v4.5': 'falSeedream45',
    'fal-ai-z-image-turbo': 'falZImageTurbo',
    'fal-ai-kling-image-o1': 'falKlingImageO1',
    'fal-ai-kling-video-o1': 'falKlingVideoO1',
    'fal-ai-kling-video-v2.6-pro': 'falKlingV26Pro',
    'fal-ai-sora-2': 'falSora2',
    'fal-ai-ltx-2': 'falLtx2',
    'fal-ai-bytedance-seedance-v1': 'falSeedanceV1',
    'fal-ai-vidu-q2': 'falViduQ2',
    'fal-ai-pixverse-v5.5': 'falPixverse55',
    'fal-ai-wan-25-preview': 'falWan25',
    'wan-25-preview': 'falWan25',  # 别名

    # 魔搭模型
    'Tongyi-MAI/Z-Image-Turbo': 'msZImageTurbo',
    'Qwen/Qwen-Image': 'msQwenImage',
    'Qwen/Qwen-Image-Edit-2509': 'msQwenImageEdit',
    'black-forest-labs/FLUX.1-Krea-dev': 'msFluxKrea',
    'modelscope-custom': 'msCustom',
}

# 需要重命名的通用参数（这些参数在多个模型中冲突）
CONFLICTING_PARAMS = {
    'videoDuration',
    'videoAspectRatio',
    'videoResolution',
    'videoNegativePrompt',
    'videoSeed',
    'aspectRatio',
    'num_images',
    'numImages',
    'resolution',
    'imageSize',
    'guidance',
    'negativePrompt',
    'steps',
}

# 模型特有参数（不需要重命名，因为已经有前缀）
MODEL_SPECIFIC_PARAMS = {
    'viduMode', 'viduAspectRatio', 'viduStyle', 'viduMovementAmplitude', 'viduBgm',
    'viduQ2Mode', 'viduQ2AspectRatio', 'viduQ2Resolution', 'viduQ2MovementAmplitude', 'viduQ2Bgm', 'viduQ2FastMode',
    'klingCfgScale', 'klingMode', 'klingAspectRatio', 'klingKeepAudio', 'klingElements',
    'klingV26AspectRatio', 'klingV26GenerateAudio', 'klingV26CfgScale',
    'hailuoFastMode', 'minimaxEnablePromptExpansion',
    'pixFastMode', 'pixStyle',
    'pixverseAspectRatio', 'pixverseResolution', 'pixverseStyle', 'pixverseThinkingType', 'pixverseGenerateAudio', 'pixverseMultiClip',
    'wanSize', 'wanPromptExtend', 'wanAudio', 'wanAspectRatio', 'wanResolution', 'wanPromptExpansion',
    'seedanceVariant', 'seedanceResolution', 'seedanceAspectRatio', 'seedanceCameraFixed',
    'seedanceMode', 'seedanceVersion', 'seedanceFastMode',
    'veoMode', 'veoAspectRatio', 'veoResolution', 'veoEnhancePrompt', 'veoGenerateAudio', 'veoAutoFix', 'veoFastMode',
    'soraMode', 'soraAspectRatio', 'soraResolution',
    'ltxResolution', 'ltxFps', 'ltxGenerateAudio', 'ltxFastMode', 'ltxRetakeDuration', 'ltxRetakeStartTime', 'ltxRetakeMode',
    'numInferenceSteps', 'enablePromptExpansion', 'acceleration',
    'modelscopeCustomModel', 'resolutionBaseSize',
    'voiceId', 'audioSpec', 'audioEmotion', 'languageBoost', 'audioVol', 'audioPitch', 'audioSpeed',
    'audioSampleRate', 'audioBitrate', 'audioFormat', 'audioChannel', 'latexRead', 'textNormalization',
    'selectedResolution', 'resolutionQuality', 'customWidth', 'customHeight', 'maxImages',
    'mode',  # LTX-2 的 mode
}

# ============================================================================
# 数据结构
# ============================================================================

@dataclass
class ParamRename:
    """参数重命名记录"""
    model_id: str
    old_name: str
    new_name: str
    file_path: str

@dataclass
class FileChange:
    """文件修改记录"""
    file_path: str
    changes: List[Tuple[str, str]]  # (old, new) pairs

# ============================================================================
# 核心功能
# ============================================================================

class ParameterRefactor:
    def __init__(self):
        self.param_renames: List[ParamRename] = []
        self.file_changes: Dict[str, FileChange] = {}
        self.model_params: Dict[str, Set[str]] = defaultdict(set)

    def analyze_models(self):
        """分析所有模型文件，找出需要重命名的参数"""
        print("[*] 分析模型文件...")

        models_dir = SRC_DIR / "models"
        for model_file in models_dir.glob("*.ts"):
            if model_file.name == "index.ts":
                continue

            # 从文件名推断模型ID
            model_id = model_file.stem

            # 读取文件内容
            content = model_file.read_text(encoding='utf-8')

            # 提取参数ID
            param_ids = re.findall(r"id:\s*['\"]([^'\"]+)['\"]", content)

            for param_id in param_ids:
                self.model_params[model_id].add(param_id)

                # 如果是冲突参数，记录需要重命名
                if param_id in CONFLICTING_PARAMS:
                    if model_id in MODEL_PREFIX_MAP:
                        prefix = MODEL_PREFIX_MAP[model_id]
                        # 将参数名首字母大写，拼接到前缀后
                        new_name = prefix + param_id[0].upper() + param_id[1:]

                        self.param_renames.append(ParamRename(
                            model_id=model_id,
                            old_name=param_id,
                            new_name=new_name,
                            file_path=str(model_file)
                        ))

        print(f"[OK] 发现 {len(self.param_renames)} 个需要重命名的参数")

    def generate_rename_mapping(self) -> Dict[str, Dict[str, str]]:
        """生成每个模型的参数重命名映射"""
        mapping = defaultdict(dict)
        for rename in self.param_renames:
            mapping[rename.model_id][rename.old_name] = rename.new_name
        return dict(mapping)

    def refactor_model_files(self, dry_run=True):
        """重构模型定义文件"""
        print("\n[*] 重构模型定义文件...")

        rename_map = self.generate_rename_mapping()

        for model_id, renames in rename_map.items():
            model_file = SRC_DIR / "models" / f"{model_id}.ts"
            if not model_file.exists():
                continue

            content = model_file.read_text(encoding='utf-8')
            original_content = content

            # 替换参数ID
            for old_name, new_name in renames.items():
                # 匹配 id: 'paramName' 或 id: "paramName"
                pattern = rf"(id:\s*['\"]){old_name}(['\"])"
                replacement = rf"\1{new_name}\2"
                content = re.sub(pattern, replacement, content)

            if content != original_content:
                if not dry_run:
                    model_file.write_text(content, encoding='utf-8')
                print(f"  [+] {model_file.name}")

                self.file_changes[str(model_file)] = FileChange(
                    file_path=str(model_file),
                    changes=[(old, new) for old, new in renames.items()]
                )

    def refactor_state_management(self, dry_run=True):
        """重构状态管理文件"""
        print("\n[*] 重构状态管理...")

        state_file = SRC_DIR / "components" / "MediaGenerator" / "hooks" / "useMediaGeneratorState.ts"
        if not state_file.exists():
            print("  [!] 状态文件不存在")
            return

        content = state_file.read_text(encoding='utf-8')
        original_content = content
        changes = []

        # 为每个模型的冲突参数创建独立的状态
        rename_map = self.generate_rename_mapping()

        # 收集所有需要添加的新状态
        new_states = []
        for model_id, renames in rename_map.items():
            for old_name, new_name in renames.items():
                # 检查是否已经存在这个状态
                if f"const [{new_name}," not in content:
                    # 找到旧状态的定义，复制一份作为新状态
                    old_state_pattern = rf"const \[{old_name},\s*set{old_name[0].upper() + old_name[1:]}\]\s*=\s*useState<[^>]+>\([^)]+\)"
                    match = re.search(old_state_pattern, content)
                    if match:
                        old_state_def = match.group(0)
                        # 生成新状态定义
                        new_state_def = old_state_def.replace(old_name, new_name)
                        new_state_def = new_state_def.replace(
                            f"set{old_name[0].upper() + old_name[1:]}",
                            f"set{new_name[0].upper() + new_name[1:]}"
                        )
                        new_states.append(new_state_def)
                        changes.append((old_name, new_name))

        # 在文件末尾的 return 语句之前添加新状态
        if new_states:
            # 找到最后一个 useState 的位置
            last_usestate_pos = content.rfind("useState")
            if last_usestate_pos != -1:
                # 找到这一行的结尾
                line_end = content.find("\n", last_usestate_pos)
                if line_end != -1:
                    # 在下一行插入新状态
                    insert_pos = line_end + 1
                    new_states_str = "\n  // 重构后的模型特定参数\n  " + "\n  ".join(new_states) + "\n"
                    content = content[:insert_pos] + new_states_str + content[insert_pos:]

        # 更新 return 语句，添加新的状态和 setter
        if new_states:
            # 找到 return 语句
            return_match = re.search(r"return\s*\{", content)
            if return_match:
                return_pos = return_match.end()
                # 生成新的返回项
                new_returns = []
                for model_id, renames in rename_map.items():
                    for old_name, new_name in renames.items():
                        setter_name = f"set{new_name[0].upper() + new_name[1:]}"
                        new_returns.append(f"    {new_name},\n    {setter_name},")

                if new_returns:
                    new_returns_str = "\n    // 重构后的参数\n" + "\n".join(new_returns) + "\n"
                    # 找到 return { 后的第一个换行
                    first_newline = content.find("\n", return_pos)
                    if first_newline != -1:
                        content = content[:first_newline] + new_returns_str + content[first_newline:]

        if content != original_content:
            if not dry_run:
                state_file.write_text(content, encoding='utf-8')
            print(f"  [+] {state_file.name}")

            self.file_changes[str(state_file)] = FileChange(
                file_path=str(state_file),
                changes=changes
            )

    def refactor_preset_mapping(self, dry_run=True):
        """重构预设映射文件"""
        print("\n[*] 重构预设映射...")

        mapping_file = SRC_DIR / "config" / "presetStateMapping.ts"
        if not mapping_file.exists():
            print("  [!] 映射文件不存在")
            return

        content = mapping_file.read_text(encoding='utf-8')
        original_content = content
        changes = []

        rename_map = self.generate_rename_mapping()

        # 在 PresetSetters 接口中添加新的 setter
        interface_match = re.search(r"export interface PresetSetters \{([^}]+)\}", content, re.DOTALL)
        if interface_match:
            interface_content = interface_match.group(1)
            new_setters = []

            for model_id, renames in rename_map.items():
                for old_name, new_name in renames.items():
                    setter_name = f"set{new_name[0].upper() + new_name[1:]}"
                    # 查找旧 setter 的类型定义
                    old_setter_name = f"set{old_name[0].upper() + old_name[1:]}"
                    type_pattern = rf"{old_setter_name}:\s*\([^)]+\)\s*=>\s*void"
                    type_match = re.search(type_pattern, interface_content)
                    if type_match:
                        old_type_def = type_match.group(0)
                        new_type_def = old_type_def.replace(old_setter_name, setter_name)
                        new_setters.append(f"    {new_type_def}")
                        changes.append((old_name, new_name))

            if new_setters:
                # 在接口末尾添加新 setter
                interface_end = interface_match.end() - 1
                new_setters_str = "\n\n    // 重构后的参数 setters\n" + "\n".join(new_setters) + "\n"
                content = content[:interface_end] + new_setters_str + content[interface_end:]

        # 在 createPresetSetterMap 函数中添加新的映射
        function_match = re.search(r"export function createPresetSetterMap\([^{]+\{([^}]+return \{[^}]+)\}", content, re.DOTALL)
        if function_match:
            new_mappings = []

            for model_id, renames in rename_map.items():
                for old_name, new_name in renames.items():
                    setter_name = f"set{new_name[0].upper() + new_name[1:]}"
                    new_mappings.append(f"        {new_name}: setters.{setter_name},")

            if new_mappings:
                # 找到 return 语句的结束位置
                return_match = re.search(r"return\s*\{([^}]+)\}", content, re.DOTALL)
                if return_match:
                    return_end = return_match.end() - 1
                    new_mappings_str = "\n\n        // 重构后的参数映射\n" + "\n".join(new_mappings) + "\n    "
                    content = content[:return_end] + new_mappings_str + content[return_end:]

        if content != original_content:
            if not dry_run:
                mapping_file.write_text(content, encoding='utf-8')
            print(f"  [+] {mapping_file.name}")

            self.file_changes[str(mapping_file)] = FileChange(
                file_path=str(mapping_file),
                changes=changes
            )

    def generate_migration_script(self):
        """生成数据迁移脚本"""
        print("\n[*] 生成数据迁移脚本...")

        rename_map = self.generate_rename_mapping()

        migration_code = '''/**
 * 参数重构数据迁移工具
 * 用于迁移 localStorage 中的历史记录和预设数据
 *
 * 使用方法：
 * 1. 将此文件放到 src/utils/parameterMigration.ts
 * 2. 在 App.tsx 的开头调用 migrateAllData()
 */

// 参数重命名映射表
const PARAM_RENAME_MAP: Record<string, Record<string, string>> = ''' + json.dumps(rename_map, indent=2) + ''';

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
    console.log('✅ 数据已迁移，跳过');
    return;
  }

  console.log('🔄 开始数据迁移...');

  migrateHistory();
  migratePresets();

  // 标记为已迁移
  localStorage.setItem('params_migrated_v1', 'true');

  console.log('✅ 所有数据迁移完成');
}
'''

        migration_file = SRC_DIR / "utils" / "parameterMigration.ts"
        migration_file.parent.mkdir(parents=True, exist_ok=True)
        migration_file.write_text(migration_code, encoding='utf-8')

        print(f"  [+] {migration_file}")

    def generate_report(self):
        """生成重构报告"""
        print("\n[*] 生成重构报告...")

        report = f"""# 参数重构报告

## 概览

- **重命名参数数量**: {len(self.param_renames)}
- **修改文件数量**: {len(self.file_changes)}
- **涉及模型数量**: {len(set(r.model_id for r in self.param_renames))}

## 参数重命名详情

"""

        # 按模型分组显示
        rename_map = self.generate_rename_mapping()
        for model_id, renames in sorted(rename_map.items()):
            report += f"### {model_id}\n\n"
            report += "| 旧参数名 | 新参数名 |\n"
            report += "|---------|----------|\n"
            for old_name, new_name in sorted(renames.items()):
                report += f"| `{old_name}` | `{new_name}` |\n"
            report += "\n"

        report += "## 修改文件列表\n\n"
        for file_path in sorted(self.file_changes.keys()):
            report += f"- `{file_path}`\n"

        report += "\n## 下一步操作\n\n"
        report += "1. ✅ 检查生成的迁移脚本：`src/utils/parameterMigration.ts`\n"
        report += "2. ✅ 在 `App.tsx` 中导入并调用 `migrateAllData()`\n"
        report += "3. ✅ 运行 `npm run dev` 测试应用\n"
        report += "4. ✅ 测试以下功能：\n"
        report += "   - 切换不同模型\n"
        report += "   - 修改参数\n"
        report += "   - 保存和加载预设\n"
        report += "   - 从历史记录重新编辑\n"
        report += "5. ✅ 如果一切正常，提交代码：`git commit -am 'refactor: resolve parameter conflicts'`\n"

        report_file = PROJECT_ROOT / "refactor_report.md"
        report_file.write_text(report, encoding='utf-8')

        print(f"  [+] {report_file}")

    def run(self, dry_run=True, skip_confirm=False):
        """执行完整的重构流程"""
        print("=" * 60)
        print("参数重构自动化脚本")
        print("=" * 60)

        if dry_run:
            print("\n[!] DRY RUN 模式 - 不会修改任何文件")
        else:
            print("\n[!] 实际执行模式 - 将修改文件！")
            if not skip_confirm:
                response = input("确认继续？(yes/no): ")
                if response.lower() != 'yes':
                    print("[X] 已取消")
                    return
            else:
                print("[!] 自动确认模式 - 跳过确认步骤")

        # 1. 分析模型
        self.analyze_models()

        # 2. 重构模型文件
        self.refactor_model_files(dry_run)

        # 3. 重构状态管理
        self.refactor_state_management(dry_run)

        # 4. 重构预设映射
        self.refactor_preset_mapping(dry_run)

        # 5. 生成迁移脚本
        if not dry_run:
            self.generate_migration_script()

        # 6. 生成报告
        self.generate_report()

        print("\n" + "=" * 60)
        if dry_run:
            print("[OK] DRY RUN 完成！查看 refactor_report.md 了解详情")
            print("[TIP] 运行 'python refactor_parameters.py --execute' 执行实际重构")
        else:
            print("[OK] 重构完成！")
            print("[INFO] 查看 refactor_report.md 了解详情")
            print("[TODO] 记得在 App.tsx 中调用 migrateAllData()")
        print("=" * 60)

# ============================================================================
# 主程序
# ============================================================================

if __name__ == "__main__":
    import sys

    dry_run = "--execute" not in sys.argv
    skip_confirm = "--yes" in sys.argv or "-y" in sys.argv

    refactor = ParameterRefactor()
    refactor.run(dry_run=dry_run, skip_confirm=skip_confirm)
