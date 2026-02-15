# 🔐 Setup Secrets for Daily Insight Bot

To enable email notifications, you must configure the following **Repository Secrets** in GitHub.

**Settings Page:** [Click here to configure secrets](https://github.com/zsfd1997-glitch/daily-insight-bot-v4/settings/secrets/actions/new)

## Required Secrets

| Secret Name       | Description                                      | Example Value                 |
|-------------------|--------------------------------------------------|-------------------------------|
| `EMAIL_USER`      | Your email address (sender)                      | `bot@example.com`             |
| `EMAIL_PASS`      | Your email password or App Password (SMTP)       | `abcd-efgh-ijkl-mnop`         |
| `RECIPIENT_EMAIL` | The email address to receive daily insights      | `user@example.com`            |

## How to get App Password (for Common Providers)

- **Gmail**: Google Account -> Security -> 2-Step Verification -> App passwords.
- **QQ Mail**: Settings -> Accounts -> POP3/IMAP/SMTP/Exchange -> Generate Authorization Code.
- **Outlook**: Microsoft Account -> Security -> Advanced security options -> App passwords.

> **Note**: GitHub Actions logs will mask these values for security (displayed as `***`), but the bot can read them internally.
