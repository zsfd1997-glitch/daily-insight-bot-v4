process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const axios = require('axios');
const nodemailer = require('nodemailer');
const https = require('https');
const { translate } = require('google-translate-api-x');
const fs = require('fs');
const path = require('path');
const RSSParser = require('rss-parser');
const parser = new RSSParser();

// --- 配置区域 ---
const HISTORY_FILE = path.join(__dirname, 'history.json');
const MAX_HISTORY_SIZE = 1000;
const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASS = process.env.EMAIL_PASS;
const RECIPIENT_EMAIL = process.env.RECIPIENT_EMAIL;
const CURRENT_YEAR = new Date().getFullYear(); // 2026

// --- 关键词评分系统 (v3.0) ---
const KEYWORDS = {
  critical: ['seedance', 'open ai', 'openai', 'sora', 'gpt-5', 'gpt5', 'gemini', 'deepseek', 'anthropic', 'claude', 'blackwell', 'nvidia', 'rtx 50'],
  high: ['融资', 'ipo', '上市', '暴涨', '首发', 'launch', 'funding', 'surge', 'breakthrough', 'acquisition', 'merger'],
  medium: ['chip', 'semiconductor', 'tsmc', 'amd', 'intel', 'nuclear', 'energy', 'mining', 'copper', 'lithium', '电力', '芯片', '矿产', '能源', '算力'],
  auto: ['tesla', 'waymo', 'autopilot', 'fsd', 'ev', 'electric vehicle', 'xiaopeng', 'nio', 'byd', 'robotaxi', '自动驾驶', '新能源汽车', '特斯拉', '智驾', 'rivian', 'lucid', '理想', '蔚来', '小鹏', '比亚迪'],
  low: ['update', 'release', 'new', 'report', 'trend', 'ai', 'model', '模型', '发布']
};

function calculateScore(text) {
  let score = 0;
  const lowerText = text.toLowerCase();
  KEYWORDS.critical.forEach(k => { if (lowerText.includes(k)) score += 100; });
  KEYWORDS.high.forEach(k => { if (lowerText.includes(k)) score += 10; });
  KEYWORDS.medium.forEach(k => { if (lowerText.includes(k)) score += 5; });
  KEYWORDS.auto.forEach(k => { if (lowerText.includes(k)) score += 5; });
  KEYWORDS.low.forEach(k => { if (lowerText.includes(k)) score += 1; });
  if (lowerText.includes('seedance') || lowerText.includes('即梦') || lowerText.includes('jimeng')) score += 200;
  return score;
}

// --- 时间格式化工具 ---
// 输出格式: "2/9 17:40" (月/日 时:分, 北京时间)
function formatTime(dateInput) {
  try {
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return '时间未知';
    const month = d.toLocaleString('zh-CN', { month: 'numeric', timeZone: 'Asia/Shanghai' });
    const day = d.toLocaleString('zh-CN', { day: 'numeric', timeZone: 'Asia/Shanghai' });
    const hour = d.toLocaleString('zh-CN', { hour: '2-digit', hour12: false, timeZone: 'Asia/Shanghai' });
    const minute = d.toLocaleString('zh-CN', { minute: '2-digit', timeZone: 'Asia/Shanghai' });
    return `${month}/${day} ${hour}:${minute.padStart(2, '0')}`;
  } catch (e) {
    return '时间未知';
  }
}

// 检查是否为今年的新闻
function isThisYear(dateInput) {
  try {
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return true; // 无法判断则保留
    return d.getFullYear() === CURRENT_YEAR;
  } catch (e) {
    return true; // 无法判断则保留
  }
}

// 根据 source 标注地区旗帜
function getRegion(source) {
  const cnSources = ['36Kr', '财联社', '掘金', '量子位', 'QbitAI'];
  const usSources = ['TechCrunch', 'ProductHunt', 'GitHub', 'HackerNews', 'HuggingFace', '基建', '汽车'];
  if (cnSources.some(s => source.includes(s))) return '🇨🇳';
  if (usSources.some(s => source.includes(s))) return '🇺🇸';
  return '🌐';
}

// --- 历史记录管理 ---
function loadHistory() {
  try {
    if (fs.existsSync(HISTORY_FILE)) return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
  } catch (e) { console.error('History load error:', e); }
  return [];
}

function saveHistory(history) {
  try {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history.slice(-MAX_HISTORY_SIZE), null, 2));
  } catch (e) { console.error('History save error:', e); }
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const ONE_WEEK_MS = 7 * ONE_DAY_MS;

// Jaccard 相似度计算 (分词 + Set 交集)
function getJaccardSimilarity(str1, str2) {
  const tokenize = (s) => new Set(s.toLowerCase().replace(/[^\w\u4e00-\u9fa5]/g, ' ').split(/\s+/).filter(w => w.length > 1));
  const set1 = tokenize(str1);
  const set2 = tokenize(str2);
  if (set1.size === 0 || set2.size === 0) return 0;

  const intersection = new Set([...set1].filter(x => set2.has(x)));
  const union = new Set([...set1, ...set2]);
  return intersection.size / union.size;
}

// 检查是否为 "旧闻" (>24h 历史) - Semantic
function isOldHistory(item, history) {
  const cutoff = Date.now() - ONE_DAY_MS;
  const fourHoursAgo = Date.now() - (4 * 60 * 60 * 1000);

  // Replay Logic: 如果是 4-8 小时内的高分内容 (score>=8)，允许再次出现 (不算旧闻)
  const isHighValueReplay = (h) => h.score >= 8 && h.time > cutoff && h.time < fourHoursAgo;

  return history
    .filter(h => h.time < cutoff && !isHighValueReplay(h)) // 如果是 Replay 候选，暂时不视为旧闻
    .some(h => h.url === item.url || getJaccardSimilarity(h.title, item.title) > 0.4);
}

// 检查是否为 "今日已发" (<24h 历史) - Semantic
function isTodayDuplicate(item, history) {
  const cutoff = Date.now() - ONE_DAY_MS;
  const fourHoursAgo = Date.now() - (4 * 60 * 60 * 1000);

  // Replay Logic: 同上，如果是高分 Replay 内容，不视为今日已发 (允许再次发送)
  const isHighValueReplay = (h) => h.score >= 8 && h.time > cutoff && h.time < fourHoursAgo;

  return history
    .filter(h => h.time >= cutoff && !isHighValueReplay(h))
    .some(h => h.url === item.url || getJaccardSimilarity(h.title, item.title) > 0.4);
}

// 批次内去重 (Semantic)
function batchDedup(items) {
  const uniqueItems = [];
  for (const item of items) {
    // 与已保留的 items 对比
    const isDup = uniqueItems.some(existing =>
      existing.url === item.url || getJaccardSimilarity(existing.title, item.title) > 0.4
    );
    if (!isDup) uniqueItems.push(item);
  }
  return uniqueItems;
}

// 生成可视化趋势 Header
function generateVisualHeader(items) {
  const keywords = {};
  const stopWords = new Set(['the', 'and', 'for', 'with', 'new', 'release', 'launch', 'model', 'ai', 'releases', 'launches', 'updates', 'update', 'version', 'v1', 'v2', 'v3', 'pro', 'max', 'tech', 'source', 'open', 'data', 'web', 'app', 'tool', 'system', 'platform']);

  items.forEach(item => {
    const words = item.title.toLowerCase().replace(/[^\w\u4e00-\u9fa5]/g, ' ').split(/\s+/);
    words.forEach(w => {
      if (w.length > 2 && !stopWords.has(w) && !/^\d+$/.test(w)) {
        keywords[w] = (keywords[w] || 0) + 1;
      }
    });
  });

  // Top 5 keywords
  const sorted = Object.entries(keywords)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .filter(k => k[1] > 1); // 至少出现2次

  if (sorted.length === 0) return '';

  // Capitalize
  const capitalize = s => s.charAt(0).toUpperCase() + s.slice(1);

  return `<div style="background:#f0f8ff;border:1px solid #cceeff;border-radius:6px;padding:8px 12px;margin-bottom:20px;font-size:13px;color:#0066cc;text-align:center;">
    🔥 <strong>Trending:</strong> ${sorted.map(([k, v]) => `${capitalize(k)} (${v})`).join(' · ')}
  </div>`;
}

// --- 翻译辅助 ---
async function translateText(text) {
  try {
    const res = await translate(text, { to: 'zh-CN', forceBatch: false });
    return res.text;
  } catch (e) { return text; }
}

// --- 摘要截断 ---
function truncSummary(text, max = 80) {
  if (!text) return '';
  const clean = text.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  return clean.length > max ? clean.substring(0, max) + '...' : clean;
}

// --- HTTP Client ---
const agent = new https.Agent({ rejectUnauthorized: false });
const client = axios.create({
  httpsAgent: agent,
  timeout: 20000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
  }
});

let allItems = [];

// ============================================================
//  1. 🚨 AI 产品首发监测 (Consumer Tech)
// ============================================================

// 1a. 36Kr AI (中国 AI 首发最快)
async function fetch36Kr() {
  console.log('[1a] Fetching 36Kr AI...');
  try {
    const feed = await parser.parseURL('https://36kr.com/feed');
    for (const item of feed.items.slice(0, 20)) {
      if (!isThisYear(item.pubDate)) continue;
      const score = calculateScore(item.title + (item.contentSnippet || ''));
      allItems.push({
        title: item.title,
        summary: truncSummary(item.contentSnippet),
        url: item.link,
        time: formatTime(item.pubDate),
        source: '36Kr·AI首发',
        region: '🇨🇳',
        score: score + 5
      });
    }
    console.log('  -> 36Kr done');
  } catch (e) { console.error('  ❌ 36Kr Fail:', e.message); }
}

// 1b. TechCrunch AI (硅谷首发)
async function fetchTechCrunchAI() {
  console.log('[1b] Fetching TechCrunch AI...');
  try {
    const feed = await parser.parseURL('https://techcrunch.com/category/artificial-intelligence/feed/');
    for (const item of feed.items.slice(0, 20)) {
      if (!isThisYear(item.pubDate)) continue;
      const zhTitle = await translateText(item.title);
      const zhSnippet = await translateText(truncSummary(item.contentSnippet, 100));
      allItems.push({
        title: zhTitle,
        summary: truncSummary(zhSnippet),
        url: item.link,
        time: formatTime(item.pubDate),
        source: 'TechCrunch·AI',
        region: '🇺🇸',
        score: calculateScore(item.title) + 5
      });
    }
    console.log('  -> TechCrunch AI done');
  } catch (e) { console.error('  ❌ TechCrunch AI Fail:', e.message); }
}

// 1c. Product Hunt (Top Products)
async function fetchProductHunt() {
  console.log('[1c] Fetching Product Hunt...');
  try {
    const feed = await parser.parseURL('https://www.producthunt.com/feed');
    for (const item of feed.items.slice(0, 20)) {
      if (!isThisYear(item.pubDate)) continue;
      const zhTitle = await translateText(item.title);
      const phSnippet = await translateText(truncSummary(item.contentSnippet, 100));
      allItems.push({
        title: zhTitle,
        summary: truncSummary(phSnippet),
        url: item.link,
        time: formatTime(item.pubDate),
        source: 'ProductHunt',
        region: '🇺🇸',
        score: calculateScore(item.title + (item.contentSnippet || '')) + 3
      });
    }
    console.log('  -> ProductHunt done');
  } catch (e) { console.error('  ❌ ProductHunt Fail:', e.message); }
}

// ============================================================
//  2. ⚡ AI 基础设施与能源 (Infrastructure)
// ============================================================
async function fetchInfrastructure() {
  console.log('[2] Fetching Infrastructure (Chips/Energy/Mining)...');
  const queries = [
    { q: 'AI chip NVIDIA AMD semiconductor', src: '基建·芯片' },
    { q: 'data center energy power nuclear', src: '基建·能源' },
    { q: 'copper lithium mining AI supply chain', src: '基建·矿产' },
    { q: 'TSMC foundry chip shortage', src: '基建·芯片' },
    { q: 'uranium nuclear power AI', src: '基建·能源' }
  ];

  for (const { q, src } of queries) {
    try {
      const feed = await parser.parseURL(`https://news.google.com/rss/search?q=${encodeURIComponent(q + ' when:1d')}&hl=en-US&gl=US&ceid=US:en`);
      for (const item of feed.items.slice(0, 5)) {
        if (!isThisYear(item.pubDate)) continue;
        const zhTitle = await translateText(item.title);
        allItems.push({
          title: zhTitle,
          summary: truncSummary(item.contentSnippet),
          url: item.link,
          time: formatTime(item.pubDate),
          source: src,
          region: '🇺🇸',
          score: calculateScore(item.title) + 5
        });
      }
    } catch (e) { console.error(`  ❌ Infra(${q.substring(0, 15)}...) Fail:`, e.message); }
  }
  console.log('  -> Infrastructure done');
}

// ============================================================
//  3. 🧠 核心技术 (Tech & Research)
// ============================================================

// 3a. GitHub Trending AI/LLM
async function fetchGitHubTrending() {
  console.log('[3a] Fetching GitHub Trending AI...');
  try {
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 3);
    const sinceDate = weekAgo.toISOString().split('T')[0];
    const res = await client.get(`https://api.github.com/search/repositories?q=topic:ai+topic:llm+pushed:>${sinceDate}&sort=stars&order=desc&per_page=15`);
    for (const item of res.data.items || []) {
      if (item.stargazers_count < 50) continue;
      const desc = await translateText((item.description || '').substring(0, 100));
      allItems.push({
        title: `${item.full_name}: ${desc}`,
        summary: `⭐${(item.stargazers_count / 1000).toFixed(1)}k stars · ${item.language || 'N/A'}`,
        url: item.html_url,
        time: formatTime(item.pushed_at),
        source: 'GitHub·AI',
        region: '🇺🇸',
        score: calculateScore(item.description || '') + 3
      });
    }
    console.log('  -> GitHub done');
  } catch (e) { console.error('  ❌ GitHub Fail:', e.message); }
}

// 3b. HuggingFace Daily Papers
async function fetchHuggingFace() {
  console.log('[3b] Fetching HuggingFace Papers...');
  try {
    const res = await client.get('https://huggingface.co/api/daily_papers');
    const papers = res.data || [];
    for (const paper of papers.slice(0, 15)) {
      const zhTitle = await translateText(paper.paper.title);
      const pubDate = paper.publishedAt || paper.paper.publishedAt || new Date().toISOString();
      const zhAbstract = await translateText(truncSummary(paper.paper.summary || '', 120));
      allItems.push({
        title: zhTitle,
        summary: truncSummary(zhAbstract),
        url: `https://huggingface.co/papers/${paper.paper.id}`,
        time: formatTime(pubDate),
        source: 'HuggingFace·论文',
        region: '🇺🇸',
        score: calculateScore(paper.paper.title) + 4
      });
    }
    console.log('  -> HuggingFace done');
  } catch (e) { console.error('  ❌ HuggingFace Fail:', e.message); }
}

// 3c. Hacker News (YC)
async function fetchHackerNews() {
  console.log('[3c] Fetching HackerNews...');
  try {
    const topRes = await client.get('https://hacker-news.firebaseio.com/v0/topstories.json');
    const topIds = topRes.data.slice(0, 15);
    const promises = topIds.map(id => client.get(`https://hacker-news.firebaseio.com/v0/item/${id}.json`).catch(() => null));
    const items = await Promise.all(promises);

    for (const res of items) {
      if (res && res.data && res.data.title) {
        const hnTime = res.data.time ? new Date(res.data.time * 1000) : new Date();
        if (!isThisYear(hnTime)) continue;
        const zhTitle = await translateText(res.data.title);
        allItems.push({
          title: zhTitle,
          summary: `${res.data.score || 0} points · ${res.data.descendants || 0} comments`,
          url: res.data.url || `https://news.ycombinator.com/item?id=${res.data.id}`,
          time: formatTime(hnTime),
          source: 'HackerNews',
          region: '🇺🇸',
          score: calculateScore(res.data.title) + 3
        });
      }
    }
    console.log('  -> HackerNews done');
  } catch (e) { console.error('  ❌ HackerNews Fail:', e.message); }
}

// ============================================================
//  4. 🚗 智能驾驶与汽车 (Auto/EV)
// ============================================================
async function fetchAutomotive() {
  console.log('[4] Fetching Automotive (TechCrunch + Google)...');
  // 4a. TechCrunch Transportation
  try {
    const feed = await parser.parseURL('https://techcrunch.com/category/transportation/feed/');
    for (const item of feed.items.slice(0, 15)) {
      if (!isThisYear(item.pubDate)) continue;
      const zhTitle = await translateText(item.title);
      const autoSnippet = await translateText(truncSummary(item.contentSnippet, 100));
      allItems.push({
        title: zhTitle,
        summary: truncSummary(autoSnippet),
        url: item.link,
        time: formatTime(item.pubDate),
        source: '汽车·TechCrunch',
        region: '🇺🇸',
        score: calculateScore(item.title) + 5
      });
    }
  } catch (e) { console.error('  ❌ TC Auto Fail:', e.message); }

  // 4b. Google News EV / Robotaxi
  try {
    const feed = await parser.parseURL(`https://news.google.com/rss/search?q=${encodeURIComponent('Tesla Waymo robotaxi EV autonomous when:1d')}&hl=en-US&gl=US&ceid=US:en`);
    for (const item of feed.items.slice(0, 10)) {
      if (!isThisYear(item.pubDate)) continue;
      const zhTitle = await translateText(item.title);
      allItems.push({
        title: zhTitle,
        summary: '',
        url: item.link,
        time: formatTime(item.pubDate),
        source: '汽车·EV',
        region: '🇺🇸',
        score: calculateScore(item.title) + 5
      });
    }
  } catch (e) { console.error('  ❌ Google EV Fail:', e.message); }
  console.log('  -> Automotive done');
}

// ============================================================
//  5. 📈 财经宏观 (Finance & Macro)
// ============================================================

// 5a. 财联社
async function fetchCLS() {
  console.log('[5a] Fetching 财联社...');
  try {
    const ts = Math.floor(Date.now() / 1000);
    const res = await client.get(`https://www.cls.cn/nodeapi/updateTelegraphList?rn=20&timestamp=${ts}`);
    (res.data.data.roll_data || []).forEach(item => {
      const pubDate = new Date(item.ctime * 1000);
      if (!isThisYear(pubDate)) return;
      let title = item.title || (item.content || '').replace(/<[^>]+>/g, '').substring(0, 100);
      const clsContent = (item.content || '').replace(/<[^>]+>/g, '');
      allItems.push({
        title,
        summary: truncSummary(clsContent),
        url: `https://www.cls.cn/detail/${item.id}`,
        time: formatTime(pubDate),
        source: '财联社·宏观',
        region: '🇨🇳',
        score: calculateScore(title) + 2
      });
    });
    console.log('  -> 财联社 done');
  } catch (e) { console.error('  ❌ 财联社 Fail:', e.message); }
}

// 5b. 掘金 AI 热榜
async function fetchJuejin() {
  console.log('[5b] Fetching 掘金AI...');
  try {
    const res = await client.get('https://api.juejin.cn/content_api/v1/content/article_rank?category_id=6809637773935378440&type=hot&limit=15');
    (res.data.data || []).forEach(item => {
      allItems.push({
        title: item.content.title,
        summary: truncSummary(item.content.brief_content || ''),
        url: `https://juejin.cn/post/${item.content.content_id}`,
        time: formatTime(new Date()),
        source: '掘金·AI',
        region: '🇨🇳',
        score: calculateScore(item.content.title) + 2
      });
    });
    console.log('  -> 掘金 done');
  } catch (e) { console.error('  ❌ 掘金 Fail:', e.message); }
}

// ============================================================
//  主函数
// ============================================================
async function main() {
  console.log('🚀 Daily Insight Bot v3.3 - 全量抓取中...\n');
  const history = loadHistory();

  // 10 个数据源并行抓取
  await Promise.allSettled([
    fetch36Kr(),
    fetchTechCrunchAI(),
    fetchProductHunt(),
    fetchInfrastructure(),
    fetchGitHubTrending(),
    fetchHuggingFace(),
    fetchHackerNews(),
    fetchAutomotive(),
    fetchCLS(),
    fetchJuejin()
  ]);

  console.log(`\n📊 总抓取: ${allItems.length} 条 (去重前)`);

  // Step 1: 过滤掉 >24h 的旧闻
  let validItems = allItems.filter(item => !isOldHistory(item, history));
  console.log(`📊 过滤旧闻后: ${validItems.length} 条`);

  // Step 2: 批次内去重
  validItems = batchDedup(validItems);
  console.log(`📊 批次去重后: ${validItems.length} 条`);

  // Step 3: 分区 (Fresh vs Review)
  // Fresh: 历史中不存在 (<24h 也没出现过)
  // Review: 历史中存在 (<24h 出现过)
  const freshItems = [];
  const reviewItems = [];

  for (const item of validItems) {
    if (isTodayDuplicate(item, history)) {
      reviewItems.push(item);
    } else {
      freshItems.push(item);
    }
  }

  // 排序
  freshItems.sort((a, b) => b.score - a.score);
  reviewItems.sort((a, b) => b.score - a.score);

  console.log(`📊 新鲜事 (Fresh): ${freshItems.length} 条`);
  console.log(`📊 今日回顾 (Review): ${reviewItems.length} 条`);

  // Step 4: 回填机制 (仅针对 Fresh 不足的情况)
  const MIN_ITEMS = 50;
  if (freshItems.length < MIN_ITEMS) {
    const now = Date.now();
    const oneDayAgo = now - ONE_DAY_MS;
    const oneWeekAgo = now - ONE_WEEK_MS;

    const backfillCandidates = history
      .filter(h => h.time >= oneWeekAgo && h.time < oneDayAgo && (h.score || 0) >= 5)
      .sort((a, b) => (b.score || 0) - (a.score || 0));

    const currentUrls = new Set([...freshItems, ...reviewItems].map(i => i.url));
    const currentTitles = new Set([...freshItems, ...reviewItems].map(i => i.title));

    let backfillCount = 0;
    for (const h of backfillCandidates) {
      if (freshItems.length >= MIN_ITEMS) break;
      if (currentUrls.has(h.url) || currentTitles.has(h.title)) continue;
      currentUrls.add(h.url);
      currentTitles.add(h.title);
      freshItems.push({
        title: h.title,
        summary: h.summary || '',
        url: h.url,
        time: formatTime(new Date(h.time)),
        source: `📎${h.source || '回顾'}`,
        region: h.region || '🌐',
        score: h.score || 0
      });
      backfillCount++;
    }
    if (backfillCount > 0) console.log(`📎 回填: ${backfillCount} 条`);
  }

  if (freshItems.length === 0 && reviewItems.length === 0) {
    console.log('❌ No items. Skipping email.');
    return;
  }

  // === 构建 HTML ===
  const millionaireItems = freshItems.filter(i => i.score >= 10).slice(0, 5);
  const others = freshItems.filter(i => !millionaireItems.includes(i));

  let htmlContent = '';

  // Part 1: Millionaire (Fresh)
  if (millionaireItems.length > 0) {
    htmlContent += `<div style="margin-bottom:25px;background:#ffffff;border:2px solid #d4af37;border-radius:8px;padding:15px;box-shadow:0 4px 12px rgba(212,175,55,0.2);">
      <h2 style="color:#d4af37;margin:0 0 15px 0;font-size:18px;text-align:center;border-bottom:1px solid #f0e6d2;padding-bottom:10px;">🚨 财富机会 (Millionaire Signals)</h2>
      <ul style="padding-left:20px;margin:0;">`;
    millionaireItems.forEach(item => {
      const region = item.region || getRegion(item.source);
      const mSummary = item.summary ? `<div style="font-size:13px;color:#666;margin:3px 0 0 0;line-height:1.3;">${item.summary}</div>` : '';
      htmlContent += `<li style="margin-bottom:12px;">
        <div style="font-size:16px;font-weight:bold;">
            <a href="${item.url}" style="text-decoration:none;color:#333;">${item.title}</a>
            <span style="background:#d4af37;color:#fff;font-size:10px;padding:2px 6px;border-radius:4px;margin-left:8px;">${item.score}分</span>
        </div>
        ${mSummary}
        <div style="font-size:12px;color:#888;margin-top:4px;">${region} ${item.source} • ${item.time}</div>
      </li>`;
    });
    htmlContent += '</ul></div>';
  }

  // Part 2: 分类 (Fresh)
  const groups = {
    '🚨 AI 产品首发 (Consumer Tech)': others.filter(i =>
      i.source.includes('36Kr') || i.source.includes('TechCrunch·AI') || i.source.includes('ProductHunt')),
    '⚡ AI 基础设施 (Chips/Energy/Mining)': others.filter(i =>
      i.source.includes('基建')),
    '🧠 核心技术 (Tech & Research)': others.filter(i =>
      i.source.includes('GitHub') || i.source.includes('HuggingFace') || i.source.includes('HackerNews') || i.source.includes('掘金')),
    '🚗 智能驾驶与汽车 (Auto/EV)': others.filter(i =>
      i.source.includes('汽车')),
    '📈 财经宏观 (Finance & Macro)': others.filter(i =>
      i.source.includes('财联社') || i.source.includes('华尔街'))
  };

  const grouped = new Set();
  Object.values(groups).forEach(arr => arr.forEach(i => grouped.add(i)));
  const ungrouped = others.filter(i => !grouped.has(i));
  if (ungrouped.length > 0) groups['📌 其他资讯'] = ungrouped;

  for (const [name, items] of Object.entries(groups)) {
    if (items.length === 0) continue;
    htmlContent += `<div style="margin-bottom:30px;border-left:4px solid #d4af37;padding-left:15px;background:#fffcf5;padding:10px;border-radius:0 8px 8px 0;">
      <h3 style="color:#bfa15f;margin:0 0 10px 0;font-size:16px;">${name}</h3>
      <ul style="padding-left:0;list-style:none;margin:0;">`;

    items.slice(0, 20).forEach(item => {
      const badgeColor = item.score >= 10 ? '#d4af37' : item.score >= 5 ? '#b8860b' : '#999';
      const region = item.region || getRegion(item.source);
      const summaryHtml = item.summary ? `<div style="font-size:13px;color:#666;margin:2px 0 0 0;line-height:1.3;">${item.summary}</div>` : '';

      htmlContent += `<li style="margin-bottom:12px; border-bottom:1px dashed #e0d0b0; padding-bottom:8px;">
        <div style="font-size:15px;font-weight:bold;line-height:1.4;margin-bottom:4px;">
            <a href="${item.url}" style="text-decoration:none;color:#333;">${item.title}</a>
            <span style="display:inline-block;background:${badgeColor};color:#fff;font-size:10px;padding:1px 5px;border-radius:4px;margin-left:6px;vertical-align:text-bottom;">${item.score}分</span>
        </div>
        ${summaryHtml}
        <div style="font-size:12px;color:#888;">${region} ${item.source} • ${item.time}</div>
      </li>`;
    });
    htmlContent += '</ul></div>';
  }

  // Part 3: 今日回顾 (Review - 灰色显示 但保持 UI 一致性)
  if (reviewItems.length > 0) {
    htmlContent += `<div style="margin-top:40px;padding-top:20px;border-top:2px dashed #ddd;">
      <h3 style="color:#999;margin:0 0 15px 0;font-size:16px;text-align:center;">📉 今日已读 (Review)</h3>
      <ul style="padding-left:0;list-style:none;margin:0;">`;

    reviewItems.slice(0, 30).forEach(item => {
      const badgeColor = '#999'; // Review 项统一用灰色 Badge
      const region = item.region || getRegion(item.source);
      const summaryHtml = item.summary ? `<div style="font-size:13px;color:#999;margin:2px 0 0 0;line-height:1.3;">${item.summary}</div>` : '';

      htmlContent += `<li style="margin-bottom:12px; border-bottom:1px dashed #eee; padding-bottom:8px; opacity: 0.8;">
        <div style="font-size:15px;font-weight:bold;line-height:1.4;margin-bottom:4px;">
            <a href="${item.url}" style="text-decoration:none;color:#666;">${item.title}</a>
            <span style="display:inline-block;background:${badgeColor};color:#fff;font-size:10px;padding:1px 5px;border-radius:4px;margin-left:6px;vertical-align:text-bottom;">${item.score}分</span>
        </div>
        ${summaryHtml}
        <div style="font-size:12px;color:#ccc;">${region} ${item.source} • ${item.time}</div>
      </li>`;
    });
    htmlContent += '</ul></div>';
  }

  // === 发送邮件 ===
  if (!EMAIL_USER || !EMAIL_PASS) {
    console.log('⚠️ Skipping email (no credentials). Items:', validItems.length);
  } else {
    let transporter = nodemailer.createTransport({
      service: 'qq', secure: true,
      auth: { user: EMAIL_USER, pass: EMAIL_PASS },
      tls: { rejectUnauthorized: false }
    });

    // 获取当前北京时间
    const now = new Date();
    const cnTimeStr = now.toLocaleTimeString('en-US', { timeZone: 'Asia/Shanghai', hour12: false });
    const [hStr, mStr] = cnTimeStr.split(':');
    let cnHour = parseInt(hStr);
    const cnMinute = parseInt(mStr);

    // 如果是 45 分以后触发，视为下一小时的任务
    if (cnMinute >= 45) {
      cnHour = (cnHour + 1) % 24;
    }

    let titlePrefix = `Daily Insight - ${cnHour}点档`;
    if (cnHour === 6) titlePrefix = '🌅 [Morning Digest] 早报聚合 (夜间汇总)';

    const subject = millionaireItems.length > 0
      ? `🔥 [Urgent] ${millionaireItems[0].title.substring(0, 30)}...`
      : titlePrefix;

    const finalHtml = `<div style="font-family:'Helvetica Neue', Arial, sans-serif; max-width:700px; margin:0 auto; color:#333; line-height:1.6; background-color:#FAFAFA; padding:20px; border-radius:10px;">
      <div style="text-align:center; padding-bottom:15px; margin-bottom:20px;">
        <h1 style="margin:0; font-size:22px; color:#111; letter-spacing:1px;">DAILY INSIGHT</h1>
        <p style="margin:5px 0 0; color:#666; font-size:12px; text-transform:uppercase;">Millionaire Edition v3.4</p>
      </div>
      ${generateVisualHeader(freshItems)}
      ${htmlContent}
      <div style="margin-top:40px; text-align:center; color:#ccc; font-size:12px;">
        Powered by Intelligent Analysis Engine • 新鲜 ${freshItems.length} 条 / 回顾 ${reviewItems.length} 条
      </div>
    </div>`;

    await transporter.sendMail({
      from: `"Insight Bot" <${EMAIL_USER}>`,
      to: RECIPIENT_EMAIL,
      subject: subject,
      html: finalHtml
    });
    console.log('✅ Email sent successfully!');
  }

  // === 更新历史 (Fresh Only) ===
  const finalFresh = freshItems.filter(i => !i.source.startsWith('📎'));
  const newHistory = [...history, ...finalFresh.map(i => ({
    title: i.title, url: i.url, time: Date.now(),
    score: i.score, summary: i.summary || '',
    source: i.source, region: i.region || '🌐'
  }))];
  saveHistory(newHistory);
  console.log(`📦 History updated. Total: ${Math.min(newHistory.length, MAX_HISTORY_SIZE)}`);
}

main();
