#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
完成剩余文件的重构
处理适配器、选项构建器、组件、价格计算等文件
"""

import os
import re
import sys
from pathlib import Path

# 设置标准输出编码为 UTF-8
if sys.platform == 'win32':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

PROJECT_ROOT = Path(__file__).parent
SRC_DIR = PROJECT_ROOT / "src"

# 参数重命名映射
PARAM_RENAMES = {
    'fal-ai-bytedance-seedance-v1': {'videoDuration': 'falSeedanceV1VideoDuration'},
    'fal-ai-bytedance-seedream-v4': {'numImages': 'falSeedream40NumImages'},
    'fal-ai-kling-image-o1': {'aspectRatio': 'falKlingImageO1AspectRatio', 'num_images': 'falKlingImageO1NumImages'},
    'fal-ai-kling-video-v2.6-pro': {'videoDuration': 'falKlingV26ProVideoDuration'},
    'fal-ai-ltx-2': {'videoDuration': 'falLtx2VideoDuration'},
    'fal-ai-nano-banana': {'aspectRatio': 'falNanoBananaAspectRatio', 'num_images': 'falNanoBananaNumImages'},
    'fal-ai-nano-banana-pro': {'aspectRatio': 'falNanoBananaProAspectRatio', 'num_images': 'falNanoBananaProNumImages'},
    'fal-ai-pixverse-v5.5': {'videoDuration': 'falPixverse55VideoDuration'},
    'fal-ai-sora-2': {'videoDuration': 'falSora2VideoDuration'},
    'fal-ai-veo-3.1': {'videoDuration': 'falVeo31VideoDuration'},
    'fal-ai-vidu-q2': {'videoDuration': 'falViduQ2VideoDuration'},
    'fal-ai-wan-25-preview': {'videoDuration': 'falWan25VideoDuration'},
    'wan-25-preview': {'videoDuration': 'falWan25VideoDuration'},
    'fal-ai-z-image-turbo': {'imageSize': 'falZImageTurboImageSize', 'numImages': 'falZImageTurboNumImages'},
    'kling-2.5-turbo': {'videoAspectRatio': 'ppioKling25VideoAspectRatio', 'videoDuration': 'ppioKling25VideoDuration'},
    'minimax-hailuo-2.3': {'videoDuration': 'ppioHailuo23VideoDuration', 'videoResolution': 'ppioHailuo23VideoResolution'},
    'pixverse-v4.5': {'videoAspectRatio': 'ppioPixverse45VideoAspectRatio', 'videoResolution': 'ppioPixverse45VideoResolution'},
    'seedance-v1': {'videoDuration': 'ppioSeedanceV1VideoDuration'},
    'wan-2.5-preview': {'videoDuration': 'ppioWan25VideoDuration'}
}

def refactor_file(file_path: Path, model_id: str = None):
    """重构单个文件"""
    if not file_path.exists():
        return False

    content = file_path.read_text(encoding='utf-8')
    original_content = content

    # 如果指定了模型ID，只替换该模型的参数
    if model_id and model_id in PARAM_RENAMES:
        renames = PARAM_RENAMES[model_id]
        for old_name, new_name in renames.items():
            # 替换各种可能的引用方式
            patterns = [
                # options.paramName 或 options?.paramName
                (rf'\boptions\??\.{old_name}\b', f'options.{new_name}'),
                # state.paramName
                (rf'\bstate\.{old_name}\b', f'state.{new_name}'),
                # values.paramName
                (rf'\bvalues\.{old_name}\b', f'values.{new_name}'),
                # params.paramName
                (rf'\bparams\??\.{old_name}\b', f'params.{new_name}'),
                # paramName: 对象属性
                (rf'\b{old_name}:', f'{new_name}:'),
            ]

            for pattern, replacement in patterns:
                content = re.sub(pattern, replacement, content)
    else:
        # 如果没有指定模型ID，尝试从文件名推断并替换所有相关参数
        for mid, renames in PARAM_RENAMES.items():
            # 检查文件名是否包含模型标识
            model_key = mid.replace('fal-ai-', '').replace('-', '').lower()
            file_key = file_path.stem.replace('-', '').lower()

            if model_key in file_key or file_key in model_key:
                for old_name, new_name in renames.items():
                    patterns = [
                        (rf'\boptions\??\.{old_name}\b', f'options.{new_name}'),
                        (rf'\bstate\.{old_name}\b', f'state.{new_name}'),
                        (rf'\bvalues\.{old_name}\b', f'values.{new_name}'),
                        (rf'\bparams\??\.{old_name}\b', f'params.{new_name}'),
                        (rf'\b{old_name}:', f'{new_name}:'),
                    ]

                    for pattern, replacement in patterns:
                        content = re.sub(pattern, replacement, content)

    if content != original_content:
        file_path.write_text(content, encoding='utf-8')
        return True
    return False

def main():
    print("=" * 60)
    print("剩余文件重构脚本")
    print("=" * 60)

    modified_files = []

    # 1. 重构适配器文件
    print("\n[*] 重构适配器文件...")
    adapters_dir = SRC_DIR / "adapters"
    for adapter_file in adapters_dir.rglob("*.ts"):
        if adapter_file.name == "index.ts":
            continue
        if refactor_file(adapter_file):
            print(f"  [+] {adapter_file.relative_to(SRC_DIR)}")
            modified_files.append(str(adapter_file))

    # 2. 重构选项构建器
    print("\n[*] 重构选项构建器...")
    builder_file = SRC_DIR / "components" / "MediaGenerator" / "builders" / "optionsBuilder.ts"
    if refactor_file(builder_file):
        print(f"  [+] {builder_file.name}")
        modified_files.append(str(builder_file))

    # 3. 重构组件文件
    print("\n[*] 重构组件文件...")
    component_files = [
        SRC_DIR / "components" / "MediaGenerator" / "index.tsx",
        SRC_DIR / "components" / "MediaGenerator" / "components" / "ParameterPanel.tsx",
        SRC_DIR / "components" / "MediaGenerator" / "components" / "InputArea.tsx",
    ]
    for comp_file in component_files:
        if comp_file.exists() and refactor_file(comp_file):
            print(f"  [+] {comp_file.name}")
            modified_files.append(str(comp_file))

    # 4. 重构价格计算
    print("\n[*] 重构价格计算...")
    pricing_file = SRC_DIR / "config" / "pricing.ts"
    if refactor_file(pricing_file):
        print(f"  [+] {pricing_file.name}")
        modified_files.append(str(pricing_file))

    print("\n" + "=" * 60)
    print(f"[OK] 重构完成！共修改 {len(modified_files)} 个文件")
    print("=" * 60)

    return len(modified_files)

if __name__ == "__main__":
    modified_count = main()
    sys.exit(0 if modified_count >= 0 else 1)
