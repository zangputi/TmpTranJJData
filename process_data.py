import os
import glob
from datetime import datetime, timedelta

# Configuration
OLD_DIR = 'Data/Old'
DAILY_DIR = 'Data/DailyData'
OUTPUT_DIR = 'Data/JJData'

def get_daily_files_sorted():
    files = glob.glob(os.path.join(DAILY_DIR, '*.txt'))
    # Extract date and sort
    files_with_date = []
    for f in files:
        basename = os.path.basename(f)
        try:
            # Assuming YYYY-MM-DD.txt
            date_str = basename.replace('.txt', '')
            date_obj = datetime.strptime(date_str, '%Y-%m-%d')
            files_with_date.append((date_obj, f))
        except ValueError:
            continue
    files_with_date.sort(key=lambda x: x[0])
    return files_with_date

def load_daily_data(filepath):
    """
    Parses DailyData file.
    Returns a dict: {Code: {Open, Close, High, Low, ExRights}}
    Code is index 1.
    Close index 8
    Open index 9
    High index 10
    Low index 11
    ExRights index 21 (PreClose)
    """
    data = {}
    try:
        with open(filepath, 'r', encoding='utf-8') as f: # DailyData is pipe separated text, likely utf-8 or gbk.
            # `read_file` output looked like utf-8 characters.
            content = f.read()
    except UnicodeDecodeError:
        with open(filepath, 'r', encoding='gbk') as f:
            content = f.read()

    lines = content.strip().split('\n')
    for line in lines:
        if not line: continue
        parts = line.split('|')
        if len(parts) <= 21: continue # Ensure enough columns

        code = parts[1].strip()
        try:
            close_val = float(parts[8])
            open_val = float(parts[9])
            high_val = float(parts[10])
            low_val = float(parts[11])
            ex_rights = float(parts[21]) # Previous Close

            data[code] = {
                'Close': close_val,
                'Open': open_val,
                'High': high_val,
                'Low': low_val,
                'ExRights': ex_rights
            }
        except ValueError:
            continue
    return data

def process():
    if not os.path.exists(OUTPUT_DIR):
        os.makedirs(OUTPUT_DIR)

    daily_files = get_daily_files_sorted()
    daily_dates = [x[0] for x in daily_files]

    old_files = glob.glob(os.path.join(OLD_DIR, '*.txt'))

    for old_file in old_files:
        filename = os.path.basename(old_file)
        # Extract date from filename, e.g., 全部Ａ股20250403.txt -> 20250403
        import re
        match = re.search(r'(\d{8})', filename)
        if not match:
            print(f"Skipping {filename}, no date found.")
            continue

        date_str = match.group(1)
        current_date = datetime.strptime(date_str, '%Y%m%d')

        # Find T (Today)
        try:
            t_idx = daily_dates.index(current_date)
            today_file = daily_files[t_idx][1]
        except ValueError:
            print(f"Daily data for {current_date.date()} not found. Skipping.")
            continue

        # Find T-1 (Yesterday)
        if t_idx > 0:
            yesterday_file = daily_files[t_idx-1][1]
            yesterday_data = load_daily_data(yesterday_file)
        else:
            yesterday_data = {}

        today_data = load_daily_data(today_file)

        # Read Old File
        try:
            with open(old_file, 'r', encoding='gbk') as f: # Old data is GBK usually
                lines = f.readlines()
        except UnicodeDecodeError:
             with open(old_file, 'r', encoding='utf-8') as f:
                lines = f.readlines()

        new_lines = []

        # Process Header
        if len(lines) >= 2:
            new_lines.append(lines[0].rstrip())
            # Append new column names to second line
            header2 = lines[1].rstrip()
            new_cols = ["昨开涨幅", "昨最低", "昨最高", "昨开收盘涨幅",
                        "开盘涨幅", "最低价", "最高价", "涨幅", "开收盘涨幅差", "今开核距昨开涨"]
            header2 += "\t" + "\t".join(new_cols)
            new_lines.append(header2)
        else:
            print(f"File {filename} content too short.")
            continue

        # Process Data
        for i in range(2, len(lines)):
            line = lines[i].rstrip()
            if not line: continue
            parts = line.split('\t')
            code = parts[0].strip()

            # Init metrics
            metrics = [0.0] * 10

            # Determine if we have data
            has_today = code in today_data
            has_yesterday = code in yesterday_data

            # Yesterday Metrics
            if has_yesterday:
                y = yesterday_data[code]
                y_open = y['Open']
                y_close = y['Close']
                y_high = y['High']
                y_low = y['Low']
                y_ex = y['ExRights'] # T-2 Close

                # 1. 昨开涨幅: (Yesterday.Open - Yesterday.ExRights) / Yesterday.ExRights * 100
                if y_ex != 0:
                    metrics[0] = (y_open - y_ex) / y_ex * 100

                # 2. 昨最低
                metrics[1] = y_low

                # 3. 昨最高
                metrics[2] = y_high

                # 4. 昨开收盘涨幅: (Yesterday.Close - Yesterday.Open) / Yesterday.ExRights * 100
                if y_ex != 0:
                    metrics[3] = (y_close - y_open) / y_ex * 100

            # Today Metrics
            if has_today:
                t = today_data[code]
                t_open = t['Open']
                t_close = t['Close']
                t_high = t['High']
                t_low = t['Low']
                t_ex = t['ExRights'] # T-1 Close (Yesterday.Close)

                # 5. 开盘涨幅: (Today.Open - Today.ExRights) / Today.ExRights * 100
                if t_ex != 0:
                    metrics[4] = (t_open - t_ex) / t_ex * 100

                # 6. 最低价
                metrics[5] = t_low

                # 7. 最高价
                metrics[6] = t_high

                # 8. 涨幅: (Today.Close - Today.ExRights) / Today.ExRights * 100
                if t_ex != 0:
                    metrics[7] = (t_close - t_ex) / t_ex * 100

                # 9. 开收盘涨幅差: (Today.Close - Today.Open) / Today.ExRights * 100
                if t_ex != 0:
                    metrics[8] = (t_close - t_open) / t_ex * 100

                # 10. 今开核距昨开涨: (Today.Open - Yesterday.Open) / Yesterday.ExRights * 100
                # Requires Yesterday data
                if has_yesterday:
                    y = yesterday_data[code]
                    y_open = y['Open']
                    y_ex = y['ExRights']
                    if y_ex != 0:
                        metrics[9] = (t_open - y_open) / y_ex * 100

            # Rounding
            metrics_str = [f"{x:.2f}" for x in metrics]

            # Append
            new_line = line + "\t" + "\t".join(metrics_str)
            new_lines.append(new_line)

        # Write Output
        out_path = os.path.join(OUTPUT_DIR, filename)
        with open(out_path, 'w', encoding='gbk') as f: # Keep original encoding preference if possible, usually GBK for these files
             f.write('\n'.join(new_lines))
        print(f"Processed {filename} -> {out_path}")

if __name__ == '__main__':
    process()
