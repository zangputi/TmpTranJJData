const fs = require('fs');
const path = require('path');
const iconv = require('iconv-lite');

// Directories
const OLD_DATA_DIR = path.join(__dirname, 'Data/Old');
const DAILY_DATA_DIR = path.join(__dirname, 'Data/DailyData');
const OUTPUT_DIR = path.join(__dirname, 'Data/JJData');

// Metrics to append (for header)
const NEW_METRICS = [
    '昨开涨幅', '昨最低', '昨最高', '昨开收盘涨幅',
    '开盘涨幅', '最低价', '最高价', '涨幅', '开收盘涨幅差', '今开核距昨开涨'
];

// Ensure output directory exists
if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// Function to parse date from filename YYYYMMDD
function parseDateFromOldFilename(filename) {
    const match = filename.match(/(\d{8})\.txt$/);
    if (match) {
        const dateStr = match[1];
        return `${dateStr.substring(0, 4)}-${dateStr.substring(4, 6)}-${dateStr.substring(6, 8)}`;
    }
    return null;
}

// Function to load DailyData file into a map
function loadDailyData(filepath) {
    const dataMap = new Map();
    if (!fs.existsSync(filepath)) return dataMap;

    const content = fs.readFileSync(filepath, 'utf8');
    const lines = content.split('\n');

    for (const line of lines) {
        if (!line.trim()) continue;
        const parts = line.split('|');
        // DailyData: 1:Code, 8:Close, 9:Open, 10:High, 11:Low, 21:ExRights
        if (parts.length > 21) {
            const code = parts[1];
            dataMap.set(code, {
                Code: code,
                Close: parseFloat(parts[8]),
                Open: parseFloat(parts[9]),
                High: parseFloat(parts[10]),
                Low: parseFloat(parts[11]),
                ExRights: parseFloat(parts[21]) // Previous day close
            });
        }
    }
    return dataMap;
}

// Function to round to 2 decimal places
function round2(num) {
    return Math.round(num * 100) / 100;
}

// Function to format number to 2 decimal places string
function format2(num) {
    return num.toFixed(2);
}

// Main processing
async function main() {
    // 1. List all DailyData files and sort them to find T-1
    const dailyFiles = fs.readdirSync(DAILY_DATA_DIR)
        .filter(f => f.match(/^\d{4}-\d{2}-\d{2}\.txt$/))
        .sort(); // String sort works for YYYY-MM-DD

    const dailyFileMap = new Map(); // Date -> Filename
    dailyFiles.forEach(f => {
        const date = f.replace('.txt', '');
        dailyFileMap.set(date, f);
    });

    // 2. Iterate Old Data files
    const oldFiles = fs.readdirSync(OLD_DATA_DIR).filter(f => f.endsWith('.txt'));

    for (const oldFile of oldFiles) {
        console.log(`Processing ${oldFile}...`);
        const targetDate = parseDateFromOldFilename(oldFile);
        if (!targetDate) {
            console.warn(`Skipping ${oldFile}: cannot parse date.`);
            continue;
        }

        // Find Today (T) and Yesterday (T-1)
        const tIndex = dailyFiles.findIndex(f => f === `${targetDate}.txt`);
        let todayData = new Map();
        let yesterdayData = new Map();

        if (tIndex !== -1) {
            todayData = loadDailyData(path.join(DAILY_DATA_DIR, dailyFiles[tIndex]));
            // T-1 is the file at tIndex - 1
            if (tIndex > 0) {
                const prevFile = dailyFiles[tIndex - 1];
                yesterdayData = loadDailyData(path.join(DAILY_DATA_DIR, prevFile));
            } else {
                console.warn(`No T-1 data for ${targetDate} (T is first file).`);
            }
        } else {
            console.warn(`No DailyData for ${targetDate}.`);
        }

        // Read Old File
        const oldFilePath = path.join(OLD_DATA_DIR, oldFile);
        const oldFileBuffer = fs.readFileSync(oldFilePath);

        // Decode GBK (Assume GBK as per prompt/file check, also handle possible UTF8 if GBK fails or by checking BOM?
        // Prompt says GBK or UTF8. simple check: if iconv decode gives replacement chars excessively maybe wrong?
        // But usually stock data on windows is GBK. Let's try GBK first.
        let fileContent = iconv.decode(oldFileBuffer, 'gbk');

        // Split lines
        const lines = fileContent.split(/\r?\n/);

        const outputLines = [];

        // Process Header
        if (lines.length > 0) {
            outputLines.push(lines[0]); // First line: keep as is
        }
        if (lines.length > 1) {
            // Second line: append new metrics names
            outputLines.push(lines[1] + '\t' + NEW_METRICS.join('\t'));
        }

        // Process Data Lines (from index 2)
        for (let i = 2; i < lines.length; i++) {
            const line = lines[i];
            if (!line.trim()) {
                outputLines.push(line);
                continue;
            }

            const parts = line.split('\t');
            const code = parts[0].trim(); // First column is Code

            // Default values 0
            let m1=0, m2=0, m3=0, m4=0, m5=0, m6=0, m7=0, m8=0, m9=0, m10=0;

            const t = todayData.get(code);
            const y = yesterdayData.get(code);

            // Calculate if both T and T-1 data available (for cross-day or yesterday metrics)
            // Or just T for today metrics.

            // "异常处理：如果缺少 T-1 日文件或对应代码数据，所有“昨”开头的指标及跨日计算指标均填 0。"
            // Metrics needing Yesterday: 1, 2, 3, 4, 10

            if (y) {
                // 1. 昨开涨幅: (Yesterday.Open - Yesterday.ExRights) / Yesterday.ExRights * 100
                if (y.ExRights !== 0) m1 = (y.Open - y.ExRights) / y.ExRights * 100;

                // 2. 昨最低: Yesterday.Low
                m2 = y.Low;

                // 3. 昨最高: Yesterday.High
                m3 = y.High;

                // 4. 昨开收盘涨幅: (Yesterday.Close - Yesterday.Open) / Yesterday.ExRights * 100
                if (y.ExRights !== 0) m4 = (y.Close - y.Open) / y.ExRights * 100;
            }

            if (t) {
                // 5. 开盘涨幅: (Today.Open - Today.ExRights) / Today.ExRights * 100
                if (t.ExRights !== 0) m5 = (t.Open - t.ExRights) / t.ExRights * 100;

                // 6. 最低价: Today.Low
                m6 = t.Low;

                // 7. 最高价: Today.High
                m7 = t.High;

                // 8. 涨幅: (Today.Close - Today.ExRights) / Today.ExRights * 100
                if (t.ExRights !== 0) m8 = (t.Close - t.ExRights) / t.ExRights * 100;

                // 9. 开收盘涨幅差: (Today.Close - Today.Open) / Today.ExRights * 100
                if (t.ExRights !== 0) m9 = (t.Close - t.Open) / t.ExRights * 100;
            }

            // 10. 今开核距昨开涨: (Today.Open - Yesterday.Open) / Yesterday.ExRights * 100
            if (t && y) {
                if (y.ExRights !== 0) m10 = (t.Open - y.Open) / y.ExRights * 100;
            }

            // Rounding and Formatting
            const newValues = [m1, m2, m3, m4, m5, m6, m7, m8, m9, m10].map(v => format2(v));

            outputLines.push(line + '\t' + newValues.join('\t'));
        }

        // Write to Output (UTF-8)
        const outputContent = outputLines.join('\n'); // Standardize newlines
        // Note: Writing as UTF-8.
        fs.writeFileSync(path.join(OUTPUT_DIR, oldFile), outputContent, 'utf8');
        console.log(`Saved ${oldFile} to ${OUTPUT_DIR}`);
    }
    console.log("All processed.");
}

main().catch(err => console.error(err));
