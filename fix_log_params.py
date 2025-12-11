#!/usr/bin/env python3
"""
修复 logInfo/logError/logWarning 的参数数量问题
- 只有1个参数：添加空对象 {}
- 超过2个参数：将多余参数合并为对象
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
    'calls_fixed': 0
}

def count_params(params_str: str) -> int:
    """
    计算参数数量（简单版本，处理常见情况）
    """
    if not params_str.strip():
        return 0

    # 简单计数：按逗号分割，但要考虑括号和引号
    depth = 0
    in_string = False
    string_char = None
    param_count = 1

    for char in params_str:
        if char in ('"', "'", '`') and not in_string:
            in_string = True
            string_char = char
        elif char == string_char and in_string:
            in_string = False
            string_char = None
        elif not in_string:
            if char in ('(', '[', '{'):
                depth += 1
            elif char in (')', ']', '}'):
                depth -= 1
            elif char == ',' and depth == 0:
                param_count += 1

    return param_count

def fix_log_call(match):
    """
    修复单个日志调用
    """
    func_name = match.group(1)  # logInfo, logError, logWarning
    params = match.group(2)  # 参数部分

    # 计算参数数量
    param_count = count_params(params)

    if param_count == 2:
        # 参数数量正确，不需要修改
        return match.group(0)

    elif param_count == 1:
        # 只有1个参数，添加空对象
        stats['calls_fixed'] += 1
        return f"{func_name}({params}, {{}})"

    elif param_count > 2:
        # 超过2个参数，需要合并
        # 找到第一个逗号的位置（不在括号或引号内）
        depth = 0
        in_string = False
        string_char = None
        first_comma_pos = -1

        for i, char in enumerate(params):
            if char in ('"', "'", '`') and not in_string:
                in_string = True
                string_char = char
            elif char == string_char and in_string:
                in_string = False
                string_char = None
            elif not in_string:
                if char in ('(', '[', '{'):
                    depth += 1
                elif char in (')', ']', '}'):
                    depth -= 1
                elif char == ',' and depth == 0:
                    first_comma_pos = i
                    break

        if first_comma_pos > 0:
            # 分离第一个参数和剩余参数
            first_param = params[:first_comma_pos].strip()
            rest_params = params[first_comma_pos + 1:].strip()

            # 将剩余参数包装为对象
            # 尝试智能命名
            stats['calls_fixed'] += 1
            return f"{func_name}({first_param}, {{ data: [{rest_params}] }})"

    # 默认返回原始内容
    return match.group(0)

def fix_file(file_path: Path) -> bool:
    """
    修复文件中的日志调用
    返回是否修改了文件
    """
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()

        original_content = content

        # 匹配 logInfo/logError/logWarning 调用
        # 使用非贪婪匹配，并处理嵌套括号
        pattern = r'(logInfo|logError|logWarning)\(((?:[^()]|\([^()]*\))*)\)'

        # 多次替换，直到没有变化（处理嵌套情况）
        max_iterations = 5
        for _ in range(max_iterations):
            new_content = re.sub(pattern, fix_log_call, content)
            if new_content == content:
                break
            content = new_content

        # 如果内容有变化，写回文件
        if content != original_content:
            with open(file_path, 'w', encoding='utf-8') as f:
                f.write(content)
            return True

        return False

    except Exception as e:
        print(f"[ERROR] 处理文件失败 {file_path}: {e}")
        return False

def main():
    """主函数"""
    print("开始修复日志函数参数...")
    print(f"扫描目录: {SRC_DIR.absolute()}\n")

    # 遍历所有 .ts 和 .tsx 文件
    for file_path in SRC_DIR.rglob('*.ts*'):
        if file_path.suffix not in ['.ts', '.tsx']:
            continue

        # 跳过类型定义文件
        if file_path.name.endswith('.d.ts'):
            continue

        stats['files_processed'] += 1

        if fix_file(file_path):
            stats['files_modified'] += 1
            print(f"[OK] {file_path.relative_to(SRC_DIR)}")

    # 输出统计信息
    print("\n" + "="*60)
    print("修复统计:")
    print("="*60)
    print(f"处理文件数: {stats['files_processed']}")
    print(f"修改文件数: {stats['files_modified']}")
    print(f"修复调用数: {stats['calls_fixed']}")
    print("="*60)
    print("\n完成！")
    print("\n注意：脚本使用了简单的参数合并策略。")
    print("建议运行后检查修改，确保逻辑正确。")

if __name__ == '__main__':
    main()
