# Ki Ki AI Lottery Bot

Telegram Bot for automated lottery betting (Wingo / TRX).

## Deploy on Railway / Render

### 1. GitHub
1. ဒီ repo ကို GitHub မှာ create လုပ်ပါ
2. `index.js`, `package.json`, `.gitignore` တို့ တင်ပါ

### 2. Railway
1. [railway.app](https://railway.app) သို့သွားပါ
2. New Project → Deploy from GitHub repo
3. Variables ထည့်ပါ:
   - `BOT_TOKEN` = သင့် Telegram Bot Token
   - `ADMIN_ID` = သင့် Telegram ID
4. Deploy

### 3. Render
1. [render.com](https://render.com) သို့သွားပါ
2. New → Web Service → Connect GitHub
3. Build Command: `npm install`
4. Start Command: `node index.js`
5. Environment Variables ထည့်ပါ (BOT_TOKEN, ADMIN_ID)

## Notes
- `canvas` package ကြောင့် Railway / Render မှာ native dependencies လိုနိုင်ပါတယ်
- Free tier မှာ file system ephemeral ဖြစ်လို့ `user_settings.json` တို့ ပြန်ပျောက်နိုင်ပါတယ်
- Production အတွက် database (MongoDB / Redis) သုံးဖို့ အကြံပြုပါတယ်