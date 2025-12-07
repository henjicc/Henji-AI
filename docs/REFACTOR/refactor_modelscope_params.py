#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
重构魔搭模型参数：steps, guidance, negativePrompt
"""

import re
from pathlib import Path

# 参数重命名映射
PARAM_RENAMES = {
    'steps': 'modelscopeSteps',
    'guidance': 'modelscopeGuidance',
    'negativePrompt': 'modelscopeNegativePrompt',
}

def rename_in_file(filepath: Path, renames: dict) -> bool:
    """在文件中重命名参数"""
    try:
        content = filepath.read_text(encoding='utf-8')
        original_content = content

        for old_name, new_name in renames.items():
            # 1. 重命名 id: 'xxx' 格式
            content = re.sub(
                rf"id:\s*['\"]({old_name})['\"]",
                f"id: '{new_name}'",
                content
            )

            # 2. 重命名 setter 函数名 (setXxx)
            old_setter = 'set' + old_name[0].upper() + old_name[1:]
            new_setter = 'set' + new_name[0].upper() + new_name[1:]
            content = re.sub(
                rf'\b{old_setter}\b',
                new_setter,
                content
            )

            # 3. 重命名 state 变量声明 const [xxx, setXxx]
            content = re.sub(
                rf'\bconst\s+\[\s*{old_name}\s*,\s*{new_setter}\s*\]',
                f'const [{new_name}, {new_setter}]',
                content
            )

            # 4. 重命名对象属性访问
            # 对象属性简写 { xxx }
            content = re.sub(
                rf'\{{\s*{old_name}\s*\}}',
                f'{{{new_name}}}',
                content
            )

            # 对象属性 xxx: yyy (但要小心不要误改其他地方)
            content = re.sub(
                rf'(\W){old_name}:',
                rf'\1{new_name}:',
                content
            )

            # state.xxx, values.xxx, params.xxx, options.xxx
            for prefix in ['state', 'values', 'params', 'options', 'setters']:
                content = re.sub(
                    rf'\b{prefix}\.{old_name}\b',
                    f'{prefix}.{new_name}',
                    content
                )

            # 5. 重命名 onChange 回调中的参数名
            content = re.sub(
                rf"onChange\(['\"]({old_name})['\"]",
                f"onChange('{new_name}'",
                content
            )

        if content != original_content:
            filepath.write_text(content, encoding='utf-8')
            return True
        return False

    except Exception as e:
        print(f"[ERROR] Failed to process {filepath}: {e}")
        return False

def main():
    """主函数"""
    base_dir = Path(__file__).parent

    # 需要处理的文件列表
    files_to_process = [
        # 模型参数定义
        'src/models/modelscope-common.ts',

        # 组件
        'src/components/MediaGenerator/index.tsx',
        'src/components/MediaGenerator/components/ParameterPanel.tsx',
        'src/components/MediaGenerator/builders/optionsBuilder.ts',
        'src/components/MediaGenerator/hooks/useMediaGeneratorState.ts',

        # 配置
        'src/config/presetStateMapping.ts',
    ]

    updated_count = 0

    for file_path in files_to_process:
        full_path = base_dir / file_path
        if not full_path.exists():
            print(f"[SKIP] File not found: {file_path}")
            continue

        if rename_in_file(full_path, PARAM_RENAMES):
            print(f"[OK] Updated: {file_path}")
            updated_count += 1
        else:
            print(f"[SKIP] No changes: {file_path}")

    print(f"\n[DONE] Updated {updated_count} files")

if __name__ == '__main__':
    main()
