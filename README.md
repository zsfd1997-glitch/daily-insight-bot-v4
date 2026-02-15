# Daily Insight Bot (Daily News 推送) 🚀

> **当前版本**: Millionaire Edition (Classic)
> **状态**: 🟢 Active (Every 4 Hours)

这是一个基于 GitHub Actions 的高价值信息聚合推送系统。专注于 **"财富机会"** 的挖掘与推送。

## 📊 核心数据源 (Millionaire Edition)
- **Hacker News (YC Top)**: 硅谷技术与创投风向。
- **Bilibili (Tech)**: 年轻一代的硬核科技消费趋势。
- **财联社 (CLS)**: 金融市场宏观与盘口异动。
- **掘金 (Juejin AI)**: 开发者圈层的 AI 技术热点。

## 🧠 智能分析引擎
Bot 内置了 **Millionaire Analysis Engine**，自动扫描标题中的财富关键词：
- **High Value (+5分)**: IPO, 融资, 暴涨, 政策, 垄断, 重磅...
- **Medium Value (+3分)**: AI, NVIDIA, Tesla, Chip, Robot...

只有得分超过 **5分** 的内容，才会进入邮件头部的 **"🚨 财富机会 (Millionaire Signals)"** 金色专栏。

## ⚙️ 运行配置
- **调度**: 每 4 小时整点运行一次 (`0 */4 * * *`)。
- **推送**: 直接发送至配置的 QQ 邮箱（微信即时提醒）。
- **文件位置**: 代码位于 `daily-insight-bot/` 目录。
