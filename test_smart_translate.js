process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const { translate } = require('google-translate-api-x');

// 辅助功能: 随机延迟防止封控
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// 判断是否含有中文（简单阈值判断，只要包含一定比例中文字符即视为中文）
// 这里简化策略：只要包含中文字符，就认为是中文内容，不需要翻译？
// 不，有些标题可能是 "GitHub刚刚发布了Copilot..." 这种混合的。
// 更好的策略是：如果看起来像是纯英文，才翻译。
// 判断策略：移除常见标点和数字后，如果剩余字符中 ASCII 字符占比过高，且中文字符极少，则认为是英文。
function isMostlyChinese(text) {
    const chineseRegex = /[\u4e00-\u9fa5]/g;
    const match = text.match(chineseRegex);
    const chineseCount = match ? match.length : 0;

    // 如果没有任何中文字符，肯定不是中文
    if (chineseCount === 0) return false;

    // 如果中文字符占比超过 10% (通常英文标题里的中文很少)，认为是中文
    // 比如 "DeepSeek update: ..." (0中文) -> False
    // "小米SU7 ultra发布..." (4中文, 总长10+) -> True
    return true;
}

async function smartTranslate(text) {
    if (!text) return text;

    // 1. 语言检测
    if (isMostlyChinese(text)) {
        console.log(`[Skip] Detected Chinese: "${text}"`);
        return text;
    }

    console.log(`[Translating] "${text}" ...`);

    // 2. 翻译 + 重试机制
    let retries = 3;
    while (retries > 0) {
        try {
            // 随机延迟，模拟人类操作节奏
            await delay(Math.random() * 500 + 200);
            const res = await translate(text, { to: 'zh-CN', forceBatch: false, fallbackBatch: false });
            return `[译] ${res.text} (${text})`;
        } catch (e) {
            console.error(`  Warning: Translation failed (remaining retries: ${retries - 1}):`, e.message);
            retries--;
            if (retries === 0) {
                console.error('  ❌ Translation finally failed.');
                return text; // 最终失败返回原文
            }
            await delay(1000); // 失败后等待一秒重试
        }
    }
}

async function runTest() {
    const testCases = [
        "OpenAI releases new GPT-5 model with reasoning capabilities",
        "小米汽车SU7 Ultra正式发布，售价81.49万元",
        "DeepSeek-V3 technical report is out",
        "财联社2月6日电，美联储宣布维持利率不变",
        "Just a short English title",
        "混合内容测试：Apple's new vision pro is expensive" // 应该翻译，因为没有中文字符
    ];

    console.log("=== Starting Smart Translation Test ===\n");

    for (const text of testCases) {
        const result = await smartTranslate(text);
        console.log(`Original: ${text}`);
        console.log(`Result:   ${result}\n`);
    }
}

runTest();
