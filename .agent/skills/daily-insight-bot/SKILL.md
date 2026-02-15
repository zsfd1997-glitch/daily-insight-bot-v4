---
name: Daily Insight Bot
description: AI 资讯聚合邮件机器人 - 项目上下文、架构、UI 规范、待办事项
---

# Daily Insight Bot - 项目全览

## 项目定位
每小时自动抓取 10+ 数据源的 AI/科技/金融资讯，去重、评分、分类，以 **Millionaire Edition** 金色 UI 发送邮件。

## 技术栈
- **Runtime**: Node.js (GitHub Actions)
- **核心文件**: `api_bot.js` (主逻辑), `.github/workflows/daily_bot.yml` (调度)
- **依赖**: axios, nodemailer, google-translate-api-x, rss-parser
- **邮箱**: QQ 邮箱 SMTP (jasonzsfd@qq.com)
- **GitHub**: zsfd1997-glitch/daily-insight-bot

## GitHub Secrets (已配置)
- `EMAIL_USER`: jasonzsfd@qq.com
- `EMAIL_PASS`: QQ SMTP 授权码
- `RECIPIENT_EMAIL`: jasonzsfd@qq.com

## 调度规则
- Cron: `0 0-16 * * *` (UTC 00-16 / 北京时间 08:00-24:00 每整点)
- 凌晨 01:00-07:00 暂停，08:00 发 Morning Digest
- 支持 `workflow_dispatch` 手动触发

## 去重机制
- `history.json` 存储已发送的 title/url
- GitHub Action 每次运行后自动 commit history.json
- `MAX_HISTORY_SIZE = 1000`

## 当前 v3.0 数据源 (10个, 目标 100+ 条/次)

| # | 分类 | 源 | 函数 | 条数 |
|---|------|-----|------|------|
| 1a | 🚨 AI 产品首发 | 36Kr RSS | `fetch36Kr()` | ~20 |
| 1b | 🚨 AI 产品首发 | TechCrunch AI RSS | `fetchTechCrunchAI()` | ~20 |
| 1c | 🚨 AI 产品首发 | Product Hunt RSS | `fetchProductHunt()` | ~20 |
| 2 | ⚡ 基础设施 | Google News (5 queries) | `fetchInfrastructure()` | ~25 |
| 3a | 🧠 核心技术 | GitHub Trending AI | `fetchGitHubTrending()` | ~15 |
| 3b | 🧠 核心技术 | HuggingFace Papers | `fetchHuggingFace()` | ~15 |
| 3c | 🧠 核心技术 | HackerNews Top | `fetchHackerNews()` | ~15 |
| 4 | 🚗 汽车 | TC Transportation + Google EV | `fetchAutomotive()` | ~25 |
| 5a | 📈 财经 | 财联社 API | `fetchCLS()` | ~20 |
| 5b | 📈 财经 | 掘金 AI 热榜 | `fetchJuejin()` | ~15 |

## UI 规范 (Millionaire Edition)

### 整体结构
```
DAILY INSIGHT (居中标题)
Millionaire Edition (副标题)

🚨 财富机会 (Millionaire Signals) - 金色边框卡片, Top 5, score >= 10
  ├─ 标题 [评分勋章]
  └─ source: xxx | 时间

🚨 AI 产品首发 - 金色左边框, 奶白背景
⚡ AI 基础设施
🧠 核心技术
🚗 智能驾驶
📈 财经宏观
📌 其他资讯

页脚: 本次新增 N 条资讯
```

### 每条 Item 样式 (全局统一)
- 标题: 15px, bold, 黑色链接
- 评分勋章: inline-block, 圆角, 10px
  - score >= 10: 金色 `#d4af37`
  - score >= 5: 深金 `#b8860b`
  - score < 5: 灰色 `#999`
- 来源 + 时间: 12px, 灰色 `#888`
- 分隔线: dashed `#e0d0b0`

### 关键 CSS 值
- 外框: `max-width:700px; background:#FAFAFA; border-radius:10px; padding:20px`
- Millionaire 卡片: `border:2px solid #d4af37; box-shadow:0 4px 12px rgba(212,175,55,0.2)`
- 分类区块: `border-left:4px solid #d4af37; background:#fffcf5; border-radius:0 8px 8px 0`

## 评分系统
- **Critical (100)**: seedance, openai, sora, gpt-5, gemini, deepseek, anthropic, claude, nvidia
- **High (10)**: 融资, ipo, 上市, launch, funding, surge, breakthrough, acquisition
- **Medium (5)**: chip, semiconductor, tsmc, nuclear, energy, mining, copper, lithium
- **Auto (5)**: tesla, waymo, autopilot, byd, robotaxi, 自动驾驶, 新能源汽车
- **Low (1)**: update, release, new, report, trend, ai, model
- **Seedance 特殊加分**: +200

## ⚠️ 待办事项 (下次会话继续)

### 必须完成
1. **时间格式优化**: 每条新闻显示简洁发布时间如 `2/9 17:40`，而不是 `News` 或 `热榜`
2. **发布地点标注**: 每条显示来源地区如 `🇨🇳 CN` 或 `🇺🇸 USA`
3. **过滤非今年新闻**: 排除 pubDate 不在 2026 年的条目
4. **验证发送的邮件**: 手动触发已执行但需确认用户收到 100+ 条

### 可选优化
- 模糊去重 (标题相似度匹配)
- 周末模式 (深度阅读)
- 评分更细化

## 安全规则
- 全局禁止 `rm` 和 `rm -rf` 命令 (见 `/.agent/skills/safety_guardrails/SKILL.md`)
- `NODE_TLS_REJECT_UNAUTHORIZED = '0'` (翻译库需要)

## 工作流
- 推送代码后执行: `/auto-push` (见 `/.agent/workflows/auto-push.md`)
