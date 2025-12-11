#!/usr/bin/env python3
"""
批量替换 console.log/error/warn 为 logInfo/logError/logWarning
并自动添加 import 语句
"""

import os
import re
from pathlib import Path

# 配置
SRC_DIR = Path("src")
IMPORT_STATEMENT = "import { logError, logWarning, logInfo } from './utils/errorLogger'"

# 统计信息
stats = {
    'files_processed': 0,
    'files_modified': 0,
    'console_log_replaced': 0,
    'console_error_replaced': 0,
    'console_warn_replaced': 0,
    'imports_added': 0
}

def get_relative_import_path(file_path: Path) -> str:
    """
    根据文件路径计算相对于 errorLogger.ts 的导入路径
    """
    # 计算文件相对于 src 的深度
    relative_to_src = file_path.relative_to(SRC_DIR)
    depth = len(relative_to_src.parts) - 1  # 减去文件名本身

    if depth == 0:
        # 文件在 src 根目录
        return "import { logError, logWarning, logInfo } from './utils/errorLogger'"
    else:
        # 文件在子目录中
        prefix = '../' * depth
        return f"import {{ logError, logWarning, logInfo }} from '{prefix}utils/errorLogger'"

def has_error_logger_import(content: str) -> bool:
    """检查文件是否已经导入了 errorLogger"""
    patterns = [
        r"from\s+['\"].*errorLogger['\"]",
        r"import\s+.*errorLogger",
    ]
    for pattern in patterns:
        if re.search(pattern, content):
            return True
    return False

def add_import_statement(content: str, file_path: Path) -> tuple[str, bool]:
    """
    在文件顶部添加 import 语句
    返回 (修改后的内容, 是否添加了import)
    """
    if has_error_logger_import(content):
        return content, False

    import_statement = get_relative_import_path(file_path)

    # 找到最后一个 import 语句的位置
    import_pattern = r'^import\s+.*$'
    lines = content.split('\n')
    last_import_index = -1

    for i, line in enumerate(lines):
        if re.match(import_pattern, line.strip()):
            last_import_index = i

    if last_import_index >= 0:
        # 在最后一个 import 后面插入
        lines.insert(last_import_index + 1, import_statement)
    else:
        # 没有找到 import，插入到文件开头（跳过注释）
        insert_index = 0
        for i, line in enumerate(lines):
            stripped = line.strip()
            if stripped and not stripped.startswith('//') and not stripped.startswith('/*') and not stripped.startswith('*'):
                insert_index = i
                break
        lines.insert(insert_index, import_statement)

    return '\n'.join(lines), True

def replace_console_calls(content: str) -> tuple[str, dict]:
    """
    替换 console.log/error/warn 调用
    返回 (修改后的内容, 替换统计)
    """
    replacements = {
        'log': 0,
        'error': 0,
        'warn': 0
    }

    # 替换 console.log -> logInfo
    # 匹配 console.log('prefix', data) 或 console.log(data)
    def replace_log(match):
        replacements['log'] += 1
        args = match.group(1)
        # 如果只有一个参数，添加一个空前缀
        if ',' not in args:
            return f"logInfo('', {args})"
        return f"logInfo({args})"

    content = re.sub(r'console\.log\((.*?)\)(?=\s*(?://|/\*|$|\n))', replace_log, content, flags=re.DOTALL)

    # 替换 console.error -> logError
    def replace_error(match):
        replacements['error'] += 1
        args = match.group(1)
        if ',' not in args:
            return f"logError('', {args})"
        return f"logError({args})"

    content = re.sub(r'console\.error\((.*?)\)(?=\s*(?://|/\*|$|\n))', replace_error, content, flags=re.DOTALL)

    # 替换 console.warn -> logWarning
    def replace_warn(match):
        replacements['warn'] += 1
        args = match.group(1)
        if ',' not in args:
            return f"logWarning('', {args})"
        return f"logWarning({args})"

    content = re.sub(r'console\.warn\((.*?)\)(?=\s*(?://|/\*|$|\n))', replace_warn, content, flags=re.DOTALL)

    return content, replacements

def process_file(file_path: Path) -> bool:
    """
    处理单个文件
    返回是否修改了文件
    """
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            original_content = f.read()

        # 跳过 errorLogger.ts 本身
        if 'errorLogger' in file_path.name:
            return False

        content = original_content
        modified = False

        # 替换 console 调用
        content, replacements = replace_console_calls(content)
        if any(replacements.values()):
            modified = True
            stats['console_log_replaced'] += replacements['log']
            stats['console_error_replaced'] += replacements['error']
            stats['console_warn_replaced'] += replacements['warn']

            # 添加 import 语句
            content, import_added = add_import_statement(content, file_path)
            if import_added:
                stats['imports_added'] += 1

        # 如果内容有变化，写回文件
        if modified and content != original_content:
            with open(file_path, 'w', encoding='utf-8') as f:
                f.write(content)
            return True

        return False

    except Exception as e:
        print(f"❌ 处理文件失败 {file_path}: {e}")
        return False

def main():
    """主函数"""
    print("🚀 开始批量替换 console 调用...")
    print(f"📁 扫描目录: {SRC_DIR.absolute()}\n")

    # 遍历所有 .ts 和 .tsx 文件
    for file_path in SRC_DIR.rglob('*.ts*'):
        if file_path.suffix not in ['.ts', '.tsx']:
            continue

        stats['files_processed'] += 1

        if process_file(file_path):
            stats['files_modified'] += 1
            print(f"✅ 已修改: {file_path.relative_to(SRC_DIR)}")

    # 输出统计信息
    print("\n" + "="*60)
    print("📊 替换统计:")
    print("="*60)
    print(f"处理文件数: {stats['files_processed']}")
    print(f"修改文件数: {stats['files_modified']}")
    print(f"添加 import: {stats['imports_added']}")
    print(f"console.log  → logInfo:    {stats['console_log_replaced']}")
    print(f"console.error → logError:   {stats['console_error_replaced']}")
    print(f"console.warn  → logWarning: {stats['console_warn_replaced']}")
    print("="*60)
    print("\n✨ 完成！")

if __name__ == '__main__':
    main()
