#!/usr/bin/env python3
"""
自动清理 errorLogger 中未使用的导入
"""

import os
import re
from pathlib import Path

# 配置
SRC_DIR = Path("src")

# 统计信息
stats = {
    'files_processed': 0,
    'files_modified': 0,
    'imports_cleaned': 0
}

def find_errorlogger_import(content: str) -> tuple[str | None, int]:
    """
    找到 errorLogger 的导入语句
    返回 (导入语句, 行号) 或 (None, -1)
    """
    lines = content.split('\n')
    for i, line in enumerate(lines):
        if 'from' in line and 'errorLogger' in line and 'import' in line:
            return line, i
    return None, -1

def parse_imported_functions(import_line: str) -> list[str]:
    """
    解析导入语句中的函数列表
    例如: "import { logError, logWarning, logInfo } from '...'"
    返回: ['logError', 'logWarning', 'logInfo']
    """
    match = re.search(r'import\s*\{\s*([^}]+)\s*\}', import_line)
    if not match:
        return []

    functions_str = match.group(1)
    functions = [f.strip() for f in functions_str.split(',')]
    return functions

def check_function_usage(content: str, function_name: str) -> bool:
    """
    检查函数是否在代码中被使用
    排除导入语句本身
    """
    lines = content.split('\n')
    for line in lines:
        # 跳过导入语句
        if 'import' in line and 'from' in line and 'errorLogger' in line:
            continue

        # 检查函数调用
        # 匹配 functionName( 的模式
        pattern = rf'\b{function_name}\s*\('
        if re.search(pattern, line):
            return True

    return False

def build_new_import_line(original_line: str, used_functions: list[str]) -> str:
    """
    构建新的导入语句
    """
    if not used_functions:
        return ''  # 如果没有使用任何函数，返回空字符串（删除整行）

    # 提取导入路径
    path_match = re.search(r"from\s+['\"]([^'\"]+)['\"]", original_line)
    if not path_match:
        return original_line

    import_path = path_match.group(1)

    # 构建新的导入语句
    functions_str = ', '.join(used_functions)
    new_line = f"import {{ {functions_str} }} from '{import_path}'"

    return new_line

def clean_unused_imports(file_path: Path) -> bool:
    """
    清理文件中未使用的 errorLogger 导入
    返回是否修改了文件
    """
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()

        # 跳过 errorLogger.ts 本身
        if 'errorLogger' in file_path.name:
            return False

        # 找到导入语句
        import_line, line_index = find_errorlogger_import(content)
        if not import_line:
            return False  # 没有 errorLogger 导入

        # 解析导入的函数
        imported_functions = parse_imported_functions(import_line)
        if not imported_functions:
            return False

        # 检查每个函数是否被使用
        used_functions = []
        unused_functions = []
        for func in imported_functions:
            if check_function_usage(content, func):
                used_functions.append(func)
            else:
                unused_functions.append(func)

        # 如果所有函数都被使用，不需要修改
        if not unused_functions:
            return False

        # 构建新的导入语句
        new_import_line = build_new_import_line(import_line, used_functions)

        # 替换导入语句
        lines = content.split('\n')
        if new_import_line:
            lines[line_index] = new_import_line
        else:
            # 如果没有使用任何函数，删除整行
            del lines[line_index]

        new_content = '\n'.join(lines)

        # 写回文件
        with open(file_path, 'w', encoding='utf-8') as f:
            f.write(new_content)

        print(f"[OK] {file_path.relative_to(SRC_DIR)}")
        print(f"     移除: {', '.join(unused_functions)}")
        if used_functions:
            print(f"     保留: {', '.join(used_functions)}")
        else:
            print(f"     删除整个导入语句")

        stats['imports_cleaned'] += len(unused_functions)
        return True

    except Exception as e:
        print(f"[ERROR] 处理文件失败 {file_path}: {e}")
        return False

def main():
    """主函数"""
    print("开始清理未使用的 errorLogger 导入...")
    print(f"扫描目录: {SRC_DIR.absolute()}\n")

    # 遍历所有 .ts 和 .tsx 文件
    for file_path in SRC_DIR.rglob('*.ts*'):
        if file_path.suffix not in ['.ts', '.tsx']:
            continue

        stats['files_processed'] += 1

        if clean_unused_imports(file_path):
            stats['files_modified'] += 1

    # 输出统计信息
    print("\n" + "="*60)
    print("清理统计:")
    print("="*60)
    print(f"处理文件数: {stats['files_processed']}")
    print(f"修改文件数: {stats['files_modified']}")
    print(f"清理导入数: {stats['imports_cleaned']}")
    print("="*60)
    print("\n完成！")

if __name__ == '__main__':
    main()
