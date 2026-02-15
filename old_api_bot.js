process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // 忽略 SSL 错误 (修复 translation 库证书问题)
const axios = require('axios');
const nodemailer = require('nodemailer');
const https = require('https');
const { translate } = require('google-translate-api-x');

// --- 辅助功能: 翻译 ---
async function translateText(text) {
  try {
    const res = await translate(text, { to: 'zh-CN', forceBatch: false, fallbackBatch: false });
    return `[译] ${res.text} (${text})`;
  } catch (e) {
    return text; // 翻译失败返回原文
  }
}

// --- 辅助功能: 判断周末 ---
function isWeekend() {
  const day = new Date().getDay();
  return day === 0 || day === 6; // 0 is Sunday, 6 is Saturday
}

// --- 辅助功能: 随机延迟防止封控 ---
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));


// 优先从环境变量获取 (GitHub Actions)，否则使用默认值 (本地测试)
const EMAIL_USER = process.env.EMAIL_USER || 'jasonzsfd@qq.com';
const EMAIL_PASS = process.env.EMAIL_PASS || 'wfhqdjhvvheqebha';
const RECIPIENT_EMAIL = process.env.RECIPIENT_EMAIL || EMAIL_USER;

// === 关键配置：忽略 SSL 证书错误，模拟浏览器请求 ===
const agent = new https.Agent({
  rejectUnauthorized: false
});

const client = axios.create({
  httpsAgent: agent,
  timeout: 15000, // 增加超时时间
  headers: {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1'
  }
});

// --- 关键词评分系统 ---
const KEYWORDS = {
  // 核心财富词 (5分)
  high: ['融资', 'ipo', '上市', '暴涨', '突破', '首发', '政策', '重磅', '垄断', '收购', '财报', '红利', 'launch', 'funding', 'surge', 'breakthrough'],
  // 重点关注领域 (3分)
  medium: ['ai', 'gpt', 'llm', 'nvidia', 'tesla', 'apple', 'openai', 'mistral', 'anthropic', '芯片', '半导体', '新能源', 'robot', 'agent'],
  // 一般关注 (1分)
  low: ['更新', '发布', 'new', 'update', 'release']
};

function calculateScore(text) {
  let score = 0;
  const lowerText = text.toLowerCase();
  KEYWORDS.high.forEach(k => { if (lowerText.includes(k)) score += 5; });
  KEYWORDS.medium.forEach(k => { if (lowerText.includes(k)) score += 3; });
  KEYWORDS.low.forEach(k => { if (lowerText.includes(k)) score += 1; });

  // 周末模式: 深度阅读加分 (长文/周刊)
  if (isWeekend()) {
    if (lowerText.includes('weekly') || lowerText.includes('周刊') || lowerText.includes('deep dive') || lowerText.includes('深度')) {
      score += 5;
    }
  }
  return score;
}

// 统一的数据结构: { title, url, time, source, score }
let allItems = [];

async function main() {
  console.log('🚀 正在执行【百万富翁】聚合分析 (财联社 + 掘金AI + HackerNews + AI产品榜)...');

  // --- 1. 财联社 (A股/宏观) ---
  try {
    console.log('Fetching CLS...');
    const ts = Math.floor(Date.now() / 1000);
    const res = await client.get(`https://www.cls.cn/nodeapi/updateTelegraphList?rn=15&timestamp=${ts}`);
    (res.data.data.roll_data || []).forEach(item => {
      let title = item.title || item.content.replace(/<[^>]+>/g, '').substring(0, 100);
      let time = new Date(item.ctime * 1000).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Shanghai' });
      allItems.push({
        title,
        url: `https://www.cls.cn/detail/${item.id}`,
        time,
        source: '财联社·宏观',
        score: calculateScore(title) + 2 // 基础分+2，因为是金融源
      });
    });
  } catch (e) { console.error('❌ 财联社:', e.message); }

  // --- 2. 掘金 AI (前沿技术) ---
  try {
    console.log('Fetching Juejin AI...');
    const res = await client.get('https://api.juejin.cn/content_api/v1/content/article_rank?category_id=6809637773935378440&type=hot&limit=10');
    (res.data.data || []).forEach(item => {
      allItems.push({
        title: item.content.title,
        url: `https://juejin.cn/post/${item.content.content_id}`,
        time: '热榜',
        source: '掘金·AI',
        score: calculateScore(item.content.title) + 2 // 基础分+2，因为是AI源
      });
    });
  } catch (e) { console.error('❌ 掘金AI:', e.message); }

  // --- 3. Hacker News (YC - 硅谷风向) ---
  try {
    console.log('Fetching Hacker News...');
    const topRes = await client.get('https://hacker-news.firebaseio.com/v0/topstories.json');
    const topIds = topRes.data.slice(0, 10); // 取前10
    const promises = topIds.map(id => client.get(`https://hacker-news.firebaseio.com/v0/item/${id}.json`).catch(() => null));
    const items = await Promise.all(promises);

    // HackerNews 翻译处理
    for (const res of items) {
      if (res && res.data) {
        let title = res.data.title;
        // 尝试翻译
        title = await translateText(title);

        allItems.push({
          title: title,
          url: res.data.url || `https://news.ycombinator.com/item?id=${res.data.id}`,
          time: 'YC Top',
          source: 'HackerNews',
          score: calculateScore(res.data.title) + 3 // 基础分+3，含金量极高
        });
      }
    }
  } catch (e) { console.error('❌ HackerNews:', e.message); }

  // --- 4. AI 产品榜 (GitHub 热门 AI 项目) ---
  try {
    console.log('Fetching AI Products (GitHub Trending)...');
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    const sinceDate = weekAgo.toISOString().split('T')[0];
    const ghRes = await client.get(
      `https://api.github.com/search/repositories?q=topic:ai+topic:llm+pushed:>${sinceDate}&sort=stars&order=desc&per_page=8`,
      { headers: { ...client.defaults.headers, 'Accept': 'application/vnd.github.v3+json' } }
    );
    for (const item of (ghRes.data.items || []).slice(0, 8)) {
      let desc = item.description || '';
      // 翻译英文描述
      if (desc && /[a-zA-Z]/.test(desc)) {
        desc = await translateText(desc.substring(0, 80));
      }
      allItems.push({
        title: `${item.full_name} — ${desc}`.substring(0, 120),
        url: item.html_url,
        time: `⭐${(item.stargazers_count / 1000).toFixed(1)}k`,
        source: 'AI产品榜',
        score: calculateScore((item.description || '') + ' ' + item.full_name) + 2
      });
    }
  } catch (e) { console.error('❌ AI Products:', e.message); }

  // --- 5. Hugging Face Daily Papers (AI 前沿论文) ---
  try {
    console.log('Fetching Hugging Face Daily Papers...');
    // 使用 HF 的 daily_papers API
    const res = await client.get('https://huggingface.co/api/daily_papers');
    const papers = res.data || [];
    // 串行翻译避免过快
    for (const paper of papers.slice(0, 8)) {
      const originalTitle = paper.paper.title;
      const translatedTitle = await translateText(originalTitle);

      allItems.push({
        title: translatedTitle,
        url: `https://huggingface.co/papers/${paper.paper.id}`,
        time: 'HF Daily',
        source: 'HuggingFace·AI',
        score: calculateScore(originalTitle) + 4 // AI论文基础分高
      });
    }
  } catch (e) { console.error('❌ HuggingFace:', e.message); }

  // --- 6. 华尔街见闻 (全球宏观/金融科技) + 灾备切换 ---
  try {
    console.log('Fetching WallstreetCN...');
    // 使用华尔街见闻的 live news API
    const res = await client.get('https://api-one-wscn.awtmt.com/apiv1/content/lives?channel=global-channel&limit=20');
    (res.data.data.items || []).forEach(item => {
      const text = item.content_text || item.content;
      if (!text) return;

      let title = text.replace(/<[^>]+>/g, '').substring(0, 80);
      let timeStr = new Date(item.display_time * 1000).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Shanghai' });

      allItems.push({
        title: title,
        url: item.uri || `https://wallstreetcn.com/live/global`,
        time: timeStr,
        source: '华尔街见闻',
        score: calculateScore(title) + 2
      });
    });
  } catch (e) {
    console.error('❌ WallstreetCN Failed, switching to CLS fallback (already covered by CLS step)...', e.message);
  }

  // --- 5. 排序与分层 ---
  // 1. 过滤掉分数过低的无效信息 (可选，暂不过滤)
  // 2. 按分数降序
  allItems.sort((a, b) => b.score - a.score);

  // 3. 提取 "🚨 财富机会/Millionaire Signals" (Top 5 & score >= 5)
  const millionaireItems = allItems.filter(i => i.score >= 5).slice(0, 5);
  // 4. 其他分类展示 (去重)
  const others = allItems.filter(i => !millionaireItems.includes(i));

  // --- 构建 HTML ---
  if (allItems.length === 0) return console.log('❌ 无内容');

  let htmlContent = '';

  // Part 1: Millionaire Signals
  if (millionaireItems.length > 0) {
    htmlContent += `<div style="margin-bottom:25px;background:#ffffff;border:2px solid #d4af37;border-radius:8px;padding:15px;box-shadow:0 4px 12px rgba(212,175,55,0.2);">
      <h2 style="color:#d4af37;margin:0 0 15px 0;font-size:18px;text-align:center;border-bottom:1px solid #f0e6d2;padding-bottom:10px;">🚨 财富机会 (Millionaire Signals)</h2>
      <ul style="padding-left:20px;margin:0;">`;
    millionaireItems.forEach(item => {
      htmlContent += `<li style="margin-bottom:12px;">
        <div style="font-size:16px;font-weight:bold;">
            <a href="${item.url}" style="text-decoration:none;color:#333;">${item.title}</a>
            <span style="background:#d4af37;color:#fff;font-size:10px;padding:2px 6px;border-radius:4px;margin-left:8px;">${item.score}分</span>
        </div>
        <div style="font-size:12px;color:#888;margin-top:4px;">source: ${item.source} | ${item.time}</div>
      </li>`;
    });
    htmlContent += '</ul></div>';
  }

  // Part 2: 分类列表 (Finance, AI, Tech)
  // 这里简单按来源分组展示剩余的
  const groups = {
    '📈 金融与宏观': others.filter(i => i.source.includes('财联社')),
    '🤖 AI 与前沿': others.filter(i => i.source.includes('掘金') || i.source.includes('HackerNews')),
    '🔬 HuggingFace Paper': others.filter(i => i.source.includes('HuggingFace')),
    '🚀 华尔街见闻 (Fintech)': others.filter(i => i.source.includes('华尔街见闻')),
    '🏆 AI 产品榜': others.filter(i => i.source.includes('AI产品榜'))
  };

  for (const [name, items] of Object.entries(groups)) {
    if (items.length === 0) continue;
    htmlContent += `<div style="margin-bottom:30px;border-left:4px solid #333;padding-left:15px;">
      <h3 style="color:#333;margin:0 0 10px 0;">${name}</h3>
      <ul style="padding-left:20px;margin:0;">`;
    items.slice(0, 8).forEach(item => {
      htmlContent += `<li style="margin-bottom:8px;">
        <a href="${item.url}" style="text-decoration:none;color:#444;font-size:14px;">${item.title}</a>
        <span style="font-size:12px;color:#999;margin-left:5px;">(${item.source})</span>
      </li>`;
    });
    htmlContent += '</ul></div>';
  }

  // --- 发送邮件 ---
  let transporter = nodemailer.createTransport({
    service: 'qq', secure: true,
    auth: { user: EMAIL_USER, pass: EMAIL_PASS },
    tls: { rejectUnauthorized: false }
  });

  const dateStr = new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long', hour: '2-digit', timeZone: 'Asia/Shanghai' });
  const subjectPrefix = isWeekend() ? '【周末深度阅读】' : '【Millionaire Signal】';

  await transporter.sendMail({
    from: `"Daily Insight Bot" <${EMAIL_USER}>`,
    to: RECIPIENT_EMAIL,
    subject: `${subjectPrefix}${dateStr} | 高价值信息聚合`,
    html: `<div style="font-family:'Helvetica Neue', Arial, sans-serif; max-width:650px; margin:0 auto; color:#333; line-height:1.6; background-color:#FAFAFA; padding:20px; border-radius:10px;">
            <div style="text-align:center; padding-bottom:15px; margin-bottom:20px;">
                <h1 style="margin:0; font-size:22px; color:#111; letter-spacing:1px;">DAILY INSIGHT</h1>
                <p style="margin:5px 0 0; color:#666; font-size:12px; text-transform:uppercase;">Millionaire Edition</p>
            </div>
            ${htmlContent}
            <div style="margin-top:40px; text-align:center; color:#ccc; font-size:12px;">
                Powered by Intelligent Analysis Engine
            </div>
           </div>`
  });
  console.log('✅ 邮件发送成功！');
}

main();
