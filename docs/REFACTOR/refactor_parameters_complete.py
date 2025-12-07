#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
完整的参数重构自动化脚本
处理所有相关文件，包括适配器、组件、构建器等

使用方法：
1. 先运行基础脚本查看报告：python refactor_parameters.py
2. 备份项目：git commit -am "backup before complete refactor"
3. 运行完整脚本：python refactor_parameters_complete.py --execute
4. 测试应用
"""

import os
import re
import json
import sys
from pathlib import Path
from typing import Dict, List, Tuple, Set
from collections import defaultdict

# 设置标准输出编码为 UTF-8
if sys.platform == 'win32':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

PROJECT_ROOT = Path(__file__).parent
SRC_DIR = PROJECT_ROOT / "src"

# 参数重命名映射（从基础脚本生成的报告中提取）
PARAM_RENAME_MAP = {
    'fal-ai-bytedance-seedance-v1': {
        'videoDuration': 'falSeedanceV1VideoDuration'
    },
    'fal-ai-bytedance-seedream-v4': {
        'numImages': 'falSeedream40NumImages'
    },
    'fal-ai-kling-image-o1': {
        'aspectRatio': 'falKlingImageO1AspectRatio',
        'num_images': 'falKlingImageO1NumImages'
    },
    'fal-ai-kling-video-v2.6-pro': {
        'videoDuration': 'falKlingV26ProVideoDuration'
    },
    'fal-ai-ltx-2': {
        'videoDuration': 'falLtx2VideoDuration'
    },
    'fal-ai-nano-banana': {
        'aspectRatio': 'falNanoBananaAspectRatio',
        'num_images': 'falNanoBananaNumImages'
    },
    'fal-ai-nano-banana-pro': {
        'aspectRatio': 'falNanoBananaProAspectRatio',
        'num_images': 'falNanoBananaProNumImages'
    },
    'fal-ai-pixverse-v5.5': {
        'videoDuration': 'falPixverse55VideoDuration'
    },
    'fal-ai-sora-2': {
        'videoDuration': 'falSora2VideoDuration'
    },
    'fal-ai-veo-3.1': {
        'videoDuration': 'falVeo31VideoDuration'
    },
    'fal-ai-vidu-q2': {
        'videoDuration': 'falViduQ2VideoDuration'
    },
    'fal-ai-wan-25-preview': {
        'videoDuration': 'falWan25VideoDuration'
    },
    'wan-25-preview': {  # 别名
        'videoDuration': 'falWan25VideoDuration'
    },
    'fal-ai-z-image-turbo': {
        'imageSize': 'falZImageTurboImageSize',
        'numImages': 'falZImageTurboNumImages'
    },
    'kling-2.5-turbo': {
        'videoAspectRatio': 'ppioKling25VideoAspectRatio',
        'videoDuration': 'ppioKling25VideoDuration'
    },
    'minimax-hailuo-2.3': {
        'videoDuration': 'ppioHailuo23VideoDuration',
        'videoResolution': 'ppioHailuo23VideoResolution'
    },
    'pixverse-v4.5': {
        'videoAspectRatio': 'ppioPixverse45VideoAspectRatio',
        'videoResolution': 'ppioPixverse45VideoResolution'
    },
    'seedance-v1': {
        'videoDuration': 'ppioSeedanceV1VideoDuration'
    },
    'wan-2.5-preview': {
        'videoDuration': 'ppioWan25VideoDuration'
    }
}

class CompleteRefactor:
    def __init__(self):
        self.files_modified = []
        self.errors = []

    def refactor_adapters(self, dry_run=True):
        """重构适配器文件"""
        print("\n[*] 重构适配器文件...")

        adapters_dir = SRC_DIR / "adapters"

        for adapter_file in adapters_dir.rglob("*.ts"):
            if adapter_file.name == "index.ts":
                continue

            content = adapter_file.read_text(encoding='utf-8')
            original_content = content

            # 尝试从文件名或内容推断模型ID
            for model_id, renames in PARAM_RENAME_MAP.items():
                # 检查文件是否与这个模型相关
                model_key = model_id.replace('fal-ai-', '').replace('-', '')
                if model_key in adapter_file.stem.replace('-', '').lower():
                    # 替换参数引用
                    for old_name, new_name in renames.items():
                        # 匹配 options.paramName 或 options?.paramName
                        patterns = [
                            (rf"(options\??\.){old_name}\b", rf"\1{new_name}"),
                            (rf"(['\"]{old_name}['\"])", rf"'{new_name}'"),
                        ]

                        for pattern, replacement in patterns:
                            content = re.sub(pattern, replacement, content)

            if content != original_content:
                if not dry_run:
                    adapter_file.write_text(content, encoding='utf-8')
                print(f"  [+] {adapter_file.relative_to(SRC_DIR)}")
                self.files_modified.append(str(adapter_file))

    def refactor_options_builder(self, dry_run=True):
        """重构选项构建器"""
        print("\n[*] 重构选项构建器...")

        builder_file = SRC_DIR / "components" / "MediaGenerator" / "builders" / "optionsBuilder.ts"
        if not builder_file.exists():
            print("  [!] 构建器文件不存在")
            return

        content = builder_file.read_text(encoding='utf-8')
        original_content = content

        # 替换参数引用
        for model_id, renames in PARAM_RENAME_MAP.items():
            for old_name, new_name in renames.items():
                # 匹配参数解构和使用
                patterns = [
                    # 函数参数中的解构
                    (rf"\b{old_name}(?=\s*[,:])", new_name),
                    # 对象属性访问
                    (rf"\.{old_name}\b", f".{new_name}"),
                ]

                for pattern, replacement in patterns:
                    content = re.sub(pattern, replacement, content)

        if content != original_content:
            if not dry_run:
                builder_file.write_text(content, encoding='utf-8')
            print(f"  [+] {builder_file.name}")
            self.files_modified.append(str(builder_file))

    def refactor_components(self, dry_run=True):
        """重构组件文件"""
        print("\n[*] 重构组件文件...")

        component_files = [
            SRC_DIR / "components" / "MediaGenerator" / "index.tsx",
            SRC_DIR / "components" / "MediaGenerator" / "components" / "ParameterPanel.tsx",
            SRC_DIR / "components" / "MediaGenerator" / "components" / "InputArea.tsx",
        ]

        for comp_file in component_files:
            if not comp_file.exists():
                continue

            content = comp_file.read_text(encoding='utf-8')
            original_content = content

            # 替换参数引用
            for model_id, renames in PARAM_RENAME_MAP.items():
                for old_name, new_name in renames.items():
                    # 匹配 state.paramName 或 values.paramName
                    patterns = [
                        (rf"\bstate\.{old_name}\b", f"state.{new_name}"),
                        (rf"\bvalues\.{old_name}\b", f"values.{new_name}"),
                        (rf"\b{old_name}(?=\s*[,:])", new_name),
                    ]

                    for pattern, replacement in patterns:
                        content = re.sub(pattern, replacement, content)

            if content != original_content:
                if not dry_run:
                    comp_file.write_text(content, encoding='utf-8')
                print(f"  [+] {comp_file.name}")
                self.files_modified.append(str(comp_file))

    def refactor_pricing(self, dry_run=True):
        """重构价格计算文件"""
        print("\n[*] 重构价格计算...")

        pricing_file = SRC_DIR / "config" / "pricing.ts"
        if not pricing_file.exists():
            print("  [!] 价格文件不存在")
            return

        content = pricing_file.read_text(encoding='utf-8')
        original_content = content

        # 替换参数引用
        for model_id, renames in PARAM_RENAME_MAP.items():
            for old_name, new_name in renames.items():
                # 匹配 params.paramName 或 params?.paramName
                patterns = [
                    (rf"params\??\.{old_name}\b", f"params.{new_name}"),
                ]

                for pattern, replacement in patterns:
                    content = re.sub(pattern, replacement, content)

        if content != original_content:
            if not dry_run:
                pricing_file.write_text(content, encoding='utf-8')
            print(f"  [+] {pricing_file.name}")
            self.files_modified.append(str(pricing_file))

    def generate_summary(self):
        """生成完整重构总结"""
        print("\n[*] 生成完整重构总结...")

        summary = f"""# 完整参数重构总结

## 修改统计

- **修改文件总数**: {len(self.files_modified)}
- **错误数量**: {len(self.errors)}

## 修改文件列表

"""
        for file_path in sorted(self.files_modified):
            summary += f"- `{file_path}`\n"

        if self.errors:
            summary += "\n## 错误列表\n\n"
            for error in self.errors:
                summary += f"- {error}\n"

        summary += """
## 重要提醒

### 1. 手动检查项

由于脚本无法完美处理所有情况，请手动检查以下内容：

#### A. 条件判断中的模型ID匹配
```typescript
// 需要手动检查这类代码
if (selectedModel === 'fal-ai-wan-25-preview') {
  // 确保使用了新的参数名 falWan25VideoDuration
}
```

#### B. 动态参数访问
```typescript
// 需要手动检查这类代码
const value = options[paramName]  // 如果 paramName 是旧名称，需要更新
```

#### C. 类型定义
检查 `src/types/` 目录下的类型定义文件，确保参数类型也已更新。

### 2. 测试清单

- [ ] 运行 `npm run dev` 确保没有编译错误
- [ ] 测试每个模型的参数修改
- [ ] 测试保存和加载预设
- [ ] 测试从历史记录重新编辑
- [ ] 测试价格估算是否正确
- [ ] 测试模型切换时参数是否正确重置

### 3. 数据迁移

确保已经：
1. 在 `App.tsx` 中导入并调用 `migrateAllData()`
2. 测试迁移功能是否正常工作
3. 备份用户数据（如果是生产环境）

### 4. 提交代码

```bash
git add .
git commit -m "refactor: resolve all parameter conflicts

- Renamed 25 conflicting parameters across 18 models
- Updated adapters, components, builders, and pricing
- Added data migration for localStorage
- Generated by automated refactor script"
```
"""

        summary_file = PROJECT_ROOT / "refactor_complete_summary.md"
        summary_file.write_text(summary, encoding='utf-8')

        print(f"  [+] {summary_file}")

    def run(self, dry_run=True):
        """执行完整重构"""
        print("=" * 60)
        print("完整参数重构脚本")
        print("=" * 60)

        if dry_run:
            print("\n[!] DRY RUN 模式 - 不会修改任何文件")
        else:
            print("\n[!] 实际执行模式 - 将修改文件！")
            print("[!] 请确保已经运行基础脚本并查看了报告")
            response = input("确认继续？(yes/no): ")
            if response.lower() != 'yes':
                print("[X] 已取消")
                return

        try:
            # 1. 重构适配器
            self.refactor_adapters(dry_run)

            # 2. 重构选项构建器
            self.refactor_options_builder(dry_run)

            # 3. 重构组件
            self.refactor_components(dry_run)

            # 4. 重构价格计算
            self.refactor_pricing(dry_run)

            # 5. 生成总结
            self.generate_summary()

            print("\n" + "=" * 60)
            if dry_run:
                print("[OK] DRY RUN 完成！")
                print("[INFO] 查看 refactor_complete_summary.md 了解详情")
                print("[TIP] 运行 'python refactor_parameters_complete.py --execute' 执行实际重构")
            else:
                print("[OK] 完整重构完成！")
                print("[INFO] 查看 refactor_complete_summary.md 了解详情")
                print("[TODO] 按照总结中的测试清单进行测试")
            print("=" * 60)

        except Exception as e:
            print(f"\n[ERROR] 重构过程中出错: {e}")
            import traceback
            traceback.print_exc()
            self.errors.append(str(e))

if __name__ == "__main__":
    import sys

    dry_run = "--execute" not in sys.argv

    refactor = CompleteRefactor()
    refactor.run(dry_run=dry_run)
