#!/usr/bin/env python3
"""
批量重命名参数脚本
将所有旧的参数名重命名为新的"供应商+模型+版本"格式
"""

import os
import re
from pathlib import Path

# 参数重命名映射表
PARAM_RENAMES = {
    # Vidu Q1 (派欧云) - 已完成
    'viduMode': 'ppioViduQ1Mode',
    'viduAspectRatio': 'ppioViduQ1AspectRatio',
    'viduStyle': 'ppioViduQ1Style',
    'viduMovementAmplitude': 'ppioViduQ1MovementAmplitude',
    'viduBgm': 'ppioViduQ1Bgm',

    # Kling 2.5 Turbo (派欧云)
    'klingCfgScale': 'ppioKling25CfgScale',

    # Hailuo (派欧云)
    'hailuoFastMode': 'ppioHailuo23FastMode',
    'minimaxEnablePromptExpansion': 'ppioHailuo23EnablePromptExpansion',

    # PixVerse v4.5 (派欧云)
    'pixFastMode': 'ppioPixverse45FastMode',
    'pixStyle': 'ppioPixverse45Style',

    # Wan 2.5 (派欧云)
    'wanSize': 'ppioWan25Size',
    'wanPromptExtend': 'ppioWan25PromptExtend',
    'wanAudio': 'ppioWan25Audio',

    # Wan 2.5 (Fal)
    'wanAspectRatio': 'falWan25AspectRatio',
    'wanResolution': 'falWan25Resolution',
    'wanPromptExpansion': 'falWan25PromptExpansion',

    # Seedance (派欧云)
    'seedanceVariant': 'ppioSeedanceV1Variant',
    'seedanceResolution': 'ppioSeedanceV1Resolution',
    'seedanceAspectRatio': 'ppioSeedanceV1AspectRatio',
    'seedanceCameraFixed': 'ppioSeedanceV1CameraFixed',

    # Seedance v1 (Fal)
    'seedanceMode': 'falSeedanceV1Mode',
    'seedanceVersion': 'falSeedanceV1Version',
    'seedanceFastMode': 'falSeedanceV1FastMode',

    # Veo 3.1 (Fal)
    'veoMode': 'falVeo31Mode',
    'veoAspectRatio': 'falVeo31AspectRatio',
    'veoResolution': 'falVeo31Resolution',
    'veoEnhancePrompt': 'falVeo31EnhancePrompt',
    'veoGenerateAudio': 'falVeo31GenerateAudio',
    'veoAutoFix': 'falVeo31AutoFix',
    'veoFastMode': 'falVeo31FastMode',

    # Kling Video O1 (Fal)
    'klingMode': 'falKlingVideoO1Mode',
    'klingAspectRatio': 'falKlingVideoO1AspectRatio',
    'klingKeepAudio': 'falKlingVideoO1KeepAudio',
    'klingElements': 'falKlingVideoO1Elements',

    # Kling v2.6 Pro (Fal)
    'klingV26AspectRatio': 'falKlingV26ProAspectRatio',
    'klingV26GenerateAudio': 'falKlingV26ProGenerateAudio',
    'klingV26CfgScale': 'falKlingV26ProCfgScale',

    # Sora 2 (Fal)
    'soraMode': 'falSora2Mode',
    'soraAspectRatio': 'falSora2AspectRatio',
    'soraResolution': 'falSora2Resolution',

    # LTX-2 (Fal)
    'mode': 'falLtx2Mode',  # 注意：这个需要特别小心，只在 LTX-2 相关代码中替换
    'ltxResolution': 'falLtx2Resolution',
    'ltxFps': 'falLtx2Fps',
    'ltxGenerateAudio': 'falLtx2GenerateAudio',
    'ltxFastMode': 'falLtx2FastMode',
    'ltxRetakeDuration': 'falLtx2RetakeDuration',
    'ltxRetakeStartTime': 'falLtx2RetakeStartTime',
    'ltxRetakeMode': 'falLtx2RetakeMode',

    # Vidu Q2 (Fal)
    'viduQ2Mode': 'falViduQ2Mode',
    'viduQ2AspectRatio': 'falViduQ2AspectRatio',
    'viduQ2Resolution': 'falViduQ2Resolution',
    'viduQ2MovementAmplitude': 'falViduQ2MovementAmplitude',
    'viduQ2Bgm': 'falViduQ2Bgm',
    'viduQ2FastMode': 'falViduQ2FastMode',

    # Pixverse V5.5 (Fal)
    'pixverseAspectRatio': 'falPixverse55AspectRatio',
    'pixverseResolution': 'falPixverse55Resolution',
    'pixverseStyle': 'falPixverse55Style',
    'pixverseThinkingType': 'falPixverse55ThinkingType',
    'pixverseGenerateAudio': 'falPixverse55GenerateAudio',
    'pixverseMultiClip': 'falPixverse55MultiClip',
}

# 需要特殊处理的参数（只在特定上下文中替换）
CONTEXT_SPECIFIC_RENAMES = {
    'mode': {
        'new_name': 'falLtx2Mode',
        'contexts': ['ltx', 'LTX', 'Ltx']  # 只在包含这些关键词的上下文中替换
    }
}

def should_skip_file(filepath):
    """判断是否应该跳过该文件"""
    skip_patterns = [
        'node_modules',
        '.git',
        'dist',
        'build',
        '__pycache__',
        '.pyc',
        'batch_rename_params.py'
    ]
    return any(pattern in str(filepath) for pattern in skip_patterns)

def replace_in_file(filepath, dry_run=True):
    """在文件中替换参数名"""
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read()

        original_content = content
        changes = []

        # 执行替换
        for old_name, new_name in PARAM_RENAMES.items():
            # 跳过 'mode' 参数，它需要特殊处理
            if old_name == 'mode':
                continue

            # 匹配各种模式
            patterns = [
                # id: 'paramName'
                (rf"id:\s*['\"]({old_name})['\"]", rf"id: '{new_name}'"),
                # paramName:
                (rf"\b({old_name}):", rf"{new_name}:"),
                # .paramName
                (rf"\.({old_name})\b", rf".{new_name}"),
                # {paramName}
                (rf"\{{(\s*)({old_name})(\s*)\}}", rf"{{\1{new_name}\3}}"),
                # values.paramName
                (rf"values\.({old_name})\b", rf"values.{new_name}"),
                # state.paramName
                (rf"state\.({old_name})\b", rf"state.{new_name}"),
                # params.paramName
                (rf"params\.({old_name})\b", rf"params.{new_name}"),
                # setParamName
                (rf"\bset{old_name[0].upper()}{old_name[1:]}\b",
                 rf"set{new_name[0].upper()}{new_name[1:]}"),
            ]

            for pattern, replacement in patterns:
                new_content = re.sub(pattern, replacement, content)
                if new_content != content:
                    count = len(re.findall(pattern, content))
                    changes.append(f"  - {old_name} -> {new_name}: {count} occurrences")
                    content = new_content

        # 特殊处理 'mode' 参数（只在 LTX-2 相关代码中替换）
        if 'ltx' in str(filepath).lower() or 'LTX' in original_content or 'Ltx' in original_content:
            old_name = 'mode'
            new_name = 'falLtx2Mode'
            patterns = [
                (rf"id:\s*['\"]({old_name})['\"]", rf"id: '{new_name}'"),
                (rf"(?<!ltx)({old_name}):", rf"{new_name}:"),  # 避免匹配 ltxMode:
                (rf"\.({old_name})\b", rf".{new_name}"),
                (rf"values\.({old_name})\b", rf"values.{new_name}"),
                (rf"state\.({old_name})\b", rf"state.{new_name}"),
                (rf"params\.({old_name})\b", rf"params.{new_name}"),
            ]

            for pattern, replacement in patterns:
                new_content = re.sub(pattern, replacement, content)
                if new_content != content:
                    count = len(re.findall(pattern, content))
                    changes.append(f"  - {old_name} -> {new_name}: {count} occurrences (LTX context)")
                    content = new_content

        # 如果有变化
        if content != original_content:
            if not dry_run:
                with open(filepath, 'w', encoding='utf-8') as f:
                    f.write(content)
                print(f"[OK] Updated: {filepath}")
            else:
                print(f"Would update: {filepath}")

            for change in changes:
                print(change)
            return True

        return False

    except Exception as e:
        print(f"[ERROR] Error processing {filepath}: {e}")
        return False

def main():
    """主函数"""
    import sys

    dry_run = '--dry-run' in sys.argv or '-n' in sys.argv

    if dry_run:
        print("=== DRY RUN MODE (no files will be modified) ===\n")
    else:
        print("=== LIVE MODE (files will be modified) ===\n")

    # 要处理的目录
    base_dir = Path(__file__).parent
    target_dirs = [
        base_dir / 'src' / 'models',
        base_dir / 'src' / 'components' / 'MediaGenerator',
        base_dir / 'src' / 'config',
    ]

    total_files = 0
    updated_files = 0

    for target_dir in target_dirs:
        if not target_dir.exists():
            print(f"Warning: Directory not found: {target_dir}")
            continue

        print(f"\nProcessing directory: {target_dir}")
        print("-" * 80)

        # 遍历所有 .ts 和 .tsx 文件
        for filepath in target_dir.rglob('*.ts*'):
            if should_skip_file(filepath):
                continue

            total_files += 1
            if replace_in_file(filepath, dry_run):
                updated_files += 1

    print("\n" + "=" * 80)
    print(f"Summary: {updated_files}/{total_files} files {'would be' if dry_run else 'were'} updated")

    if dry_run:
        print("\nTo apply changes, run: python batch_rename_params.py")
    else:
        print("\n[SUCCESS] All changes applied successfully!")

if __name__ == '__main__':
    main()
