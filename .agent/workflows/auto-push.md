---
description: Auto push changes to GitHub after editing daily-insight-bot code
---

# Auto Push Workflow

When modifying any code in the daily-insight-bot-repo project, ALWAYS commit and push changes to GitHub after editing.

## Steps

1. Make the requested code changes
2. Test locally if possible (optional, may fail due to local network)
// turbo
3. Stage all changes: `git add -A`
// turbo
4. Commit with a descriptive message: `git commit -m "feat: <description>"`
// turbo
5. Push to GitHub: `git push origin main`

> **Why**: The bot runs on GitHub Actions. If changes are not pushed, the remote will keep running the old code and the bot may fail or send stale content.
