#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
重构剩余的通用参数：
1. imageSize → modelscopeImageSize
2. resolution → falNanoBananaProResolution 和 falKlingImageO1Resolution
"""

import re
from pathlib import Path

def rename_imagesize_in_file(filepath: Path) -> bool:
    """重命名 imageSize 为 modelscopeImageSize"""
    try:
        content = filepath.read_text(encoding='utf-8')
        original_content = content

        # 1. 重命名 id: 'imageSize' 格式
        content = re.sub(
            r"id:\s*['\"]imageSize['\"]",
            "id: 'modelscopeImageSize'",
            content
        )

        # 2. 重命名 setter 函数名
        content = re.sub(
            r'\bsetImageSize\b',
            'setModelscopeImageSize',
            content
        )

        # 3. 重命名 state 变量声明
        content = re.sub(
            r'\bconst\s+\[\s*imageSize\s*,\s*setModelscopeImageSize\s*\]',
            'const [modelscopeImageSize, setModelscopeImageSize]',
            content
        )

        # 4. 重命名对象属性访问
        for prefix in ['state', 'values', 'params', 'options', 'setters']:
            content = re.sub(
                rf'\b{prefix}\.imageSize\b',
                f'{prefix}.modelscopeImageSize',
                content
            )

        # 5. 重命名 onChange 回调
        content = re.sub(
            r"onChange\(['\"]imageSize['\"]",
            "onChange('modelscopeImageSize'",
            content
        )

        # 6. 重命名对象属性简写
        content = re.sub(
            r'\{\s*imageSize\s*\}',
            '{modelscopeImageSize}',
            content
        )

        # 7. 重命名对象属性 imageSize:
        content = re.sub(
            r'(\W)imageSize:',
            r'\1modelscopeImageSize:',
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
        'src/models/qwen-image-edit-2509.ts',

        # 组件
        'src/components/MediaGenerator/index.tsx',
        'src/components/MediaGenerator/components/ParameterPanel.tsx',
        'src/components/MediaGenerator/builders/optionsBuilder.ts',
        'src/components/MediaGenerator/hooks/useMediaGeneratorState.ts',

        # 配置
        'src/config/presetStateMapping.ts',
    ]

    updated_count = 0

    print("=== 重命名 imageSize → modelscopeImageSize ===")
    for file_path in files_to_process:
        full_path = base_dir / file_path
        if not full_path.exists():
            print(f"[SKIP] File not found: {file_path}")
            continue

        if rename_imagesize_in_file(full_path):
            print(f"[OK] Updated: {file_path}")
            updated_count += 1
        else:
            print(f"[SKIP] No changes: {file_path}")

    print(f"\n[DONE] Updated {updated_count} files")

if __name__ == '__main__':
    main()
