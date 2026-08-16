const { Telegraf, Markup, session } = require('telegraf');
const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const axios = require('axios');
//const { createCanvas, loadImage } = require('canvas');
const path = require('path');

// Login config
const logging = {
  info: (msg) => console.log(`[INFO] ${new Date().toISOString()} - ${msg}`),
  warning: (msg) => console.log(`[WARN] ${new Date().toISOString()} - ${msg}`),
  error: (msg) => console.log(`[ERROR] ${new Date().toISOString()} - ${msg}`),
  debug: (msg) => console.log(`[DEBUG] ${new Date().toISOString()} - ${msg}`)
};

const userState = {};
const userTemp = {};
const userSessions = {};
const userPendingBets = {};
const userWaitingForResult = {};
const userSkippedBets = {};
const userShouldSkipNext = {};
const userBalanceWarnings = {};
const userSkipResultWait = {};
const userAllResults = {};
const userStopInitiated = {};
const userSLSkipWaitingForWin = {};
const userPlatforms = {};
let userSettings = {};
let userGameInfo = {};
let userStats = {};
let userLastResults = {};
let allowedsixlotteryIds = new Set();
let freeModeEnabled = false;

const activeUsers = new Set();

const PLATFORMS = {
  "6LOTTERY": {
    name: "6LOTTERY",
    baseUrl: "https://6lotteryapi.com/api/webapi/",
    color: "🔴"
  },
  "777BIGWIN": {
    name: "777BIGWIN",
    baseUrl: "https://api.bigwinqaz.com/api/webapi/",
    color: "🟢"
  },
  "CKLOTTERY": {
    name: "CKLOTTERY",
    baseUrl: "https://ckygjf6r.com/api/webapi/",
    color: "🔵"
  }
};

// 🌈 Color 
const COLORS = {
  GREEN: { name: 'Green', id: 11, numbers: [1, 3, 7, 9] },
  VIOLET: { name: 'Violet', id: 12, numbers: [0, 5] },
  RED: { name: 'Red', id: 10, numbers: [2, 4, 6, 8] }
};

// 📊 Emoji Sets
const EMOJI = {
  WIN: '🏆',
  LOSS: '💔',
  RESULT: '🎲',
  SKIP: '⏭️',
  BET: '🎯',
  BALANCE: '💰',
  PROFIT: '📈',
  LOSS_ICON: '📉',
  START: '🚀',
  STOP: '🛑',
  SETTINGS: '⚙️',
  STATS: '📊',
  LOGIN: '🔐',
  LOGOUT: '🚪',
  BACK: '🔙',
  MENU: '📋',
  GAME: '🎮',
  STRATEGY: '🧠',
  RISK: '🛡️',
  TARGET: '🎯',
  LAYER: '🏗️',
  MODE: '🔄',
  INFO: 'ℹ️',
  ADMIN: '👑',
  USER: '👤',
  ADD: '➕',
  REMOVE: '➖',
  BROADCAST: '📢',
  CHECK: '🔍',
  ENABLE: '✅',
  DISABLE: '❌',
  WARNING: '⚠️',
  ERROR: '❌',
  LOADING: '⏳',
  SUCCESS: '🎉',
  WAIT: '⏰',
  VIRTUAL: '🖥️',
  REAL: '💵',
  TREND: '📊',
  ALTERNATE: '🔄',
  PATTERN: '🔢',
  COLOR: '🎨',
  GREEN: '🟢',
  VIOLET: '🟣',
  RED: '🔴',
  MARTINGALE: '📈',
  ANTI_MARTINGALE: '📉',
  DALEMBERT: '⚖️',
  CUSTOM: '🎛️',
  AI: '🤖'
};

// 🎨 Style
const STYLE = {
  SEPARATOR: '─'.repeat(15),
  BOLD: (text) => `*${String(text).replace(/[*_\\`]/g, '\\$&')}*`,
  CODE: (text) => `\`${String(text).replace(/[`\\]/g, '\\$&')}\``, 
  HEADER: (text) => `🔥 *${String(text).replace(/[*_\\`]/g, '\\$&')}* 🔥`,
  SUBHEADER: (text) => `📌 *${String(text).replace(/[*_\\`]/g, '\\$&')}*`,
  SECTION: (text) => `📁 *${String(text).replace(/[*_\\`]/g, '\\$&')}*`,
  ITEM: (text) => `├─ ${text}`,
  LAST_ITEM: (text) => `└─ ${text}`
};

// ============================================
// AI MODE FUNCTIONS
// ============================================

// Volatility တွက်ချက်ရန်
function calcVolatility(userId) {
  const results = userAllResults[userId] || [];
  if (results.length < 10) return 0.5;
  
  const last10 = results.slice(-10);
  let changes = 0;
  for (let i = 1; i < last10.length; i++) {
    if (last10[i] !== last10[i-1]) changes++;
  }
  return changes / 9; // 0 to 1 scale
}

// Win Streak တွက်ချက်ရန်
function calcWinStreak(userId) {
  const stats = userStats[userId];
  if (!stats || !stats.recent_results) return 0;
  
  let streak = 0;
  const recent = stats.recent_results || [];
  for (let i = recent.length - 1; i >= 0; i--) {
    if (recent[i] === 'WIN') streak++;
    else break;
  }
  return streak;
}

// AI Strategy Selector
function aiSelectStrategy(userId) {
  const volatility = calcVolatility(userId);
  const streak = calcWinStreak(userId);
  const settings = userSettings[userId] || {};
  const betType = settings.bet_type || "BS";
  
  // Color mode ဆိုရင် COLOR_SNIPER ကိုသုံးမယ်
  if (betType === "COLOR") {
    return "COLOR_SNIPER";
  }
  
  if (volatility > 0.7) return "GEMINI_AI";
  if (streak >= 3) return "DEEPSEEK_ADAPTIVE";
  if (volatility < 0.3) return "TREND_FOLLOW";
  return "GPT_ADAPTIVE_AI";
}

// AI Bet Size Controller
function aiBaseBet(balance, aiLevel) {
  if (aiLevel === "SAFE") return balance * 0.008;
  if (aiLevel === "SMART") return balance * 0.012;
  return balance * 0.02; // AGGRESSIVE
}

// AI Risk Guardian
function aiRiskGuard(userId, balance, startBalance) {
  if (!startBalance || startBalance === 0) return "OK";
  
  const dd = ((startBalance - balance) / startBalance) * 100;
  
  if (dd >= 15) return "STOP";
  if (dd >= 8) return "PAUSE";
  return "OK";
}

// AI Mode Status Message
function getAIStatusMessage(userId, settings, balance, startBalance) {
  const aiMode = settings.ai_mode || { enabled: false, level: "SMART" };
  if (!aiMode.enabled) return "";
  
  const dd = startBalance ? ((startBalance - balance) / startBalance) * 100 : 0;
  const riskStatus = aiRiskGuard(userId, balance, startBalance);
  
  let riskEmoji = "🟢";
  if (riskStatus === "PAUSE") riskEmoji = "🟡";
  if (riskStatus === "STOP") riskEmoji = "🔴";
  
  return `\n\n🤖 *AI MODE:* ${aiMode.level}\n` +
         `Strategy: ${aiMode.current_strategy || 'N/A'}\n` +
         `Base Bet: ${aiMode.base_bet_percent}%\n` +
         `Risk: ${riskEmoji} ${riskStatus}\n` +
         `Drawdown: ${dd.toFixed(1)}%`;
}

// AI Mode Main Controller (Round တိုင်းမှာ Run)
async function aiModeController(userId, ctx, bot, currentBalance) {
  const settings = userSettings[userId];
  if (!settings || !settings.ai_mode || !settings.ai_mode.enabled) {
    return { shouldProceed: true, betAmount: null, strategy: null };
  }
  
  const aiMode = settings.ai_mode;
  
  // Virtual/Real Mode အလိုက် startBalance ကိုရှာမယ်
  let startBalance;
  if (settings.virtual_mode) {
    startBalance = userStats[userId]?.initial_balance || currentBalance;
  } else {
    startBalance = userStats[userId]?.start_balance || currentBalance;
  }
  
  // Risk Guardian Check
  const riskStatus = aiRiskGuard(userId, currentBalance, startBalance);
  
  if (riskStatus === "STOP") {
    settings.running = false;
    await bot.telegram.sendMessage(userId, 
      `🛑 *AI MODE STOPPED*\n` +
      `Reason: Max Drawdown Reached\n` +
      `Loss: ${((startBalance - currentBalance) / startBalance * 100).toFixed(1)}%\n` +
      `Advice: Resume after cooldown`,
      { parse_mode: 'Markdown' }
    );
    return { shouldProceed: false, betAmount: null, strategy: null };
  }
  
  if (riskStatus === "PAUSE") {
    aiMode.pause_until = Date.now() + 300000;
    await bot.telegram.sendMessage(userId,
      `⏸️ *AI MODE PAUSED*\n` +
      `Reason: Soft Drawdown Reached (${aiMode.soft_drawdown}%)\n` +
      `Current Drawdown: ${((startBalance - currentBalance) / startBalance * 100).toFixed(1)}%\n` +
      `Resuming in 5 minutes...`,
      { parse_mode: 'Markdown' }
    );
    return { shouldProceed: false, betAmount: null, strategy: null };
  }
  
  if (aiMode.pause_until && Date.now() < aiMode.pause_until) {
    return { shouldProceed: false, betAmount: null, strategy: null };
  } else if (aiMode.pause_until) {
    aiMode.pause_until = null;
  }
  
  const roundsSinceSwitch = (settings.rounds_played || 0) - (aiMode.last_switch_round || 0);
  if (roundsSinceSwitch >= 10 || !aiMode.current_strategy) {
    aiMode.current_strategy = aiSelectStrategy(userId);
    aiMode.last_switch_round = settings.rounds_played || 0;
    logging.info(`AI Mode: Strategy changed to ${aiMode.current_strategy} for user ${userId}`);
  }
  
  const baseBet = aiBaseBet(currentBalance, aiMode.level);
  const betAmount = Math.max(Math.floor(baseBet), 100);
  
  return { 
    shouldProceed: true, 
    betAmount, 
    strategy: aiMode.current_strategy 
  };
}

// ============================================
// END AI MODE FUNCTIONS
// ============================================


function saveUserSettings() {
  try {
    const settingsData = {
      userSettings: userSettings,
      userGameInfo: userGameInfo,
      userStats: userStats,
      userLastResults: userLastResults
    };
    fs.writeFileSync('user_settings.json', JSON.stringify(settingsData, null, 4));
    logging.info("User settings saved to file");
  } catch (error) {
    logging.error(`Error saving user settings: ${error}`);
  }
}

function loadUserSettings() {
  try {
    if (fs.existsSync('user_settings.json')) {
      const data = JSON.parse(fs.readFileSync('user_settings.json', 'utf8'));
      
      Object.assign(userSettings, data.userSettings || {});
      Object.assign(userGameInfo, data.userGameInfo || {});
      Object.assign(userStats, data.stats || {});
      
      if (data.userLastResults && Array.isArray(data.userLastResults)) {
        userLastResults.length = 0;
        data.userLastResults.forEach(item => userLastResults.push(item));
      }
      
      logging.info("User settings loaded from file");
    } else {
      logging.info("user_settings.json not found. Starting with empty settings");
    }
  } catch (error) {
    logging.error(`Error loading user settings: ${error}`);
  }
}

const FREE_MODE_CONFIG_FILE = 'free_mode.json';

function loadFreeModeSetting() {
  try {
    if (fs.existsSync(FREE_MODE_CONFIG_FILE)) {
      const data = JSON.parse(fs.readFileSync(FREE_MODE_CONFIG_FILE, 'utf8'));
      freeModeEnabled = data.enabled || false;
      logging.info(`Free Mode loaded: ${freeModeEnabled ? 'ENABLED' : 'DISABLED'}`);
    } else {
      freeModeEnabled = false;
      saveFreeModeSetting();
      logging.info("Free Mode config not found. Starting with Free Mode DISABLED");
    }
  } catch (error) {
    logging.error(`Error loading free mode setting: ${error}`);
    freeModeEnabled = false;
  }
}

function saveFreeModeSetting() {
  try {
    const data = { enabled: freeModeEnabled };
    fs.writeFileSync(FREE_MODE_CONFIG_FILE, JSON.stringify(data, null, 4));
    logging.info(`Free Mode saved: ${freeModeEnabled ? 'ENABLED' : 'DISABLED'}`);
  } catch (error) {
    logging.error(`Error saving free mode setting: ${error}`);
  }
}

async function makeRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const agent = new https.Agent({ 
      rejectUnauthorized: false,
      keepAlive: true,
      keepAliveMsecs: 1000
    });
    
    const defaultOptions = {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:142.0) Gecko/20100101 Firefox/142.0',
        'Connection': 'Keep-Alive',
        'Ar-Origin': 'https://6win598.com',
        'Origin': 'https://6win598.com',
        'Referer': 'https://6win598.com/',
      },
      timeout: 12000
    };
    
    const requestOptions = {
      ...defaultOptions,
      ...options,
      agent
    };
    
    const req = https.request(url, requestOptions, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const jsonData = JSON.parse(data);
          resolve({ data: jsonData });
        } catch (error) {
          reject(new Error(`Failed to parse response: ${error.message}`));
        }
      });
    });
    
    req.on('error', (error) => {
      reject(error);
    });
    
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timed out'));
    });
    
    if (options.body) {
      req.write(JSON.stringify(options.body));
    }
    
    req.end();
  });
}

function loadAllowedUsers() {
  try {
    if (fs.existsSync('users_6lottery.json')) {
      const data = JSON.parse(fs.readFileSync('users_6lottery.json', 'utf8'));
      allowedsixlotteryIds = new Set(data.allowed_ids || []);
      logging.info(`Loaded ${allowedsixlotteryIds.size} users`);
    } else {
      logging.warning("users_6lottery.json not found. Starting new");
      allowedsixlotteryIds = new Set();
    }
  } catch (error) {
    logging.error(`Error loading users_6lottery.json: ${error}`);
    allowedsixlotteryIds = new Set();
  }
}

function saveAllowedUsers() {
  try {
    fs.writeFileSync('users_6lottery.json', JSON.stringify({ 
      allowed_ids: Array.from(allowedsixlotteryIds) 
    }, null, 4));
    logging.info(`Saved ${allowedsixlotteryIds.size} users`);
  } catch (error) {
    logging.error(`Error saving user list: ${error}`);
  }
}

function normalizeText(text) {
  return text.normalize('NFKC').trim();
}

function signMd5(data) {
  const filtered = {};
  for (const [key, value] of Object.entries(data)) {
    if (key !== "signature" && key !== "timestamp") {
      filtered[key] = value;
    }
  }
  const sorted = Object.keys(filtered).sort().reduce((acc, key) => {
    acc[key] = filtered[key];
    return acc;
  }, {});
  const jsonStr = JSON.stringify(sorted).replace(/\s+/g, '');
  return crypto.createHash('md5').update(jsonStr).digest('hex').toUpperCase();
}

function computeUnitAmount(amt) {
  if (amt <= 0) return 1;
  const amtStr = String(amt);
  const trailingZeros = amtStr.length - amtStr.replace(/0+$/, '').length;
  
  if (trailingZeros >= 4) return 10000;
  if (trailingZeros === 3) return 1000;
  if (trailingZeros === 2) return 100;
  if (trailingZeros === 1) return 10;
  return Math.pow(10, amtStr.length - 1);
}

function getSelectMap(gameType, betType) {
  if (betType === 'COLOR') {
    return { 
      "G": 11,  // Green
      "V": 12,  // Violet
      "R": 10   // Red
    };
  } else {
    return { 
      "B": 13,  // Big
      "S": 14   // Small
    };
  }
}

function numberToBS(num) {
  return num >= 5 ? 'B' : 'S';
}

function numberToColor(num) {
  if (COLORS.GREEN.numbers.includes(num)) return 'G';
  if (COLORS.VIOLET.numbers.includes(num)) return 'V';
  if (COLORS.RED.numbers.includes(num)) return 'R';
  return 'G'; // Default to Green
}

function getColorName(colorCode) {
  switch(colorCode) {
    case 'G': return COLORS.GREEN.name;
    case 'V': return COLORS.VIOLET.name;
    case 'R': return COLORS.RED.name;
    default: return 'Unknown';
  }
}

function getValidDalembertBetAmount(unitSize, currentUnits, balance, minBet) {
  let amount = unitSize * currentUnits;
  
  while (amount > balance && currentUnits >1) {
    currentUnits--;
    amount = unitSize * currentUnits;
  }
  
  if (amount > balance) {
    amount = balance;
  }
  
  if (amount < minBet) {
    amount = minBet;
  }
  
  return { amount, adjustedUnits: currentUnits };
}

function computeBetDetails(desiredAmount) {
  if (desiredAmount <= 0) {
    return { unitAmount: 0, betCount: 0, actualAmount: 0 };
  }
  
  const unitAmount = computeUnitAmount(desiredAmount);
  const betCount = Math.max(1, Math.floor(desiredAmount / unitAmount));
  const actualAmount = unitAmount * betCount;
  
  return { unitAmount, betCount, actualAmount };
}

function calculateBetAmount(settings, currentBalance) {
  const bettingStrategy = settings.betting_strategy || "Martingale";
  const betSizes = settings.bet_sizes || [100];
  const minBetSize = Math.min(...betSizes);
  
  logging.debug(`Calculating bet amount - Strategy: ${bettingStrategy}, Bet Sizes: [${betSizes.join(', ')}]`);
  
  if (bettingStrategy === "D'Alembert") {
    if (betSizes.length > 1) {
      throw new Error("D'Alembert strategy requires only ONE bet size");
    }
    
    const unitSize = betSizes[0];
    let units = settings.dalembert_units || 1;
    
    const { amount: validAmount, adjustedUnits } = getValidDalembertBetAmount(unitSize, units, currentBalance, minBetSize);
    
    if (adjustedUnits !== units) {
      settings.dalembert_units = adjustedUnits;
      units = adjustedUnits;
      logging.info(`D'Alembert: Adjusted units to ${units} due to balance constraints`);
    }
    
    logging.info(`D'Alembert: Betting ${validAmount} (${units} units of ${unitSize})`);
    return validAmount;
    
  } else if (bettingStrategy === "Custom") {
    const customIndex = settings.custom_index || 0;
    const adjustedIndex = Math.min(customIndex, betSizes.length - 1);
    const amount = betSizes[adjustedIndex];
    logging.info(`Custom: Betting ${amount} at index ${adjustedIndex}`);
    return amount;
    
  } else {
    // Martingale / Anti
    const martinIndex = settings.martin_index || 0;
    const adjustedIndex = Math.min(martinIndex, betSizes.length - 1);
    const amount = betSizes[adjustedIndex];
    logging.info(`${bettingStrategy}: Betting ${amount} at index ${adjustedIndex}`);
    return amount;
  }
}

function updateBettingStrategy(settings, isWin, betAmount) {
  const bettingStrategy = settings.betting_strategy || "Martingale";
  const betSizes = settings.bet_sizes || [100];
  
  logging.debug(`Updating betting strategy - Strategy: ${bettingStrategy}, ရလဒ်: ${isWin ? 'WIN' : 'LOSS'}, Bet Amount: ${betAmount}`);
  
  if (bettingStrategy === "Martingale") {
    if (isWin) {
      settings.martin_index = 0;
      logging.info("Martingale: Win - Reset to index 0");
    } else {
      settings.martin_index = Math.min((settings.martin_index || 0) + 1, betSizes.length - 1);
      logging.info(`Martingale: Loss - Move to index ${settings.martin_index}`);
    }
    
  } else if (bettingStrategy === "Anti-Martingale") {
    if (isWin) {
      settings.martin_index = Math.min((settings.martin_index || 0) + 1, betSizes.length - 1);
      logging.info(`Anti-Martingale: Win - Move to index ${settings.martin_index}`);
    } else {
      settings.martin_index = 0;
      logging.info("Anti-Martingale: Loss - Reset to index 0");
    }
    
  } else if (bettingStrategy === "D'Alembert") {
    if (isWin) {
      settings.dalembert_units = Math.max(1, (settings.dalembert_units || 1) - 1);
      logging.info(`D'Alembert: Win - Decrease units to ${settings.dalembert_units}`);
    } else {
      settings.dalembert_units = (settings.dalembert_units || 1) + 1;
      logging.info(`D'Alembert: Loss - Increase units to ${settings.dalembert_units}`);
    }
    
  } else if (bettingStrategy === "Custom") {
    const currentIndex = settings.custom_index || 0;
    
    let actualIndex = 0;
    for (let i = 0; i < betSizes.length; i++) {
      if (betSizes[i] === betAmount) {
        actualIndex = i;
        break;
      }
    }
    
    if (isWin) {
      if (actualIndex > 0) {
        settings.custom_index = actualIndex - 1;
      } else {
        settings.custom_index = 0;
      }
      logging.info(`Custom: Win - Move to index ${settings.custom_index}`);
    } else {
      if (actualIndex < betSizes.length - 1) {
        settings.custom_index = actualIndex + 1;
      } else {
        settings.custom_index = betSizes.length - 1;
      }
      logging.info(`Custom: Loss - Move to index ${settings.custom_index}`);
    }
  }
}

function generateSignature(data) {
  const f = {};
  const exclude = ["signature", "track", "xosoBettingData"];
  
  Object.keys(data).sort().forEach(function(k) {
    const v = data[k];
    if (v !== null && v !== '' && !exclude.includes(k)) {
      f[k] = v === 0 ? 0 : v;
    }
  });
  
  const jstr = JSON.stringify(f);
  return crypto.createHash('md5').update(jstr).digest('hex').toUpperCase();
}

async function loginRequest(phone, password, baseUrl = PLATFORMS["CKLOTTERY"].baseUrl) {
  if (!baseUrl.endsWith('/')) baseUrl += '/';

  const loginData = {
    username: "95" + phone,
    pwd: password,
    phonetype:1,
    logintype: "mobile",
    packId: "",
    deviceId: "5dcab3e06db88a206975e91ea6ac7c87",
    language: 7,
    random: crypto.randomBytes(16).toString('hex'),
  };
  
  const signature = generateSignature(loginData);
  loginData.signature = signature;
  loginData.timestamp = Math.floor(Date.now() / 1000);
  
  try {
    const response = await axios.post(
      baseUrl + "Login",
      loginData,
      {
        headers: {
          "Content-Type": "application/json;charset=UTF-8",
          "Ar-Origin": "https://6win598.com",
          "Origin": "https://6win598.com",
          "Referer": "https://6win598.com/",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:142.0) Gecko/20100101 Firefox/142.0",
          "Accept-Language": "en-US,en;q=0.5",
          "Accept-Encoding": "gzip, deflate, br",
          "Connection": "keep-alive",
        },
        timeout: 15000,
      }
    );
    
    const res = response.data;
    if (res.code === 0 && res.data) {
      const tokenHeader = res.data.tokenHeader || "Bearer ";
      const token = res.data.token || "";
      
      const session = {
        post: async (endpoint, data) => {
          const url = baseUrl + endpoint;
          const options = {
            method: 'POST',
            headers: {
              "Authorization": `${tokenHeader}${token}`,
              "Content-Type": "application/json; charset=UTF-8",
              "Ar-Origin": "https://6win598.com",
              "Origin": "https://6win598.com",
              "Referer": "https://6win598.com/",
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:142.0) Gecko/20100101 Firefox/142.0"
            },
            body: data
          };
          return makeRequest(url, options);
        }
      };
      return { response: res, session };
    }
    return { response: res, session: null };
  } catch (error) {
    logging.error(`Login error: ${error.message}`);
    return { response: { error: error.message }, session: null };
  }
}

async function getUserInfo(session, userId) {
  const body = {
    "language": 7,
    "random": "4fc9f8f8d6764a5f934d4c6a468644e0"
  };
  body.signature = generateSignature(body).toUpperCase();
  body.timestamp = Math.floor(Date.now() / 1000);
  
  try {
    const response = await session.post("GetUserInfo", body);
    const res = response.data;
    if (res.code === 0 && res.data) {
      const info = {
        "user_id": res.data.userId,
        "username": res.data.userName,
        "nickname": res.data.nickName,
        "balance": res.data.amount,
        "photo": res.data.userPhoto,
        "login_date": res.data.userLoginDate,
        "withdraw_count": res.data.withdrawCount,
        "is_allow_withdraw": res.data.isAllowWithdraw === 1
      };
      userGameInfo[userId] = info;
      return info;
    }
    return null;
  } catch (error) {
    logging.error(`Get user info error: ${error.message}`);
    return null;
  }
}

async function getBalance(session, userId) {
  const platformKey = userSettings[userId]?.platform || "CKLOTTERY";
  const platform = PLATFORMS[platformKey];
  const body = {
    "language": 7,
    "random": "71ebd56cff7d4679971c482807c33f6f"
  };
  body.signature = generateSignature(body).toUpperCase();
  body.timestamp = Math.floor(Date.now() / 1000);
  
  try {
    const response = await session.post("GetBalance", body);
    const res = response.data;
    logging.info(`Balance check response for user ${userId}`);
    
    if (res.code === 0 && res.data) {
      const data = res.data;
      const amount = data.Amount || data.amount || data.balance;
      if (amount !== undefined && amount !== null) {
        const balance = parseFloat(amount);
        if (userGameInfo[userId]) {
          userGameInfo[userId].balance = balance;
        }
        if (!userStats[userId]) {
          userStats[userId] = { start_balance: balance, profit: 0.0 };
        }
        return balance;
      }
      logging.warning(`No balance amount found for user ${userId}`);
    } else {
      logging.error(`Get balance failed for user ${userId}: ${res.msg || 'Unknown error'}`);
    }
    return null;
  } catch (error) {
    logging.error(`Balance check error for user ${userId}: ${error.message}`);
    return null;
  }
}

async function getGameIssueRequest(session, gameType) {
  let typeId, endpoint;
  
  if (gameType === "TRX") {
    typeId = 13;
    endpoint = "GetTrxGameIssue";
  } else if (gameType === "WINGO_30S") {
    typeId = 30; // Wingo 30s 
    endpoint = "GetGameIssue"; 
  } else if (gameType === "WINGO_3MIN") {
    typeId = 2; // Wingo 3min
    endpoint = "GetGameIssue"; 
  } else if (gameType === "WINGO_5MIN") {
    typeId = 3; // Wingo 5min
    endpoint = "GetGameIssue"; 
  } else {
    typeId = 1; // WINGO 1min
    endpoint = "GetGameIssue";
  }
  
  const body = {
    "typeId": typeId,
    "language": 7,
    "random": "7d76f361dc5d4d8c98098ae3d48ef7af"
  };
  body.signature = signMd5(body).toUpperCase();
  body.timestamp = Math.floor(Date.now() / 1000);
  
  const maxRetries = 3;
  const retryDelay = 2000; 
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await session.post(endpoint, body);
      logging.info(`Game issue request for ${gameType}, attempt ${attempt + 1}`);
      
      if (response.data && response.data.code === 0) {
        return response.data;
      } else if (response.data && response.data.code !== 0) {
        logging.error(`Game issue error for ${gameType}: ${response.data.msg || 'Unknown error'}`);
        if (attempt < maxRetries - 1) {
          await new Promise(resolve => setTimeout(resolve, retryDelay));
          continue;
        }
        return response.data;
      }
      
      return response.data;
    } catch (error) {
      logging.error(`Game issue error for ${gameType}, attempt ${attempt + 1}: ${error.message}`);
      
      if (attempt < maxRetries - 1) {
        await new Promise(resolve => setTimeout(resolve, retryDelay));
        continue;
      }
      return { error: error.message };
    }
  }
  
  return { error: "Failed after retries" };
}

async function placeBetRequest(session, issueNumber, selectType, unitAmount, betCount, gameType, userId) {
  let typeId, endpoint;
  
  if (gameType === "TRX") {
    typeId = 13;
    endpoint = "GameTrxBetting";
  } else if (gameType === "WINGO_30S") {
    typeId = 30; // Wingo 30s
    endpoint = "GameBetting";
  } else if (gameType === "WINGO_3MIN") {
    typeId = 2; // Wingo 3min
    endpoint = "GameBetting";
  } else if (gameType === "WINGO_5MIN") {
    typeId = 3; // Wingo 5min
    endpoint = "GameBetting";
  } else {
    typeId = 1; //  WINGO 1min
    endpoint = "GameBetting";
  }
  
  const settings = userSettings[userId] || {};
  const betType = settings.bet_type || "BS";
  const actualGameType = betType === "COLOR" ? 0 : 2; 
  
  if (!selectType || isNaN(selectType)) {
    logging.error(`Invalid selectType: ${selectType} for user ${userId}`);
    return { error: "Invalid bet selection type" };
  }
  
  const betBody = {
    "typeId": typeId,
    "issuenumber": issueNumber,
    "language": 7,
    "gameType": actualGameType, 
    "amount": unitAmount,
    "betCount": betCount,
    "selectType": parseInt(selectType),
    "random": "f9ec46840a374a65bb2abad44dfc4dc3"
  };
  betBody.signature = generateSignature(betBody).toUpperCase();
  betBody.timestamp = Math.floor(Date.now() / 1000);
  
  logging.info(`Bet request details for user ${userId}:`);
  logging.info(`  ဂိမ်းအမျိုးအစား: ${gameType}, လောင်းကစားအမျိုးအစား: ${betType}, API gameType: ${actualGameType}`);
  logging.info(`  Issue: ${issueNumber}, SelectType: ${selectType}, Amount: ${unitAmount * betCount}`);
  
  for (let attempt = 0; attempt < MAX_BET_RETRIES; attempt++) {
    try {
      const response = await session.post(endpoint, betBody);
      const res = response.data;
      logging.info(`Bet request for user ${userId}, ${gameType}, issue ${issueNumber}, select_type ${selectType}, amount ${unitAmount * betCount}`);
      return res;
    } catch (error) {
      logging.error(`Bet error for user ${userId}, attempt ${attempt + 1}: ${error.message}`);
      
      if (attempt < MAX_BET_RETRIES - 1) {
        await new Promise(resolve => setTimeout(resolve, BET_RETRY_DELAY * 1000));
        continue;
      }
      return { error: error.message };
    }
  }
  return { error: "Failed after retries" };
}

async function getWingoGameResults(session, gameType = "WINGO") {
  let typeId;
  let endpoint = "GetNoaverageEmerdList"; // Default endpoint
  
  if (gameType === "WINGO_30S") {
    typeId = 30;
  } else if (gameType === "WINGO_3MIN") {
    typeId = 2;
  } else if (gameType === "WINGO_5MIN") {
    typeId = 3;
  } else {
    typeId = 1;
  }
  
  const body = {
    "pageSize": 10,
    "pageNo": 1,
    "typeId": typeId,
    "language": 7,
    "random": "4ad5325e389745a882f4189ed6550e70"
  };
  
  if (gameType === "WINGO_30S") {
    body.signature = "5483D466A138F08B6704354BAA7E7FB3";
    body.timestamp = 1761247150;
  } else {
    body.signature = generateSignature(body).toUpperCase();
    body.timestamp = Math.floor(Date.now() / 1000);
  }
  
  try {
    const response = await session.post(endpoint, body);
    const data = response.data;
    
    if (data && data.code === 0 && data.data && data.data.list) {
      logging.info(`Successfully fetched ${data.data.list.length} results for ${gameType}`);
      return data;
    } else {
      logging.error(`Failed to get ${gameType} results: ${data?.msg || 'Unknown error'}`);
      return data;
    }
  } catch (error) {
    logging.error(`Error getting ${gameType} results: ${error.message}`);
    return { error: error.message };
  }
}

// Telegram message 
async function sendMessageWithRetry(ctx, text, replyMarkup = null) {
  // မူလ Markdown ပြင်ဆင်ချက်များကို ထားထားပါမည်
  const cleanText = text.replace(/\*\*(.*?)\*\*/g, '*$1*') 
                       .replace(/__(.*?)__/g, '_$1_')     
                       .replace(/```/g, '`\u200b`\u200b`'); 
  
  for (let attempt = 0; attempt < MAX_TELEGRAM_RETRIES; attempt++) {
    try {
      const options = { parse_mode: 'Markdown' };
      if (replyMarkup) {
        options.reply_markup = replyMarkup.reply_markup || replyMarkup;
      }
      
      await ctx.reply(cleanText, options);
      return true;
    } catch (error) {
      logging.error(`Telegram message error, attempt ${attempt + 1}: ${error.message}`);
      
      // Markdown Error တက်ခဲ့လျှင် (can't parse entities)
      if (error.response && error.response.error_code === 400 && 
          error.response.description.includes("can't parse entities")) {
        try {
          const plainOptions = {}; // parse_mode မသုံးတော့ပါ
          if (replyMarkup) {
            plainOptions.reply_markup = replyMarkup.reply_markup || replyMarkup;
          }
          
          // 🌟 ပြင်ဆင်လိုက်သော အပိုင်း 🌟
          // '\' တွေခံမယ့်အစား, စာသားထဲမှာပါနေတဲ့ *, _, ` စတဲ့ Markdown သင်္ကေတတွေကို အပြီးတိုင် ဖျက်ပစ်လိုက်ပါမည်။
          // ဒါမှသာ ရိုးရိုးစာသား ပို့တဲ့အခါ သပ်သပ်ရပ်ရပ် ဖြစ်နေမှာပါ။
          const plainText = text.replace(/[*_`]/g, ''); 
          
          await ctx.reply(`⚠️ [Formatting Error - Plain Text Mode]\n\n${plainText}`, plainOptions);
          return true; // အောင်မြင်သွားလျှင် Loop ထဲမှ ထွက်မည်
        } catch (plainError) {
          logging.error(`Plain text fallback also failed: ${plainError.message}`);
        }
      }
      
      if (attempt < MAX_TELEGRAM_RETRIES - 1) {
        await new Promise(resolve => setTimeout(resolve, TELEGRAM_RETRY_DELAY));
        continue;
      }
      return false;
    }
  }
  return false;
}

async function safeDeleteMessage(ctx, messageId = null) {
  try {
    const msgId = messageId || ctx.callbackQuery?.message?.message_id;
    if (msgId) {
      await ctx.deleteMessage(msgId);
    }
  } catch (error) {
    if (error.response?.error_code !== 400) {
      logging.error(`Failed to delete message: ${error.message}`);
    }
  }
}

async function checkProfitAndStopLoss(userId, bot) {
  const settings = userSettings[userId] || {};
  const stats = safeGetUserStats(userId);
  
  const targetProfit = settings.target_profit;
  const stopLossLimit = settings.stop_loss;

  const isSniperStrategy = ["CYBER_SNIPER", "COLOR_SNIPER", "ULTRA_SNIPER"].includes(settings.strategy);
  
  if (isSniperStrategy) {
    logging.info(`Skipping profit/stop-loss check for ${settings.strategy} strategy`);
    return false;
  }
  
  if (!targetProfit && !stopLossLimit) {
    return false;
  }
  
  
  let currentProfit;
  let balance;
  
  if (settings.virtual_mode) {
    currentProfit = (userStats[userId].virtual_balance || 0) - (userStats[userId].initial_balance || 0);
    balance = userStats[userId].virtual_balance;
  } else {
    currentProfit = userStats[userId].profit || 0;
    const session = userSessions[userId];
    balance = await getBalance(session, parseInt(userId));
  }
  
  if (targetProfit && currentProfit >= targetProfit) {
    settings.running = false;
    delete userWaitingForResult[userId];
    delete userShouldSkipNext[userId];
    
    settings.martin_index = 0;
    settings.dalembert_units = 1;
    settings.custom_index = 0;
    
    settings.profit_target_reached = true;
    settings.profit_target_message = `${EMOJI.TARGET} ${STYLE.HEADER('TARGET ACHIEVED')}\n` +
                                    `${STYLE.SEPARATOR}\n` +
                                    `${STYLE.ITEM(`Target: ${targetProfit} Ks`)}\n` +
                                    `${STYLE.ITEM(`Profit: ${currentProfit >= 0 ? '+' : ''}${currentProfit.toFixed(2)} Ks`)}\n` +
                                    `${STYLE.LAST_ITEM(`${settings.virtual_mode ? 'Virtual Balance' : 'Balance'}: ${balance?.toFixed(2) || '0.00'} Ks`)}`;
    
    try {
      const imagePath = await createResultImage('PROFIT', targetProfit, balance, settings.virtual_mode, currentProfit, userId);
      
      const restartKeyboard = Markup.inlineKeyboard([
        Markup.button.callback(`${EMOJI.START} RESTART`, `restart_bot:${userId}`)
      ]);
      
      await bot.telegram.sendPhoto(userId, { source: imagePath }, {
        caption: settings.profit_target_message,
        parse_mode: 'Markdown',
        reply_markup: restartKeyboard.reply_markup
      });
      
      fs.unlinkSync(imagePath);
    } catch (error) {
      logging.error(`Error creating/sending profit target image: ${error.message}`);
    }
    
    return true;
  }
  
  if (stopLossLimit && currentProfit <= -stopLossLimit) {
    settings.running = false;
    delete userWaitingForResult[userId];
    delete userShouldSkipNext[userId];
    
    settings.martin_index = 0;
    settings.dalembert_units =1;
    settings.custom_index =0;
    
    settings.stop_loss_reached = true;
    settings.stop_loss_message = `${EMOJI.STOP} ${STYLE.HEADER('STOP LOSS HIT')}\n` +
                               `${STYLE.SEPARATOR}\n` +
                               `${STYLE.ITEM(`Limit: ${stopLossLimit} Ks`)}\n` +
                               `${STYLE.ITEM(`Loss: ${Math.abs(currentProfit).toFixed(2)} Ks`)}\n` +
                               `${STYLE.LAST_ITEM(`${settings.virtual_mode ? 'Virtual Balance' : 'Balance'}: ${balance?.toFixed(2) || '0.00'} Ks`)}`;
    
    try {
      const imagePath = await createResultImage('STOP LOSS', stopLossLimit, balance, settings.virtual_mode, currentProfit, userId);
      
      const restartKeyboard = Markup.inlineKeyboard([
        Markup.button.callback(`${EMOJI.START} RESTART`, `restart_bot:${userId}`)
      ]);
      
      await bot.telegram.sendPhoto(userId, { source: imagePath }, {
        caption: settings.stop_loss_message,
        parse_mode: 'Markdown',
        reply_markup: restartKeyboard.reply_markup
      });
      
      fs.unlinkSync(imagePath);
    } catch (error) {
      logging.error(`Error creating/sending stop loss image: ${error.message}`);
    }
    
    return true;
  }
  
  return false;
}

function ensureUserStatsInitialized(userId) {
  if (!userStats[userId]) {
    const settings = userSettings[userId] || {};
    userStats[userId] = {
      start_balance: 0,
      profit: 0,
      virtual_balance: settings.virtual_mode ? (settings.virtual_balance || 0) : 0,
      initial_balance: settings.virtual_mode ? (settings.virtual_balance || 0) : 0,
      recent_results: []
    };
    logging.info(`Initialized userStats for user ${userId}`);
  }
}

function safeGetUserStats(userId) {
  if (!userStats[userId]) {
    const settings = userSettings[userId] || {};
    userStats[userId] = {
      start_balance: 0,
      profit: 0,
      virtual_balance: settings.virtual_mode ? (settings.virtual_balance || 0) : 0,
      initial_balance: settings.virtual_mode ? (settings.virtual_balance || 0) : 0,
      recent_results: []
    };
    logging.info(`Created userStats for ${userId}`);
  }
  return userStats[userId];
}

// 1. CYBER_SNIPER
function getCyberSniperPrediction(userId) {
  const state = userSettings[userId].cyber_sniper_state || {
    active: false,
    direction: null, // 'B' or 'S'
    sequence: [],
    step: 0,
    hit_count: 0,
    got_same_result: false
  };

  const lastNumbers = userLastResults[userId] || [];
  const lastNumStr = lastNumbers.length > 0 ? lastNumbers[lastNumbers.length - 1] : null;

  if (!state.active && lastNumStr) {
    if (lastNumStr === "0") {
      state.active = true;
      state.direction = "B";
      state.sequence = ["B"];
      state.step = 0;
      state.hit_count = 0;
      state.got_same_result = false;
      logging.info(`CYBER_SNIPER: Triggered by 0. Betting BIG.`);
    } else if (lastNumStr === "9") {
      state.active = true;
      state.direction = "S";
      state.sequence = ["S"];
      state.step = 0;
      state.hit_count = 0;
      state.got_same_result = false;
      logging.info(`CYBER_SNIPER: Triggered by 9. Betting SMALL.`);
    }
  }

  userSettings[userId].cyber_sniper_state = state;

  if (state.active) {
    if (state.step < state.sequence.length) {
      return { choice: state.sequence[state.step], shouldSkip: false };
    } else {
      return { choice: state.direction, shouldSkip: false };
    }
  } else {
    return { choice: 'B', shouldSkip: true }; 
  }
}

// 2. QUANTUM_CALC 
function getQuantumCalcPrediction(userId) {
  if (!userAllResults[userId] || userAllResults[userId].length < 5) {
    return 'B';
  }

  const latest5 = userAllResults[userId].slice(-5);
  const numericLatest5 = latest5.map(r => r === 'B' ? 7 : 2);
  const sumLatest = numericLatest5.reduce((a, b) => a + b, 0);

  const remainingHistory = userAllResults[userId].slice(0, -5);
  let sumHistory = 0;
  if (remainingHistory.length > 0) {
    const numericHistory = remainingHistory.map(r => r === 'B' ? 7 : 2);
    sumHistory = numericHistory.reduce((a, b) => a + b, 0);
  }

  const diff = Math.abs(sumLatest - sumHistory);
  const lastDigit = diff % 10;
  const isTwoDigitCalc = Math.abs(sumLatest - sumHistory) >= 10;

  logging.info(`QUANTUM_CALC: SumLatest=${sumLatest}, SumHistory=${sumHistory}, Diff=${diff}, LastDigit=${lastDigit}, Is2Digit=${isTwoDigitCalc}`);

  if (isTwoDigitCalc) {
    if (lastDigit >= 5) return 'S';
    else return 'B';
  } else {
    if (lastDigit >= 5) return 'B';
    else return 'S';
  }
}

// 3. TIME_WARP
function getTimeWarpPrediction(userId) {
  if (!userSettings[userId].time_warp_pos) {
    userSettings[userId].time_warp_pos = 8; 
  }
  const pos = userSettings[userId].time_warp_pos;

  if (!userAllResults[userId] || userAllResults[userId].length < pos) {
    // Fallback if not enough data
    const last = userAllResults[userId]?.slice(-1)[0];
    return last || 'B';
  }

  const index = userAllResults[userId].length - pos;
  const prediction = userAllResults[userId][index];
  logging.info(`TIME_WARP: Looking back ${pos} positions (index ${index}), found ${prediction}`);
  return prediction;
}

// 4. COLOR SNIPER
function getColorSniperPrediction(userId) {
  const state = userSettings[userId].color_sniper_state || {
    active: false,
    step: 0,
    hit_count: 0,
    waiting_for_trigger: true
  };

  const lastNumbers = userLastResults[userId] || [];
  const lastNumStr = lastNumbers.length > 0 ? lastNumbers[lastNumbers.length - 1] : null;

  if (!state.active && state.waiting_for_trigger && lastNumStr) {
    if (lastNumStr === "1" || lastNumStr === "7") {
      state.active = true;
      state.waiting_for_trigger = false;
      state.step = 0;
      state.hit_count = 0;
      logging.info(`COLOR_SNIPER: Triggered by ${lastNumStr}. Betting RED.`);
    }
  }

  userSettings[userId].color_sniper_state = state;

  if (state.active) {
    return { choice: 'R', shouldSkip: false };
  } else {
    return { choice: 'R', shouldSkip: true };
  }
}
   // 5. ULTRA_SNIPER
function getUltraSniperPrediction(userId) {
  const state = userSettings[userId].ultra_sniper_state || {
    active: false,
    step: 0,          // 0 = waiting, 1 = first bet, 2 = second, 3 = third
    direction: null,
    betCount: 0
  };

  const lastNumbers = userLastResults[userId] || [];
  const lastNumStr = lastNumbers.length > 0 ? lastNumbers[lastNumbers.length - 1] : null;

  if (!state.active && lastNumStr) {
    if (lastNumStr === "0") {
      state.active = true;
      state.direction = "B";
      state.step = 1;
      state.betCount = 0;
      logging.info(`ULTRA_SNIPER: Triggered by 0. Betting BIG.`);
    } else if (lastNumStr === "9") {
      state.active = true;
      state.direction = "S";
      state.step = 1;
      state.betCount = 0;
      logging.info(`ULTRA_SNIPER: Triggered by 9. Betting SMALL.`);
    }
  }

  userSettings[userId].ultra_sniper_state = state;

  if (state.active) {
    // Bet according to step (1,2,3 all same direction)
    return { choice: state.direction, shouldSkip: false };
  } else {
    return { choice: 'B', shouldSkip: true };
  }
}

// 6. CHAOS_SEEKER
function getChaosSeekerPrediction(userId) {
  const state = userSettings[userId].chaos_seeker_state || {
    active: false,
    triggerPattern: null,
    betCount: 0,
    multiplier: 1
  };

  const lastResults = userAllResults[userId] || [];
  const lastThree = lastResults.slice(-3);

  // Detect pattern of three consecutive same (BBB or SSS)
  if (lastThree.length === 3 && lastThree[0] === lastThree[1] && lastThree[1] === lastThree[2]) {
    const pattern = lastThree[0];
    const opposite = pattern === 'B' ? 'S' : 'B';
    state.active = true;
    state.triggerPattern = pattern;
    state.betCount = 0;
    state.multiplier = 1;
    logging.info(`CHAOS_SEEKER: Triggered by ${pattern}${pattern}${pattern}. Betting ${opposite}.`);
  }

  userSettings[userId].chaos_seeker_state = state;

  if (state.active) {
    const opposite = state.triggerPattern === 'B' ? 'S' : 'B';
    return { choice: opposite, shouldSkip: false };
  } else {
    return { choice: 'B', shouldSkip: true };
  }
}

// 7. TERMINATOR
function getTerminatorPrediction(userId) {
  const state = userSettings[userId].terminator_state || {
    active: true,
    consecutiveLosses: 0,
    baseBet: 0
  };

  const lastResults = userAllResults[userId] || [];
  const lastThree = lastResults.slice(-3);

  // Detect pattern of three consecutive same (BBB or SSS)
  if (lastThree.length === 3 && lastThree[0] === lastThree[1] && lastThree[1] === lastThree[2]) {
    const pattern = lastThree[0];
    const opposite = pattern === 'B' ? 'S' : 'B';
    state.active = true;
    logging.info(`TERMINATOR: Triggered by ${pattern}${pattern}${pattern}. Betting ${opposite}.`);
    return { choice: opposite, shouldSkip: false, state };
  }

  userSettings[userId].terminator_state = state;
  return { choice: 'B', shouldSkip: true };
}

// 8. NEURAL_NET
function getNeuralNetPrediction(userId) {
  const results = userAllResults[userId] || [];
  if (results.length < 10) return { choice: 'B', shouldSkip: false };

  // Pattern frequency analysis
  const patterns = {
    'BB': 0, 'BS': 0, 'SB': 0, 'SS': 0,
    'BBB': 0, 'BBS': 0, 'BSB': 0, 'BSS': 0,
    'SBB': 0, 'SBS': 0, 'SSB': 0, 'SSS': 0
  };

  for (let i = 0; i < results.length - 1; i++) {
    const p2 = results[i] + results[i + 1];
    if (patterns[p2] !== undefined) patterns[p2]++;

    if (i < results.length - 2) {
      const p3 = results[i] + results[i + 1] + results[i + 2];
      if (patterns[p3] !== undefined) patterns[p3]++;
    }
  }

  // Find most common 2-gram
  let maxPattern = 'BB';
  let maxCount = 0;
  ['BB', 'BS', 'SB', 'SS'].forEach(p => {
    if (patterns[p] > maxCount) {
      maxCount = patterns[p];
      maxPattern = p;
    }
  });

  // Predict based on last result
  const lastResult = results[results.length - 1];
  let prediction = 'B';

  if (maxPattern === 'BB' && lastResult === 'B') prediction = 'B';
  else if (maxPattern === 'BS' && lastResult === 'B') prediction = 'S';
  else if (maxPattern === 'SB' && lastResult === 'S') prediction = 'B';
  else if (maxPattern === 'SS' && lastResult === 'S') prediction = 'S';
  else prediction = lastResult === 'B' ? 'S' : 'B';

  logging.info(`NEURAL_NET: Most common pattern ${maxPattern} (${maxCount}), last=${lastResult}, predict=${prediction}`);
  return { choice: prediction, shouldSkip: false };
}

// 9. PYRO_TECH
function getPyroTechPrediction(userId) {
  const state = userSettings[userId].pyro_state || {
    active: false,
    step: 0,
    direction: null,
    betCount: 0
  };

  const lastNumbers = userLastResults[userId] || [];
  const lastNumStr = lastNumbers.length > 0 ? lastNumbers[lastNumbers.length - 1] : null;

  if (!state.active && lastNumStr) {
    if (lastNumStr === "0") {
      state.active = true;
      state.direction = "B";
      state.step = 1;
      state.betCount = 0;
      logging.info(`PYRO_TECH: Triggered by 0. First bet BIG.`);
    } else if (lastNumStr === "9") {
      state.active = true;
      state.direction = "S";
      state.step = 1;
      state.betCount = 0;
      logging.info(`PYRO_TECH: Triggered by 9. First bet SMALL.`);
    }
  }

  userSettings[userId].pyro_state = state;

  if (state.active && state.step <= 2) {
    return { choice: state.direction, shouldSkip: false, state };
  }
  return { choice: 'B', shouldSkip: true };
}

// 10. TSUNAMI
function getTsunamiPrediction(userId) {
  const results = userAllResults[userId] || [];
  if (results.length < 4) return { choice: 'B', shouldSkip: false };

  const lastFour = results.slice(-4);
  const counts = { B: 0, S: 0 };
  lastFour.forEach(r => counts[r]++);

  // If 3 or more of the same in last 4, bet opposite
  if (counts.B >= 3) {
    logging.info(`TSUNAMI: 3+ BIG in last 4, betting SMALL`);
    return { choice: 'S', shouldSkip: false };
  } else if (counts.S >= 3) {
    logging.info(`TSUNAMI: 3+ SMALL in last 4, betting BIG`);
    return { choice: 'B', shouldSkip: false };
  }

  return { choice: results[results.length - 1] === 'B' ? 'S' : 'B', shouldSkip: false };
}

// 11. MAGE
function getMagePrediction(userId) {
  const lastNumbers = userLastResults[userId] || [];
  if (lastNumbers.length < 3) return { choice: 'B', shouldSkip: false };

  // Get last 3 numbers
  const lastThree = lastNumbers.slice(-3).map(n => parseInt(n));
  const sum = lastThree.reduce((a, b) => a + b, 0);
  const lastDigit = sum % 10;

  // 0-4 = SMALL, 5-9 = BIG
  const prediction = lastDigit >= 5 ? 'B' : 'S';
  logging.info(`MAGE: Numbers ${lastThree.join('+')}=${sum}, last digit=${lastDigit}, predict=${prediction}`);
  return { choice: prediction, shouldSkip: false };
}

// 12. REAPER
function getReaperPrediction(userId) {
  const results = userAllResults[userId] || [];
  if (results.length < 2) return { choice: 'B', shouldSkip: false };

  const lastTwo = results.slice(-2);
  
  // If last two are same (BB or SS), continue that trend
  if (lastTwo[0] === lastTwo[1]) {
    logging.info(`REAPER: ${lastTwo[0]}${lastTwo[1]} pattern, continuing with ${lastTwo[0]}`);
    return { choice: lastTwo[0], shouldSkip: false };
  }
  
  // If last two are different (BS or SB), bet the first one
  logging.info(`REAPER: ${lastTwo[0]}${lastTwo[1]} pattern, betting ${lastTwo[0]}`);
  return { choice: lastTwo[0], shouldSkip: false };
}

// ============================================
// >>>>>>>>> DeepSeek Strategies <<<<<<<<<<
// ============================================

// 13. DEEPSEEK_PREDICTOR (DeepSeek AI Pattern Predictor)
function getDeepSeekPredictorPrediction(userId) {
  const results = userAllResults[userId] || [];
  if (results.length < 6) {
    return { choice: 'B', shouldSkip: false };
  }

  const patternProbabilities = {
    'BBB': 0, 'BBS': 0, 'BSB': 0, 'BSS': 0,
    'SBB': 0, 'SBS': 0, 'SSB': 0, 'SSS': 0
  };

  for (let i = 0; i < results.length - 3; i++) {
    const pattern = results.slice(i, i + 3).join('');
    if (patternProbabilities.hasOwnProperty(pattern)) {
      patternProbabilities[pattern]++;
    }
  }

  const lastTwoResults = results.slice(-2);
  let mostLikelyNext = 'B';
  let maxProb = 0;
  const possibleNext = ['B', 'S'];
  
  possibleNext.forEach(next => {
    const potentialPattern = lastTwoResults.join('') + next;
    if (patternProbabilities[potentialPattern] > maxProb) {
      maxProb = patternProbabilities[potentialPattern];
      mostLikelyNext = next;
    }
  });

  const totalPatterns = Object.values(patternProbabilities).reduce((a, b) => a + b, 0);
  const confidence = totalPatterns > 0 ? (maxProb / totalPatterns) * 100 : 0;

  logging.info(`DEEPSEEK_PREDICTOR: Last 2 results = ${lastTwoResults.join('')}, Most likely next = ${mostLikelyNext}, Confidence = ${confidence.toFixed(2)}%`);

  return { choice: mostLikelyNext, shouldSkip: false };
}

// 14. DEEPSEEK_NEURAL (DeepSeek Neural Network - Trend Analyzer)
function getDeepSeekNeuralPrediction(userId) {
  const results = userAllResults[userId] || [];
  if (results.length < 10) {
    return { choice: 'B', shouldSkip: false };
  }

  const recentResults = results.slice(-10);
  
  let trendStrength = 0;
  for (let i = 0; i < recentResults.length; i++) {
    if (recentResults[i] === 'B') {
      trendStrength += 1;
    } else {
      trendStrength -= 1;
    }
  }

  let volatility = 0;
  for (let i = 1; i < recentResults.length; i++) {
    if (recentResults[i] !== recentResults[i-1]) {
      volatility++;
    }
  }

  let prediction = 'B';
  let confidenceLevel = 0;

  if (Math.abs(trendStrength) >= 4) {
    prediction = trendStrength > 0 ? 'B' : 'S';
    confidenceLevel = Math.min(90, 50 + Math.abs(trendStrength) * 5);
    logging.info(`DEEPSEEK_NEURAL: Strong trend detected (${trendStrength > 0 ? 'BIG' : 'SMALL'}), following trend.`);
  } else if (volatility >= 7) {
    prediction = recentResults[recentResults.length - 1];
    confidenceLevel = 40;
    logging.info(`DEEPSEEK_NEURAL: High volatility detected, following last result (${prediction}).`);
  } else {
    prediction = recentResults[recentResults.length - 1] === 'B' ? 'S' : 'B';
    confidenceLevel = 60;
    logging.info(`DEEPSEEK_NEURAL: No clear trend, betting against last result (${prediction}).`);
  }

  logging.info(`DEEPSEEK_NEURAL: TrendStrength=${trendStrength}, Volatility=${volatility}, Prediction=${prediction}, Confidence=${confidenceLevel}%`);

  return { choice: prediction, shouldSkip: false };
}

// 15. DEEPSEEK_ADAPTIVE (DeepSeek Adaptive AI - Smart Aggressor)
function getDeepSeekAdaptivePrediction(userId) {
  const results = userAllResults[userId] || [];
  
  if (!userSettings[userId].deepseek_adaptive_state) {
    userSettings[userId].deepseek_adaptive_state = {
      aggressionLevel: 1.0,
      consecutiveWins: 0,
      consecutiveLosses: 0,
      lastPrediction: null,
      performanceScore: 0
    };
  }
  const state = userSettings[userId].deepseek_adaptive_state;

  if (results.length < 3) {
    return { choice: 'B', shouldSkip: false };
  }

  let prediction = 'B';
  const lastResult = results[results.length - 1];

  const lastThree = results.slice(-3);
  const pattern = lastThree.join('');

  if (state.aggressionLevel > 1.5) {
    if (lastResult === 'B') {
      prediction = 'B';
    } else {
      prediction = 'S';
    }
    logging.info(`DEEPSEEK_ADAPTIVE: High aggression mode (${state.aggressionLevel.toFixed(2)}x), following trend.`);
  } else if (state.aggressionLevel < 0.7) {
    prediction = lastResult === 'B' ? 'S' : 'B';
    logging.info(`DEEPSEEK_ADAPTIVE: Conservative mode (${state.aggressionLevel.toFixed(2)}x), betting against last.`);
  } else {
    if (pattern === 'BBB' || pattern === 'SSS') {
      prediction = lastResult === 'B' ? 'S' : 'B';
    } else {
      const lastTwo = results.slice(-2).join('');
      if (lastTwo === 'BS') prediction = 'S';
      else if (lastTwo === 'SB') prediction = 'B';
      else prediction = lastResult;
    }
    logging.info(`DEEPSEEK_ADAPTIVE: Normal mode, pattern analysis decision = ${prediction}.`);
  }

  state.lastPrediction = prediction;

  logging.info(`DEEPSEEK_ADAPTIVE: Prediction=${prediction}, AggressionLevel=${state.aggressionLevel.toFixed(2)}, ConsecutiveWins=${state.consecutiveWins}, ConsecutiveLosses=${state.consecutiveLosses}`);

  return { choice: prediction, shouldSkip: false };
}

// ============================================
// GPT_ADAPTIVE_AI (ChatGPT-style Adaptive Strategy)
// ============================================
function getGPTAdaptiveAIPrediction(userId) {
  const results = userAllResults[userId] || [];
  if (results.length < 8) {
    return { choice: 'B', shouldSkip: true };
  }

  const last10 = results.slice(-10);

  let score = 0;
  let streak = 0;

  for (let i = 0; i < last10.length; i++) {
    if (last10[i] === 'B') score++;
    else score--;
  }

  for (let i = last10.length - 1; i > 0; i--) {
    if (last10[i] === last10[i - 1]) streak++;
    else break;
  }

  if (streak >= 4 && Math.abs(score) <= 2) {
    logging.info(`GPT_AI: Risk detected → SKIP`);
    return { choice: 'B', shouldSkip: true };
  }

  let decision;
  if (score >= 3) decision = 'B';
  else if (score <= -3) decision = 'S';
  else decision = last10[last10.length - 1];

  logging.info(`GPT_AI: score=${score}, streak=${streak}, decision=${decision}`);

  return { choice: decision, shouldSkip: false };
}

// ============================================
// GEMINI_AI (Smart Analytics & Pattern Recognition)
// ============================================
function getGeminiAIPrediction(userId) {
  const results = userAllResults[userId] || [];
  
  if (results.length < 5) {
    logging.info(`GEMINI_AI: Gathering data... Skipping.`);
    return { choice: 'B', shouldSkip: true }; 
  }

  const lastFive = results.slice(-5);
  const lastThree = lastFive.slice(-3);

  if (lastThree[0] === lastThree[1] && lastThree[1] === lastThree[2]) {
    logging.info(`GEMINI_AI: Strong momentum detected (${lastThree[0]}). Following trend.`);
    return { choice: lastThree[0], shouldSkip: false };
  }

  let volatility = 0;
  for (let i = 1; i < lastFive.length; i++) {
    if (lastFive[i] !== lastFive[i-1]) volatility++;
  }
  
  if (volatility >= 3) {
    logging.info(`GEMINI_AI: High volatility (${volatility} switches in 5 results). Smart Skipping.`);
    return { choice: 'B', shouldSkip: true };
  }

  const bCount = lastFive.filter(r => r === 'B').length;
  const prediction = bCount >= 3 ? 'B' : 'S'; 
  
  logging.info(`GEMINI_AI: Pattern analysis (B:${bCount}/5). Predicting ${prediction}.`);
  return { choice: prediction, shouldSkip: false };
}

// ============================================
// GROK AI STRATEGY (xAI Powered - Truth Seeking)
// ============================================
function getGrokAIPrediction(userId) {
  const results = userAllResults[userId] || [];
  if (results.length < 10) {
    logging.info(`[GROK_AI] Gathering cosmic data... Skipping`);
    return { choice: 'B', shouldSkip: true };
  }

  const recent = results.slice(-15);
  const last = recent[recent.length - 1];

  // 1. Momentum (recent weights more)
  let momentum = 0;
  recent.forEach((r, i) => momentum += (r === 'B' ? 1.2 : -1) * (i / recent.length));

  // 2. Transition Analysis
  const transitions = { BB:0, BS:0, SB:0, SS:0 };
  for (let i = 0; i < recent.length - 1; i++) {
    const pair = recent[i] + recent[i + 1];
    if (transitions[pair] !== undefined) transitions[pair]++;
  }

  // 3. Volatility
  let changes = 0;
  for (let i = 1; i < recent.length; i++) {
    if (recent[i] !== recent[i - 1]) changes++;
  }
  const volatility = changes / (recent.length - 1);

  let prediction = 'B';
  let shouldSkip = false;

  if (Math.abs(momentum) > 7) {
    prediction = momentum > 0 ? 'B' : 'S';
  } else if (volatility > 0.65) {
    prediction = last === 'B' ? 'S' : 'B'; // mean reversion
  } else {
    const lastResult = recent[recent.length - 1];
    if (lastResult === 'B') {
      prediction = (transitions.BB + transitions.BS > transitions.SB + transitions.SS) ? 'B' : 'S';
    } else {
      prediction = (transitions.SS + transitions.SB > transitions.BB + transitions.BS) ? 'S' : 'B';
    }
  }

  // Grok's Smart Skip (too chaotic = universe is confusing)
  shouldSkip = (volatility > 0.72 && Math.abs(momentum) < 4);

  logging.info(`[GROK_AI] Momentum=\( {momentum.toFixed(1)}, Vol= \){volatility.toFixed(2)}, Predict=\( {prediction}, Skip= \){shouldSkip}`);

  return { choice: prediction, shouldSkip };
}

async function createSniperImage(type, userId, strategyName, hitCount, lossCount, maxHits, maxLosses, profit = 0, balance = 0, isVirtual = false) {
  // 🌟 Background Image URL
  const bgImageUrl = 'https://repgyetdcodkynrbxocg.supabase.co/storage/v1/object/public/images/telegram-1771319827873-a58891ef.jpg';

  let backgroundImage;
  try {
    backgroundImage = await loadImage(bgImageUrl);
  } catch (error) {
    console.error("Error loading sniper background image:", error);
    backgroundImage = null;
  }

  // 🚀 Resolution 1200x800
  const canvas = createCanvas(1200, 800);
  const ctx = canvas.getContext('2d');

  // ---- 1. နောက်ခံပုံ နေရာချခြင်း ----
  if (backgroundImage) {
    ctx.drawImage(backgroundImage, 0, 0, 1200, 800);
  } else {
    ctx.fillStyle = '#0F0F13';
    ctx.fillRect(0, 0, 1200, 800);
  }

  // ---- Helper Functions ----
  const roundRect = (ctx, x, y, w, h, r) => {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
    return ctx;
  };

  const formatNum = (num) => {
    if (num === undefined || num === null || isNaN(num)) return '0.00';
    return Number(num).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  // ---- Theme Color Logic ----
  let themeColor = '';
  let accentColor = '';
  let title = '';
  let statusMessage = '';

  const isSuccess = (type === 'HIT' || type === 'MISSION_COMPLETE');
  const isFailOrLoss = (type === 'LOSS' || type === 'MAX_LOSSES');

  switch(type) {
    case 'MISSION_COMPLETE': 
      themeColor = '#00FF7F';
      accentColor = '#32CD32'; 
      title = '🏆 MISSION COMPLETE 🏆'; 
      statusMessage = 'ELITE SNIPER'; 
      break;
    case 'MAX_LOSSES': 
      themeColor = '#FF3333';
      accentColor = '#8B0000'; 
      title = '☠️ MISSION FAILED ☠️'; 
      statusMessage = 'MISSION TERMINATED'; 
      break;
    case 'HIT': 
      themeColor = '#FFD700';
      accentColor = '#FF8C00'; 
      title = '🎯 SNIPER HIT 🎯'; 
      statusMessage = 'TARGET ACQUIRED'; 
      break;
    case 'LOSS': 
      themeColor = '#9400D3';
      accentColor = '#FF1493'; 
      title = '💀 SNIPER MISSED 💀'; 
      statusMessage = 'TARGET EVADED'; 
      break;
    default:
      themeColor = '#00FFFF';
      accentColor = '#008B8B';
      title = 'SNIPER STATUS';
      statusMessage = 'WAITING';
  }

  // ---- 2. Vignette Overlay ----
  const vignette = ctx.createRadialGradient(600, 400, 200, 600, 400, 1000);
  vignette.addColorStop(0, 'rgba(0, 0, 0, 0.1)');
  vignette.addColorStop(1, 'rgba(0, 0, 0, 0.85)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, 1200, 800);

  // ---- 3. Cinematic Cyberpunk Borders ----
  ctx.save();
  ctx.shadowColor = themeColor;
  ctx.shadowBlur = 40;
  ctx.strokeStyle = themeColor;
  ctx.lineWidth = 3;
  ctx.strokeRect(30, 30, 1140, 740);
  
  ctx.shadowBlur = 15;
  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = 10;
  const cLen = 70;
  ctx.beginPath();
  ctx.moveTo(30, 30 + cLen); ctx.lineTo(30, 30); ctx.lineTo(30 + cLen, 30);
  ctx.moveTo(1170, 30 + cLen); ctx.lineTo(1170, 30); ctx.lineTo(1170 - cLen, 30);
  ctx.moveTo(30, 770 - cLen); ctx.lineTo(30, 770); ctx.lineTo(30 + cLen, 770);
  ctx.moveTo(1170, 770 - cLen); ctx.lineTo(1170, 770); ctx.lineTo(1170 - cLen, 770);
  ctx.stroke();
  ctx.restore();

  // ---- 4. Dynamic Title & Strategy ----
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  
  ctx.shadowColor = '#000000';
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 5;
  ctx.font = 'bold 75px "Arial Black", "Impact", sans-serif';
  ctx.fillStyle = themeColor;
  ctx.fillText(title, 600, 120);

  ctx.shadowColor = themeColor;
  ctx.shadowBlur = 25;
  ctx.shadowOffsetY = 0;
  ctx.font = 'bold 32px "Arial", sans-serif';
  ctx.fillStyle = '#FFFFFF';
  ctx.fillText(`⚡ ${(strategyName || "UNKNOWN").toUpperCase()} ⚡`, 600, 190);
  ctx.restore();

  // ---- 5. Sniper Crosshair ----
  ctx.save();
  ctx.translate(600, 460);
  
  ctx.strokeStyle = isSuccess ? 'rgba(0, 255, 0, 0.3)' : (type === 'MAX_LOSSES' ? 'rgba(255, 0, 0, 0.3)' : 'rgba(255, 255, 255, 0.2)');
  ctx.lineWidth = 2;
  
  ctx.beginPath(); ctx.moveTo(-220, 0); ctx.lineTo(220, 0); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, -220); ctx.lineTo(0, 220); ctx.stroke();
  
  ctx.beginPath(); ctx.arc(0, 0, 130, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.arc(0, 0, 70, 0, Math.PI * 2); ctx.stroke();
  
  ctx.beginPath();
  ctx.arc(0, 0, 5, 0, Math.PI * 2);
  ctx.fillStyle = themeColor;
  ctx.fill();

  if (isSuccess) {
    ctx.strokeStyle = themeColor;
    ctx.lineWidth = 5;
    ctx.shadowColor = themeColor;
    ctx.shadowBlur = 15;
    ctx.beginPath(); ctx.moveTo(-20, -20); ctx.lineTo(20, 20); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-20, 20); ctx.lineTo(20, -20); ctx.stroke();
  }
  ctx.restore();

  // ---- 6. Status Message ----
  ctx.save();
  ctx.textAlign = 'center';
  ctx.shadowColor = '#000000';
  ctx.shadowBlur = 15;
  ctx.font = 'bold 45px "Arial Black"';
  ctx.fillStyle = themeColor;
  ctx.fillText(statusMessage, 600, 310);
  ctx.restore();

  // ---- 7. Premium UI Data Boxes ----
  const drawGlassBox = (x, y, w, h, label1, val1, color1, label2, val2, color2, glowColor) => {
    ctx.save();
    
    const baseGradient = ctx.createLinearGradient(x, y, x, y + h);
    baseGradient.addColorStop(0, 'rgba(20, 20, 25, 0.85)');
    baseGradient.addColorStop(1, 'rgba(5, 5, 10, 0.7)');
    
    ctx.fillStyle = baseGradient;
    ctx.shadowColor = '#000000';
    ctx.shadowBlur = 20;
    ctx.shadowOffsetY = 10;
    roundRect(ctx, x, y, w, h, 25).fill();

    const glossGradient = ctx.createLinearGradient(x, y, x, y + h * 0.4);
    glossGradient.addColorStop(0, 'rgba(255, 255, 255, 0.1)');
    glossGradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = glossGradient;
    roundRect(ctx, x, y, w, h * 0.4, 25).fill();

    ctx.shadowBlur = 15;
    ctx.shadowColor = glowColor;
    ctx.shadowOffsetY = 0;
    ctx.strokeStyle = glowColor;
    ctx.lineWidth = 2;
    roundRect(ctx, x, y, w, h, 25).stroke();
    
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 1;
    roundRect(ctx, x + 2, y + 2, w - 4, h - 4, 23).stroke();

    const fillTextFit = (text, tx, ty, maxW, baseSize) => {
      let currentSize = baseSize;
      ctx.font = `bold ${currentSize}px "Arial Black"`;
      while (ctx.measureText(text).width > maxW && currentSize > 18) {
        currentSize -= 1;
        ctx.font = `bold ${currentSize}px "Arial Black"`;
      }
      ctx.fillText(text, tx, ty);
    };

    ctx.textBaseline = 'middle';
    const row1Y = y + 45;
    const row2Y = y + 100;

    ctx.textAlign = 'left';
    ctx.shadowColor = '#000'; ctx.shadowBlur = 5;
    ctx.fillStyle = '#CCCCCC';
    ctx.font = 'bold 24px "Arial"';
    ctx.fillText(label1, x + 30, row1Y);
    
    ctx.textAlign = 'right';
    ctx.fillStyle = color1;
    ctx.shadowColor = color1; ctx.shadowBlur = 15;
    fillTextFit(val1, x + w - 30, row1Y, w - 180, 36);

    if (label2) {
      ctx.textAlign = 'left';
      ctx.shadowColor = '#000'; ctx.shadowBlur = 5;
      
      if (label2.includes('VIRTUAL')) ctx.fillStyle = '#00E5FF';
      else if (label2.includes('REAL')) ctx.fillStyle = '#00FA9A';
      else ctx.fillStyle = '#CCCCCC';
      
      ctx.font = 'bold 24px "Arial"';
      ctx.fillText(label2, x + 30, row2Y);
      
      ctx.textAlign = 'right';
      ctx.fillStyle = color2;
      ctx.shadowColor = color2; 
      ctx.shadowBlur = (color2 === '#FFFFFF') ? 5 : 15;
      fillTextFit(val2, x + w - 30, row2Y, w - 180, 36);
    }
    ctx.restore();
  };

  const boxW = 530;
  const boxH = 150;
  const boxY = 400;

  drawGlassBox(40, boxY, boxW, boxH, 
    '🎯 HITS:', `${hitCount || 0} / ${maxHits || 0}`, '#00FF7F', 
    '❌ LOSSES:', `${lossCount || 0} / ${maxLosses || 0}`, '#FF3333',
    'rgba(0, 191, 255, 0.5)'
  );

  const isVirtualMode = Boolean(isVirtual);
  const balanceLabel = isVirtualMode ? '🎮 VIRTUAL BAL:' : '💵 REAL BAL:';
  const balanceValue = `${formatNum(balance)} Ks`;
  
  if (type === 'MISSION_COMPLETE' || type === 'MAX_LOSSES') {
    let actualProfit = parseFloat(profit) || 0;
    let profitLabel = actualProfit >= 0 ? '📈 PROFIT:' : '📉 LOSS:';
    let profitDisplay = actualProfit >= 0 ? `+${formatNum(actualProfit)} Ks` : `-${formatNum(Math.abs(actualProfit))} Ks`;
    let profitColor = actualProfit >= 0 ? '#00FF7F' : '#FF3333';
    
    let boxGlow = actualProfit >= 0 ? 'rgba(0, 255, 127, 0.5)' : 'rgba(255, 51, 51, 0.5)';

    drawGlassBox(630, boxY, boxW, boxH, 
      profitLabel, profitDisplay, profitColor,
      balanceLabel, balanceValue, '#FFFFFF',
      boxGlow
    );
  } else {
    let statusLabel = '📊 STATUS:';
    let statusValue = isSuccess ? 'ONGOING' : 'WARNING';
    let statusColor = isSuccess ? '#FFD700' : '#FF3333';
    let boxGlow = 'rgba(255, 215, 0, 0.5)';

    drawGlassBox(630, boxY, boxW, boxH, 
      statusLabel, statusValue, statusColor,
      balanceLabel, balanceValue, '#FFFFFF',
      boxGlow
    );
  }

  // ---- 8. High-Tech Footer ----
  ctx.save();
  ctx.textAlign = 'center';
  
  ctx.shadowColor = themeColor;
  ctx.shadowBlur = 10;
  ctx.fillStyle = themeColor;
  ctx.fillRect(400, 680, 400, 2);

  ctx.shadowBlur = 15;
  ctx.fillStyle = '#FFFFFF';
  ctx.font = 'bold 24px "Courier New", monospace';
  ctx.fillText(`⚡ USER ID: ${userId || 'UNKNOWN'} ⚡`, 600, 715);
  
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#888888';
  ctx.font = '16px "Courier New", monospace';
  ctx.fillText(new Date().toLocaleString(), 600, 745);
  ctx.restore();

  // ---- Save Image ----
  const imagePath = path.join(__dirname, `sniper_${type.toLowerCase()}_${userId}_${Date.now()}.png`);
  const out = fs.createWriteStream(imagePath);
  const stream = canvas.createPNGStream();
  stream.pipe(out);
  
  return new Promise((resolve, reject) => {
    out.on('finish', () => resolve(imagePath));
    out.on('error', reject);
  });
}

async function handleSniperHit(userId, strategyName, bot, isWin) {
  const settings = userSettings[userId] || {};
  
  if (!settings.sniper_hit_count) {
    settings.sniper_hit_count = 0;
  }
  
  if (!settings.sniper_loss_count) {
    settings.sniper_loss_count = 0;
  }
  
  if (isWin) {
    settings.sniper_hit_count++;
    settings.sniper_loss_count = 0;
    
    if (SNIPER_NOTIFICATIONS) {
      const hitNotification = `🎯 ${STYLE.BOLD(`${strategyName} HIT!`)} 🎯\n` +
                            `${STYLE.SEPARATOR}\n` +
                            `${STYLE.ITEM(`Hit Count: ${settings.sniper_hit_count}/${SNIPER_MAX_HITS}`)}\n` +
                            `${STYLE.ITEM(`Loss Count: ${settings.sniper_loss_count}/${SNIPER_MAX_LOSSES}`)}\n` +
                            `${STYLE.LAST_ITEM(`Strategy: ${strategyName}`)}`;
      
      try {
        await bot.telegram.sendMessage(userId, hitNotification, { parse_mode: 'Markdown' });
      } catch (error) {
        logging.error(`Failed to send sniper notification to ${userId}: ${error.message}`);
      }
    }
    
    if (settings.sniper_hit_count >= SNIPER_MAX_HITS) {
      await terminateSniperSession(userId, strategyName, bot, true);
      return true; 
    }
  } else {
    settings.sniper_loss_count++;
    if (SNIPER_NOTIFICATIONS) {
      const lossNotification = `❌ ${STYLE.BOLD(`${strategyName} LOSS!`)} ❌\n` +
                              `${STYLE.SEPARATOR}\n` +
                              `${STYLE.ITEM(`Hit Count: ${settings.sniper_hit_count}/${SNIPER_MAX_HITS}`)}\n` +
                              `${STYLE.ITEM(`Loss Count: ${settings.sniper_loss_count}/${SNIPER_MAX_LOSSES}`)}\n` +
                              `${STYLE.LAST_ITEM(`Strategy: ${strategyName}`)}`;
      
      try {
        await bot.telegram.sendMessage(userId, lossNotification, { parse_mode: 'Markdown' });
      } catch (error) {
        logging.error(`Failed to send sniper loss notification to ${userId}: ${error.message}`);
      }
    }
    
    if (settings.sniper_loss_count >= SNIPER_MAX_LOSSES) {
      await terminateSniperSession(userId, strategyName, bot, false);
      return true; 
    }
  }
  
  return false;
}

async function terminateSniperSession(userId, strategyName, bot, isHitTermination) {
  const settings = userSettings[userId] || {};
  
  settings.running = false;
  delete userWaitingForResult[userId];
  delete userShouldSkipNext[userId];
  
  settings.martin_index = 0;
  settings.dalembert_units = 1;
  settings.custom_index = 0;
  
  let terminationReason;
  if (isHitTermination) {
    terminationReason = `🎯 ${STYLE.BOLD('TARGET ACHIEVED')}`;
  } else {
    terminationReason = `🛑 ${STYLE.BOLD('MAX LOSSES REACHED')}`;
  }
  
  const terminationMessage = `${terminationReason}\n` +
                           `${STYLE.SEPARATOR}\n` +
                           `${STYLE.ITEM(`Strategy: ${strategyName}`)}\n` +
                           `${STYLE.ITEM(`Target Hits: ${SNIPER_MAX_HITS}`)}\n` +
                           `${STYLE.ITEM(`Actual Hits: ${settings.sniper_hit_count || 0}`)}\n` +
                           `${STYLE.ITEM(`Max Losses: ${SNIPER_MAX_LOSSES}`)}\n` +
                           `${STYLE.ITEM(`Actual Losses: ${settings.sniper_loss_count || 0}`)}\n` +
                           `${STYLE.LAST_ITEM(isHitTermination ? '🎉 Mission Complete!' : '⚠️ Session Terminated - Too many losses')}`;
  
  try {
    await bot.telegram.sendMessage(userId, terminationMessage, { parse_mode: 'Markdown' });
  } catch (error) {
    logging.error(`Failed to send termination message to ${userId}: ${error.message}`);
  }
  
  delete settings.sniper_hit_count;
  delete settings.sniper_loss_count;
}

async function sendTerminationImage(userId, bot, strategyName, imageType, hitCount, lossCount, profit, balance, isVirtual, customMessage) {
  try {
    const imagePath = await createSniperImage(
      imageType,
      userId,
      strategyName,
      hitCount,
      lossCount,
      SNIPER_MAX_HITS,
      SNIPER_MAX_LOSSES,
      profit,
      balance,
      isVirtual
    );
    
    const caption = `${customMessage}\n` +
                  `${STYLE.SEPARATOR}\n` +
                  `${STYLE.ITEM(`Strategy: ${strategyName}`)}\n` +
                  `${STYLE.ITEM(`Hits: ${hitCount}`)}\n` +
                  `${STYLE.ITEM(`Losses: ${lossCount}`)}\n` +
                  `${STYLE.ITEM(`Balance: ${balance.toFixed(2)} Ks`)}\n` +
                  `${STYLE.LAST_ITEM(`Profit: ${profit >= 0 ? '+' : ''}${profit.toFixed(2)} Ks`)}`;
    
    const restartKeyboard = Markup.inlineKeyboard([
      Markup.button.callback(`${EMOJI.START} RESTART`, `restart_bot:${userId}`)
    ]);
    
    await bot.telegram.sendPhoto(userId, { source: imagePath }, {
      caption: caption,
      parse_mode: 'Markdown',
      reply_markup: restartKeyboard.reply_markup
    });
    
    fs.unlinkSync(imagePath);
  } catch (error) {
    logging.error(`Failed to send termination image for ${strategyName}: ${error.message}`);
    const fallbackMessage = `${customMessage}\n` +
                          `${STYLE.SEPARATOR}\n` +
                          `${STYLE.ITEM(`Balance: ${balance.toFixed(2)} Ks`)}\n` +
                          `${STYLE.LAST_ITEM(`Profit: ${profit >= 0 ? '+' : ''}${profit.toFixed(2)} Ks`)}`;
    
    await bot.telegram.sendMessage(userId, fallbackMessage, { parse_mode: 'Markdown' });
  }
}

async function winLoseChecker(bot) {
  logging.info("Win/lose checker started");
  while (true) {
    try {
      for (const [userId, session] of Object.entries(userSessions)) {
        if (!session) continue;
        const settings = userSettings[userId] || {};
        
        if (!userStats[userId]) {
          userStats[userId] = {
            start_balance: 0,
            profit: 0,
            virtual_balance: settings.virtual_mode ? (settings.virtual_balance || 0) : 0,
            initial_balance: settings.virtual_mode ? (settings.virtual_balance || 0) : 0,
            recent_results: []
          };
          logging.info(`Initialized userStats for user ${userId} in winLoseChecker`);
        }
        
        const gameType = settings.game_type || "TRX"; 
        const betType = settings.bet_type || "BS"; 
        const stats = safeGetUserStats(userId);
        
        let data;
        
        if (gameType === "WINGO" || gameType === "WINGO_30S" || gameType === "WINGO_3MIN" || gameType === "WINGO_5MIN") {
          const wingoRes = await getWingoGameResults(session, gameType);
          if (!wingoRes || wingoRes.code !== 0) {
            logging.error(`Failed to get ${gameType} results: ${wingoRes?.msg || 'Unknown error'}`);
            continue;
          }
          data = wingoRes.data?.list || [];

          if (data.length < 10) {
            logging.warning(`Only ${data.length} results available for ${gameType}, expected 10`);
          }
          
          if (gameType === "WINGO_30S" || gameType === "WINGO_3MIN" || gameType === "WINGO_5MIN") {
            logging.debug(`${gameType}: Retrieved ${data.length} results`);
            if (data.length > 0) {
              logging.debug(`${gameType}: First result issueNumber: ${data[0].issueNumber}, number: ${data[0].number}`);
            }
          }
        } else {
          let issueRes = await getGameIssueRequest(session, gameType);
          
          if (!issueRes || issueRes.code !== 0) {
            continue;
          }
          
          data = issueRes.data ? [issueRes.data.settled || {}] : [];
        }
        
        if (gameType === "WINGO" || gameType === "WINGO_30S" || gameType === "WINGO_3MIN" || gameType === "WINGO_5MIN") {
          if (!userAllResults[userId]) userAllResults[userId] = [];
          if (!userLastResults[userId]) userLastResults[userId] = [];
          
          for (let i = 0; i < Math.min(data.length, 10); i++) {
            const result = data[i];
            if (result && result.number) {
              const number = parseInt(result.number || "0") % 10;
              const bigSmall = number >= 5 ? "B" : "S";
              const color = numberToColor(number);
              
              if (!userAllResults[userId].includes(bigSmall)) {
                userAllResults[userId].push(bigSmall);
                if (userAllResults[userId].length > 20) {
                  userAllResults[userId] = userAllResults[userId].slice(-20);
                }
              }
            }
          }
        }
        
        if (userPendingBets[userId]) {
          for (const [period, betInfo] of Object.entries(userPendingBets[userId])) {
            const settled = data.find(item => item.issueNumber === period);
            if (settled && settled.number) {
              if (gameType === "WINGO_30S" || gameType === "WINGO_3MIN" || gameType === "WINGO_5MIN") {
                logging.debug(`${gameType}: Found result for period ${period}: ${settled.number}`);
              }
              
              const [betChoice, amount, isVirtual] = betInfo;
              const number = parseInt(settled.number || "0") % 10;
              const bigSmall = number >= 5 ? "B" : "S";
              const color = numberToColor(number);
              
              let isWin;
              if (betType === "COLOR") {
                isWin = betChoice === color;
              } else {
                isWin = (betChoice === "B" && bigSmall === "B") || (betChoice === "S" && bigSmall === "S");
              }
              
              if (!userLastResults[userId]) {
                userLastResults[userId] = [];
              }
              userLastResults[userId].push(number.toString());
              if (userLastResults[userId].length > 10) {
                userLastResults[userId] = userLastResults[userId].slice(-10);
              }
              
              if (!userAllResults[userId]) {
                userAllResults[userId] = [];
              }
              userAllResults[userId].push(bigSmall);
              if (userAllResults[userId].length > 20) {
                userAllResults[userId] = userAllResults[userId].slice(-20);
              }
              
              // AI Mode အတွက် recent_results update
              if (!userStats[userId].recent_results) {
                userStats[userId].recent_results = [];
              }
              
              userStats[userId].recent_results.push(isWin ? 'WIN' : 'LOSS');
              if (userStats[userId].recent_results.length > 20) {
                userStats[userId].recent_results = userStats[userId].recent_results.slice(-20);
              }
              
if (settings.strategy === "CYBER_SNIPER" && settings.cyber_sniper_state) {
  const csState = settings.cyber_sniper_state;
  
  if (settings.sniper_hit_count === undefined) {
    settings.sniper_hit_count = 0;
  }
  if (settings.sniper_loss_count === undefined) {
    settings.sniper_loss_count = 0;
  }
  
  let currentBalance = 0;
  if (settings.virtual_mode) {
    currentBalance = (userStats[userId].virtual_balance || 0);
  } else {
    const session = userSessions[userId];
    if (session) {
      currentBalance = await getBalance(session, parseInt(userId)) || 0;
    }
  }
  
  if (isWin) {
    settings.sniper_hit_count++;
    settings.sniper_loss_count = 0;
    csState.hit_count = (csState.hit_count || 0) + 1;
    
    if (settings.sniper_hit_count >= SNIPER_MAX_HITS) {
      let currentProfit = 0;
      if (settings.virtual_mode) {
        currentProfit = (userStats[userId].virtual_balance || 0) - (userStats[userId].initial_balance || 0);
      } else {
        currentProfit = currentBalance - (userStats[userId].start_balance || 0);
      }

      try {
        const imagePath = await createSniperImage(
          'MISSION_COMPLETE',
          userId,
          'CYBER SNIPER',
          settings.sniper_hit_count,
          settings.sniper_loss_count,
          SNIPER_MAX_HITS,
          SNIPER_MAX_LOSSES,
          currentProfit,
          currentBalance,
          settings.virtual_mode
        );
        
        const caption = `🎯 ${STYLE.BOLD('CYBER SNIPER MISSION COMPLETE!')}\n` +
                      `${STYLE.SEPARATOR}\n` +
                      `${STYLE.ITEM(`Target Hits: ${SNIPER_MAX_HITS}`)}\n` +
                      `${STYLE.ITEM(`Actual Hits: ${settings.sniper_hit_count}`)}\n` +
                      `${STYLE.ITEM(`Losses: ${settings.sniper_loss_count}`)}\n` +
                      `${STYLE.LAST_ITEM('🎉 Target acquired successfully!')}`;
        
        const restartKeyboard = Markup.inlineKeyboard([
          Markup.button.callback(`${EMOJI.START} RESTART`, `restart_bot:${userId}`)
        ]);
        
        await bot.telegram.sendPhoto(userId, { source: imagePath }, {
          caption: caption,
          parse_mode: 'Markdown',
          reply_markup: restartKeyboard.reply_markup
        });
        
        fs.unlinkSync(imagePath);
      } catch (error) {
        logging.error(`Failed to send mission complete image to ${userId}: ${error.message}`);
        const terminationMessage = `🎯 ${STYLE.BOLD('CYBER SNIPER MISSION COMPLETE!')}\n` +
                                 `${STYLE.SEPARATOR}\n` +
                                 `${STYLE.ITEM(`Target Hits: ${SNIPER_MAX_HITS}`)}\n` +
                                 `${STYLE.ITEM(`Actual Hits: ${settings.sniper_hit_count}`)}\n` +
                                 `${STYLE.ITEM(`Losses: ${settings.sniper_loss_count}`)}\n` +
                                 `${STYLE.LAST_ITEM('🎉 Target acquired successfully!')}`;
        
        await bot.telegram.sendMessage(userId, terminationMessage, { parse_mode: 'Markdown' });
      }
      
      settings.running = false;
      delete userWaitingForResult[userId];
      delete userShouldSkipNext[userId];
      
      csState.active = false;
      csState.direction = null;
      csState.sequence = [];
      csState.step = 0;
      csState.hit_count = 0;
      csState.got_same_result = false;
      
      logging.info(`CYBER_SNIPER: Target Acquired (${SNIPER_MAX_HITS} Wins). Stopping.`);
    } else {
      settings.cyber_hit_once = true;
      logging.info(`CYBER_SNIPER: Hit ${settings.sniper_hit_count}/${SNIPER_MAX_HITS}`);
      
      csState.active = false;
      csState.direction = null;
      csState.sequence = [];
      csState.step = 0;
    }
  } else {
    settings.sniper_loss_count++;
    
    if (settings.sniper_loss_count >= SNIPER_MAX_LOSSES) {
      let currentProfit = 0;
      if (settings.virtual_mode) {
        currentProfit = (userStats[userId].virtual_balance || 0) - (userStats[userId].initial_balance || 0);
      } else {
        currentProfit = currentBalance - (userStats[userId].start_balance || 0);
      }
      
      try {
        const imagePath = await createSniperImage(
          'MAX_LOSSES',
          userId,
          'CYBER SNIPER',
          settings.sniper_hit_count,
          settings.sniper_loss_count,
          SNIPER_MAX_HITS,
          SNIPER_MAX_LOSSES,
          currentProfit,
          currentBalance,
          settings.virtual_mode
        );
        
        const caption = `🛑 ${STYLE.BOLD('CYBER SNIPER MAX LOSSES REACHED')}\n` +
                      `${STYLE.SEPARATOR}\n` +
                      `${STYLE.ITEM(`Target Hits: ${SNIPER_MAX_HITS}`)}\n` +
                      `${STYLE.ITEM(`Actual Hits: ${settings.sniper_hit_count}`)}\n` +
                      `${STYLE.ITEM(`Max Losses: ${SNIPER_MAX_LOSSES}`)}\n` +
                      `${STYLE.LAST_ITEM('⚠️ Session terminated - Too many consecutive losses')}`;
        
        const restartKeyboard = Markup.inlineKeyboard([
          Markup.button.callback(`${EMOJI.START} RESTART`, `restart_bot:${userId}`)
        ]);
        
        await bot.telegram.sendPhoto(userId, { source: imagePath }, {
          caption: caption,
          parse_mode: 'Markdown',
          reply_markup: restartKeyboard.reply_markup
        });
        
        fs.unlinkSync(imagePath);
      } catch (error) {
        logging.error(`Failed to send max losses image to ${userId}: ${error.message}`);
        const terminationMessage = `🛑 ${STYLE.BOLD('CYBER SNIPER MAX LOSSES REACHED')}\n` +
                                 `${STYLE.SEPARATOR}\n` +
                                 `${STYLE.ITEM(`Target Hits: ${SNIPER_MAX_HITS}`)}\n` +
                                 `${STYLE.ITEM(`Actual Hits: ${settings.sniper_hit_count}`)}\n` +
                                 `${STYLE.ITEM(`Max Losses: ${SNIPER_MAX_LOSSES}`)}\n` +
                                 `${STYLE.LAST_ITEM('⚠️ Session terminated - Too many consecutive losses')}`;
        
        await bot.telegram.sendMessage(userId, terminationMessage, { parse_mode: 'Markdown' });
      }
      
      settings.running = false;
      settings.cyber_max_reached = true;
      delete userWaitingForResult[userId];
      delete userShouldSkipNext[userId];
      
      csState.active = false;
      csState.direction = null;
      csState.sequence = [];
      csState.step = 0;
      csState.hit_count = 0;
      csState.got_same_result = false;
      
      logging.info(`CYBER_SNIPER: Max losses (${SNIPER_MAX_LOSSES}) reached. Stopping.`);
    } else {
      csState.step++;
      if (csState.step >= 4) {
        settings.running = false;
        settings.cyber_max_reached = true;
        logging.info(`CYBER_SNIPER: Max internal losses (4) reached. Stopping.`);
        delete userWaitingForResult[userId];
        delete userShouldSkipNext[userId];
      } else {
        const lastNumStr = userLastResults[userId][userLastResults[userId].length - 2];
        const currentNumStr = userLastResults[userId][userLastResults[userId].length - 1];

        if (lastNumStr === currentNumStr && csState.step === 1) {
          csState.got_same_result = true;
          if (currentNumStr === "0") csState.sequence = ["B", "S", "B", "B"];
          if (currentNumStr === "9") csState.sequence = ["S", "B", "S", "S"];
        } else if (!csState.got_same_result) {
          if (csState.direction === "B") {
            if (csState.step === 2) csState.sequence.push("B");
            if (csState.step === 3) csState.sequence.push("B");
          } else {
            if (csState.step === 2) csState.sequence.push("S");
            if (csState.step === 3) csState.sequence.push("S");
          }
        }
      }
    }
  }
}

if (settings.strategy === "COLOR_SNIPER" && settings.color_sniper_state) {
  const csState = settings.color_sniper_state;
  
  if (settings.sniper_hit_count === undefined) {
    settings.sniper_hit_count = 0;
  }
  if (settings.sniper_loss_count === undefined) {
    settings.sniper_loss_count = 0;
  }
  
  if (isWin) {
    settings.sniper_hit_count++;
    settings.sniper_loss_count = 0;
    csState.hit_count = (csState.hit_count || 0) + 1;
    
    if (settings.sniper_hit_count >= SNIPER_MAX_HITS) {
      let currentBalance = 0;
      let currentProfit = 0;
      
      if (settings.virtual_mode) {
        currentBalance = (userStats[userId].virtual_balance || 0);
        currentProfit = currentBalance - (userStats[userId].initial_balance || 0);
      } else {
        const session = userSessions[userId];
        if (session) {
          currentBalance = await getBalance(session, parseInt(userId)) || 0;
          currentProfit = currentBalance - (userStats[userId].start_balance || 0);
        }
      }

      try {
        const imagePath = await createSniperImage(
          'MISSION_COMPLETE',
          userId,
          settings.strategy,
          settings.sniper_hit_count,
          settings.sniper_loss_count,
          SNIPER_MAX_HITS,
          SNIPER_MAX_LOSSES,
          currentProfit,
          currentBalance,
          settings.virtual_mode
        );

        const caption = `🎯 ${STYLE.BOLD('COLOR SNIPER MISSION COMPLETE!')}\n` +
                      `${STYLE.SEPARATOR}\n` +
                      `${STYLE.ITEM(`Target Hits: ${SNIPER_MAX_HITS}`)}\n` +
                      `${STYLE.ITEM(`Actual Hits: ${settings.sniper_hit_count}`)}\n` +
                      `${STYLE.ITEM(`Losses: ${settings.sniper_loss_count}`)}\n` +
                      `${STYLE.LAST_ITEM('🎉 Target acquired successfully!')}`;
        
        const restartKeyboard = Markup.inlineKeyboard([
          Markup.button.callback(`${EMOJI.START} RESTART`, `restart_bot:${userId}`)
        ]);
        
        await bot.telegram.sendPhoto(userId, { source: imagePath }, {
          caption: caption,
          parse_mode: 'Markdown',
          reply_markup: restartKeyboard.reply_markup
        });
        
        fs.unlinkSync(imagePath);
      } catch (error) {
        logging.error(`Failed to send mission complete image to ${userId}: ${error.message}`);
        const terminationMessage = `🎯 ${STYLE.BOLD('COLOR SNIPER MISSION COMPLETE!')}\n` +
                                 `${STYLE.SEPARATOR}\n` +
                                 `${STYLE.ITEM(`Target Hits: ${SNIPER_MAX_HITS}`)}\n` +
                                 `${STYLE.ITEM(`Actual Hits: ${settings.sniper_hit_count}`)}\n` +
                                 `${STYLE.ITEM(`Losses: ${settings.sniper_loss_count}`)}\n` +
                                 `${STYLE.LAST_ITEM('🎉 Target acquired successfully!')}`;
        
        await bot.telegram.sendMessage(userId, terminationMessage, { parse_mode: 'Markdown' });
      }
      
      settings.color_sniper_hit_twice = true;
      settings.running = false;
      delete userWaitingForResult[userId];
      delete userShouldSkipNext[userId];
      
      csState.active = false;
      csState.waiting_for_trigger = true;
      csState.step = 0;
      csState.hit_count = 0;
      
      logging.info(`COLOR_SNIPER: Target Acquired (${SNIPER_MAX_HITS} Wins). Stopping.`);
    } else {
      settings.color_sniper_hit_once = true;
      logging.info(`COLOR_SNIPER: Hit ${settings.sniper_hit_count}/${SNIPER_MAX_HITS}`);
      
      csState.active = false;
      csState.waiting_for_trigger = true;
      csState.step = 0;
    }
  } else {
    settings.sniper_loss_count++;
    
        if (settings.sniper_loss_count >= SNIPER_MAX_LOSSES) {
      let currentBalance = 0;
      let currentProfit = 0;
      
      if (settings.virtual_mode) {
        currentBalance = (userStats[userId].virtual_balance || 0);
        currentProfit = currentBalance - (userStats[userId].initial_balance || 0);
      } else {
        const session = userSessions[userId];
        if (session) {
          currentBalance = await getBalance(session, parseInt(userId)) || 0;
          currentProfit = currentBalance - (userStats[userId].start_balance || 0);
        }
      }

      try {
        const imagePath = await createSniperImage(
          'MAX_LOSSES',
          userId,
          settings.strategy,
          settings.sniper_hit_count,
          settings.sniper_loss_count,
          SNIPER_MAX_HITS,
          SNIPER_MAX_LOSSES,
          currentProfit,
          currentBalance,
          settings.virtual_mode
        );

        const caption = `🛑 ${STYLE.BOLD('COLOR SNIPER MAX LOSSES REACHED')}\n` +
                      `${STYLE.SEPARATOR}\n` +
                      `${STYLE.ITEM(`Target Hits: ${SNIPER_MAX_HITS}`)}\n` +
                      `${STYLE.ITEM(`Actual Hits: ${settings.sniper_hit_count}`)}\n` +
                      `${STYLE.ITEM(`Max Losses: ${SNIPER_MAX_LOSSES}`)}\n` +
                      `${STYLE.LAST_ITEM('⚠️ Session terminated - Too many consecutive losses')}`;
        
        const restartKeyboard = Markup.inlineKeyboard([
          Markup.button.callback(`${EMOJI.START} RESTART`, `restart_bot:${userId}`)
        ]);
        
        await bot.telegram.sendPhoto(userId, { source: imagePath }, {
          caption: caption,
          parse_mode: 'Markdown',
          reply_markup: restartKeyboard.reply_markup
        });
        
        fs.unlinkSync(imagePath);
      } catch (error) {
        logging.error(`Failed to send max losses image to ${userId}: ${error.message}`);
        const terminationMessage = `🛑 ${STYLE.BOLD('COLOR SNIPER MAX LOSSES REACHED')}\n` +
                                 `${STYLE.SEPARATOR}\n` +
                                 `${STYLE.ITEM(`Target Hits: ${SNIPER_MAX_HITS}`)}\n` +
                                 `${STYLE.ITEM(`Actual Hits: ${settings.sniper_hit_count}`)}\n` +
                                 `${STYLE.ITEM(`Max Losses: ${SNIPER_MAX_LOSSES}`)}\n` +
                                 `${STYLE.LAST_ITEM('⚠️ Session terminated - Too many consecutive losses')}`;
        
        await bot.telegram.sendMessage(userId, terminationMessage, { parse_mode: 'Markdown' });
      }
      
      settings.running = false;
      settings.color_sniper_max_reached = true;
      delete userWaitingForResult[userId];
      delete userShouldSkipNext[userId];
      
      csState.active = false;
      csState.waiting_for_trigger = true;
      csState.step = 0;
      csState.hit_count = 0;
      
      logging.info(`COLOR_SNIPER: Max losses (${SNIPER_MAX_LOSSES}) reached. Stopping.`);
    } else {
      csState.step++;
      if (csState.step >= 4) {
        settings.running = false;
        settings.color_sniper_max_reached = true;
        logging.info(`COLOR_SNIPER: Max internal losses (4) reached. Stopping.`);
        delete userWaitingForResult[userId];
        delete userShouldSkipNext[userId];
      }
    }
  }
}

if (settings.strategy === "QUANTUM_CALC") {
  logging.info(`QUANTUM_CALC: ${isWin ? 'WIN' : 'LOSS'}`);
}

if (settings.strategy === "TIME_WARP") {
  logging.info(`TIME_WARP: ${isWin ? 'WIN' : 'LOSS'}`);
  if (!isWin) {
    settings.time_warp_pos = settings.time_warp_pos === 8 ? 5 : 8;
    logging.info(`TIME_WARP: Loss. Switched lookback to ${settings.time_warp_pos}`);
  }
}
if (settings.strategy === "GROK_AI") {
  logging.info(`[GROK_AI] ${isWin ? 'WIN' : 'LOSS'} - Universe analysis complete 🌌`);
  
  // Optional: Grok-specific future extension (လိုရင်သုံး)
  // settings.grok_momentum = (settings.grok_momentum || 0) + (isWin ? 1 : -1);
}

if (settings.strategy === "ULTRA_SNIPER" && settings.ultra_sniper_state) {
  const usState = settings.ultra_sniper_state;
  
  if (settings.sniper_hit_count === undefined) {
    settings.sniper_hit_count = 0;
  }
  if (settings.sniper_loss_count === undefined) {
    settings.sniper_loss_count = 0;
  }
  
  let currentBalance = 0;
  if (settings.virtual_mode) {
    currentBalance = (userStats[userId].virtual_balance || 0);
  } else {
    const session = userSessions[userId];
    if (session) {
      currentBalance = await getBalance(session, parseInt(userId)) || 0;
    }
  }
  
  let currentProfit = 0;
  if (settings.virtual_mode) {
    currentProfit = (userStats[userId].virtual_balance || 0) - (userStats[userId].initial_balance || 0);
  } else {
    currentProfit = (userStats[userId]?.profit || 0);
  }
  
  if (isWin) {
    settings.sniper_hit_count++;
    settings.sniper_loss_count = 0;
    
    if (settings.sniper_hit_count >= SNIPER_MAX_HITS) {
      try {
        const imagePath = await createSniperImage(
          'MISSION_COMPLETE',
          userId,
          'ULTRA SNIPER',
          settings.sniper_hit_count,
          settings.sniper_loss_count,
          SNIPER_MAX_HITS,
          SNIPER_MAX_LOSSES,
          currentProfit,
          currentBalance,
          settings.virtual_mode
        );
        
        const caption = `🎯 ${STYLE.BOLD('ULTRA SNIPER MISSION COMPLETE!')}\n` +
                      `${STYLE.SEPARATOR}\n` +
                      `${STYLE.ITEM(`Target Hits: ${SNIPER_MAX_HITS}`)}\n` +
                      `${STYLE.ITEM(`Actual Hits: ${settings.sniper_hit_count}`)}\n` +
                      `${STYLE.ITEM(`Losses: ${settings.sniper_loss_count}`)}\n` +
                      `${STYLE.LAST_ITEM('🎉 Target acquired successfully!')}`;
        
        const restartKeyboard = Markup.inlineKeyboard([
          Markup.button.callback(`${EMOJI.START} RESTART`, `restart_bot:${userId}`)
        ]);
        
        await bot.telegram.sendPhoto(userId, { source: imagePath }, {
          caption: caption,
          parse_mode: 'Markdown',
          reply_markup: restartKeyboard.reply_markup
        });
        
        fs.unlinkSync(imagePath);
      } catch (error) {
        logging.error(`Failed to send ultra sniper mission complete image: ${error.message}`);
      }
      
      settings.running = false;
      settings.ultra_sniper_state = { active: false, step: 0, direction: null, betCount: 0 };
      delete userWaitingForResult[userId];
      delete userShouldSkipNext[userId];
      
      logging.info(`ULTRA_SNIPER: Target Acquired (${SNIPER_MAX_HITS} Wins). Stopping.`);
    } else {
      logging.info(`ULTRA_SNIPER: Hit ${settings.sniper_hit_count}/${SNIPER_MAX_HITS}`);
    }
  } else {
    settings.sniper_loss_count++;
    
    if (settings.sniper_loss_count >= SNIPER_MAX_LOSSES) {
      try {
        const imagePath = await createSniperImage(
          'MAX_LOSSES',
          userId,
          'ULTRA SNIPER',
          settings.sniper_hit_count,
          settings.sniper_loss_count,
          SNIPER_MAX_HITS,
          SNIPER_MAX_LOSSES,
          currentProfit,
          currentBalance,
          settings.virtual_mode
        );
        
        const caption = `🛑 ${STYLE.BOLD('ULTRA SNIPER MAX LOSSES REACHED')}\n` +
                      `${STYLE.SEPARATOR}\n` +
                      `${STYLE.ITEM(`Target Hits: ${SNIPER_MAX_HITS}`)}\n` +
                      `${STYLE.ITEM(`Actual Hits: ${settings.sniper_hit_count}`)}\n` +
                      `${STYLE.ITEM(`Max Losses: ${SNIPER_MAX_LOSSES}`)}\n` +
                      `${STYLE.LAST_ITEM('⚠️ Session terminated - Too many losses')}`;
        
        const restartKeyboard = Markup.inlineKeyboard([
          Markup.button.callback(`${EMOJI.START} RESTART`, `restart_bot:${userId}`)
        ]);
        
        await bot.telegram.sendPhoto(userId, { source: imagePath }, {
          caption: caption,
          parse_mode: 'Markdown',
          reply_markup: restartKeyboard.reply_markup
        });
        
        fs.unlinkSync(imagePath);
      } catch (error) {
        logging.error(`Failed to send ultra sniper max losses image: ${error.message}`);
      }
      
      settings.running = false;
      settings.ultra_sniper_state = { active: false, step: 0, direction: null, betCount: 0 };
      delete userWaitingForResult[userId];
      delete userShouldSkipNext[userId];
      
      logging.info(`ULTRA_SNIPER: Max losses (${SNIPER_MAX_LOSSES}) reached. Stopping.`);
    } else {
      usState.step++;
      if (usState.step > 3) {
        try {
          const imagePath = await createSniperImage(
            'MAX_LOSSES',
            userId,
            'ULTRA SNIPER',
            settings.sniper_hit_count,
            settings.sniper_loss_count,
            SNIPER_MAX_HITS,
            SNIPER_MAX_LOSSES,
            currentProfit,
            currentBalance,
            settings.virtual_mode
          );
          
          const caption = `🛑 ${STYLE.BOLD('ULTRA SNIPER MAX LOSSES REACHED')}\n` +
                        `${STYLE.SEPARATOR}\n` +
                        `${STYLE.ITEM(`Status: 3 consecutive losses`)}\n` +
                        `${STYLE.ITEM(`Balance: ${currentBalance.toFixed(2)} Ks`)}\n` +
                        `${STYLE.LAST_ITEM(`Profit: ${currentProfit >= 0 ? '+' : ''}${currentProfit.toFixed(2)} Ks`)}`;
          
          const restartKeyboard = Markup.inlineKeyboard([
            Markup.button.callback(`${EMOJI.START} RESTART`, `restart_bot:${userId}`)
          ]);
          
          await bot.telegram.sendPhoto(userId, { source: imagePath }, {
            caption: caption,
            parse_mode: 'Markdown',
            reply_markup: restartKeyboard.reply_markup
          });
          
          fs.unlinkSync(imagePath);
        } catch (error) {
          logging.error(`Failed to send ultra sniper max losses image: ${error.message}`);
        }
        
        settings.running = false;
        settings.ultra_sniper_state = { active: false, step: 0, direction: null, betCount: 0 };
        delete userWaitingForResult[userId];
        delete userShouldSkipNext[userId];
        
        logging.info(`ULTRA_SNIPER: 3 consecutive losses. Stopping.`);
      } else {
        logging.info(`ULTRA_SNIPER: Loss. Step ${usState.step}/3.`);
      }
    }
  }
}

if (settings.strategy === "CHAOS_SEEKER" && settings.chaos_seeker_state) {
  const csState = settings.chaos_seeker_state;
  
  if (settings.sniper_hit_count === undefined) {
    settings.sniper_hit_count = 0;
  }
  if (settings.sniper_loss_count === undefined) {
    settings.sniper_loss_count = 0;
  }
  
  let currentBalance = 0;
  let currentProfit = 0;
  
  if (settings.virtual_mode) {
    currentBalance = (userStats[userId].virtual_balance || 0);
    currentProfit = currentBalance - (userStats[userId].initial_balance || 0);
  } else {
    const session = userSessions[userId];
    if (session) {
      currentBalance = await getBalance(session, parseInt(userId)) || 0;
      currentProfit = (userStats[userId]?.profit || 0);
    }
  }
  
  if (isWin) {
    settings.sniper_hit_count++;
    settings.sniper_loss_count = 0;
    
    settings.chaos_seeker_state = { active: false, triggerPattern: null, betCount: 0, multiplier: 1 };
    
    const targetProfit = settings.target_profit;
    if (targetProfit && currentProfit >= targetProfit) {
      try {
        const imagePath = await createSniperImage(
          'MISSION_COMPLETE',
          userId,
          'CHAOS SEEKER',
          settings.sniper_hit_count,
          settings.sniper_loss_count,
          SNIPER_MAX_HITS,
          SNIPER_MAX_LOSSES,
          currentProfit,
          currentBalance,
          settings.virtual_mode
        );
        
        const caption = `🎯 ${STYLE.BOLD('CHAOS SEEKER PROFIT TARGET ACHIEVED!')}\n` +
                      `${STYLE.SEPARATOR}\n` +
                      `${STYLE.ITEM(`Target: ${targetProfit} Ks`)}\n` +
                      `${STYLE.ITEM(`Profit: +${currentProfit.toFixed(2)} Ks`)}\n` +
                      `${STYLE.ITEM(`Balance: ${currentBalance.toFixed(2)} Ks`)}\n` +
                      `${STYLE.LAST_ITEM('🎉 Target acquired successfully!')}`;
        
        const restartKeyboard = Markup.inlineKeyboard([
          Markup.button.callback(`${EMOJI.START} RESTART`, `restart_bot:${userId}`)
        ]);
        
        await bot.telegram.sendPhoto(userId, { source: imagePath }, {
          caption: caption,
          parse_mode: 'Markdown',
          reply_markup: restartKeyboard.reply_markup
        });
        
        fs.unlinkSync(imagePath);
      } catch (error) {
        logging.error(`Failed to send chaos seeker profit target image: ${error.message}`);
        const terminationMessage = `🎯 ${STYLE.BOLD('PROFIT TARGET ACHIEVED!')}\n` +
                                 `${STYLE.SEPARATOR}\n` +
                                 `${STYLE.ITEM(`Target: ${targetProfit} Ks`)}\n` +
                                 `${STYLE.LAST_ITEM(`Profit: +${currentProfit.toFixed(2)} Ks`)}`;
        
        await bot.telegram.sendMessage(userId, terminationMessage, { parse_mode: 'Markdown' });
      }
      
      settings.running = false;
      delete userWaitingForResult[userId];
      delete userShouldSkipNext[userId];
      logging.info(`CHAOS_SEEKER: Profit target reached (${currentProfit}/${targetProfit}). Stopping.`);
    } else {
      const stopLossLimit = settings.stop_loss;
      if (stopLossLimit && currentProfit <= -stopLossLimit) {
        try {
          const imagePath = await createSniperImage(
            'MAX_LOSSES',
            userId,
            'CHAOS SEEKER',
            settings.sniper_hit_count,
            settings.sniper_loss_count,
            SNIPER_MAX_HITS,
            SNIPER_MAX_LOSSES,
            currentProfit,
            currentBalance,
            settings.virtual_mode
          );
          
          const caption = `🛑 ${STYLE.BOLD('CHAOS SEEKER STOP LOSS HIT')}\n` +
                        `${STYLE.SEPARATOR}\n` +
                        `${STYLE.ITEM(`Limit: ${stopLossLimit} Ks`)}\n` +
                        `${STYLE.ITEM(`Loss: ${Math.abs(currentProfit).toFixed(2)} Ks`)}\n` +
                        `${STYLE.ITEM(`Balance: ${currentBalance.toFixed(2)} Ks`)}\n` +
                        `${STYLE.LAST_ITEM('⚠️ Session terminated - Stop loss reached')}`;
          
          const restartKeyboard = Markup.inlineKeyboard([
            Markup.button.callback(`${EMOJI.START} RESTART`, `restart_bot:${userId}`)
          ]);
          
          await bot.telegram.sendPhoto(userId, { source: imagePath }, {
            caption: caption,
            parse_mode: 'Markdown',
            reply_markup: restartKeyboard.reply_markup
          });
          
          fs.unlinkSync(imagePath);
        } catch (error) {
          logging.error(`Failed to send chaos seeker stop loss image: ${error.message}`);
          const terminationMessage = `🛑 ${STYLE.BOLD('STOP LOSS HIT')}\n` +
                                   `${STYLE.SEPARATOR}\n` +
                                   `${STYLE.ITEM(`Limit: ${stopLossLimit} Ks`)}\n` +
                                   `${STYLE.LAST_ITEM(`Loss: ${Math.abs(currentProfit).toFixed(2)} Ks`)}`;
          
          await bot.telegram.sendMessage(userId, terminationMessage, { parse_mode: 'Markdown' });
        }
        
        settings.running = false;
        delete userWaitingForResult[userId];
        delete userShouldSkipNext[userId];
        logging.info(`CHAOS_SEEKER: Stop loss reached (${Math.abs(currentProfit)}/${stopLossLimit}). Stopping.`);
      } else {
        logging.info(`CHAOS_SEEKER: Win. Resetting. (Hits: ${settings.sniper_hit_count})`);
      }
    }
  } else {
    settings.sniper_loss_count++;
    
    csState.multiplier = Math.min(5, csState.multiplier + 1);
    csState.betCount++;
    logging.info(`CHAOS_SEEKER: Loss. Multiplier now ${csState.multiplier}. (Losses: ${settings.sniper_loss_count})`);
    
    if (csState.betCount >= 5) {
      try {
        const imagePath = await createSniperImage(
          'MAX_LOSSES',
          userId,
          'CHAOS SEEKER',
          settings.sniper_hit_count,
          settings.sniper_loss_count,
          SNIPER_MAX_HITS,
          SNIPER_MAX_LOSSES,
          currentProfit,
          currentBalance,
          settings.virtual_mode
        );
        
        const caption = `🛑 ${STYLE.BOLD('CHAOS SEEKER MAX LOSSES REACHED')}\n` +
                      `${STYLE.SEPARATOR}\n` +
                      `${STYLE.ITEM(`Status: 5 consecutive losses`)}\n` +
                      `${STYLE.ITEM(`Balance: ${currentBalance.toFixed(2)} Ks`)}\n` +
                      `${STYLE.LAST_ITEM(`Profit: ${currentProfit >= 0 ? '+' : ''}${currentProfit.toFixed(2)} Ks`)}`;
        
        const restartKeyboard = Markup.inlineKeyboard([
          Markup.button.callback(`${EMOJI.START} RESTART`, `restart_bot:${userId}`)
        ]);
        
        await bot.telegram.sendPhoto(userId, { source: imagePath }, {
          caption: caption,
          parse_mode: 'Markdown',
          reply_markup: restartKeyboard.reply_markup
        });
        
        fs.unlinkSync(imagePath);
      } catch (error) {
        logging.error(`Failed to send chaos seeker max losses image: ${error.message}`);
        const terminationMessage = `🛑 ${STYLE.BOLD('MAX LOSSES REACHED')}\n` +
                                 `${STYLE.SEPARATOR}\n` +
                                 `${STYLE.LAST_ITEM('5 consecutive losses')}`;
        
        await bot.telegram.sendMessage(userId, terminationMessage, { parse_mode: 'Markdown' });
      }
      
      settings.running = false;
      settings.chaos_seeker_state = { active: false, triggerPattern: null, betCount: 0, multiplier: 1 };
      delete userWaitingForResult[userId];
      delete userShouldSkipNext[userId];
      
      logging.info(`CHAOS_SEEKER: 5 losses. Deactivating.`);
    }
  }
}

if (settings.strategy === "TERMINATOR" && settings.terminator_state) {
  const termState = settings.terminator_state;
  
  if (settings.sniper_hit_count === undefined) settings.sniper_hit_count = 0;
  if (settings.sniper_loss_count === undefined) settings.sniper_loss_count = 0;
  
  let currentBalance = 0;
  let currentProfit = 0;
  
  if (settings.virtual_mode) {
    currentBalance = (userStats[userId].virtual_balance || 0);
    currentProfit = currentBalance - (userStats[userId].initial_balance || 0);
  } else {
    const session = userSessions[userId];
    if (session) {
      currentBalance = await getBalance(session, parseInt(userId)) || 0;
      currentProfit = (userStats[userId]?.profit || 0);
    }
  }
  
  if (isWin) {
    settings.sniper_hit_count++;
    settings.sniper_loss_count = 0;
    
    const targetProfit = settings.target_profit;
    if (targetProfit && currentProfit >= targetProfit) {
      await sendTerminationImage(userId, bot, 'TERMINATOR', 'MISSION_COMPLETE', 
  settings.sniper_hit_count || 0,
  settings.sniper_loss_count || 0,
  currentProfit, currentBalance, settings.virtual_mode,
  `🎯 TARGET ACHIEVED! Profit: +${currentProfit.toFixed(2)} Ks`);
      
      settings.running = false;
      settings.terminator_state = { active: true, consecutiveLosses: 0 };
      delete userWaitingForResult[userId];
      delete userShouldSkipNext[userId];
      logging.info(`TERMINATOR: Profit target reached. Stopping.`);
    } else {
      const stopLossLimit = settings.stop_loss;
      if (stopLossLimit && currentProfit <= -stopLossLimit) {
        await sendTerminationImage(userId, bot, 'TERMINATOR', 'MAX_LOSSES',
          settings.sniper_hit_count, settings.sniper_loss_count,
          currentProfit, currentBalance, settings.virtual_mode,
          `🛑 STOP LOSS HIT! Loss: ${Math.abs(currentProfit).toFixed(2)} Ks`);
        
        settings.running = false;
        settings.terminator_state = { active: true, consecutiveLosses: 0 };
        delete userWaitingForResult[userId];
        delete userShouldSkipNext[userId];
        logging.info(`TERMINATOR: Stop loss reached. Stopping.`);
      }
    }
  } else {
    settings.sniper_loss_count++;
    termState.consecutiveLosses++;
    
    if (termState.consecutiveLosses >= 5) {
      await sendTerminationImage(userId, bot, 'TERMINATOR', 'MAX_LOSSES',
        settings.sniper_hit_count, settings.sniper_loss_count,
        currentProfit, currentBalance, settings.virtual_mode,
        `☠️ 5 CONSECUTIVE LOSSES!`);
      
      settings.running = false;
      settings.terminator_state = { active: true, consecutiveLosses: 0 };
      delete userWaitingForResult[userId];
      delete userShouldSkipNext[userId];
      logging.info(`TERMINATOR: 5 consecutive losses. Stopping.`);
    }
  }
}

if (settings.strategy === "NEURAL_NET") {
  if (settings.sniper_hit_count === undefined) settings.sniper_hit_count = 0;
  if (settings.sniper_loss_count === undefined) settings.sniper_loss_count = 0;
  
  let currentBalance = 0;
  let currentProfit = 0;
  
  if (settings.virtual_mode) {
    currentBalance = (userStats[userId].virtual_balance || 0);
    currentProfit = currentBalance - (userStats[userId].initial_balance || 0);
  } else {
    const session = userSessions[userId];
    if (session) {
      currentBalance = await getBalance(session, parseInt(userId)) || 0;
      currentProfit = (userStats[userId]?.profit || 0);
    }
  }
  
  if (isWin) {
    settings.sniper_hit_count++;
    settings.sniper_loss_count = 0;
  } else {
    settings.sniper_loss_count++;
  }
  
  const targetProfit = settings.target_profit;
  if (targetProfit && currentProfit >= targetProfit) {
    await sendTerminationImage(userId, bot, 'NEURAL NET', 'MISSION_COMPLETE',
      settings.sniper_hit_count || 0, 
      settings.sniper_loss_count || 0,
      currentProfit, currentBalance, settings.virtual_mode,
      `🎯 TARGET ACHIEVED! Profit: +${currentProfit.toFixed(2)} Ks`);
    
    settings.running = false;
    delete userWaitingForResult[userId];
    delete userShouldSkipNext[userId];
    logging.info(`NEURAL_NET: Profit target reached. Stopping.`);
    return;
  }
  
  const stopLossLimit = settings.stop_loss;
  if (stopLossLimit && currentProfit <= -stopLossLimit) {
    await sendTerminationImage(userId, bot, 'NEURAL NET', 'MAX_LOSSES',
      settings.sniper_hit_count || 0, 
      settings.sniper_loss_count || 0,
      currentProfit, currentBalance, settings.virtual_mode,
      `🛑 STOP LOSS HIT! Loss: ${Math.abs(currentProfit).toFixed(2)} Ks`);
    
    settings.running = false;
    delete userWaitingForResult[userId];
    delete userShouldSkipNext[userId];
    logging.info(`NEURAL_NET: Stop loss reached. Stopping.`);
    return;
  }
  
  logging.info(`NEURAL_NET: ${isWin ? 'WIN' : 'LOSS'} - Hits: ${settings.sniper_hit_count}, Losses: ${settings.sniper_loss_count}`);
}

if (settings.strategy === "PYRO_TECH" && settings.pyro_state) {
  const pyroState = settings.pyro_state;
  
  if (settings.sniper_hit_count === undefined) settings.sniper_hit_count = 0;
  if (settings.sniper_loss_count === undefined) settings.sniper_loss_count = 0;
  
  let currentBalance = 0;
  let currentProfit = 0;
  
  if (settings.virtual_mode) {
    currentBalance = (userStats[userId].virtual_balance || 0);
    currentProfit = currentBalance - (userStats[userId].initial_balance || 0);
  } else {
    const session = userSessions[userId];
    if (session) {
      currentBalance = await getBalance(session, parseInt(userId)) || 0;
      currentProfit = (userStats[userId]?.profit || 0);
    }
  }
  
  if (isWin) {
    settings.sniper_hit_count++;
    settings.sniper_loss_count = 0;
    
    if (pyroState.step === 1) {
      pyroState.step = 2;
      pyroState.active = true;
      logging.info(`PYRO_TECH: First bet won. Continuing to second bet with double amount.`);
    } else if (pyroState.step === 2) {
      pyroState.active = false;
      pyroState.step = 0;
      logging.info(`PYRO_TECH: Second bet won. Mission complete.`);
    } else {
      pyroState.active = false;
      pyroState.step = 0;
    }
    
    const targetProfit = settings.target_profit;
    if (targetProfit && currentProfit >= targetProfit) {
      await sendTerminationImage(userId, bot, 'PYRO TECH', 'MISSION_COMPLETE',
        settings.sniper_hit_count || 0, 
        settings.sniper_loss_count || 0,
        currentProfit, currentBalance, settings.virtual_mode,
        `🎯 TARGET ACHIEVED! Profit: +${currentProfit.toFixed(2)} Ks`);
      
      settings.running = false;
      pyroState.active = false;
      pyroState.step = 0;
      delete userWaitingForResult[userId];
      delete userShouldSkipNext[userId];
      logging.info(`PYRO_TECH: Profit target reached. Stopping.`);
      return;
    }
  } else {
    settings.sniper_loss_count++;
    
    pyroState.active = false;
    pyroState.step = 0;
    logging.info(`PYRO_TECH: Loss. Resetting.`);
    
    const stopLossLimit = settings.stop_loss;
    if (stopLossLimit && currentProfit <= -stopLossLimit) {
      await sendTerminationImage(userId, bot, 'PYRO TECH', 'MAX_LOSSES',
        settings.sniper_hit_count || 0, 
        settings.sniper_loss_count || 0,
        currentProfit, currentBalance, settings.virtual_mode,
        `🛑 STOP LOSS HIT! Loss: ${Math.abs(currentProfit).toFixed(2)} Ks`);
      
      settings.running = false;
      pyroState.active = false;
      pyroState.step = 0;
      delete userWaitingForResult[userId];
      delete userShouldSkipNext[userId];
      logging.info(`PYRO_TECH: Stop loss reached. Stopping.`);
      return;
    }
  }
}

if (settings.strategy === "TSUNAMI") {
  if (settings.sniper_hit_count === undefined) settings.sniper_hit_count = 0;
  if (settings.sniper_loss_count === undefined) settings.sniper_loss_count = 0;
  
  let currentBalance = 0;
  let currentProfit = 0;
  
  if (settings.virtual_mode) {
    currentBalance = (userStats[userId].virtual_balance || 0);
    currentProfit = currentBalance - (userStats[userId].initial_balance || 0);
  } else {
    const session = userSessions[userId];
    if (session) {
      currentBalance = await getBalance(session, parseInt(userId)) || 0;
      currentProfit = (userStats[userId]?.profit || 0);
    }
  }
  
  if (isWin) {
    settings.sniper_hit_count++;
    settings.sniper_loss_count = 0;
  } else {
    settings.sniper_loss_count++;
  }
  
  const targetProfit = settings.target_profit;
  if (targetProfit && currentProfit >= targetProfit) {
    await sendTerminationImage(userId, bot, 'TSUNAMI', 'MISSION_COMPLETE',
      settings.sniper_hit_count || 0, 
      settings.sniper_loss_count || 0,
      currentProfit, currentBalance, settings.virtual_mode,
      `🎯 TARGET ACHIEVED! Profit: +${currentProfit.toFixed(2)} Ks`);
    
    settings.running = false;
    delete userWaitingForResult[userId];
    delete userShouldSkipNext[userId];
    logging.info(`TSUNAMI: Profit target reached. Stopping.`);
    return;
  }
  
  const stopLossLimit = settings.stop_loss;
  if (stopLossLimit && currentProfit <= -stopLossLimit) {
    await sendTerminationImage(userId, bot, 'TSUNAMI', 'MAX_LOSSES',
      settings.sniper_hit_count || 0, 
      settings.sniper_loss_count || 0,
      currentProfit, currentBalance, settings.virtual_mode,
      `🛑 STOP LOSS HIT! Loss: ${Math.abs(currentProfit).toFixed(2)} Ks`);
    
    settings.running = false;
    delete userWaitingForResult[userId];
    delete userShouldSkipNext[userId];
    logging.info(`TSUNAMI: Stop loss reached. Stopping.`);
    return;
  }
  
  logging.info(`TSUNAMI: ${isWin ? 'WIN' : 'LOSS'} - Hits: ${settings.sniper_hit_count}, Losses: ${settings.sniper_loss_count}`);
}

if (settings.strategy === "MAGE") {
  if (settings.sniper_hit_count === undefined) settings.sniper_hit_count = 0;
  if (settings.sniper_loss_count === undefined) settings.sniper_loss_count = 0;
  
  let currentBalance = 0;
  let currentProfit = 0;
  
  if (settings.virtual_mode) {
    currentBalance = (userStats[userId].virtual_balance || 0);
    currentProfit = currentBalance - (userStats[userId].initial_balance || 0);
  } else {
    const session = userSessions[userId];
    if (session) {
      currentBalance = await getBalance(session, parseInt(userId)) || 0;
      currentProfit = (userStats[userId]?.profit || 0);
    }
  }
  
  if (isWin) {
    settings.sniper_hit_count++;
    settings.sniper_loss_count = 0;
  } else {
    settings.sniper_loss_count++;
  }
  
  const targetProfit = settings.target_profit;
  if (targetProfit && currentProfit >= targetProfit) {
    await sendTerminationImage(userId, bot, 'MAGE', 'MISSION_COMPLETE',
      settings.sniper_hit_count || 0, 
      settings.sniper_loss_count || 0,
      currentProfit, currentBalance, settings.virtual_mode,
      `🎯 TARGET ACHIEVED! Profit: +${currentProfit.toFixed(2)} Ks`);
    
    settings.running = false;
    delete userWaitingForResult[userId];
    delete userShouldSkipNext[userId];
    logging.info(`MAGE: Profit target reached. Stopping.`);
    return;
  }
  
  const stopLossLimit = settings.stop_loss;
  if (stopLossLimit && currentProfit <= -stopLossLimit) {
    await sendTerminationImage(userId, bot, 'MAGE', 'MAX_LOSSES',
      settings.sniper_hit_count || 0, 
      settings.sniper_loss_count || 0,
      currentProfit, currentBalance, settings.virtual_mode,
      `🛑 STOP LOSS HIT! Loss: ${Math.abs(currentProfit).toFixed(2)} Ks`);
    
    settings.running = false;
    delete userWaitingForResult[userId];
    delete userShouldSkipNext[userId];
    logging.info(`MAGE: Stop loss reached. Stopping.`);
    return;
  }
  
  logging.info(`MAGE: ${isWin ? 'WIN' : 'LOSS'} - Hits: ${settings.sniper_hit_count}, Losses: ${settings.sniper_loss_count}`);
}

if (settings.strategy === "REAPER") {
  if (settings.sniper_hit_count === undefined) settings.sniper_hit_count = 0;
  if (settings.sniper_loss_count === undefined) settings.sniper_loss_count = 0;
  
  let currentBalance = 0;
  let currentProfit = 0;
  
  if (settings.virtual_mode) {
    currentBalance = (userStats[userId].virtual_balance || 0);
    currentProfit = currentBalance - (userStats[userId].initial_balance || 0);
  } else {
    const session = userSessions[userId];
    if (session) {
      currentBalance = await getBalance(session, parseInt(userId)) || 0;
      currentProfit = (userStats[userId]?.profit || 0);
    }
  }
  
  if (isWin) {
    settings.sniper_hit_count++;
    settings.sniper_loss_count = 0;
  } else {
    settings.sniper_loss_count++;
  }
  
  const targetProfit = settings.target_profit;
  if (targetProfit && currentProfit >= targetProfit) {
    await sendTerminationImage(userId, bot, 'REAPER', 'MISSION_COMPLETE',
      settings.sniper_hit_count || 0, 
      settings.sniper_loss_count || 0,
      currentProfit, currentBalance, settings.virtual_mode,
      `🎯 TARGET ACHIEVED! Profit: +${currentProfit.toFixed(2)} Ks`);
    
    settings.running = false;
    delete userWaitingForResult[userId];
    delete userShouldSkipNext[userId];
    logging.info(`REAPER: Profit target reached. Stopping.`);
    return;
  }
  
  const stopLossLimit = settings.stop_loss;
  if (stopLossLimit && currentProfit <= -stopLossLimit) {
    await sendTerminationImage(userId, bot, 'REAPER', 'MAX_LOSSES',
      settings.sniper_hit_count || 0, 
      settings.sniper_loss_count || 0,
      currentProfit, currentBalance, settings.virtual_mode,
      `🛑 STOP LOSS HIT! Loss: ${Math.abs(currentProfit).toFixed(2)} Ks`);
    
    settings.running = false;
    delete userWaitingForResult[userId];
    delete userShouldSkipNext[userId];
    logging.info(`REAPER: Stop loss reached. Stopping.`);
    return;
  }
  
  logging.info(`REAPER: ${isWin ? 'WIN' : 'LOSS'} - Hits: ${settings.sniper_hit_count}, Losses: ${settings.sniper_loss_count}`);
}

if (settings.strategy === "DEEPSEEK_PREDICTOR") {
  if (settings.sniper_hit_count === undefined) settings.sniper_hit_count = 0;
  if (settings.sniper_loss_count === undefined) settings.sniper_loss_count = 0;
  
  let currentBalance = 0;
  let currentProfit = 0;
  
  if (settings.virtual_mode) {
    currentBalance = (userStats[userId]?.virtual_balance || 0);
    currentProfit = currentBalance - (userStats[userId]?.initial_balance || 0);
  } else {
    const session = userSessions[userId];
    if (session) {
      currentBalance = await getBalance(session, parseInt(userId)) || 0;
      currentProfit = (userStats[userId]?.profit || 0);
    }
  }
  
  if (isWin) {
    settings.sniper_hit_count++;
    settings.sniper_loss_count = 0;
  } else {
    settings.sniper_loss_count++;
  }
  
  const targetProfit = settings.target_profit;
  if (targetProfit && currentProfit >= targetProfit) {
    await sendTerminationImage(userId, bot, 'DEEPSEEK PREDICTOR', 'MISSION_COMPLETE',
      settings.sniper_hit_count || 0, 
      settings.sniper_loss_count || 0,
      currentProfit, currentBalance, settings.virtual_mode,
      `🎯 TARGET ACHIEVED! Profit: +${currentProfit.toFixed(2)} Ks`);
    
    settings.running = false;
    delete userWaitingForResult[userId];
    delete userShouldSkipNext[userId];
    logging.info(`DEEPSEEK_PREDICTOR: Profit target reached. Stopping.`);
    return;
  }
  
  const stopLossLimit = settings.stop_loss;
  if (stopLossLimit && currentProfit <= -stopLossLimit) {
    await sendTerminationImage(userId, bot, 'DEEPSEEK PREDICTOR', 'MAX_LOSSES',
      settings.sniper_hit_count || 0, 
      settings.sniper_loss_count || 0,
      currentProfit, currentBalance, settings.virtual_mode,
      `🛑 STOP LOSS HIT! Loss: ${Math.abs(currentProfit).toFixed(2)} Ks`);
    
    settings.running = false;
    delete userWaitingForResult[userId];
    delete userShouldSkipNext[userId];
    logging.info(`DEEPSEEK_PREDICTOR: Stop loss reached. Stopping.`);
    return;
  }
  
  logging.info(`DEEPSEEK_PREDICTOR: ${isWin ? 'WIN' : 'LOSS'} - Hits: ${settings.sniper_hit_count}, Losses: ${settings.sniper_loss_count}`);
}

if (settings.strategy === "DEEPSEEK_NEURAL") {
  if (settings.sniper_hit_count === undefined) settings.sniper_hit_count = 0;
  if (settings.sniper_loss_count === undefined) settings.sniper_loss_count = 0;
  
  let currentBalance = 0;
  let currentProfit = 0;
  
  if (settings.virtual_mode) {
    currentBalance = (userStats[userId]?.virtual_balance || 0);
    currentProfit = currentBalance - (userStats[userId]?.initial_balance || 0);
  } else {
    const session = userSessions[userId];
    if (session) {
      currentBalance = await getBalance(session, parseInt(userId)) || 0;
      currentProfit = (userStats[userId]?.profit || 0);
    }
  }
  
  if (isWin) {
    settings.sniper_hit_count++;
    settings.sniper_loss_count = 0;
  } else {
    settings.sniper_loss_count++;
  }
  
  const targetProfit = settings.target_profit;
  if (targetProfit && currentProfit >= targetProfit) {
    await sendTerminationImage(userId, bot, 'DEEPSEEK NEURAL', 'MISSION_COMPLETE',
      settings.sniper_hit_count || 0, 
      settings.sniper_loss_count || 0,
      currentProfit, currentBalance, settings.virtual_mode,
      `🎯 TARGET ACHIEVED! Profit: +${currentProfit.toFixed(2)} Ks`);
    settings.running = false;
    delete userWaitingForResult[userId];
    delete userShouldSkipNext[userId];
    logging.info(`DEEPSEEK_NEURAL: Profit target reached. Stopping.`);
    return;
  }
  
  const stopLossLimit = settings.stop_loss;
  if (stopLossLimit && currentProfit <= -stopLossLimit) {
    await sendTerminationImage(userId, bot, 'DEEPSEEK NEURAL', 'MAX_LOSSES',
      settings.sniper_hit_count || 0, 
      settings.sniper_loss_count || 0,
      currentProfit, currentBalance, settings.virtual_mode,
      `🛑 STOP LOSS HIT! Loss: ${Math.abs(currentProfit).toFixed(2)} Ks`);
    settings.running = false;
    delete userWaitingForResult[userId];
    delete userShouldSkipNext[userId];
    logging.info(`DEEPSEEK_NEURAL: Stop loss reached. Stopping.`);
    return;
  }
  
  logging.info(`DEEPSEEK_NEURAL: ${isWin ? 'WIN' : 'LOSS'} - Hits: ${settings.sniper_hit_count}, Losses: ${settings.sniper_loss_count}`);
}

if (settings.strategy === "DEEPSEEK_ADAPTIVE") {
  if (!settings.deepseek_adaptive_state) {
    settings.deepseek_adaptive_state = {
      aggressionLevel: 1.0,
      consecutiveWins: 0,
      consecutiveLosses: 0,
      lastPrediction: null,
      performanceScore: 0
    };
  }
  const state = settings.deepseek_adaptive_state;
  
  if (settings.sniper_hit_count === undefined) settings.sniper_hit_count = 0;
  if (settings.sniper_loss_count === undefined) settings.sniper_loss_count = 0;
  
  let currentBalance = 0;
  let currentProfit = 0;
  
  if (settings.virtual_mode) {
    currentBalance = (userStats[userId]?.virtual_balance || 0);
    currentProfit = currentBalance - (userStats[userId]?.initial_balance || 0);
  } else {
    const session = userSessions[userId];
    if (session) {
      currentBalance = await getBalance(session, parseInt(userId)) || 0;
      currentProfit = (userStats[userId]?.profit || 0);
    }
  }
  
  if (isWin) {
    settings.sniper_hit_count++;
    settings.sniper_loss_count = 0;
    
    state.consecutiveWins++;
    state.consecutiveLosses = 0;
    
    state.aggressionLevel = Math.min(2.0, state.aggressionLevel + 0.2);
    
    if (state.consecutiveWins >= 3) {
      state.aggressionLevel = Math.min(2.0, state.aggressionLevel + 0.1);
    }
    
    logging.info(`DEEPSEEK_ADAPTIVE: WIN! Aggression increased to ${state.aggressionLevel.toFixed(2)}x (${state.consecutiveWins} wins)`);
    
  } else {
    settings.sniper_loss_count++;
    
    state.consecutiveLosses++;
    state.consecutiveWins = 0;
    
    state.aggressionLevel = Math.max(0.4, state.aggressionLevel - 0.15);
    
    if (state.consecutiveLosses >= 2) {
      state.aggressionLevel = Math.max(0.4, state.aggressionLevel - 0.1);
    }
    
    logging.info(`DEEPSEEK_ADAPTIVE: LOSS! Aggression decreased to ${state.aggressionLevel.toFixed(2)}x (${state.consecutiveLosses} losses)`);
  }
  
  const targetProfit = settings.target_profit;
  if (targetProfit && currentProfit >= targetProfit) {
    await sendTerminationImage(userId, bot, 'DEEPSEEK ADAPTIVE', 'MISSION_COMPLETE',
      settings.sniper_hit_count || 0, 
      settings.sniper_loss_count || 0,
      currentProfit, currentBalance, settings.virtual_mode,
      `🎯 TARGET ACHIEVED! Profit: +${currentProfit.toFixed(2)} Ks | Final Aggression: ${state.aggressionLevel.toFixed(2)}x`);
    settings.running = false;
    delete userWaitingForResult[userId];
    delete userShouldSkipNext[userId];
    logging.info(`DEEPSEEK_ADAPTIVE: Profit target reached. Stopping.`);
    return;
  }
  
  const stopLossLimit = settings.stop_loss;
  if (stopLossLimit && currentProfit <= -stopLossLimit) {
    await sendTerminationImage(userId, bot, 'DEEPSEEK ADAPTIVE', 'MAX_LOSSES',
      settings.sniper_hit_count || 0, 
      settings.sniper_loss_count || 0,
      currentProfit, currentBalance, settings.virtual_mode,
      `🛑 STOP LOSS HIT! Loss: ${Math.abs(currentProfit).toFixed(2)} Ks | Final Aggression: ${state.aggressionLevel.toFixed(2)}x`);
    settings.running = false;
    delete userWaitingForResult[userId];
    delete userShouldSkipNext[userId];
    logging.info(`DEEPSEEK_ADAPTIVE: Stop loss reached. Stopping.`);
    return;
  }
  
  if (settings.sniper_loss_count >= 5) {
    await sendTerminationImage(userId, bot, 'DEEPSEEK ADAPTIVE', 'MAX_LOSSES',
      settings.sniper_hit_count || 0, 
      settings.sniper_loss_count || 0,
      currentProfit, currentBalance, settings.virtual_mode,
      `⚠️ 5 CONSECUTIVE LOSSES! Safety Triggered. Aggression: ${state.aggressionLevel.toFixed(2)}x`);
    settings.running = false;
    delete userWaitingForResult[userId];
    delete userShouldSkipNext[userId];
    logging.info(`DEEPSEEK_ADAPTIVE: 5 consecutive losses. Safety stop.`);
    return;
  }
  
  logging.info(`DEEPSEEK_ADAPTIVE: ${isWin ? 'WIN' : 'LOSS'} - Hits: ${settings.sniper_hit_count}, Losses: ${settings.sniper_loss_count}, Aggression: ${state.aggressionLevel.toFixed(2)}x`);
}

if (settings.strategy === "GPT_ADAPTIVE_AI") {
  if (settings.sniper_hit_count === undefined) settings.sniper_hit_count = 0;
  if (settings.sniper_loss_count === undefined) settings.sniper_loss_count = 0;
  
  if (!settings.gpt_ai_state) {
    settings.gpt_ai_state = {
      confidence_score: 0,
      consecutive_skips: 0,
      last_decision: null,
      pattern_detected: false,
      risk_level: 'LOW'
    };
  }
  
  let currentBalance = 0;
  let currentProfit = 0;
  
  if (settings.virtual_mode) {
    currentBalance = (userStats[userId]?.virtual_balance || 0);
    currentProfit = currentBalance - (userStats[userId]?.initial_balance || 0);
  } else {
    const session = userSessions[userId];
    if (session) {
      currentBalance = await getBalance(session, parseInt(userId)) || 0;
      currentProfit = (userStats[userId]?.profit || 0);
    }
  }
  
  if (isWin) {
    settings.sniper_hit_count++;
    settings.sniper_loss_count = 0;
    
    settings.gpt_ai_state.confidence_score = Math.min(10, (settings.gpt_ai_state.confidence_score || 0) + 2);
    settings.gpt_ai_state.consecutive_skips = 0;
    
    if (settings.gpt_ai_state.confidence_score >= 7) {
      settings.gpt_ai_state.risk_level = 'LOW';
    } else if (settings.gpt_ai_state.confidence_score >= 4) {
      settings.gpt_ai_state.risk_level = 'MEDIUM';
    } else {
      settings.gpt_ai_state.risk_level = 'HIGH';
    }
    
    logging.info(`GPT_ADAPTIVE_AI: WIN - Confidence: ${settings.gpt_ai_state.confidence_score}, Risk: ${settings.gpt_ai_state.risk_level}`);
  } else {
    settings.sniper_loss_count++;
    
    settings.gpt_ai_state.confidence_score = Math.max(0, (settings.gpt_ai_state.confidence_score || 0) - 1);
    
    if (settings.sniper_loss_count >= 3) {
      settings.gpt_ai_state.risk_level = 'HIGH';
    } else if (settings.sniper_loss_count >= 2) {
      settings.gpt_ai_state.risk_level = 'MEDIUM';
    }
    
    logging.info(`GPT_ADAPTIVE_AI: LOSS - Confidence: ${settings.gpt_ai_state.confidence_score}, Risk: ${settings.gpt_ai_state.risk_level}, Consecutive Losses: ${settings.sniper_loss_count}`);
  }
  
if (settings.strategy === "GEMINI_AI") {
  if (settings.sniper_hit_count === undefined) settings.sniper_hit_count = 0;
  if (settings.sniper_loss_count === undefined) settings.sniper_loss_count = 0;
  
  let currentBalance = 0;
  let currentProfit = 0;
  
  if (settings.virtual_mode) {
    currentBalance = (userStats[userId]?.virtual_balance || 0);
    currentProfit = currentBalance - (userStats[userId]?.initial_balance || 0);
  } else {
    const session = userSessions[userId];
    if (session) {
      currentBalance = await getBalance(session, parseInt(userId)) || 0;
      currentProfit = (userStats[userId]?.profit || 0);
    }
  }
  
  if (isWin) {
    settings.sniper_hit_count++;
    settings.sniper_loss_count = 0;
  } else {
    settings.sniper_loss_count++;
  }
  
  const targetProfit = settings.target_profit;
  if (targetProfit && currentProfit >= targetProfit) {
    await sendTerminationImage(userId, bot, 'GEMINI AI', 'MISSION_COMPLETE',
      settings.sniper_hit_count || 0, settings.sniper_loss_count || 0,
      currentProfit, currentBalance, settings.virtual_mode,
      `🎯 TARGET ACHIEVED! Profit: +${currentProfit.toFixed(2)} Ks`);
    
    settings.running = false;
    delete userWaitingForResult[userId];
    delete userShouldSkipNext[userId];
    logging.info(`GEMINI_AI: Profit target reached. Stopping.`);
    return;
  }
  
  const stopLossLimit = settings.stop_loss;
  if (stopLossLimit && currentProfit <= -stopLossLimit) {
    await sendTerminationImage(userId, bot, 'GEMINI AI', 'MAX_LOSSES',
      settings.sniper_hit_count || 0, settings.sniper_loss_count || 0,
      currentProfit, currentBalance, settings.virtual_mode,
      `🛑 STOP LOSS HIT! Loss: ${Math.abs(currentProfit).toFixed(2)} Ks`);
    
    settings.running = false;
    delete userWaitingForResult[userId];
    delete userShouldSkipNext[userId];
    logging.info(`GEMINI_AI: Stop loss reached. Stopping.`);
    return;
  }
  
  logging.info(`GEMINI_AI: ${isWin ? 'WIN' : 'LOSS'} - Hits: ${settings.sniper_hit_count}, Losses: ${settings.sniper_loss_count}`);
}

  
  const targetProfit = settings.target_profit;
  if (targetProfit && currentProfit >= targetProfit) {
    let imageType = 'MISSION_COMPLETE';
    let statusMessage = `🎯 TARGET ACHIEVED! Profit: +${currentProfit.toFixed(2)} Ks`;
    
    if (settings.gpt_ai_state.confidence_score < 5) {
      statusMessage = `🎯 TARGET REACHED (Low Confidence) Profit: +${currentProfit.toFixed(2)} Ks`;
    }
    
    await sendTerminationImage(userId, bot, 'GPT ADAPTIVE AI', imageType,
      settings.sniper_hit_count || 0, 
      settings.sniper_loss_count || 0,
      currentProfit, currentBalance, settings.virtual_mode,
      statusMessage);
    
    settings.running = false;
    delete userWaitingForResult[userId];
    delete userShouldSkipNext[userId];
    logging.info(`GPT_ADAPTIVE_AI: Profit target reached. Stopping.`);
    return;
  }
  
  const stopLossLimit = settings.stop_loss;
  if (stopLossLimit && currentProfit <= -stopLossLimit) {
    let imageType = 'MAX_LOSSES';
    let statusMessage = `🛑 STOP LOSS HIT! Loss: ${Math.abs(currentProfit).toFixed(2)} Ks`;
    
    if (settings.gpt_ai_state.risk_level === 'HIGH') {
      statusMessage = `⚠️ CRITICAL STOP LOSS! Loss: ${Math.abs(currentProfit).toFixed(2)} Ks (High Risk Detected)`;
    }
    
    await sendTerminationImage(userId, bot, 'GPT ADAPTIVE AI', imageType,
      settings.sniper_hit_count || 0, 
      settings.sniper_loss_count || 0,
      currentProfit, currentBalance, settings.virtual_mode,
      statusMessage);
    
    settings.running = false;
    delete userWaitingForResult[userId];
    delete userShouldSkipNext[userId];
    logging.info(`GPT_ADAPTIVE_AI: Stop loss reached. Stopping.`);
    return;
  }
  
  if (settings.sniper_loss_count >= 5) {
    await sendTerminationImage(userId, bot, 'GPT ADAPTIVE AI', 'MAX_LOSSES',
      settings.sniper_hit_count || 0, 
      settings.sniper_loss_count || 0,
      currentProfit, currentBalance, settings.virtual_mode,
      `⚠️ 5 CONSECUTIVE LOSSES! AI Safety Triggered`);
    
    settings.running = false;
    delete userWaitingForResult[userId];
    delete userShouldSkipNext[userId];
    logging.info(`GPT_ADAPTIVE_AI: 5 consecutive losses. Safety stop.`);
    return;
  }
  
  logging.info(`GPT_ADAPTIVE_AI: ${isWin ? 'WIN' : 'LOSS'} - Hits: ${settings.sniper_hit_count}, Losses: ${settings.sniper_loss_count}, Confidence: ${settings.gpt_ai_state.confidence_score}/10, Risk: ${settings.gpt_ai_state.risk_level}`);
}

              if (settings.strategy === "TREND_FOLLOW" && settings.trend_state) {
                settings.trend_state.last_result = bigSmall;
                logging.info(`TREND_FOLLOW strategy: Updated last_result to ${bigSmall}`);
              }
              
              if (betType === "COLOR" && settings.strategy === "TREND_FOLLOW" && settings.color_trend_state) {
                settings.color_trend_state.last_result = color;
                logging.info(`Color TREND_FOLLOW strategy: Updated last_result to ${color}`);
              }
              
              if (settings.strategy === "ALTERNATE" && settings.alternate_state) {
                settings.alternate_state.last_result = bigSmall;
                
                if (settings.alternate_state.skip_mode) {
                  if (isWin) {
                    settings.alternate_state.skip_mode = false;
                    logging.info(`ALTERNATE strategy: Win in skip mode. Resuming normal betting.`);
                  }
                  logging.info(`ALTERNATE strategy: Updated last_result to ${bigSmall} (still in skip mode)`);
                } else {
                  logging.info(`ALTERNATE strategy: Updated last_result to ${bigSmall} (normal mode)`);
                }
              }
              
              const entryLayer = settings.layer_limit || 1;
              
              if (entryLayer === 2) {
                if (!settings.entry_layer_state) {
                  settings.entry_layer_state = { waiting_for_lose: true };
                }
                
                if (settings.entry_layer_state.waiting_for_lose) {
                  if (isWin) {
                    settings.entry_layer_state.waiting_for_lose = true;
                  } else {
                    settings.entry_layer_state.waiting_for_lose = false;
                  }
                }
              } else if (entryLayer === 3) {
                if (!settings.entry_layer_state) {
                  settings.entry_layer_state = { waiting_for_loses: true, consecutive_loses: 0 };
                }
                
                if (settings.entry_layer_state.waiting_for_loses) {
                  if (isWin) {
                    settings.entry_layer_state.waiting_for_loses = true;
                    settings.entry_layer_state.consecutive_loses = 0;
                  } else {
                    settings.entry_layer_state.consecutive_loses++;
                    
                    if (settings.entry_layer_state.consecutive_loses >= 2) {
                      settings.entry_layer_state.waiting_for_loses = false;
                    }
                  }
                }
              }
              
              if (settings.sl_layer && settings.sl_layer > 0) {
                if (isWin) {
                  settings.consecutive_losses = 0;
                  userShouldSkipNext[userId] = false;
                  
                  if (userSLSkipWaitingForWin[userId]) {
                    delete userSLSkipWaitingForWin[userId];
                    logging.info(`SL Layer: Got win after skip, resetting SL state for user ${userId}`);
                  }
                  
                  updateBettingStrategy(settings, true, amount);
                } else {
                  settings.consecutive_losses = (settings.consecutive_losses || 0) + 1;
                  logging.info(`SL Layer: Consecutive losses increased to ${settings.consecutive_losses}/${settings.sl_layer}`);
                  
                  updateBettingStrategy(settings, false, amount);
                  
                  if (settings.consecutive_losses >= settings.sl_layer) {
                    const bettingStrategy = settings.betting_strategy || "Martingale";
                    if (bettingStrategy === "Martingale" || bettingStrategy === "Anti-Martingale") {
                      settings.original_martin_index = settings.martin_index || 0;
                    } else if (bettingStrategy === "D'Alembert") {
                      settings.original_dalembert_units = settings.dalembert_units ||1;
                    } else if (bettingStrategy === "Custom") {
                      settings.original_custom_index = settings.custom_index || 0;
                    }
                    
                    settings.skip_betting = true;
                    userShouldSkipNext[userId] = true;
                    userSLSkipWaitingForWin[userId] = true;
                    logging.warning(`SL Layer triggered! Skipping next bet after ${settings.consecutive_losses} consecutive losses.`);
                  }
                }
              } else {
                updateBettingStrategy(settings, isWin, amount);
              }
              
              if (isVirtual) {
                if (!userStats[userId].virtual_balance) {
                  userStats[userId].virtual_balance = settings.virtual_balance || 0;
                }
                
                if (isWin) {
                  userStats[userId].virtual_balance += amount * 0.96;
                } else {
                  userStats[userId].virtual_balance -= amount;
                }
              } else {
                if (userStats[userId] && amount > 0) {
                  if (isWin) {
                    const profitChange = amount * 0.96;
                    userStats[userId].profit += profitChange;
                  } else {
                    userStats[userId].profit -= amount;
                  }
                }
              }
              
              const currentBalance = isVirtual 
                ? userStats[userId].virtual_balance 
                : await getBalance(session, parseInt(userId));
              
              const botStopped = await checkProfitAndStopLoss(userId, bot);
              
              if (!userStats[userId]) {
                userStats[userId] = {
                  start_balance: 0,
                  profit: 0,
                  virtual_balance: settings.virtual_mode ? (settings.virtual_balance || 0) : 0,
                  initial_balance: settings.virtual_mode ? (settings.virtual_balance || 0) : 0
                };
              }

              let resultText;
              if (betType === "COLOR") {
                resultText = `${EMOJI.RESULT} ရလဒ်: ${number} → ${getColorName(color)} (${bigSmall === 'B' ? 'Big' : 'Small'})`;
              } else {
                resultText = `${EMOJI.RESULT} ရလဒ်: ${number} → ${bigSmall === 'B' ? 'Big' : 'Small'}`;
              }
              
              const gameId = `${EMOJI.GAME} ${escapeMarkdown(gameType)} : ${period}`;
              
              let message;
              if (isWin) {
                const winAmount = amount * 0.96;
                const totalProfit = isVirtual 
                  ? (userStats[userId].virtual_balance - (userStats[userId].initial_balance || 0))
                  : (userStats[userId]?.profit || 0);
                message = `${EMOJI.WIN} ${STYLE.BOLD('အနိုင်ရရှိသည်')} +${winAmount.toFixed(2)} Ks\n` +
                         `${STYLE.SEPARATOR}\n`+
                         `${gameId}\n` +
                         `${resultText}\n` +
                         `${EMOJI.BALANCE} လက်ကျန်ငွေ ${currentBalance?.toFixed(2) || '0.00'} Ks\n` +
                         `${EMOJI.PROFIT} Total Profit: ${totalProfit >= 0 ? '+' : ''}${totalProfit.toFixed(2)} Ks`;
              } else {
                const totalProfit = isVirtual 
                  ? (userStats[userId].virtual_balance - (userStats[userId].initial_balance || 0))
                  : (userStats[userId]?.profit || 0);
                const consecutiveLosses = settings.consecutive_losses || 0;
                
                let slStatusLine = '';
                if (settings.sl_layer) {
                  slStatusLine = `${EMOJI.WARNING} Consecutive Losses: ${consecutiveLosses}/${settings.sl_layer}\n`;
                }
                
                message = `${EMOJI.LOSS} ${STYLE.BOLD('ရှုံးပါတယ်')} -${amount} Ks\n` +
                         `${STYLE.SEPARATOR}\n`+
                         `${gameId}\n` +
                         `${resultText}\n` +
                         `${slStatusLine}` +
                         `${EMOJI.BALANCE} လက်ကျန်ငွေ: ${currentBalance?.toFixed(2) || '0.00'} Ks\n` +
                         `${EMOJI.LOSS_ICON} Total Profit: ${totalProfit >= 0 ? '+' : ''}${totalProfit.toFixed(2)} Ks`;
              }
              
              try {
                await bot.telegram.sendMessage(userId, message, { parse_mode: 'Markdown' });
                
                if (settings.profit_target_reached && settings.profit_target_message) {
                  await bot.telegram.sendMessage(userId, settings.profit_target_message, { 
                    parse_mode: 'Markdown',
                    ...makeMainKeyboard(true)
                  });
                  settings.profit_target_reached = false;
                  settings.profit_target_message = null;
                  userStopInitiated[userId] = true;
                }
                
                if (settings.stop_loss_reached && settings.stop_loss_message) {
                  await bot.telegram.sendMessage(userId, settings.stop_loss_message, { 
                    parse_mode: 'Markdown',
                    ...makeMainKeyboard(true)
                  });
                  settings.stop_loss_reached = false;
                  settings.stop_loss_message = null;
                  userStopInitiated[userId] = true;
                }
              } catch (error) {
                logging.error(`Failed to send result to ${userId}: ${error.message}`);
              }
              
              delete userPendingBets[userId][period];
              if (Object.keys(userPendingBets[userId]).length === 0) {
                delete userPendingBets[userId];
              }
              userWaitingForResult[userId] = false;
            }
          }
        }
        
        if (userSkippedBets[userId]) {
          if (!userStats[userId]) {
            userStats[userId] = {
              start_balance: 0,
              profit: 0,
              virtual_balance: settings.virtual_mode ? (settings.virtual_balance || 0) : 0,
              initial_balance: settings.virtual_mode ? (settings.virtual_balance || 0) : 0
            };
          }

          for (const [period, betInfo] of Object.entries(userSkippedBets[userId])) {
            const settled = data.find(item => item.issueNumber === period);
            if (settled && settled.number) {
              if (gameType === "WINGO_30S" || gameType === "WINGO_3MIN" || gameType === "WINGO_5MIN") {
                logging.debug(`${gameType}: Found result for skipped period ${period}: ${settled.number}`);
              }
              
              const [betChoice, isVirtual] = betInfo;
              const number = parseInt(settled.number || "0") % 10;
              const bigSmall = number >= 5 ? "B" : "S";
              const color = numberToColor(number);
              
              let isWin;
              if (betType === "COLOR") {
                isWin = betChoice === color;
              } else {
                isWin = (betChoice === "B" && bigSmall === "B") || (betChoice === "S" && bigSmall === "S");
              }
              
              if (!userLastResults[userId]) {
                userLastResults[userId] = [];
              }
              userLastResults[userId].push(number.toString());
              if (userLastResults[userId].length > 10) {
                userLastResults[userId] = userLastResults[userId].slice(-10);
              }
              
              if (!userAllResults[userId]) {
                userAllResults[userId] = [];
              }
              userAllResults[userId].push(bigSmall);
              if (userAllResults[userId].length > 20) {
                userAllResults[userId] = userAllResults[userId].slice(-20);
              }
              
              // AI Mode အတွက် recent_results update (skip bets အတွက်ပါ)
              if (!userStats[userId].recent_results) {
                userStats[userId].recent_results = [];
              }
              
              userStats[userId].recent_results.push(isWin ? 'WIN' : 'LOSS');
              if (userStats[userId].recent_results.length > 20) {
                userStats[userId].recent_results = userStats[userId].recent_results.slice(-20);
              }
              
              if (settings.strategy === "TREND_FOLLOW" && settings.trend_state) {
                settings.trend_state.last_result = bigSmall;
                
                if (settings.trend_state.skip_mode) {
                  if (isWin) {
                    settings.trend_state.skip_mode = false;
                    logging.info(`TREND_FOLLOW strategy: Win in skip mode. Resuming normal betting.`);
                  }
                  logging.info(`TREND_FOLLOW strategy: Updated last_result to ${bigSmall}`);
                }
              }
              
              if (betType === "COLOR" && settings.strategy === "TREND_FOLLOW" && settings.color_trend_state) {
                settings.color_trend_state.last_result = color;
                logging.info(`Color TREND_FOLLOW strategy: Updated last_result to ${color}`);
              }
              
              if (settings.strategy === "ALTERNATE" && settings.alternate_state) {
                settings.alternate_state.last_result = bigSmall;
                
                if (settings.alternate_state.skip_mode) {
                  if (isWin) {
                    settings.alternate_state.skip_mode = false;
                    logging.info(`ALTERNATE strategy: Win in skip mode. Resuming normal betting.`);
                  }
                  logging.info(`ALTERNATE strategy: Updated last_result to ${bigSmall} (still in skip mode)`);
                } else {
                  logging.info(`ALTERNATE strategy: Updated last_result to ${bigSmall} (normal mode)`);
                }
              }
              
              const entryLayer = settings.layer_limit || 1;
              
              if (entryLayer === 2) {
                 if (!settings.entry_layer_state) {
                    settings.entry_layer_state = { waiting_for_lose: true };
                 }
                 
                 if (settings.entry_layer_state.waiting_for_lose) {
                    if (isWin) {
                       settings.entry_layer_state.waiting_for_lose = true;
                    } else {
                       settings.entry_layer_state.waiting_for_lose = false;
                    }
                 }
              } else if (entryLayer === 3) {
                 if (!settings.entry_layer_state) {
                    settings.entry_layer_state = { waiting_for_loses: true, consecutive_loses: 0 };
                 }
                 
                 if (settings.entry_layer_state.waiting_for_loses) {
                    if (isWin) {
                       settings.entry_layer_state.waiting_for_loses = true;
                       settings.entry_layer_state.consecutive_loses = 0;
                    } else {
                       settings.entry_layer_state.consecutive_loses++;
                       if (settings.entry_layer_state.consecutive_loses >= 2) {
                          settings.entry_layer_state.waiting_for_loses = false;
                       }
                    }
                 }
              }
              
              if (settings.sl_layer && settings.sl_layer > 0 && userSLSkipWaitingForWin[userId] && isWin) {
                userShouldSkipNext[userId] = false;
                settings.skip_betting = false;
                settings.consecutive_losses = 0;
                delete userSLSkipWaitingForWin[userId];
                
                const bettingStrategy = settings.betting_strategy || "Martingale";
                if (bettingStrategy === "Martingale" || bettingStrategy === "Anti-Martingale") {
                  settings.martin_index = settings.original_martin_index || 0;
                } else if (bettingStrategy === "D'Alembert") {
                  settings.dalembert_units = settings.original_dalembert_units ||1;
                } else if (bettingStrategy === "Custom") {
                  settings.custom_index = settings.original_custom_index || 0;
                }
                
                logging.info(`SL Layer: Skip win achieved! Resetting SL state and continuing with normal betting for user ${userId}`);
              }
              
              const currentBalance = isVirtual 
                ? userStats[userId].virtual_balance 
                : await getBalance(session, parseInt(userId));
              const totalProfit = isVirtual 
                ? (userStats[userId].virtual_balance - (userStats[userId].initial_balance || 0))
                : (userStats[userId]?.profit || 0);
              
              let resultText;
              if (betType === "COLOR") {
                resultText = `${EMOJI.RESULT} ရလဒ်: ${number} → ${getColorName(color)} (${bigSmall === 'B' ? 'Big' : 'Small'})`;
              } else {
                resultText = `${EMOJI.RESULT} ရလဒ်: ${number} → ${bigSmall === 'B' ? 'Big' : 'Small'}`;
              }
              
              const gameId = `${EMOJI.GAME} ${escapeMarkdown(gameType)} : ${period}`;
              
              if (entryLayer === 1) {
                let bsWaitStatus = "";
                if (settings.strategy === "TREND_FOLLOW" && settings.trend_state && settings.trend_state.skip_mode) {
                  bsWaitStatus = isWin ? `\n${EMOJI.SUCCESS} BS/SB Wait: Win detected, resuming normal betting` : `\n${EMOJI.WAIT} BS/SB Wait: Continue skipping until win`;
                }
                
                let bbWaitStatus = "";
                if (settings.strategy === "ALTERNATE" && settings.alternate_state && settings.alternate_state.skip_mode) {
                  bbWaitStatus = isWin ? `\n${EMOJI.SUCCESS} BB/SS Wait: Win detected, resuming normal betting` : `\n${EMOJI.WAIT} BB/SS Wait: Continue skipping until win`;
                }
                
                const resultMessage = isWin ? 
                  `${EMOJI.LOSS} ${STYLE.BOLD('RESULT')}\n` +
                  `${STYLE.SEPARATOR}\n`+
                  `${gameId}\n` +
                  `${resultText}\n` +
                  `${EMOJI.BALANCE} Balance: ${currentBalance?.toFixed(2) || '0.00'} Ks\n` +
                  `${EMOJI.PROFIT} Total Profit: ${totalProfit >= 0 ? '+' : ''}${totalProfit.toFixed(2)} Ks${bsWaitStatus}${bbWaitStatus}` :
                  `${EMOJI.LOSS} ${STYLE.BOLD('RESULT')}\n` +
                  `${STYLE.SEPARATOR}\n`+
                  `${gameId}\n` +
                  `${resultText}\n` +
                  `${EMOJI.BALANCE} Balance: ${currentBalance?.toFixed(2) || '0.00'} Ks\n` +
                  `${EMOJI.LOSS_ICON} Total Profit: ${totalProfit >= 0 ? '+' : ''}${totalProfit.toFixed(2)} Ks${bsWaitStatus}${bbWaitStatus}`;
                
                try {
                  await bot.telegram.sendMessage(userId, resultMessage, { parse_mode: 'Markdown' });
                } catch (error) {
                  logging.error(`Failed to send virtual result to ${userId}: ${error.message}`);
                }
              } else {

                 const resultMessage = isWin ? 
                  `${EMOJI.LOSS} ${STYLE.BOLD('RESULT')}\n` +
                  `${STYLE.SEPARATOR}\n`+
                  `${gameId}\n` +
                  `${resultText}\n` +
                  `${EMOJI.BALANCE} Balance: ${currentBalance?.toFixed(2) || '0.00'} Ks` :
                  `${EMOJI.LOSS} ${STYLE.BOLD('RESULT')}\n` +
                  `${STYLE.SEPARATOR}\n`+
                  `${gameId}\n` +
                  `${resultText}\n` +
                  `${EMOJI.BALANCE} Balance: ${currentBalance?.toFixed(2) || '0.00'} Ks`;
                  
                  try {
                    await bot.telegram.sendMessage(userId, resultMessage, { parse_mode: 'Markdown' });
                  } catch (error) {
                    logging.error(`Failed to send virtual result to ${userId}: ${error.message}`);
                  }
              }
              
              delete userSkippedBets[userId][period];
              if (Object.keys(userSkippedBets[userId]).length === 0) {
                delete userSkippedBets[userId];
              }
              
              if (userSkipResultWait[userId] === period) {
                delete userSkipResultWait[userId];
              }
            }
          }
        }
      }
      await new Promise(resolve => setTimeout(resolve, WIN_LOSE_CHECK_INTERVAL * 1000));
    } catch (error) {
      logging.error(`Win/lose checker error: ${error.message}`);
      await new Promise(resolve => setTimeout(resolve, 10000));
    }
  }
}

function getBetIndexEmoji(settings) {
  const bettingStrategy = settings.betting_strategy || "Martingale";
  let betIndex = 0;
  
  if (bettingStrategy === "Martingale" || bettingStrategy === "Anti-Martingale") {
    betIndex = settings.martin_index || 0;
  } else if (bettingStrategy === "Custom") {
    betIndex = settings.custom_index || 0;
  } else if (bettingStrategy === "D'Alembert") {
    betIndex = (settings.dalembert_units ||1) - 1;
  }
  
  return betIndex === 0 ? "🔺" : "🔻";
}

async function createResultImage(type, amount, balance, isVirtual, currentProfit, userId) {
  const profitImgUrl = 'https://repgyetdcodkynrbxocg.supabase.co/storage/v1/object/public/images/telegram-1772296579671-75569e89.jpg'; 
  const lossImgUrl = 'https://repgyetdcodkynrbxocg.supabase.co/storage/v1/object/public/images/telegram-1772296568783-ca7b29af.jpg';   

  const bgImageUrl = (type === 'PROFIT') ? profitImgUrl : lossImgUrl;

  let backgroundImage;
  try {
    console.log(`Loading background template for ${type}...`);
    backgroundImage = await loadImage(bgImageUrl);
  } catch (error) {
    console.error("Error loading template image:", error);
    throw new Error("Failed to load template image");
  }

  const canvas = createCanvas(1200, 800); 
  const ctx = canvas.getContext('2d');

  ctx.drawImage(backgroundImage, 0, 0, 1200, 800);

  const formatNum = (num) => {
    return Number(num).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const startedAmount = balance - currentProfit;

  ctx.save();
  ctx.textAlign = 'center';  
  ctx.textBaseline = 'middle';
  
  ctx.font = 'bold 30px "Arial Black", sans-serif'; 
  
  const amountColor = '#FFD700';
  const profitColor = currentProfit > 0 ? '#00FF00' : '#FF3333';
  const balanceColor = '#FFD700';

  const rightX = 960;

  ctx.fillStyle = amountColor;
  ctx.shadowColor = '#000000'; ctx.shadowBlur = 5; 
  ctx.fillText(`${formatNum(startedAmount)} Ks`, rightX, 200); 

  ctx.fillStyle = profitColor;
  const profitSign = currentProfit > 0 ? '+' : ''; 
  ctx.fillText(`${profitSign}${formatNum(currentProfit)} Ks`, rightX, 440); 

  ctx.fillStyle = balanceColor;
  ctx.fillText(`${formatNum(balance)} Ks`, rightX, 680); 

  ctx.restore();

  const imagePath = path.join(__dirname, `result_${type.toLowerCase()}_${userId}_${Date.now()}.png`);
  const out = fs.createWriteStream(imagePath);
  const stream = canvas.createPNGStream();
  stream.pipe(out);
  
  return new Promise((resolve, reject) => {
    out.on('finish', () => resolve(imagePath));
    out.on('error', reject);
  });
}

async function bettingWorker(userId, ctx, bot) {
  const settings = userSettings[userId] || {};
  let session = userSessions[userId];
  ensureUserStatsInitialized(userId);

  if (!settings || !session) {
    await sendMessageWithRetry(ctx, `${EMOJI.ERROR} Please login first`, makeMainKeyboard(false));
    settings.running = false;
    return;
  }
  
  if (!userStats[userId]) {
    if (settings.virtual_mode) {
      userStats[userId] = { 
        virtual_balance: settings.virtual_balance || 0,
        initial_balance: settings.virtual_balance || 0,
        recent_results: []
      };
    } else {
      userStats[userId] = { start_balance: 0.0, profit: 0.0, recent_results: [] };
    }
  }
  
  settings.running = true;
  settings.last_issue = null;
  settings.consecutive_errors = 0;
  settings.consecutive_losses = 0;
  settings.current_layer = 0;
  settings.skip_betting = false;
  settings.rounds_played = settings.rounds_played || 0;
  
  // AI Mode State ရှိမရှိစစ်ပြီး မရှိရင် initialize လုပ်
  if (!settings.ai_mode) {
    settings.ai_mode = {
      enabled: false,
      level: "SMART",
      current_strategy: null,
      base_bet_percent: 1.2,
      max_drawdown: 15,
      soft_drawdown: 8,
      last_switch_round: 0,
      pause_until: null
    };
  }
  
  if (settings.strategy === "CYBER_SNIPER") {
    settings.cyber_sniper_state = {
      active: false,
      direction: null,
      sequence: [],
      step: 0,
      hit_count: 0,
      got_same_result: false
    };
    userLastResults[userId] = [];
    logging.info(`CYBER_SNIPER initialized`);
  }

  if (settings.strategy === "COLOR_SNIPER") {
    settings.color_sniper_state = {
      active: false,
      step: 0,
      hit_count: 0,
      waiting_for_trigger: true
    };
    userLastResults[userId] = []; 
    logging.info(`COLOR_SNIPER initialized`);
  }

  if (settings.strategy === "TIME_WARP") {
    if (!settings.time_warp_pos) settings.time_warp_pos = 8;
    logging.info(`TIME_WARP initialized at pos ${settings.time_warp_pos}`);
  }
  
  if (settings.strategy === "ULTRA_SNIPER") {
  settings.ultra_sniper_state = { active: false, step: 0, direction: null, betCount: 0 };
  userLastResults[userId] = [];
  logging.info(`ULTRA_SNIPER initialized`);
}

if (settings.strategy === "CHAOS_SEEKER") {
  settings.chaos_seeker_state = { active: false, triggerPattern: null, betCount: 0, multiplier: 1 };
  logging.info(`CHAOS_SEEKER initialized`);
}

if (settings.strategy === "TERMINATOR") {
  settings.terminator_state = { active: true, consecutiveLosses: 0 };
  logging.info(`TERMINATOR initialized`);
}

if (settings.strategy === "PYRO_TECH") {
  settings.pyro_state = { active: false, step: 0, direction: null, betCount: 0 };
  userLastResults[userId] = [];
  logging.info(`PYRO_TECH initialized`);
}
  
if (["CYBER_SNIPER", "COLOR_SNIPER", "ULTRA_SNIPER", "CHAOS_SEEKER"].includes(settings.strategy)) {
  settings.sniper_hit_count = 0;
  settings.sniper_loss_count = 0;  
  logging.info(`Reset sniper counters for ${settings.strategy} - Hits: 0/${SNIPER_MAX_HITS}, Losses: 0/${SNIPER_MAX_LOSSES}`);
}
  
  if (settings.strategy === "BS_ORDER") {
    settings.pattern_index = 0; 
    logging.info(`BS_ORDER: Reset pattern index to 0 for user ${userId}`);
  }
  
  if (settings.original_martin_index === undefined) {
    settings.original_martin_index = 0;
  }
  if (settings.original_dalembert_units === undefined) {
    settings.original_dalembert_units = 1;
  }
  if (settings.original_custom_index === undefined) {
    settings.original_custom_index = 0;
  }
  
  userShouldSkipNext[userId] = false;
  delete userSLSkipWaitingForWin[userId];
  
  const entryLayer = settings.layer_limit || 1;
  const betType = settings.bet_type || "BS"; 
  
  if (entryLayer === 2) {
    settings.entry_layer_state = { waiting_for_lose: true };
  } else if (entryLayer === 3) {
    settings.entry_layer_state = { waiting_for_loses: true, consecutive_loses: 0 };
  }
  
  if (settings.strategy === "TREND_FOLLOW") {
    settings.trend_state = {
      last_result: null,
      skip_mode: false
    };
    logging.info(`TREND_FOLLOW strategy initialized for user ${userId}`);
  }
  
  if (betType === "COLOR" && settings.strategy === "TREND_FOLLOW") {
    settings.color_trend_state = {
      last_result: null
    };
    logging.info(`Color TREND_FOLLOW strategy initialized for user ${userId}`);
  }
  
  if (settings.strategy === "ALTERNATE") {
    settings.alternate_state = {
      last_result: null,
      skip_mode: false
    };
    logging.info(`ALTERNATE strategy initialized for user ${userId}`);
  }
  
  if (settings.strategy === "BS_ORDER") {
    if (!settings.pattern || settings.pattern.length === 0) {
      settings.pattern = DEFAULT_BS_ORDER;
      settings.pattern_index = 0;
      await sendMessageWithRetry(ctx, 
        `${EMOJI.INFO} No BS pattern found, using default: ${DEFAULT_BS_ORDER}`, 
        makeMainKeyboard(true)
      );
    } else {
      const pattern = settings.pattern;
      if (!pattern.split('').every(c => c === 'B' || c === 'S')) {
        await sendMessageWithRetry(ctx, 
          `${EMOJI.ERROR} Invalid BS pattern! Using default pattern instead.`, 
          makeMainKeyboard(true)
        );
        settings.pattern = DEFAULT_BS_ORDER;
        settings.pattern_index = 0;
      }
    }
    
    settings.pattern_index = 0;
    
    const pattern = settings.pattern;
    const firstBet = pattern && pattern.length > 0 ? pattern[0] : 'B';
    
    await sendMessageWithRetry(ctx, 
      `${EMOJI.PATTERN} ${STYLE.BOLD('BS ORDER Strategy Active')}\n` +
      `${STYLE.ITEM(`Pattern: ${pattern}`)}\n` +
      `${STYLE.ITEM(`Length: ${pattern.length}`)}\n` +
      `${STYLE.LAST_ITEM(`First bet will be: ${firstBet === 'B' ? 'BIG' : 'SMALL'}`)}`
    );
    
    logging.info(`BS_ORDER strategy initialized for user ${userId}, Pattern: ${settings.pattern}, Index: 0`);
  }
  
  if (!userLastResults[userId]) {
    userLastResults[userId] = [];
  }
  
  let currentBalance = null;
  if (settings.virtual_mode) {
    currentBalance = userStats[userId].virtual_balance || settings.virtual_balance || 0;
  } else {
    let balanceRetrieved = false;
    for (let attempt = 0; attempt < MAX_BALANCE_RETRIES; attempt++) {
      try {
        const balanceResult = await getBalance(session, parseInt(userId));
        if (balanceResult !== null) {
          currentBalance = balanceResult;
          userStats[userId].start_balance = currentBalance;
          balanceRetrieved = true;
          break;
        }
      } catch (error) {
        logging.error(`Balance check attempt ${attempt + 1} failed: ${error.message}`);
      }
      
      if (attempt < MAX_BALANCE_RETRIES - 1) {
        await new Promise(resolve => setTimeout(resolve, BALANCE_RETRY_DELAY * 1000));
      }
    }
    
    if (!balanceRetrieved) {
      await sendMessageWithRetry(ctx, `${EMOJI.ERROR} Failed to check balance. Please try again.`, makeMainKeyboard(true));
      settings.running = false;
      return;
    }
  }
  
  const safeEscape = (text) => {
    if (text === null || text === undefined) return '';
    return String(text).replace(/[*_`\\[\]()~>#+\-=|{}.!]/g, '\\$&');
  };
  
    let strategyText = settings.strategy === "TREND_FOLLOW" ? "Trend Follow" :
                     settings.strategy === "ALTERNATE" ? "Alternate" :
                     settings.strategy === "BS_ORDER" ? "Bs Order" : 
                     settings.strategy === "CYBER_SNIPER" ? "Cyber Sniper" :
                     settings.strategy === "QUANTUM_CALC" ? "Quantum Calc" :
                     settings.strategy === "TIME_WARP" ? "Time Warp" :
                     settings.strategy === "COLOR_SNIPER" ? "Color Sniper" :
                     settings.strategy === "ULTRA_SNIPER" ? "Ultra Sniper" :
                     settings.strategy === "CHAOS_SEEKER" ? "Chaos Seeker" :
                     settings.strategy === "GEMINI_AI" ? "Gemini AI" :
                     safeEscape(settings.strategy);


  if (settings.strategy === "TREND_FOLLOW") {
    const bsWaitCount = settings.bs_sb_wait_count || 0;
    if (bsWaitCount > 0) {
      strategyText += ` (BS/SB Wait: ${bsWaitCount})`;
    }
  }
  
  if (settings.strategy === "ALTERNATE") {
    const bbWaitCount = settings.bb_ss_wait_count || 0;
    if (bbWaitCount > 0) {
      strategyText += ` (BB/SS Wait: ${bbWaitCount})`;
    }
  }

  const bettingStrategyText = settings.betting_strategy === "Martingale" ? "Martingale" :
                            settings.betting_strategy === "Anti-Martingale" ? "Anti-Martingale" :
                            settings.betting_strategy === "D'Alembert" ? "D'Alembert" :
                            settings.betting_strategy === "Custom" ? "Custom" : safeEscape(settings.betting_strategy);

  const profitTargetText = settings.target_profit ? `${settings.target_profit} Ks` : "Not Set";
  const stopLossText = settings.stop_loss ? `${settings.stop_loss} Ks` : "Not Set";
  const gameType = settings.game_type || "TRX";

  const startMessage = 
    `${EMOJI.START} *Bot စတင်အလုပ်လုပ်ပြီ*\n` +
    `${STYLE.SEPARATOR}\n\n` +
    `${EMOJI.BALANCE} လက်ကျန်ငွေ : ${currentBalance} Ks\n\n` +
    `${EMOJI.GAME} ဂိမ်း: ${safeEscape(gameType)}\n` +
    `${EMOJI.MODE} အမျိုးအစား: ${betType === "COLOR" ? "Color" : "Big/Small"}\n` +
    `${EMOJI.STRATEGY} နည်းဗျူဟာ: ${(strategyText)}\n` +
    `${EMOJI.SETTINGS} မုဒ်: ${safeEscape(bettingStrategyText)}\n\n` +
    `${EMOJI.TARGET} Target: ${safeEscape(profitTargetText)}\n` +
    `${EMOJI.STOP} Stop Loss: ${safeEscape(stopLossText)}\n\n` +
    `${STYLE.SEPARATOR}\n` +
    `${EMOJI.LOADING} Starting betting sequence...`;

  await sendMessageWithRetry(ctx, startMessage);
  
  try {
    while (settings.running) {
      if (userWaitingForResult[userId]) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        continue;
      }
      
      if (userSkipResultWait[userId]) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        continue;
      }
      
      if (settings.virtual_mode) {
        currentBalance = userStats[userId].virtual_balance || settings.virtual_balance || 0;
      } else {
        try {
          const balanceResult = await getBalance(session, parseInt(userId));
          if (balanceResult !== null) {
            currentBalance = balanceResult;
          }
        } catch (error) {
          logging.error(`Balance check failed: ${error.message}`);
        }
      }
      
      if (currentBalance === null) {
        logging.error(`Current balance is null for user ${userId}`);
        await sendMessageWithRetry(ctx, `${EMOJI.ERROR} Failed to recover balance. Stopping...`, makeMainKeyboard(true));
        settings.running = false;
        break;
      }
      
      // AI Mode Controller ကိုခေါ်ပါ
      // AI Mode Controller ကိုခေါ်ပါ
if (settings.ai_mode && settings.ai_mode.enabled) {
  const aiResult = await aiModeController(userId, ctx, bot, currentBalance);
  
  if (!aiResult.shouldProceed) {
    await new Promise(resolve => setTimeout(resolve, 5000));
    continue;
  }
  
  if (aiResult.strategy) {
    settings.strategy = aiResult.strategy;
  }
  
  // ⚠️ AI က bet size သတ်မှတ်ရင် bet_sizes ကိုပြောင်းမယ့်အစား
  // current bet amount ကိုပဲ သိမ်းမယ်
  if (aiResult.betAmount) {
    settings.ai_bet_amount = aiResult.betAmount; // ဒီလိုမျိုး သပ်သပ်သိမ်းမယ်
  }
}

// Bet amount တွက်ချက်တဲ့အခါ
let desiredAmount;
if (settings.ai_mode?.enabled && settings.ai_bet_amount) {
  desiredAmount = settings.ai_bet_amount; // AI က သတ်မှတ်တဲ့ငွေကိုသုံးမယ်
} else {
  desiredAmount = calculateBetAmount(settings, currentBalance);
}
      
      const betSizes = settings.bet_sizes || [];
      if (!betSizes.length) {
        await sendMessageWithRetry(ctx, `${EMOJI.ERROR} Bet sizes not set. Please configure first.`);
        settings.running = false;
        break;
      }
      
      const minBetSize = Math.min(...betSizes);
      if (currentBalance < minBetSize) {
        const message = `${EMOJI.WARNING} ${STYLE.BOLD('Low Balance!')}\n` +
                        `${STYLE.SEPARATOR}\n` +
                        `${STYLE.ITEM(`Current: ${currentBalance.toFixed(2)} Ks`)}\n` +
                        `${STYLE.LAST_ITEM(`Minimum: ${minBetSize} Ks`)}`;
        await sendMessageWithRetry(ctx, message, makeMainKeyboard(true));
        settings.running = false;
        break;
      }
      
      const balanceWarningThreshold = minBetSize * 3;
      const now = Date.now();
      const lastWarning = userBalanceWarnings[userId] || 0;
      
      if (currentBalance < balanceWarningThreshold && currentBalance >= minBetSize && (now - lastWarning > 60000)) {
        const warningMessage = `${EMOJI.WARNING} ${STYLE.BOLD('Balance Warning!')}\n` +
                              `${STYLE.SEPARATOR}\n` +
                              `${STYLE.ITEM(`Current: ${currentBalance.toFixed(2)} Ks`)}\n` +
                              `${STYLE.LAST_ITEM(`Minimum: ${minBetSize} Ks`)}`;
        await sendMessageWithRetry(ctx, warningMessage);
        userBalanceWarnings[userId] = now;
      }
      
      let issueRes;
      try {
        issueRes = await getGameIssueRequest(session, gameType);
        if (!issueRes || issueRes.code !== 0) {
          settings.consecutive_errors++;
          if (settings.consecutive_errors >= MAX_CONSECUTIVE_ERRORS) {
            await sendMessageWithRetry(ctx, `${EMOJI.ERROR} Too many errors. Stopping.`);
            settings.running = false;
            break;
          }
          await new Promise(resolve => setTimeout(resolve, 2000));
          continue;
        }
      } catch (error) {
        logging.error(`Error getting issue: ${error.message}`);
        settings.consecutive_errors++;
        if (settings.consecutive_errors >= MAX_CONSECUTIVE_ERRORS) {
          await sendMessageWithRetry(ctx, `${EMOJI.ERROR} Too many errors. Stopping.`);
          settings.running = false;
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 2000));
        continue;
      }
      
      settings.consecutive_errors = 0;
      
      let currentIssue;
      const data = issueRes.data || {};
      
      if (gameType === "TRX") {
        currentIssue = data.predraw?.issueNumber;
      } else {
        currentIssue = data.issueNumber; 
      }
      
      if (!currentIssue || currentIssue === settings.last_issue) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        continue;
      }
      
      let ch;
      let shouldSkip = false;
      let skipReason = "";
      
      
      if (settings.strategy === "CYBER_SNIPER") {
  const prediction = getCyberSniperPrediction(userId);
  ch = prediction.choice;
  shouldSkip = prediction.shouldSkip;
  if (shouldSkip) skipReason = "(Waiting for 0 or 9)";
} 
else if (settings.strategy === "ULTRA_SNIPER") {
  const prediction = getUltraSniperPrediction(userId);
  ch = prediction.choice;
  shouldSkip = prediction.shouldSkip;
  if (shouldSkip) skipReason = "(Waiting for 0 or 9)";
}
else if (settings.strategy === "CHAOS_SEEKER") {
  const prediction = getChaosSeekerPrediction(userId);
  ch = prediction.choice;
  shouldSkip = prediction.shouldSkip;
  if (shouldSkip) skipReason = "(Waiting for pattern)";
}
else if (settings.strategy === "TERMINATOR") {
  const prediction = getTerminatorPrediction(userId);
  ch = prediction.choice;
  shouldSkip = prediction.shouldSkip;
  if (shouldSkip) skipReason = "(Waiting for BBB/SSS)";
}
else if (settings.strategy === "NEURAL_NET") {
  const prediction = getNeuralNetPrediction(userId);
  ch = prediction.choice;
  shouldSkip = false;
}
else if (settings.strategy === "PYRO_TECH") {
  const prediction = getPyroTechPrediction(userId);
  ch = prediction.choice;
  shouldSkip = prediction.shouldSkip;
  if (shouldSkip) skipReason = "(Waiting for 0 or 9)";
}
else if (settings.strategy === "TSUNAMI") {
  const prediction = getTsunamiPrediction(userId);
  ch = prediction.choice;
  shouldSkip = false;
}
else if (settings.strategy === "MAGE") {
  const prediction = getMagePrediction(userId);
  ch = prediction.choice;
  shouldSkip = false;
}
else if (settings.strategy === "REAPER") {
  ch = getReaperPrediction(userId).choice;
  shouldSkip = false;
}
else if (settings.strategy === "DEEPSEEK_PREDICTOR") {
  const prediction = getDeepSeekPredictorPrediction(userId);
  ch = prediction.choice;
  shouldSkip = prediction.shouldSkip;
}
else if (settings.strategy === "DEEPSEEK_NEURAL") {
  const prediction = getDeepSeekNeuralPrediction(userId);
  ch = prediction.choice;
  shouldSkip = prediction.shouldSkip;
}
else if (settings.strategy === "DEEPSEEK_ADAPTIVE") {
  const prediction = getDeepSeekAdaptivePrediction(userId);
  ch = prediction.choice;
  shouldSkip = prediction.shouldSkip;
}
else if (settings.strategy === "GPT_ADAPTIVE_AI") {
  const prediction = getGPTAdaptiveAIPrediction(userId);
  ch = prediction.choice;
  shouldSkip = prediction.shouldSkip;
  if (shouldSkip) skipReason = "(GPT AI: Risk detected - Skipping)";
}
else if (settings.strategy === "GROK_AI") {
  const prediction = getGrokAIPrediction(userId);
  ch = prediction.choice;
  shouldSkip = prediction.shouldSkip;
  if (shouldSkip) skipReason = "(GROK AI: Market too chaotic - waiting)";
}
else if (settings.strategy === "GEMINI_AI") {
  const prediction = getGeminiAIPrediction(userId);
  ch = prediction.choice;
  shouldSkip = prediction.shouldSkip;
  if (shouldSkip) skipReason = "(GEMINI AI: Unstable Pattern - Skipping)";
}

      else if (settings.strategy === "COLOR_SNIPER") {
        const prediction = getColorSniperPrediction(userId);
        ch = prediction.choice;
        shouldSkip = prediction.shouldSkip;
        if (shouldSkip) skipReason = "(Waiting for 1 or 7)";
      }
      else if (settings.strategy === "QUANTUM_CALC") {
        ch = getQuantumCalcPrediction(userId);
        shouldSkip = false;
      } 
      else if (settings.strategy === "TIME_WARP") {
        ch = getTimeWarpPrediction(userId);
        shouldSkip = false;
      }
      
      else if (settings.strategy === "TREND_FOLLOW") {
        if (betType === "COLOR") {
          if (!settings.color_trend_state) {
            settings.color_trend_state = { last_result: null };
          }
          
          if (settings.color_trend_state.last_result === null) {
            const colors = ['G', 'V', 'R'];
            ch = colors[Math.floor(Math.random() * colors.length)];
            logging.info(`Color TREND_FOLLOW: First bet random (${ch})`);
          } else {
            ch = settings.color_trend_state.last_result;
            logging.info(`Color TREND_FOLLOW: Following last result (${ch})`);
          }
        } else {
          if (!settings.trend_state) {
            settings.trend_state = { last_result: null, skip_mode: false };
          }
          
          const bsWaitCount = settings.bs_sb_wait_count || 0;
          if (bsWaitCount >0) {
            const requiredResults = 2 * bsWaitCount;
            const results = userAllResults[userId] || [];
            
            if (results.length >= requiredResults) {
              const lastResults = results.slice(-requiredResults);
              const patternBS = 'BS'.repeat(bsWaitCount);
              const patternSB = 'SB'.repeat(bsWaitCount);
              const actualPattern = lastResults.join('');
              
              if (actualPattern === patternBS || actualPattern === patternSB) {
                shouldSkip = true;
                settings.trend_state.skip_mode = true;
                logging.info(`TREND_FOLLOW: Pattern ${actualPattern} found. Skipping.`);
              } else {
                shouldSkip = false;
                settings.trend_state.skip_mode = false;
              }
            }
          }
          
          if (settings.trend_state.skip_mode) {
            shouldSkip = true;
            skipReason = "(BS/SB Wait)";
            ch = settings.trend_state.last_result || 'B';
          } else {
            if (settings.trend_state.last_result === null) {
              ch = 'B';
            } else {
              ch = settings.trend_state.last_result;
            }
            logging.info(`TREND_FOLLOW: Betting ${ch}`);
          }
        }
      } else if (settings.strategy === "ALTERNATE") {
        if (!settings.alternate_state) {
          settings.alternate_state = { last_result: null, skip_mode: false };
        }
        
        const bbWaitCount = settings.bb_ss_wait_count || 0;
        if (bbWaitCount > 0) {
          const requiredResults = 2 * bbWaitCount;
          const results = userAllResults[userId] || [];
          
          if (results.length >= requiredResults) {
            const lastResults = results.slice(-requiredResults);
            const patternBB = 'BB'.repeat(bbWaitCount);
            const patternSS = 'SS'.repeat(bbWaitCount);
            const actualPattern = lastResults.join('');
            
            if (actualPattern === patternBB || actualPattern === patternSS) {
              shouldSkip = true;
              settings.alternate_state.skip_mode = true;
              logging.info(`ALTERNATE: Pattern ${actualPattern} found. Skipping.`);
            } else {
              shouldSkip = false;
              settings.alternate_state.skip_mode = false;
            }
          }
        }
        
        if (settings.alternate_state.skip_mode) {
          shouldSkip = true;
          skipReason = "(BB/SS Wait)";
          if (settings.alternate_state.last_result === null) {
            ch = 'B';
          } else {
            ch = settings.alternate_state.last_result === 'B' ? 'S' : 'B';
          }
          logging.info(`ALTERNATE: Recording ${ch} (skip mode)`);
        } else {
          if (settings.alternate_state.last_result === null) {
            ch = 'B';
          } else {
            ch = settings.alternate_state.last_result === 'B' ? 'S' : 'B';
          }
          logging.info(`ALTERNATE: Betting ${ch}`);
        }
      } else if (settings.strategy === "BS_ORDER") {
        if (!settings.pattern) {
          settings.pattern = DEFAULT_BS_ORDER;
          settings.pattern_index = 0;
          logging.warning(`BS_ORDER: Pattern not found, using default: ${DEFAULT_BS_ORDER}`);
        }
        
        const pattern = settings.pattern;
        let patternIndex = settings.pattern_index || 0;
        
        if (patternIndex >= pattern.length) {
          patternIndex = 0;
          settings.pattern_index = 0;
        }
        
        if (!pattern || typeof pattern !== 'string' || pattern.length === 0) {
          logging.error(`BS_ORDER: Invalid pattern for user ${userId}: ${pattern}`);
          ch = 'B'; 
        } else if (!pattern.split('').every(c => c === 'B' || c === 'S')) {
          logging.error(`BS_ORDER: Pattern contains invalid characters: ${pattern}`);
          ch = 'B'; 
        } else {
          ch = pattern[patternIndex];
          logging.info(`BS_ORDER: Pattern="${pattern}", Index=${patternIndex}, Choice=${ch}`);
          
          const nextIndex = (patternIndex + 1) % pattern.length;
          settings.pattern_index = nextIndex;
          logging.info(`BS_ORDER: Next index will be ${nextIndex}`);
        }
      } else {
        ch = 'B';
        logging.info(`Default bet: B`);
      }
      
      const selectType = getSelectMap(gameType, betType)[ch];

      if (selectType === undefined) {
        logging.error(`Invalid selectType: ${ch}`);
        settings.consecutive_errors++;
        await new Promise(resolve => setTimeout(resolve, 2000));
        continue;
      }
      
      logging.info(`Bet Choice: ${ch}, SelectType: ${selectType}`);
      
      if (entryLayer ===1) {
        if (!shouldSkip) {
          shouldSkip = userShouldSkipNext[userId] || false;
          if (shouldSkip) {
            skipReason = "(SL Layer Skip)";
          }
        }
      } else if (entryLayer === 2) {
        if (settings.entry_layer_state && settings.entry_layer_state.waiting_for_lose) {
          shouldSkip = true;
          skipReason = "(Entry Layer 2 - Wait for Lose)";
        } else {
          if (!shouldSkip) {
            shouldSkip = userShouldSkipNext[userId] || false;
            if (shouldSkip) skipReason = "(SL Layer Skip)";
          }
        }

        if (settings.entry_layer_state && settings.entry_layer_state.waiting_for_lose && shouldSkip) {
          settings.entry_layer_state.waiting_for_lose = false;
          logging.info(`Entry Layer 2: Got loss, now resuming normal betting for user ${userId}`);
        }
      } else if (entryLayer === 3) {
        if (settings.entry_layer_state && settings.entry_layer_state.waiting_for_loses) {
          shouldSkip = true;
          skipReason = `(Entry Layer 3 - Wait for ${settings.entry_layer_state.consecutive_loses || 0}/2 Loses)`;
        } else {
          if (!shouldSkip) {
            shouldSkip = userShouldSkipNext[userId] || false;
            if (shouldSkip) skipReason = "(SL Layer Skip)";
          }
        }
        if (settings.entry_layer_state && settings.entry_layer_state.waiting_for_lose && shouldSkip) {
          settings.entry_layer_state.waiting_for_lose = false;
          logging.info(`Entry Layer 3: Got 2 loss, now resuming normal betting for user ${userId}`);
        }
      }
      
      const betEmoji = getBetIndexEmoji(settings);
      const gameId = `${EMOJI.GAME} ${gameType} : ${currentIssue}`;
      
      if (shouldSkip) {
        let betChoiceText;
        if (betType === "COLOR") {
          betChoiceText = getColorName(ch);
        } else {
          betChoiceText = ch === 'B' ? `BIG` : `SMALL`;
        }
        
        let betMsg = `${EMOJI.SKIP} SKIPPING\n\n${safeEscape(gameId)}\n${EMOJI.STRATEGY} Strategy: ${(strategyText)}`;
        
        if (!userSkippedBets[userId]) {
          userSkippedBets[userId] = {};
        }
        userSkippedBets[userId][currentIssue] = [ch, settings.virtual_mode];
        
        userSkipResultWait[userId] = currentIssue;
        
        await sendMessageWithRetry(ctx, betMsg);
        
        let resultAvailable = false;
        let waitAttempts = 0;
        const maxWaitAttempts = 60;
        
        while (!resultAvailable && waitAttempts < maxWaitAttempts && settings.running) {
          await new Promise(resolve => setTimeout(resolve, 1000));
          if (!userSkippedBets[userId] || !userSkippedBets[userId][currentIssue]) {
            resultAvailable = true;
          }
          waitAttempts++;
        }
        
        if (!resultAvailable) {
          if (userSkipResultWait[userId] === currentIssue) {
            delete userSkipResultWait[userId];
          }
        }
      } else {
        let desiredAmount;
try {
  desiredAmount = calculateBetAmount(settings, currentBalance);
  
  if (settings.strategy === "PYRO_TECH" && settings.pyro_state && settings.pyro_state.step === 2) {
    desiredAmount = desiredAmount * 2;
    logging.info(`PYRO_TECH: Second bet - doubling amount to ${desiredAmount}`);
  }
  
} catch (error) {
  await sendMessageWithRetry(ctx, `${EMOJI.ERROR} Error: ${error.message}`, makeMainKeyboard(true));
  settings.running = false;
  break;
}
        
        const { unitAmount, betCount, actualAmount } = computeBetDetails(desiredAmount);
        
        if (actualAmount === 0) {
          await sendMessageWithRetry(ctx, `${EMOJI.ERROR} Invalid bet amount.`, makeMainKeyboard(true));
          settings.running = false;
          break;
        }
        
        if (currentBalance < actualAmount) {
          await sendMessageWithRetry(ctx, `${EMOJI.ERROR} Insufficient balance.`, makeMainKeyboard(true));
          settings.running = false;
          break;
        }
        
        let betChoiceText;
        if (betType === "COLOR") {
          betChoiceText = getColorName(ch);
        } else {
          betChoiceText = ch === 'B' ? `BIG` : `SMALL`;
        }
        
        let patternInfo = "";
        if (settings.strategy === "BS_ORDER" && settings.pattern) {
          const currentIndex = settings.pattern_index !== undefined ? 
                              (settings.pattern_index === 0 ? settings.pattern.length -1 : settings.pattern_index - 1) : 0;
          patternInfo = ` (Pattern Index: ${currentIndex})`;
        }
        
        let betMsg = `${safeEscape(gameId)}\n${betEmoji} ရွေးချယ်မှု : ${safeEscape(betChoiceText)} \n💵 ထိုးကြေး : ${actualAmount} Ks\n${EMOJI.STRATEGY} နည်းဗျူဟာ: ${safeEscape(strategyText)}`;
        
        await sendMessageWithRetry(ctx, betMsg);
        
        if (settings.virtual_mode) {
          if (!userPendingBets[userId]) {
            userPendingBets[userId] = {};
          }
          userPendingBets[userId][currentIssue] = [ch, actualAmount, true];
          userWaitingForResult[userId] = true;
        } else {
          const betResp = await placeBetRequest(session, currentIssue, selectType, unitAmount, betCount, gameType, parseInt(userId));
          
          if (betResp.error || betResp.code !== 0) {
            await sendMessageWithRetry(ctx, `${EMOJI.ERROR} Bet error: ${betResp.msg || betResp.error}. Retrying...`);
            await new Promise(resolve => setTimeout(resolve, 5000));
            continue;
          }
          
          if (!userPendingBets[userId]) {
            userPendingBets[userId] = {};
          }
          userPendingBets[userId][currentIssue] = [ch, actualAmount, false];
          userWaitingForResult[userId] = true;
        }
      }
      
      settings.last_issue = currentIssue;
      
      // Betting လုပ်ပြီးတဲ့အခါ round counter တိုးမယ်
      settings.rounds_played = (settings.rounds_played || 0) + 1;
      
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  } catch (error) {
    logging.error(`Betting worker error: ${error.message}`);
    await sendMessageWithRetry(ctx, `${EMOJI.ERROR} Error: ${error.message}. Stopping...`);
    settings.running = false;
  } finally {
    settings.running = false;
    delete userWaitingForResult[userId];
    delete userShouldSkipNext[userId];
    delete userBalanceWarnings[userId];
    delete userSkipResultWait[userId];
    delete userSLSkipWaitingForWin[userId];
    
    if (settings.strategy === "CYBER_SNIPER") {
      delete settings.cyber_sniper_state;
    }
    if (settings.strategy === "COLOR_SNIPER") {
      delete settings.color_sniper_state;
    }
    if (settings.strategy === "TIME_WARP") {
      delete settings.time_warp_pos;
    }
if (settings.strategy === "ULTRA_SNIPER") {
  delete settings.ultra_sniper_state;
}
if (settings.strategy === "CHAOS_SEEKER") {
  delete settings.chaos_seeker_state;
}
if (settings.strategy === "TERMINATOR") {
  delete settings.terminator_state;
}
if (settings.strategy === "PYRO_TECH") {
  delete settings.pyro_state;
}
    
    if (settings.strategy === "TREND_FOLLOW") {
      delete settings.trend_state;
      delete settings.color_trend_state;
    }
    
    if (settings.strategy === "ALTERNATE") {
      delete settings.alternate_state;
    }
    
    if (settings.strategy === "BS_ORDER") {
      settings.pattern_index = 0;
    }
    
    // AI Mode အတွက် state ရှင်းလင်းခြင်း
    if (settings.strategy === "DEEPSEEK_ADAPTIVE") {
      delete settings.deepseek_adaptive_state;
      delete settings.sniper_hit_count;
      delete settings.sniper_loss_count;
    }
    if (settings.strategy === "DEEPSEEK_PREDICTOR" || settings.strategy === "DEEPSEEK_NEURAL") {
      delete settings.sniper_hit_count;
      delete settings.sniper_loss_count;
    }
    if (settings.strategy === "GPT_ADAPTIVE_AI") {
      delete settings.gpt_ai_state;
      delete settings.sniper_hit_count;
      delete settings.sniper_loss_count;
    }

let totalProfit = 0;
let balanceText = "";
    
    if (settings.virtual_mode) {
      totalProfit = (userStats[userId]?.virtual_balance || 0) - (userStats[userId]?.initial_balance || 0);
      balanceText = `${EMOJI.VIRTUAL} Virtual Balance: ${(userStats[userId]?.virtual_balance || 0).toFixed(2)} Ks\n`;
    } else {
      totalProfit = userStats[userId]?.profit || 0;
      try {
        const finalBalance = await getBalance(session, userId);
        balanceText = `${EMOJI.BALANCE} Final Balance: ${finalBalance?.toFixed(2) || '0.00'} Ks\n`;
      } catch (error) {
        balanceText = `${EMOJI.BALANCE} Final Balance: Unknown\n`;
      }
    }
    
    let profitIndicator = "";
    if (totalProfit > 0) profitIndicator = "+";
    else if (totalProfit < 0) profitIndicator = "-";
    
    delete userStats[userId];
    settings.martin_index = 0;
    settings.dalembert_units =1;
    settings.custom_index =0;
    
    if (!userStopInitiated[userId]) {
      const message = `${EMOJI.STOP} ${STYLE.BOLD('SESSION TERMINATED')}\n${balanceText}${EMOJI.PROFIT} Total Profit: ${profitIndicator}${totalProfit.toFixed(2)} Ks`;
      await sendMessageWithRetry(ctx, message, makeMainKeyboard(true));
    }
    
    delete userStopInitiated[userId];
    delete userAllResults[userId];
  }
}

function makePlatformKeyboard() {
  return Markup.keyboard([
    [`${PLATFORMS["6LOTTERY"].color} ${PLATFORMS["6LOTTERY"].name}`],
    [`${EMOJI.BACK} Back`]
  ]).resize().oneTime(false);
}

function makeMainKeyboard(loggedIn = false, isAdmin = false) {
  if (!loggedIn) {
    return Markup.keyboard([[`${EMOJI.LOGIN} Login`]]).resize().oneTime(false);
  }
  
  let keyboard = [
    [`${EMOJI.START} စတင်ကစားမယ်`, `${EMOJI.STOP} ကစားတာ ရပ်မယ်`],
    [`${EMOJI.BALANCE} လောင်းကြေး သတ်မှတ်`, `${EMOJI.COLOR} လောင်းကစားအမျိုးအစား`],
    [`${EMOJI.TARGET} ဂိမ်းအမျိုးအစား`, `${EMOJI.STRATEGY} နည်းဗျူဟာ`],
    [`${EMOJI.SETTINGS} လောင်းကစား ဆက်တင်များ`, `${EMOJI.RISK} အန္တရာယ်စီမံခန့်ခွဲမှု`],
    // AI Mode ခလုတ်ထည့်ရန်
    [`${EMOJI.AI} AI Mode`, `${EMOJI.INFO} အချက်အလက်`, `${EMOJI.LOGOUT} Re-Login`]
  ];
  
  if (isAdmin) {
    keyboard.push([`${EMOJI.ADMIN} Admin Panel`]);
  }
  
  console.log(`Creating keyboard for ${isAdmin ? 'admin' : 'regular'} user`);
  return Markup.keyboard(keyboard).resize().oneTime(false);
}

function makeRiskManagementSubmenu() {
  return Markup.keyboard([
    [`${EMOJI.TARGET} Profit Target`, `${EMOJI.STOP} Stop Loss`],
    [`${EMOJI.LAYER} Entry Layer`, `${EMOJI.WARNING} Bet SL`],
    [`${EMOJI.BACK} Back`]
  ]).resize().oneTime(false);
}

function makeAdminPanelKeyboard() {
  return Markup.keyboard([
    [`${EMOJI.ADD} Add User`, `${EMOJI.REMOVE} Remove User`],
    [`${EMOJI.STATS} User Stats`, `${EMOJI.MENU} Allowed IDs`],
    [`${EMOJI.ENABLE} Enable Free`, `${EMOJI.DISABLE} Disable Free`],
    [`${EMOJI.BROADCAST} Broadcast`, `${EMOJI.CHECK} Check Free Mode`],
    [`${EMOJI.MENU} Main Menu`]
  ]).resize().oneTime(false);
}

function makeRiskManagementKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback(`${EMOJI.TARGET} Profit Target`, "risk:profit_target")],
    [Markup.button.callback(`${EMOJI.STOP} Stop Loss`, "risk:stop_loss")],
    [Markup.button.callback(`${EMOJI.LAYER} Entry Layer`, "risk:entry_layer")],
    [Markup.button.callback(`${EMOJI.WARNING} Bet SL`, "risk:bet_sl")]
  ]);
}

function makeStrategyKeyboard(userId = null) {
  if (userId && userSettings[userId] && userSettings[userId].bet_type === "COLOR") {
    const keyboard = [
      [
        Markup.button.callback(`${EMOJI.TREND} TREND_FOLLOW`, "strategy:TREND_FOLLOW")
      ],
      [
        Markup.button.callback(`🎯 COLOR SNIPER`, "strategy:COLOR_SNIPER")
      ]
    ];
    return Markup.inlineKeyboard(keyboard);
  }

  const keyboard = [
    [
      Markup.button.callback(`${EMOJI.TREND} TREND_FOLLOW`, "strategy:TREND_FOLLOW") , 
      Markup.button.callback(`${EMOJI.ALTERNATE} ALTERNATE`, "strategy:ALTERNATE")
    ],
    [
      Markup.button.callback(`${EMOJI.PATTERN} BS ORDER`, "strategy:BS_ORDER") , 
      Markup.button.callback(`🤖 CYBER_SNIPER`, "strategy:CYBER_SNIPER")
    ],
    [
      Markup.button.callback(`🔮 QUANTUM_CALC`, "strategy:QUANTUM_CALC") ,       
      Markup.button.callback(`⏳ TIME_WARP`, "strategy:TIME_WARP")
    ],
    [
      Markup.button.callback(`💥 ULTRA_SNIPER`, "strategy:ULTRA_SNIPER"),
      Markup.button.callback(`🌪️ CHAOS_SEEKER`, "strategy:CHAOS_SEEKER")
    ],
    [
      Markup.button.callback(`🎯 TERMINATOR`, "strategy:TERMINATOR"),
      Markup.button.callback(`⚡ NEURAL_NET`, "strategy:NEURAL_NET")
    ],
    [
      Markup.button.callback(`🔥 PYRO_TECH`, "strategy:PYRO_TECH"),
      Markup.button.callback(`🌊 TSUNAMI`, "strategy:TSUNAMI")
    ],
    [
      Markup.button.callback(`🧙 MAGE`, "strategy:MAGE"),
      Markup.button.callback(`💀 REAPER`, "strategy:REAPER")
    ],
    [
      Markup.button.callback(`🔮 DEEPSEEK_PREDICTOR`, "strategy:DEEPSEEK_PREDICTOR"),
      Markup.button.callback(`🧠 DEEPSEEK_NEURAL`, "strategy:DEEPSEEK_NEURAL")
    ],
    [
      Markup.button.callback(`⚙️ DEEPSEEK_ADAPTIVE`, "strategy:DEEPSEEK_ADAPTIVE")
    ],
    [
      Markup.button.callback(`🧠 GPT ADAPTIVE AI`, "strategy:GPT_ADAPTIVE_AI"),
      Markup.button.callback(`🧠 GROK AI`, "strategy:GROK_AI"),
      Markup.button.callback(`✨ GEMINI AI`, "strategy:GEMINI_AI")
    ]
  ];
  
  return Markup.inlineKeyboard(keyboard);
}


function makeBetTypeKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback(`Big/Small`, "bet_type:BS")],
    [Markup.button.callback(`Color`, "bet_type:COLOR")]
  ]);
}

function makeBSWaitCountKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("1", "bs_wait_count:1"), Markup.button.callback("2", "bs_wait_count:2"), Markup.button.callback("3", "bs_wait_count:3")],
    [Markup.button.callback("4", "bs_wait_count:4"), Markup.button.callback("5", "bs_wait_count:5"), Markup.button.callback("6", "bs_wait_count:6")],
    [Markup.button.callback(`${EMOJI.CHECK} 0 (Disable)`, "bs_wait_count:0")]
  ]);
}

function makeBBWaitCountKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("1", "bb_wait_count:1"), Markup.button.callback("2", "bb_wait_count:2"), Markup.button.callback("3", "bb_wait_count:3")],
    [Markup.button.callback("4", "bb_wait_count:4"), Markup.button.callback("5", "bb_wait_count:5"), Markup.button.callback("6", "bb_wait_count:6")],
    [Markup.button.callback(`${EMOJI.CHECK} 0 (Disable)`, "bb_wait_count:0")]
  ]);
}

function makeBettingStrategyKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback(`${EMOJI.ANTI_MARTINGALE} Anti-Martingale`, "betting_strategy:Anti-Martingale")],
    [Markup.button.callback(`${EMOJI.MARTINGALE} Martingale`, "betting_strategy:Martingale")],
    [Markup.button.callback(`${EMOJI.DALEMBERT} D'Alembert`, "betting_strategy:D'Alembert")]
  ]);
}

function makeGameTypeKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback(`${EMOJI.GAME} WINGO`, "game_type:WINGO_SELECT")],
    [Markup.button.callback(`${EMOJI.GAME} TRX`, "game_type:TRX")]
  ]);
}

function makeWINGOSelectionKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback(`${EMOJI.GAME} WINGO 30s`, "game_type:WINGO_30S"), 
     Markup.button.callback(`${EMOJI.GAME} WINGO 1min`, "game_type:WINGO")],
    [Markup.button.callback(`${EMOJI.GAME} WINGO 3min`, "game_type:WINGO_3MIN"), 
     Markup.button.callback(`${EMOJI.GAME} WINGO 5min`, "game_type:WINGO_5MIN")]
  ]);
}

function makeEntryLayerKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("1 - Direct For BET", "entry_layer:1")],
    [Markup.button.callback("2 - Wait for 1 Lose", "entry_layer:2")],
    [Markup.button.callback("3 - Wait for 2 Loses", "entry_layer:3")]
  ]);
}

function makeSLLayerKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback(`${EMOJI.CHECK} 0 - Disabled`, "sl_layer:0")],
    [Markup.button.callback("1", "sl_layer:1"), Markup.button.callback("2", "sl_layer:2"), Markup.button.callback("3", "sl_layer:3")],
    [Markup.button.callback("4", "sl_layer:4"), Markup.button.callback("5", "sl_layer:5"), Markup.button.callback("6", "sl_layer:6")],
    [Markup.button.callback("7", "sl_layer:7"), Markup.button.callback("8", "sl_layer:8"), Markup.button.callback("9", "sl_layer:9")]
  ]);
}

function makeModeSelectionKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback(`${EMOJI.VIRTUAL} Virtual Mode`, "mode:virtual")],
    [Markup.button.callback(`${EMOJI.REAL} Real Mode`, "mode:real")]
  ]);
}

async function checkUserAuthorized(ctx) {
  const userId = ctx.from.id;
  if (!userSessions[userId]) {
    await sendMessageWithRetry(ctx, `${EMOJI.ERROR} Please login first`, makeMainKeyboard(false));
    return false;
  }
  if (!userSettings[userId]) {
    const platformKey = userPlatforms[userId] || "CKLOTTERY";
    userSettings[userId] = {
      platform: platformKey,
      strategy: "TREND_FOLLOW",
      betting_strategy: "Martingale",
      game_type: platformKey === "CKLOTTERY" ? "TRX" : "WINGO",
      bet_type: "BS",
      martin_index: 0,
      dalembert_units: 1,
      pattern_index: 0,
      running: false,
      consecutive_losses: 0,
      current_layer: 0,
      skip_betting: false,
      sl_layer: null,
      original_martin_index: 0,
      original_dalembert_units: 1,
      original_custom_index: 0,
      custom_index: 0,
      layer_limit: 1,
      virtual_mode: false,
      bs_sb_wait_count: 0,
      bb_ss_wait_count: 0,
      rounds_played: 0,
      // AI Mode State ထည့်ရန်
      ai_mode: {
        enabled: false,
        level: "SMART",
        current_strategy: null,
        base_bet_percent: 1.2,
        max_drawdown: 15,
        soft_drawdown: 8,
        last_switch_round: 0,
        pause_until: null
      }
    };
  }
  return true;
}

async function cmdStartHandler(ctx) {
  const userId = ctx.from.id;
  const userName = ctx.from.username || ctx.from.first_name || "User";
  
  const isAdmin = userId === ADMIN_ID;
  
  console.log(`[USER_ACTIVITY] User ${userName} (ID: ${userId}) sent /start message`);
  
  activeUsers.add(userId);
  
  if (!userSettings[userId]) {
    userSettings[userId] = {
      strategy: "TREND_FOLLOW",
      betting_strategy: "Martingale",
      game_type: "TRX", 
      bet_type: "BS", 
      martin_index: 0,
      dalembert_units: 1,
      pattern_index: 0,
      running: false,
      consecutive_losses: 0,
      current_layer: 0,
      skip_betting: false,
      sl_layer: null,
      original_martin_index: 0,
      original_dalembert_units:1,
      original_custom_index: 0,
      custom_index: 0,
      layer_limit: 1,
      virtual_mode: false,
      bs_sb_wait_count: 0,
      bb_ss_wait_count: 0,
      rounds_played: 0,
      // AI Mode State ထည့်ရန်
      ai_mode: {
        enabled: false,
        level: "SMART",
        current_strategy: null,
        base_bet_percent: 1.2,
        max_drawdown: 15,
        soft_drawdown: 8,
        last_switch_round: 0,
        pause_until: null
      }
    };
  }
  
  userLastResults[userId] = [];
  
  const loggedIn = !!userSessions[userId];
  
  let profilePhotoId = null;
  let userFullName = ctx.from.first_name || '';
  if (ctx.from.last_name) userFullName += ' ' + ctx.from.last_name;

  const cleanFullName = userFullName.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');

  try {
    const photos = await ctx.telegram.getUserProfilePhotos(userId, 0, 1);
    if (photos.total_count > 0) {
      profilePhotoId = photos.photos[0][0].file_id;
    }
  } catch (e) {
    logging.warning("Could not fetch profile photo");
  }

  const welcomeMessage = 
`🤖 𝗞𝗶 𝗞𝗶 𝗔𝗜 𝗦𝗬𝗦𝗧𝗘𝗠 🤖

[ 👤 𝗨𝗦𝗘𝗥 𝗜𝗡𝗙𝗢 ]
▸ Name: *${cleanFullName}*
▸ ID: \`${userId}\`
▸ Status: ${loggedIn ? '🟢 AUTHORIZED' : '🔴 RESTRICTED'}

▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰
 🎮 Games: TRX & WINGO
 🧠 Logic: 12+ Pro Strategies
 🤖 AI Mode: Smart Auto-Trading
 ▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰
https://www.6win999.com/#/register?invitationCode=386831122519
▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰

${loggedIn ? '⚡️ System Ready! Choose an option 👇' : '🔐 Please Login to connect system 👇'}`;

  const keyboard = makeMainKeyboard(loggedIn, isAdmin).reply_markup;

  if (profilePhotoId) {
    try {
      await ctx.replyWithPhoto(profilePhotoId, { 
        caption: welcomeMessage, 
        parse_mode: 'Markdown',
        reply_markup: keyboard 
      });
      return;
    } catch (error) {
      logging.warning(`Failed to send welcome photo: ${error.message}`);
    }
  }

  try {
    await ctx.reply(welcomeMessage, { 
      parse_mode: 'Markdown',
      reply_markup: keyboard 
    });
  } catch (error) {
    logging.error(`Failed to send welcome text: ${error.message}`);
  }
}

async function cmdAllowHandler(ctx) {
  const userId = ctx.from.id;
  if (userId !== ADMIN_ID) {
    await sendMessageWithRetry(ctx, `${EMOJI.ERROR} Admin only!`, makeMainKeyboard(true, userId === ADMIN_ID));
    return;
  }
  
  const args = ctx.message.text.split(' ').slice(1);
  if (!args.length || !args[0].match(/^\d+$/)) {
    await sendMessageWithRetry(ctx, `${EMOJI.INFO} Usage: /allow {6lottery_id}`, makeAdminPanelKeyboard());
    return;
  }
  
  const sixlotteryId = parseInt(args[0]);
  if (allowedsixlotteryIds.has(sixlotteryId)) {
    await sendMessageWithRetry(ctx, `${EMOJI.INFO} User ${sixlotteryId} already added`, makeAdminPanelKeyboard());
  } else {
    allowedsixlotteryIds.add(sixlotteryId);
    saveAllowedUsers();
    await sendMessageWithRetry(ctx, `${EMOJI.SUCCESS} User ${sixlotteryId} added`, makeAdminPanelKeyboard());
  }
}

async function cmdRemoveHandler(ctx) {
  const userId = ctx.from.id;
  if (userId !== ADMIN_ID) {
    await sendMessageWithRetry(ctx, `${EMOJI.ERROR} Admin only!`, makeMainKeyboard(true, userId === ADMIN_ID));
    return;
  }
  
  const args = ctx.message.text.split(' ').slice(1);
  if (!args.length || !args[0].match(/^\d+$/)) {
    await sendMessageWithRetry(ctx, `${EMOJI.INFO} Usage: /remove {6lottery_id}`, makeAdminPanelKeyboard());
    return;
  }
  
  const sixlotteryId = parseInt(args[0]);
  if (!allowedsixlotteryIds.has(sixlotteryId)) {
    await sendMessageWithRetry(ctx, `${EMOJI.INFO} User ${sixlotteryId} not found`, makeAdminPanelKeyboard());
  } else {
    allowedsixlotteryIds.delete(sixlotteryId);
    saveAllowedUsers();
    await sendMessageWithRetry(ctx, `${EMOJI.SUCCESS} User ${sixlotteryId} removed`, makeAdminPanelKeyboard());
  }
}

async function cmdShowIdHandler(ctx) {
  const userId = ctx.from.id;
  if (userId !== ADMIN_ID) {
    await sendMessageWithRetry(ctx, `${EMOJI.ERROR} Admin only!`);
    return;
  }
  
  try {
    let allowedIds = [];
    if (fs.existsSync('users_6lottery.json')) {
      const data = JSON.parse(fs.readFileSync('users_6lottery.json', 'utf8'));
      allowedIds = data.allowed_ids || [];
    } else {
      allowedIds = Array.from(allowedsixlotteryIds);
    }
    
    if (allowedIds.length === 0) {
      await sendMessageWithRetry(ctx, `${EMOJI.INFO} No allowed IDs found.`);
      return;
    }
  
  let message = `${EMOJI.MENU} ${STYLE.BOLD('List of Allowed IDs')}:\n\n`;
    allowedIds.forEach((id, index) => {
      message += `${index + 1}. ${STYLE.CODE(id.toString())}\n`;
    });
    
    message += `\n${EMOJI.INFO} Total: ${allowedIds.length} allowed users`;
    
    await sendMessageWithRetry(ctx, message);
  } catch (error) {
    logging.error(`Error showing allowed IDs: ${error.message}`);
    await sendMessageWithRetry(ctx, `${EMOJI.ERROR} Error retrieving allowed IDs.`);
  }
}

async function cmdUsersHandler(ctx) {
  const userId = ctx.from.id;
  if (userId !== ADMIN_ID) {
    await sendMessageWithRetry(ctx, `${EMOJI.ERROR} Admin only!`);
    return;
  }
  
  try {
    const telegramUserIds = Array.from(activeUsers);
    
    if (telegramUserIds.length === 0) {
      await sendMessageWithRetry(ctx, `${EMOJI.INFO} No active users found.`);
      return;
    }
    
    let message = `${EMOJI.MENU} ${STYLE.BOLD('List of Active Users')}:\n\n`;
    
    for (const telegramId of telegramUserIds) {
      const userInfo = userGameInfo[telegramId];
      const userName = userInfo?.nickname || userInfo?.username || "Unknown";
      const gameUserId = userInfo?.user_id || "Not logged in";
      const balance = userInfo?.balance || 0;
      const isRunning = userSettings[telegramId]?.running || false;
      
      message += `${EMOJI.USER} ${userName}\n`;
      message += `${STYLE.ITEM(`Telegram ID: ${STYLE.CODE(telegramId.toString())}`)}\n`;
      message += `${STYLE.ITEM(`Game ID: ${gameUserId}`)}\n`;
      message += `${STYLE.ITEM(`Balance: ${balance.toFixed(2)} Ks`)}\n`;
      message += `${STYLE.LAST_ITEM(`Status: ${isRunning ? '🟢 Running' : '🔴 Stopped'}`)}\n\n`;
    }
    
    message += `${EMOJI.INFO} Total: ${telegramUserIds.length} active users`;
    
    await sendMessageWithRetry(ctx, message);
  } catch (error) {
    logging.error(`Error showing users: ${error.message}`);
    await sendMessageWithRetry(ctx, `${EMOJI.ERROR} Error retrieving user list.`);
  }
}

async function cmdSendHandler(ctx) {
  await sendMessageWithRetry(ctx, `${EMOJI.INFO} Please use Broadcast button in Admin Panel.`, makeMainKeyboard(true, ctx.from.id === ADMIN_ID));
}

async function cmdEnableFreeMode(ctx) {
  const userId = ctx.from.id;
  freeModeEnabled = true;
  saveFreeModeSetting();
  
  await sendMessageWithRetry(ctx, 
    `${EMOJI.ENABLE} ${STYLE.BOLD('Free Mode ENABLED')}`,
    makeAdminPanelKeyboard()
  );
  
  const telegramUserIds = Array.from(activeUsers);
  if (telegramUserIds.length > 0) {
    const notificationMessage = `${EMOJI.SUCCESS} ${STYLE.BOLD('NOTICE')}\n\n${EMOJI.INFO} Free Mode has been ENABLED by admin.\n${EMOJI.INFO} All users can now use the bot without restrictions.`;
    
    for (const telegramId of telegramUserIds) {
      try {
        await ctx.telegram.sendMessage(telegramId, notificationMessage, { parse_mode: 'Markdown' });
      } catch (error) {
        logging.error(`Failed to notify user ${telegramId} about free mode change: ${error.message}`);
      }
    }
  }
  
  logging.info(`Admin ${userId} enabled Free Mode`);
}
async function cmdDisableFreeMode(ctx) {
  const userId = ctx.from.id;
  freeModeEnabled = false;
  saveFreeModeSetting();
  
  await sendMessageWithRetry(ctx, 
    `${EMOJI.DISABLE} ${STYLE.BOLD('Free Mode DISABLED')}`,
    makeAdminPanelKeyboard()
  );
  
  const telegramUserIds = Array.from(activeUsers);
  if (telegramUserIds.length > 0) {
    const notificationMessage = `${EMOJI.WARNING} ${STYLE.BOLD('NOTICE')}\n\n${EMOJI.INFO} Free Mode has been DISABLED by admin.\n${EMOJI.INFO} Only authorized users can continue using the bot.`;
    
    for (const telegramId of telegramUserIds) {
      try {
        await ctx.telegram.sendMessage(telegramId, notificationMessage, { parse_mode: 'Markdown' });
      } catch (error) {
        logging.error(`Failed to notify user ${telegramId} about free mode change: ${error.message}`);
      }
    }
  }
  
  logging.info(`Admin ${userId} disabled Free Mode`);
}

async function cmdCheckFreeMode(ctx) {
  const userId = ctx.from.id;
  const status = freeModeEnabled ? "ENABLED ✅" : "DISABLED ❌";
  const description = freeModeEnabled 
    ? `${STYLE.ITEM(`ALL users can login`)}\n${STYLE.LAST_ITEM(`No ID checking`)}`
    : `${STYLE.ITEM(`Only authorized users can login`)}\n${STYLE.LAST_ITEM(`ID checking is required`)}`;
  
  await sendMessageWithRetry(ctx,
    `${EMOJI.INFO} ${STYLE.BOLD('Free Mode Status:')} ${status}\n\n${description}`,
    makeAdminPanelKeyboard()
  );
}

async function callbackQueryHandler(ctx) {
  try {
    await ctx.answerCbQuery();
  } catch (error) {
    logging.error(`AnswerCbQuery error: ${error.message}`);
  }

  const userId = ctx.from.id;
  const data = ctx.callbackQuery.data;
  
  if (data.startsWith("restart_bot:")) {
    const userIdFromCallback = parseInt(data.split(":")[1]);
    
    if (userIdFromCallback !== userId) {
      await ctx.reply(`${EMOJI.ERROR} Unauthorized action`);
      return;
    }
    
    await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } });
    
    const settings = userSettings[userId] || {};
    
    if (!settings.bet_sizes) {
      await ctx.reply(`${EMOJI.ERROR} Please set BET SIZE first!`);
      return;
    }
    
    if (settings.running) {
      await ctx.reply(`${EMOJI.INFO} Bot is already running!`);
      return;
    }
    
    settings.running = true;
    settings.consecutive_errors = 0;
    saveUserSettings();
    
    const entryLayer = settings.layer_limit || 1;
    
    if (entryLayer === 2) {
      settings.entry_layer_state = { waiting_for_lose: true };
    } else if (entryLayer === 3) {
      settings.entry_layer_state = { waiting_for_loses: true, consecutive_loses: 0 };
    }
    
    if (settings.strategy === "TREND_FOLLOW") {
      settings.trend_state = { last_result: null, skip_mode: false };
      const betType = settings.bet_type || "BS";
      if (betType === "COLOR") settings.color_trend_state = { last_result: null };
    }
    
    if (settings.strategy === "ALTERNATE") {
      settings.alternate_state = { last_result: null, skip_mode: false };
    }
    
    if (settings.strategy === "CYBER_SNIPER") {
      settings.cyber_sniper_state = {
        active: false,
        direction: null,
        sequence: [],
        step: 0,
        hit_count: 0,
        got_same_result: false
      };
    }
    
    if (settings.strategy === "COLOR_SNIPER") {
      settings.color_sniper_state = {
        active: false,
        step: 0,
        hit_count: 0,
        waiting_for_trigger: true
      };
    }
    if (settings.strategy === "TIME_WARP" && !settings.time_warp_pos) {
      settings.time_warp_pos = 8;
    }
    if (settings.strategy === "ULTRA_SNIPER") {
      settings.ultra_sniper_state = { active: false, step: 0, direction: null, betCount: 0 };
    }
    if (settings.strategy === "CHAOS_SEEKER") {
      settings.chaos_seeker_state = { active: false, triggerPattern: null, betCount: 0, multiplier: 1 };
    }
    
if (["CYBER_SNIPER", "COLOR_SNIPER", "ULTRA_SNIPER", "CHAOS_SEEKER"].includes(settings.strategy)) {
  settings.sniper_hit_count = 0;
  settings.sniper_loss_count = 0;
  logging.info(`Reset sniper counters for ${settings.strategy} on restart`);
}
    
    delete userSkippedBets[userId];
    userShouldSkipNext[userId] = false;
    delete userSLSkipWaitingForWin[userId];
    userWaitingForResult[userId] = false;
    
    await ctx.reply(`${EMOJI.START} Bot restarted successfully!`);
    bettingWorker(userId, ctx, ctx.telegram);
    return;
  }
  
  if (!await checkUserAuthorized(ctx)) {
    return;
  }
  
  // AI Mode Callbacks
  if (data.startsWith("ai_mode:")) {
    const action = data.split(":")[1];
    const settings = userSettings[userId];
    if (!settings) return;
    
    if (!settings.ai_mode) {
      settings.ai_mode = {
        enabled: false,
        level: "SMART",
        current_strategy: null,
        base_bet_percent: 1.2,
        max_drawdown: 15,
        soft_drawdown: 8,
        last_switch_round: 0,
        pause_until: null
      };
    }
    
    switch(action) {
      case "enable":
        settings.ai_mode.enabled = true;
        await sendMessageWithRetry(ctx, 
          `✅ *AI Mode ENABLED*\n\n` +
          `AI will now automatically manage your strategy and bets.\n` +
          `Level: ${settings.ai_mode.level}\n` +
          `Base Bet: ${settings.ai_mode.base_bet_percent}%`,
          makeMainKeyboard(true, userId === ADMIN_ID)
        );
        break;
        
      case "disable":
        settings.ai_mode.enabled = false;
        await sendMessageWithRetry(ctx, 
          `❌ *AI Mode DISABLED*\n\n` +
          `You are now in manual control mode.`,
          makeMainKeyboard(true, userId === ADMIN_ID)
        );
        break;
        
      case "level":
        const levels = ["SAFE", "SMART", "AGGRESSIVE"];
        const currentIndex = levels.indexOf(settings.ai_mode.level);
        const nextIndex = (currentIndex + 1) % levels.length;
        settings.ai_mode.level = levels[nextIndex];
        
        if (settings.ai_mode.level === "SAFE") settings.ai_mode.base_bet_percent = 0.8;
        else if (settings.ai_mode.level === "SMART") settings.ai_mode.base_bet_percent = 1.2;
        else settings.ai_mode.base_bet_percent = 2.0;
        
        await sendMessageWithRetry(ctx,
          `⚙️ *AI Level Changed*\n\n` +
          `New Level: ${settings.ai_mode.level}\n` +
          `Base Bet: ${settings.ai_mode.base_bet_percent}%`,
          makeMainKeyboard(true, userId === ADMIN_ID)
        );
        break;
        
      case "status":
        const balance = settings.virtual_mode ? 
          (userStats[userId]?.virtual_balance || 0) : 
          (await getBalance(userSessions[userId], userId) || 0);
        const startBalance = settings.virtual_mode ?
          (userStats[userId]?.initial_balance || balance) :
          (userStats[userId]?.start_balance || balance);
        
        const volatility = calcVolatility(userId);
        const streak = calcWinStreak(userId);
        const riskStatus = aiRiskGuard(userId, balance, startBalance);
        
        let riskEmoji = "🟢";
        if (riskStatus === "PAUSE") riskEmoji = "🟡";
        if (riskStatus === "STOP") riskEmoji = "🔴";
        
        await sendMessageWithRetry(ctx,
          `📊 *AI MODE STATUS*\n` +
          `──────────────\n` +
          `Enabled: ${settings.ai_mode.enabled ? '✅' : '❌'}\n` +
          `Level: ${settings.ai_mode.level}\n` +
          `Current Strategy: ${settings.ai_mode.current_strategy || 'N/A'}\n` +
          `Volatility: ${(volatility * 100).toFixed(1)}%\n` +
          `Win Streak: ${streak}\n` +
          `Base Bet: ${settings.ai_mode.base_bet_percent}%\n` +
          `Drawdown Limit: ${settings.ai_mode.max_drawdown}%\n` +
          `Soft Limit: ${settings.ai_mode.soft_drawdown}%\n` +
          `Risk Status: ${riskEmoji} ${riskStatus}\n` +
          `Rounds Played: ${settings.rounds_played || 0}\n` +
          `Last Switch: Round ${settings.ai_mode.last_switch_round || 0}` +
          (settings.ai_mode.pause_until ? `\nPaused until: ${new Date(settings.ai_mode.pause_until).toLocaleTimeString()}` : ''),
          makeMainKeyboard(true, userId === ADMIN_ID)
        );
        break;
    }
    
    saveUserSettings();
    await safeDeleteMessage(ctx);
    return;
  }
  
  if (data.startsWith("risk:")) {
    const riskOption = data.split(":")[1];
    
    switch (riskOption) {
      case "profit_target":
        userState[userId] = { state: "INPUT_PROFIT_TARGET" };
        await sendMessageWithRetry(ctx, `${EMOJI.TARGET} ${STYLE.BOLD('Profit Target Settings')}\n\n${EMOJI.INFO} Please enter your desired profit target amount (in Ks):\n\n${STYLE.CODE('Example: 10000')}`);
        break;
      case "stop_loss":
        userState[userId] = { state: "INPUT_STOP_LIMIT" };
        await sendMessageWithRetry(ctx, `${EMOJI.STOP} ${STYLE.BOLD('Stop Loss Settings')}\n\n${EMOJI.INFO} Please enter your stop loss limit amount (in Ks):\n\n${STYLE.CODE('Example: 5000')}`);
        break;
      case "entry_layer":
        await sendMessageWithRetry(ctx, `${EMOJI.LAYER} ${STYLE.BOLD('Entry Layer Settings')}\n\n${EMOJI.INFO} Select when to start betting:`, makeEntryLayerKeyboard());
        break;
      case "bet_sl":
        await sendMessageWithRetry(ctx, `${EMOJI.WARNING} ${STYLE.BOLD('Stop Loss Layer Settings')}\n\n${EMOJI.INFO} Select how many consecutive losses before skipping bets:`, makeSLLayerKeyboard());
        break;
      default:
        await sendMessageWithRetry(ctx, `${EMOJI.ERROR} Invalid option`);
    }
    await safeDeleteMessage(ctx);
    return;
  }
  
  if (data.startsWith("strategy:")) {
    const strategy = data.split(":")[1];
    userSettings[userId].strategy = strategy;
    
    if (strategy === "BS_ORDER") {
      userState[userId] = { state: "INPUT_BS_PATTERN" };
      await sendMessageWithRetry(ctx, `${EMOJI.PATTERN} ${STYLE.BOLD('BS Pattern Settings')}\n\n${EMOJI.INFO} Please enter your BS pattern (B and S only):\n\n${STYLE.CODE('Example: BSBSSBBS')}`);
    } else if (strategy === "TREND_FOLLOW") {
      const betType = userSettings[userId].bet_type || "BS";
      if (betType === "COLOR") {
        await sendMessageWithRetry(ctx, `${EMOJI.SUCCESS} ${STYLE.BOLD('Strategy: Trend Follow (Color Mode)')}`, makeMainKeyboard(true));
      } else {
        await sendMessageWithRetry(ctx, `${EMOJI.TREND} ${STYLE.BOLD('Trend Follow Settings')}\n\n${EMOJI.INFO} Select BS/SB Wait Count:`, makeBSWaitCountKeyboard());
      }
    } else if (strategy === "ALTERNATE") {
      await sendMessageWithRetry(ctx, `${EMOJI.ALTERNATE} ${STYLE.BOLD('Alternate Settings')}\n\n${EMOJI.INFO} Select BB/SS Wait Count:`, makeBBWaitCountKeyboard());
    } else if (strategy === "CYBER_SNIPER") {
      await sendMessageWithRetry(ctx, `🤖 ${STYLE.BOLD('CYBER_SNIPER Activated')}\n\n${EMOJI.INFO} • Session terminates after ${SNIPER_MAX_HITS} hits`, makeMainKeyboard(true));
    } else if (strategy === "COLOR_SNIPER") {
      await sendMessageWithRetry(ctx, `🎯 ${STYLE.BOLD('COLOR_SNIPER Activated')}\n\n${EMOJI.INFO} • Session terminates after ${SNIPER_MAX_HITS} hits`, makeMainKeyboard(true));
    } else if (strategy === "QUANTUM_CALC") {
      await sendMessageWithRetry(ctx, `🔮 ${STYLE.BOLD('QUANTUM_CALC Activated')}`, makeMainKeyboard(true));
    } else if (strategy === "TIME_WARP") {
      await sendMessageWithRetry(ctx, `⏳ ${STYLE.BOLD('TIME_WARP Activated')}`, makeMainKeyboard(true));
    } else if (strategy === "ULTRA_SNIPER") {
  await sendMessageWithRetry(ctx, `💀 ${STYLE.BOLD('ULTRA_SNIPER Activated')}\n\n${EMOJI.INFO} • Session terminates after max 3 consecutive bets`, makeMainKeyboard(true));
} else if (strategy === "CHAOS_SEEKER") {
  await sendMessageWithRetry(ctx, `🌪️ ${STYLE.BOLD('CHAOS_SEEKER Activated')}\n\n${EMOJI.INFO} • Multiplier increases on loss (max 5x)`, makeMainKeyboard(true));
} else if (strategy === "TERMINATOR") {
  await sendMessageWithRetry(ctx, `🎯 ${STYLE.BOLD('TERMINATOR Activated')}\n\n${EMOJI.INFO} • Bets against 3-in-a-row patterns\n${EMOJI.INFO} • 5 loss limit`, makeMainKeyboard(true));
} else if (strategy === "NEURAL_NET") {
  await sendMessageWithRetry(ctx, `⚡ ${STYLE.BOLD('NEURAL_NET Activated')}\n\n${EMOJI.INFO} • Analyzes pattern frequencies\n${EMOJI.INFO} • Requires 10+ results`, makeMainKeyboard(true));
} else if (strategy === "PYRO_TECH") {
  await sendMessageWithRetry(ctx, `🔥 ${STYLE.BOLD('PYRO_TECH Activated')}\n\n${EMOJI.INFO} • 2-bet sequence after 0 or 9\n${EMOJI.INFO} • Win = double next bet`, makeMainKeyboard(true));
} else if (strategy === "TSUNAMI") {
  await sendMessageWithRetry(ctx, `🌊 ${STYLE.BOLD('TSUNAMI Activated')}\n\n${EMOJI.INFO} • Bets against 3/4 same results\n${EMOJI.INFO} • Dynamic bet sizing`, makeMainKeyboard(true));
} else if (strategy === "MAGE") {
  await sendMessageWithRetry(ctx, `🧙 ${STYLE.BOLD('MAGE Activated')}\n\n${EMOJI.INFO} • Uses number sum magic\n${EMOJI.INFO} • Last 3 numbers → sum → predict`, makeMainKeyboard(true));
} else if (strategy === "REAPER") {
  await sendMessageWithRetry(ctx, `💀 ${STYLE.BOLD('REAPER Activated')}\n\n${EMOJI.INFO} • Follows 2-result patterns\n${EMOJI.INFO} • 1.5x progressive betting`, makeMainKeyboard(true));
}   else if (strategy === "DEEPSEEK_PREDICTOR") {
    await sendMessageWithRetry(ctx, `🔮 ${STYLE.BOLD('DEEPSEEK PREDICTOR Activated')}\n\n${EMOJI.INFO} • Detects common patterns (BBB, BSB, etc.)\n${EMOJI.INFO} • Predicts based on historical probability\n${EMOJI.INFO} • Requires 6+ results for optimal performance`, makeMainKeyboard(true));
  } else if (strategy === "DEEPSEEK_NEURAL") {
    await sendMessageWithRetry(ctx, `🧠 ${STYLE.BOLD('DEEPSEEK NEURAL Activated')}\n\n${EMOJI.INFO} • Analyzes trend strength and volatility\n${EMOJI.INFO} • Follows strong trends, reverts in high volatility\n${EMOJI.INFO} • Requires 10+ results for accurate trend analysis`, makeMainKeyboard(true));
  } else if (strategy === "DEEPSEEK_ADAPTIVE") {
    await sendMessageWithRetry(ctx, `⚙️ ${STYLE.BOLD('DEEPSEEK ADAPTIVE AI Activated')}\n\n${EMOJI.INFO} • Aggression level changes based on win/loss streak\n${EMOJI.INFO} • Aggressive on wins, conservative on losses\n${EMOJI.INFO} • Learns and adapts to market conditions`, makeMainKeyboard(true));
  }
else if (strategy === "GPT_ADAPTIVE_AI") {
      await sendMessageWithRetry(ctx, `🧠 ${STYLE.BOLD('GPT ADAPTIVE AI Activated')}\n\n${EMOJI.INFO} • Analyzes last 10 results\n${EMOJI.INFO} • Uses ChatGPT-style scoring\n${EMOJI.INFO} • Skips if streak ≥4 & low confidence`, makeMainKeyboard(true));
    }
    else if (strategy === "GROK_AI") {
  await sendMessageWithRetry(ctx, 
    `🧠 ${STYLE.BOLD('GROK AI Activated')}\n\n` +
    `${EMOJI.INFO} • xAI Multi-Factor Analysis\n` +
    `${EMOJI.INFO} • Trend + Pattern + Volatility\n` +
    `${EMOJI.INFO} • Smart skipping when market is chaotic\n` +
    `${EMOJI.INFO} • "Understand the Universe" mode ON`, 
    makeMainKeyboard(true)
  );
}
    else if (strategy === "GEMINI_AI") {
  await sendMessageWithRetry(ctx, `✨ ${STYLE.BOLD('GEMINI AI Activated')}\n\n${EMOJI.INFO} • Smart Pattern Recognition\n${EMOJI.INFO} • Auto-Skips unstable patterns\n${EMOJI.INFO} • Adapts to market momentum`, makeMainKeyboard(true));
}

    saveUserSettings();
    await safeDeleteMessage(ctx);
    return;
  }
  
if (data.startsWith("bet_type:")) {
  const betType = data.split(":")[1];
  userSettings[userId].bet_type = betType;
  
  if (betType === "COLOR") {

    await sendMessageWithRetry(ctx, 
      `${EMOJI.SUCCESS} ${STYLE.BOLD('လောင်းကစားအမျိုးအစား: Color')}\n` +
      `${EMOJI.INFO} Please select a strategy compatible with color betting.`,
      makeMainKeyboard(true)
    );
  } else {
    await sendMessageWithRetry(ctx, `${EMOJI.SUCCESS} ${STYLE.BOLD('လောင်းကစားအမျိုးအစား: Big/Small')}`, makeMainKeyboard(true));
  }
  
  saveUserSettings();
  await safeDeleteMessage(ctx);
  return;
}
  
  if (data.startsWith("bs_wait_count:")) {
    const waitCount = parseInt(data.split(":")[1]);
    userSettings[userId].bs_sb_wait_count = waitCount;
    let message = waitCount === 0 ? `${EMOJI.SUCCESS} BS/SB Wait disabled` : `${EMOJI.SUCCESS} BS/SB Wait: ${waitCount}`;
    await sendMessageWithRetry(ctx, message, makeMainKeyboard(true));
    saveUserSettings();
    await safeDeleteMessage(ctx);
    return;
  }
  
  if (data.startsWith("bb_wait_count:")) {
    const waitCount = parseInt(data.split(":")[1]);
    userSettings[userId].bb_ss_wait_count = waitCount;
    let message = waitCount === 0 ? `${EMOJI.SUCCESS} BB/SS Wait disabled` : `${EMOJI.SUCCESS} BB/SS Wait: ${waitCount}`;
    await sendMessageWithRetry(ctx, message, makeMainKeyboard(true));
    saveUserSettings();
    await safeDeleteMessage(ctx);
    return;
  }
  
  if (data.startsWith("betting_strategy:")) {
    const bettingStrategy = data.split(":")[1];
    userSettings[userId].betting_strategy = bettingStrategy;
    userSettings[userId].martin_index = 0;
    userSettings[userId].dalembert_units = 1;
    userSettings[userId].consecutive_losses = 0;
    userSettings[userId].skip_betting = false;
    userSettings[userId].custom_index = 0;
    
    await sendMessageWithRetry(ctx, `${EMOJI.SUCCESS} ${STYLE.BOLD('Betting Strategy:')} ${bettingStrategy}`, makeMainKeyboard(true));
    saveUserSettings();
    await safeDeleteMessage(ctx);
    return;
  }
  
  if (data.startsWith("game_type:")) {
    const gameType = data.split(":")[1];
    
    if (gameType === "WINGO_SELECT") {
      await sendMessageWithRetry(ctx, `${EMOJI.GAME} ${STYLE.BOLD('Select WINGO ဂိမ်းအမျိုးအစား')}`, makeWINGOSelectionKeyboard());
      await safeDeleteMessage(ctx);
      return;
    }
    
    userSettings[userId].game_type = gameType;
    await sendMessageWithRetry(ctx, `${EMOJI.SUCCESS} ${STYLE.BOLD('ဂိမ်းအမျိုးအစား set')}`, makeMainKeyboard(true));
    saveUserSettings();
    await safeDeleteMessage(ctx);
    return;
  }

if (data.startsWith("entry_layer:")) {
  const layerValue = parseInt(data.split(":")[1]);
  const settings = userSettings[userId];  
  
  if (!settings) {
    await sendMessageWithRetry(ctx, `${EMOJI.ERROR} User settings not found`);
    return;
  }
  
  settings.layer_limit = layerValue;  
  
  if (layerValue === 2) {
    settings.entry_layer_state = { waiting_for_lose: true };
  } else if (layerValue === 3) {
    settings.entry_layer_state = { waiting_for_loses: true, consecutive_loses: 0 };
  }
  
  let description = layerValue === 1 ? "Bet immediately" : layerValue === 2 ? "Wait for 1 lose" : "Wait for 2 loses";
  await sendMessageWithRetry(ctx, `${EMOJI.SUCCESS} ${STYLE.BOLD(`Entry Layer: ${layerValue}`)}\n\n${EMOJI.INFO} ${description}`, makeRiskManagementSubmenu());
  saveUserSettings();
  await safeDeleteMessage(ctx);
  return;
}

if (data.startsWith("sl_layer:")) {
  const slValue = parseInt(data.split(":")[1]);
  userSettings[userId].sl_layer = slValue > 0 ? slValue : null;
  userSettings[userId].consecutive_losses = 0;
  userSettings[userId].skip_betting = false;
  
  userSettings[userId].original_martin_index = 0;
  userSettings[userId].original_dalembert_units = 1;
  userSettings[userId].original_custom_index = 0;
    
    let description = slValue === 0 ? "Disabled" : `Skip after ${slValue} losses`;
    await sendMessageWithRetry(ctx, `${EMOJI.SUCCESS} ${STYLE.BOLD(`SL Layer: ${slValue}`)}\n\n${EMOJI.INFO} ${description}`, makeRiskManagementSubmenu());
    saveUserSettings();
    await safeDeleteMessage(ctx);
    return;
  }
  
  if (data.startsWith("mode:")) {
    const mode = data.split(":")[1];
    const settings = userSettings[userId];
    
    if (mode === "virtual") {
      userState[userId] = { state: "INPUT_VIRTUAL_BALANCE" };
      await sendMessageWithRetry(ctx, `${EMOJI.VIRTUAL} ${STYLE.BOLD('Virtual Mode Settings')}\n\n${EMOJI.INFO} Please enter your virtual balance amount (in Ks):\n\n${STYLE.CODE('Example: 10000')}`);
    } else if (mode === "real") {
      settings.virtual_mode = false;
      await sendMessageWithRetry(ctx, `${EMOJI.SUCCESS} ${STYLE.BOLD('Switched to Real Mode')}`, makeMainKeyboard(true));
      saveUserSettings();
    }
    
    await safeDeleteMessage(ctx);
    return;
  }
  
  logging.warning(`Unhandled callback: ${data}`);
  await sendMessageWithRetry(ctx, `${EMOJI.ERROR} Invalid action.`, makeMainKeyboard(true));
}

async function textMessageHandler(ctx) {
  const userId = ctx.from.id;
  const userName = ctx.from.username || ctx.from.first_name || "Unknown";
  const rawText = ctx.message.text;
  const isAdmin = userId === ADMIN_ID;
  
  const buttonText = rawText.trim(); 
 
  console.log(`Received button text: "${buttonText}" from user ${userName} (${userId})`);

// Platforms
for (const [platformKey, platform] of Object.entries(PLATFORMS)) {
  if (buttonText === `${platform.color} ${platform.name}`) {
    userState[userId] = { 
      state: "PLATFORM_SELECTED", 
      platform: platformKey 
    };
    await sendMessageWithRetry(ctx, 
      `${platform.color} ${STYLE.BOLD(`Selected: ${platform.name}`)}\n\n` +
      `${EMOJI.LOGIN} Please login using the format:\n\n` +
      `${STYLE.CODE('phone')}\n` +
      `${STYLE.CODE('password')}`,
      Markup.keyboard([[`${EMOJI.BACK} Back`]]).resize().oneTime(false)
    );
    return;
  }
} 
  
  // Bet Type Button
  if (buttonText === `${EMOJI.COLOR} လောင်းကစားအမျိုးအစား`) {
    const currentBetType = userSettings[userId]?.bet_type || "BS";
    const typeText = currentBetType === "COLOR" ? "Color" : "Big/Small";
    
    await sendMessageWithRetry(ctx, 
      `${EMOJI.COLOR} ${STYLE.BOLD('လောင်းကစားအမျိုးအစား Settings')}\n\n` +
      `${EMOJI.INFO} Current: ${STYLE.BOLD(typeText)}\n` +
      `${EMOJI.INFO} Select your preferred betting mode:`, 
      makeBetTypeKeyboard()
    );
    return;
  }

  // AI Mode Button Handler
  if (buttonText === `${EMOJI.AI} AI Mode` || buttonText === "AI Mode" || buttonText === "🤖 AI Mode") {
    const settings = userSettings[userId] || {};
    const aiMode = settings.ai_mode || { enabled: false, level: "SMART" };
    
    const statusText = aiMode.enabled ? "ENABLED ✅" : "DISABLED ❌";
    
    const aiKeyboard = Markup.inlineKeyboard([
      [Markup.button.callback(`🟢 Enable AI`, "ai_mode:enable")],
      [Markup.button.callback(`🔴 Disable AI`, "ai_mode:disable")],
      [Markup.button.callback(`⚙️ Level: ${aiMode.level}`, "ai_mode:level")],
      [Markup.button.callback(`📊 AI Status`, "ai_mode:status")]
    ]);
    
    await sendMessageWithRetry(ctx,
      `🤖 *AI MODE SETTINGS*\n\n` +
      `Current Status: ${statusText}\n` +
      `AI Level: ${aiMode.level}\n` +
      `Base Bet: ${aiMode.base_bet_percent || 1.2}%\n` +
      `Max Drawdown: ${aiMode.max_drawdown || 15}%\n` +
      `Soft Drawdown: ${aiMode.soft_drawdown || 8}%\n\n` +
      `Select an option:`,
      aiKeyboard
    );
    return;
  }

  if (isAdmin) {
    console.log(`User is admin, checking admin commands...`);
    
    if (buttonText === `${EMOJI.STATS} User Stats` || buttonText === "User Stats" || buttonText === "📊 User Stats") {
      console.log(`Admin pressed User Stats button`);
      ctx.message.text = "/users";
      await cmdUsersHandler(ctx);
      return;
    }
    
    if (buttonText === `${EMOJI.MENU} Allowed IDs` || buttonText === "Allowed IDs" || buttonText === "📋 Allowed IDs") {
      console.log(`Admin pressed Allowed IDs button`);
      ctx.message.text = "/showid";
      await cmdShowIdHandler(ctx);
      return;
    }
    
    if (buttonText === `${EMOJI.ENABLE} Enable Free` || buttonText === "Enable Free" || buttonText === "🔓 Enable Free") {
      console.log(`Admin pressed Enable Free button`);
      ctx.message.text = "/enable";
      await cmdEnableFreeMode(ctx);
      return;
    }
    
    if (buttonText === `${EMOJI.DISABLE} Disable Free` || buttonText === "Disable Free" || buttonText === "🔒 Disable Free") {
      console.log(`Admin pressed Disable Free button`);
      ctx.message.text = "/disable";
      await cmdDisableFreeMode(ctx);
      return;
    }
    
    if (buttonText === `${EMOJI.ADD} Add User` || buttonText === "Add User" || buttonText === "➕ Add User") {
      console.log(`Admin pressed Add User button`);
      userState[userId] = { state: "ADMIN_ADD_USER" };
      await sendMessageWithRetry(ctx, `${EMOJI.ADD} Enter user ID to add:`, makeAdminPanelKeyboard());
      return;
    }
    
    if (buttonText === `${EMOJI.REMOVE} Remove User` || buttonText === "Remove User" || buttonText === "➖ Remove User") {
      console.log(`Admin pressed Remove User button`);
      userState[userId] = { state: "ADMIN_REMOVE_USER" };
      await sendMessageWithRetry(ctx, `${EMOJI.REMOVE} Enter user ID to remove:`, makeAdminPanelKeyboard());
      return;
    }
    
    if (buttonText === `${EMOJI.BROADCAST} Broadcast` || buttonText === "Broadcast" || buttonText === "📢 Broadcast") {
      console.log(`Admin pressed Broadcast button`);
      userState[userId] = { state: "ADMIN_BROADCAST" };
      await sendMessageWithRetry(ctx, `${EMOJI.BROADCAST} Enter broadcast message:`, makeAdminPanelKeyboard());
      return;
    }
    
    if (buttonText === `${EMOJI.CHECK} Check Free Mode` || buttonText === "Check Free Mode" || buttonText === "🔄 Check Free Mode") {
      console.log(`Admin pressed Check Free Mode button`);
      ctx.message.text = "/freemode";
      await cmdCheckFreeMode(ctx);
      return;
    }
    
    if (buttonText === `${EMOJI.MENU} Main Menu` || buttonText === "Main Menu" || buttonText === "🏠 Main Menu") {
      console.log(`Admin pressed Main Menu button`);
      const loggedIn = !!userSessions[userId];
      await sendMessageWithRetry(ctx, `${EMOJI.MENU} Returning to main menu...`, makeMainKeyboard(loggedIn, isAdmin));
      return;
    }
  }

  if (buttonText === `${EMOJI.ADMIN} Admin Panel` || buttonText === "Admin Panel" || buttonText === "👑 Admin Panel") {
    console.log(`User ${userName} (${userId}) pressed Admin Panel button`);
    if (isAdmin) {
      await sendMessageWithRetry(ctx, `${EMOJI.ADMIN} ${STYLE.BOLD('Admin Panel')}\n\n${EMOJI.INFO} Select an admin action:`, makeAdminPanelKeyboard());
    } else {
      await sendMessageWithRetry(ctx, `${EMOJI.ERROR} Admin only!`, makeMainKeyboard(true, false));
    }
    return;
  }
  
  if (isAdmin && userState[userId]?.state === "ADMIN_ADD_USER") {
    const userIdToAdd = rawText.trim();
    if (!userIdToAdd.match(/^\d+$/)) {
      await sendMessageWithRetry(ctx, `${EMOJI.ERROR} Invalid user ID.`, makeAdminPanelKeyboard());
      return;
    }
    ctx.message.text = `/allow ${userIdToAdd}`;
    await cmdAllowHandler(ctx);
    delete userState[userId];
    return;
  }
  
  if (isAdmin && userState[userId]?.state === "ADMIN_REMOVE_USER") {
    const userIdToRemove = rawText.trim();
    if (!userIdToRemove.match(/^\d+$/)) {
      await sendMessageWithRetry(ctx, `${EMOJI.ERROR} Invalid user ID.`, makeAdminPanelKeyboard());
      return;
    }
    ctx.message.text = `/remove ${userIdToRemove}`;
    await cmdRemoveHandler(ctx);
    delete userState[userId];
    return;
  }
  
  if (isAdmin && userState[userId]?.state === "ADMIN_BROADCAST") {
    const messageToSend = rawText.trim();
    if (!messageToSend) {
      await sendMessageWithRetry(ctx, `${EMOJI.INFO} Please provide a message.`, makeAdminPanelKeyboard());
      delete userState[userId];
      return;
    }
    
    try {
      const telegramUserIds = Array.from(activeUsers);
      if (telegramUserIds.length === 0) {
        await sendMessageWithRetry(ctx, `${EMOJI.INFO} No active users.`, makeAdminPanelKeyboard());
        delete userState[userId];
        return;
      }
      
      let successCount = 0;
      const broadcastMessage = `${EMOJI.BROADCAST} ${STYLE.BOLD('Admin Broadcast:')}\n\n${messageToSend}`;
      
      for (const telegramId of telegramUserIds) {
        try {
          await ctx.telegram.sendMessage(telegramId, broadcastMessage, { parse_mode: 'Markdown' });
          successCount++;
        } catch (error) {
          logging.error(`Failed to send message to user ${telegramId}: ${error.message}`);
        }
      }
      
      const resultMessage = `${EMOJI.SUCCESS} Message sent to ${successCount} users`;
      await sendMessageWithRetry(ctx, resultMessage, makeAdminPanelKeyboard());
      logging.info(`Admin broadcast sent to ${successCount}/${telegramUserIds.length} users`);
    } catch (error) {
      logging.error(`Error sending admin broadcast: ${error.message}`);
      await sendMessageWithRetry(ctx, `${EMOJI.ERROR} Error sending message.`, makeAdminPanelKeyboard());
    }
    
    delete userState[userId];
    return;
  }
  
  if (isAdmin && rawText.startsWith("/allow ")) { await cmdAllowHandler(ctx); return; }
  if (isAdmin && rawText.startsWith("/remove ")) { await cmdRemoveHandler(ctx); return; }
  if (isAdmin && rawText.startsWith("/send ")) { await cmdSendHandler(ctx); return; } 
  if (buttonText === `${EMOJI.INFO} အချက်အလက်`) {
    await showUserStats(ctx, userId);
    return;
  }
  
  if (buttonText === `${EMOJI.TARGET} ဂိမ်းအမျိုးအစား`) {
    await sendMessageWithRetry(ctx, `${EMOJI.GAME} Select ဂိမ်းအမျိုးအစား:`, makeGameTypeKeyboard());
    return;
  }
  
  if (buttonText === `${EMOJI.TARGET} Profit Target`) {
    userState[userId] = { state: "INPUT_PROFIT_TARGET" };
    await sendMessageWithRetry(ctx, `${EMOJI.TARGET} ${STYLE.BOLD('Profit Target Settings')}\n\n${EMOJI.INFO} Please enter your desired profit target amount (in Ks):\n\n${STYLE.CODE('Example: 10000')}`);
    return;
  }
  
  if (buttonText === `${EMOJI.STOP} Stop Loss`) {
    userState[userId] = { state: "INPUT_STOP_LIMIT" };
    await sendMessageWithRetry(ctx, `${EMOJI.STOP} ${STYLE.BOLD('Stop Loss Settings')}\n\n${EMOJI.INFO} Please enter your stop loss limit amount (in Ks):\n\n${STYLE.CODE('Example: 5000')}`);
    return;
  }
  
  if (buttonText === `${EMOJI.LAYER} Entry Layer`) {
    await sendMessageWithRetry(ctx, `${EMOJI.LAYER} ${STYLE.BOLD('Entry Layer Settings')}\n\n${EMOJI.INFO} Select when to start betting:`, makeEntryLayerKeyboard());
    return;
  }
  
  if (buttonText === `${EMOJI.WARNING} Bet SL`) {
    await sendMessageWithRetry(ctx, `${EMOJI.WARNING} ${STYLE.BOLD('Stop Loss Layer Settings')}\n\n${EMOJI.INFO} Select how many consecutive losses before skipping bets:`, makeSLLayerKeyboard());
    return;
  }
  
if (buttonText === `${EMOJI.BACK} Back`) {
  if (userState[userId]?.state === "PLATFORM_SELECTED") {
    const loggedIn = !!userSessions[userId];
    await sendMessageWithRetry(ctx, `${EMOJI.BACK} Returning to main menu...`, makeMainKeyboard(loggedIn, isAdmin));
    delete userState[userId];
    return;
  }
  
  const isOnPlatformKeyboard = Object.values(PLATFORMS).some(p => 
    buttonText.includes(p.name) || buttonText.includes(p.color)
  );
  
  if (isOnPlatformKeyboard) {
    const loggedIn = !!userSessions[userId];
    await sendMessageWithRetry(ctx, `${EMOJI.BACK} Returning to main menu...`, makeMainKeyboard(loggedIn, isAdmin));
  } else {
    const loggedIn = !!userSessions[userId];
    if (!loggedIn) {
      await sendMessageWithRetry(ctx, 
        `${EMOJI.LOGIN} ${STYLE.BOLD('Select Platform')}\n\n` +
        `${EMOJI.INFO} Choose your lottery platform:`,
        makePlatformKeyboard()
      );
    } else {
      await sendMessageWithRetry(ctx, `${EMOJI.BACK} Returning to main menu...`, makeMainKeyboard(loggedIn, isAdmin));
    }
  }
  
  delete userState[userId];
  return;
}
  
  if (buttonText === `${EMOJI.RISK} အန္တရာယ်စီမံခန့်ခွဲမှု`) {
    await sendMessageWithRetry(ctx, `${EMOJI.RISK} ${STYLE.BOLD('အန္တရာယ်စီမံခန့်ခွဲမှု')}\n\n${EMOJI.INFO} Configure your betting safety settings below:`, makeRiskManagementSubmenu());
    return;
  }
  
  if (buttonText === `${EMOJI.START} စတင်ကစားမယ်`) {
    console.log(`[USER_ACTIVITY] User ${userName} (ID: ${userId}) started the bot`);
    
    const settings = userSettings[userId] || {};
    
    if (!settings.bet_sizes) {
      await sendMessageWithRetry(ctx, `${EMOJI.ERROR} Please set BET SIZE first!`, makeMainKeyboard(true, isAdmin));
      return;
    }
    
    if (settings.strategy === "BS_ORDER" && !settings.pattern) {
      settings.pattern = DEFAULT_BS_ORDER;
      settings.pattern_index = 0;
      await sendMessageWithRetry(ctx, `${EMOJI.INFO} Using default order: ${DEFAULT_BS_ORDER}`, makeMainKeyboard(true, isAdmin));
    }
    
    if (settings.betting_strategy === "D'Alembert" && settings.bet_sizes.length >1) {
      await sendMessageWithRetry(ctx, `${EMOJI.ERROR} D'Alembert requires only ONE bet size.`, makeMainKeyboard(true, isAdmin));
      return;
    }
    
    if (settings.running) {
      await sendMessageWithRetry(ctx, `${EMOJI.INFO} Bot is already running!`, makeMainKeyboard(true, isAdmin));
      return;
    }
    
    settings.running = true;
    settings.consecutive_errors = 0;
    saveUserSettings();
    
    const entryLayer = settings.layer_limit || 1;
    
    if (entryLayer === 2) {
      settings.entry_layer_state = { waiting_for_lose: true };
    } else if (entryLayer === 3) {
      settings.entry_layer_state = { waiting_for_loses: true, consecutive_loses: 0 };
    }
    
    if (settings.strategy === "TREND_FOLLOW") {
      settings.trend_state = { last_result: null, skip_mode: false };
      const betType = settings.bet_type || "BS";
      if (betType === "COLOR") settings.color_trend_state = { last_result: null };
    }
    
    if (settings.strategy === "ALTERNATE") {
      settings.alternate_state = { last_result: null, skip_mode: false };
    }
    
    if (settings.strategy === "CYBER_SNIPER") {
      settings.cyber_sniper_state = {
        active: false,
        direction: null,
        sequence: [],
        step: 0,
        hit_count: 0,
        got_same_result: false
      };
    }
    if (settings.strategy === "COLOR_SNIPER") {
      settings.color_sniper_state = {
        active: false,
        step: 0,
        hit_count: 0,
        waiting_for_trigger: true
      };
    }
    if (settings.strategy === "TIME_WARP" && !settings.time_warp_pos) {
      settings.time_warp_pos = 8;
    }
    if (settings.strategy === "ULTRA_SNIPER") {
      settings.ultra_sniper_state = { active: false, step: 0, direction: null, betCount: 0 };
    }
    if (settings.strategy === "CHAOS_SEEKER") {
      settings.chaos_seeker_state = { active: false, triggerPattern: null, betCount: 0, multiplier: 1 };
    }

if (["CYBER_SNIPER", "COLOR_SNIPER", "ULTRA_SNIPER", "CHAOS_SEEKER"].includes(settings.strategy)) {
  settings.sniper_hit_count = 0;
  settings.sniper_loss_count = 0;
  logging.info(`Reset sniper counters for ${settings.strategy}`);
}

    delete userSkippedBets[userId];
    userShouldSkipNext[userId] = false;
    delete userSLSkipWaitingForWin[userId];
    userWaitingForResult[userId] = false;
    
    bettingWorker(userId, ctx, ctx.telegram);
    return;
  }
  
  if (buttonText === `${EMOJI.STOP} ကစားတာ ရပ်မယ်`) {
    console.log(`[USER_ACTIVITY] User ${userName} (ID: ${userId}) stopped the bot`);
    
    const settings = userSettings[userId] || {};
    if (!settings.running) {
      await sendMessageWithRetry(ctx, `${EMOJI.INFO} Bot is not running!`, makeMainKeyboard(true, isAdmin));
      return;
    }
    
    userStopInitiated[userId] = true;
    settings.running = false;
    delete userWaitingForResult[userId];
    delete userShouldSkipNext[userId];
    delete userSLSkipWaitingForWin[userId];
    
    saveUserSettings();

if (settings.strategy === "TREND_FOLLOW") {
  delete settings.trend_state;
  delete settings.color_trend_state;
}
if (settings.strategy === "ALTERNATE") {
  delete settings.alternate_state;
}

if (settings.strategy === "CYBER_SNIPER") {
  delete settings.cyber_sniper_state;
}
if (settings.strategy === "COLOR_SNIPER") {
  delete settings.color_sniper_state;
}
if (settings.strategy === "TIME_WARP") {
  delete settings.time_warp_pos;
}
if (settings.strategy === "ULTRA_SNIPER") {
  delete settings.ultra_sniper_state;
}
if (settings.strategy === "CHAOS_SEEKER") {
  delete settings.chaos_seeker_state;
}
if (settings.strategy === "REAPER") {
  delete settings.reaper_state;
}
if (settings.strategy === "DEEPSEEK_ADAPTIVE") {
  delete settings.deepseek_adaptive_state;
  delete settings.sniper_hit_count;
  delete settings.sniper_loss_count;
}
if (settings.strategy === "DEEPSEEK_PREDICTOR" || settings.strategy === "DEEPSEEK_NEURAL") {
  delete settings.sniper_hit_count;
  delete settings.sniper_loss_count;
}
if (settings.strategy === "GPT_ADAPTIVE_AI") {
  delete settings.gpt_ai_state;
  delete settings.sniper_hit_count;
  delete settings.sniper_loss_count;
}

let totalProfit = 0;
let balanceText = "";
    
    if (settings.virtual_mode) {
      totalProfit = (userStats[userId]?.virtual_balance || 0) - (userStats[userId]?.initial_balance || 0);
      balanceText = `${EMOJI.VIRTUAL} Virtual Balance: ${(userStats[userId]?.virtual_balance || 0).toFixed(2)} Ks\n`;
    } else {
      totalProfit = userStats[userId]?.profit || 0;
      try {
        const session = userSessions[userId];
        const finalBalance = await getBalance(session, userId);
        balanceText = `${EMOJI.BALANCE} Final Balance: ${finalBalance?.toFixed(2) || '0.00'} Ks\n`;
      } catch (error) {
        balanceText = `${EMOJI.BALANCE} Final Balance: Unknown\n`;
      }
    }
    
    let profitIndicator = "";
    if (totalProfit > 0) profitIndicator = "+";
    else if (totalProfit < 0) profitIndicator = "-";
    
    delete userStats[userId];
    settings.martin_index = 0;
    settings.dalembert_units =1;
    settings.custom_index =0;
    
    saveUserSettings();
    
    const message = `${EMOJI.STOP} ${STYLE.BOLD('SESSION TERMINATED')}\n${balanceText}${EMOJI.PROFIT} Total Profit: ${profitIndicator}${totalProfit.toFixed(2)} Ks`;
    await sendMessageWithRetry(ctx, message, makeMainKeyboard(true, isAdmin));
    return;
  }
  
  if (buttonText === `${EMOJI.BALANCE} လောင်းကြေး သတ်မှတ်`) {
    userState[userId] = { state: "INPUT_BET_SIZES" };
    await sendMessageWithRetry(ctx, `${EMOJI.BALANCE} လောင်းကြေးထိုးရန် ထိုးငွေ ပမာဏ ပို့ပါ (တစ်ကြိမ်သာ ပို့ပါ):\n${STYLE.CODE('100')}\n${STYLE.CODE('200')}\n${STYLE.CODE('500')}`, makeMainKeyboard(true, isAdmin));
    return;
  }
  
  if (buttonText === `${EMOJI.STRATEGY} နည်းဗျူဟာ`) {
    await sendMessageWithRetry(ctx, `${EMOJI.STRATEGY} Choose နည်းဗျူဟာ:`, makeStrategyKeyboard(userId));
    return;
  }
  
  if (buttonText === `${EMOJI.SETTINGS} လောင်းကစား ဆက်တင်များ`) {
    await sendMessageWithRetry(ctx, `${EMOJI.SETTINGS} Choose Betting Strategy`, makeBettingStrategyKeyboard());
    return;
  }
  
  if (buttonText === `${EMOJI.GAME} ဂိမ်း မုဒ်`) {
    await sendMessageWithRetry(ctx, `${EMOJI.GAME} Select Mode:`, makeModeSelectionKeyboard());
    return;
  }
  
if (buttonText === `${EMOJI.LOGIN} Login`) {
  await sendMessageWithRetry(ctx, 
    `${EMOJI.LOGIN} ${STYLE.BOLD('Select Platform')}\n\n` +
    `${EMOJI.INFO} Choose your lottery platform:`,
    makePlatformKeyboard()
  );
  return;
}
  
if (buttonText === `${EMOJI.LOGOUT} Re-Login`) {
  delete userSessions[userId];
  delete userGameInfo[userId];
  delete userStats[userId];
  delete userLastResults[userId];
  delete userPlatforms[userId];
  
  await sendMessageWithRetry(ctx, 
    `${EMOJI.LOGIN} ${STYLE.BOLD('Select Platform')}\n\n` +
    `${EMOJI.INFO} Choose your lottery platform:`,
    makePlatformKeyboard()
  );
  return;
}
  
  const text = normalizeText(rawText);
  const lines = text.split('\n').map(line => line.trim()).filter(line => line);
  
if (userState[userId]?.state === "PLATFORM_SELECTED" && lines.length >= 2) {
  const platformKey = userState[userId].platform;
  const platform = PLATFORMS[platformKey];
  const phone = lines[0];
  const password = lines[1];
  
  console.log(`[USER_ACTIVITY] User ${userName} (ID: ${userId}) logging into ${platform.name}`);
  activeUsers.add(userId);
  
  await sendMessageWithRetry(ctx, `🔍 အကောင့်ဝင်ခြင်း စစ်ဆေးနေသည် ခဏစောင့်ပါ.......`);
  
  userPlatforms[userId] = platformKey;
  
  const { response: res, session } = await loginRequest(phone, password, platform.baseUrl);

  if (session) {
    const userInfo = await getUserInfo(session, userId);
    if (userInfo && userInfo.user_id) {
      const gameUserId = userInfo.user_id;

      if (!freeModeEnabled && !allowedsixlotteryIds.has(gameUserId)) {
        await sendMessageWithRetry(ctx, 
          `${EMOJI.ERROR} ${STYLE.BOLD('သင်၏ ID အား အတည်ပြုမထားရသေးပါ .')}\n\n` +
          `${EMOJI.INFO} Admin အား ခွင့်ပြုချက်တောင်းပါ .\n` +
          `${EMOJI.INFO} ခွင့်ပြုချက်တောင်းရန် @Zen\\_Offical သို့ ID ပို့ပေးပါ:\n` +
          `${STYLE.ITEM(`သင်၏ ID: ${STYLE.CODE(gameUserId.toString())}`)}`,
          makeMainKeyboard(false, isAdmin)
        );
        return;
      }

      userSessions[userId] = session;
      userGameInfo[userId] = userInfo;
      userTemp[userId] = { password, platform: platformKey };
      
      userAllResults[userId] = [];
      userLastResults[userId] = [];
      
      const balance = await getBalance(session, userId);
      
      if (!userSettings[userId]) {
        userSettings[userId] = {
          platform: platformKey,
          strategy: "TREND_FOLLOW",
          betting_strategy: "Martingale",
          game_type: platformKey === "CKLOTTERY" ? "TRX" : "WINGO", 
          bet_type: "BS",
          martin_index: 0,
          dalembert_units:1,
          pattern_index: 0,
          running: false,
          consecutive_losses: 0,
          current_layer: 0,
          skip_betting: false,
          sl_layer: null,
          original_martin_index: 0,
          original_dalembert_units:1,
          original_custom_index: 0,
          custom_index: 0,
          layer_limit: 1,
          virtual_mode: false,
          bs_sb_wait_count: 0,
          bb_ss_wait_count: 0,
          rounds_played: 0,
          // AI Mode State ထည့်ရန်
          ai_mode: {
            enabled: false,
            level: "SMART",
            current_strategy: null,
            base_bet_percent: 1.2,
            max_drawdown: 15,
            soft_drawdown: 8,
            last_switch_round: 0,
            pause_until: null
          }
        };
      } else {
        userSettings[userId].platform = platformKey;
      }
      
      if (!userStats[userId]) {
        userStats[userId] = { start_balance: parseFloat(balance || 0), profit: 0.0, recent_results: [] };
      }
      
      const balanceDisplay = balance !== null ? balance :0.0;
      const modeStatus = (platformKey === "CKLOTTERY" && !freeModeEnabled) ? "" : `${EMOJI.CHECK} (Free Mode)`;
      
      const loginMessage = 
        `${platform.color} ${STYLE.BOLD(`အကောင့်ဝင်ခြင်း အောင်မြင်ခြင်း`)}\n\n${STYLE.BOLD(' 🔓ဂိမ်းပလန်:')} ${modeStatus}\n ${STYLE.BOLD('🎮 ဂိမ်းအမည် :')} ${platform.name}\n` +
        `${EMOJI.USER} ${STYLE.BOLD('အသုံးပြုသူအကောင့် ID:')} ${STYLE.CODE(userInfo.user_id.toString())}\n` +
        `${EMOJI.BALANCE} ${STYLE.BOLD('လက်ကျန်ငွေ ပမာဏ:')} ${balanceDisplay} Ks\n\n` +
        `${EMOJI.START} ကြိုဆိုပါတယ်! သင်၏ဆက်တင်များကို စီစဉ်သတ်မှတ်ပါ။.`;
      
      await sendMessageWithRetry(ctx, loginMessage, makeMainKeyboard(true, isAdmin));
      
      if (userSettings[userId].bet_sizes && userSettings[userId].pattern) {
        await showUserStats(ctx, userId);
      }
      
      saveUserSettings();
    } else {
      await sendMessageWithRetry(ctx, `${EMOJI.ERROR} Login failed: Could not get user info`, makeMainKeyboard(false, isAdmin));
    }
  } else {
    const msg = res.msg || "Login failed";
    await sendMessageWithRetry(ctx, `${EMOJI.ERROR} Login error: ${msg}`, makeMainKeyboard(false, isAdmin));
  }
  
  delete userState[userId];
  delete userTemp[userId];
  return;
}

  
  const currentState = userState[userId]?.state;
  
  if (currentState === "INPUT_VIRTUAL_BALANCE") {
    const balance = parseFloat(text);
    if (isNaN(balance) || balance <= 0) {
      await sendMessageWithRetry(ctx, `${EMOJI.ERROR} Invalid balance amount.`);
      return;
    }
    const settings = userSettings[userId];
    settings.virtual_mode = true;
    settings.virtual_balance = balance;
    
    if (!userStats[userId]) {
      userStats[userId] = {};
    }
    userStats[userId].virtual_balance = balance;
    userStats[userId].initial_balance = balance;
    
    await sendMessageWithRetry(ctx, `${EMOJI.SUCCESS} ${STYLE.BOLD('Virtual Mode:')} ${balance} Ks`, makeMainKeyboard(true, isAdmin));
    delete userState[userId];
    saveUserSettings();
    return;
  }
  
  if (!await checkUserAuthorized(ctx) && text.toLowerCase() !== "login") {
    return;
  }
  
  if (currentState === "INPUT_BET_SIZES") {
    const betSizes = lines.filter(s => s.match(/^\d+$/)).map(Number);
    if (betSizes.length === 0) {
      await sendMessageWithRetry(ctx, `${EMOJI.ERROR} No valid numbers entered.`, makeMainKeyboard(true, isAdmin));
      return;
    }
    
    const settings = userSettings[userId];
    if (settings.betting_strategy === "D'Alembert" && betSizes.length >1) {
      await sendMessageWithRetry(ctx, `${EMOJI.ERROR} D'Alembert requires only ONE bet size.`, makeMainKeyboard(true, isAdmin));
      return;
    }
    
    userSettings[userId].bet_sizes = betSizes;
    userSettings[userId].dalembert_units = 1;
    userSettings[userId].martin_index = 0;
    userSettings[userId].custom_index = 0;
    
    await sendMessageWithRetry(ctx, `${EMOJI.SUCCESS} ${STYLE.BOLD('လောင်းကြေး set:')} ${betSizes.join(',')} Ks`, makeMainKeyboard(true, isAdmin));
    delete userState[userId];
    saveUserSettings();
} else if (currentState === "INPUT_BS_PATTERN") {
    const pattern = text.toUpperCase().trim();
    
    if (!pattern) {
        await sendMessageWithRetry(ctx, `${EMOJI.ERROR} Pattern cannot be empty.`, makeMainKeyboard(true, isAdmin));
        return;
    }
    
    if (!pattern.split('').every(c => c === 'B' || c === 'S')) {
        await sendMessageWithRetry(ctx, `${EMOJI.ERROR} Pattern can only contain 'B' and 'S'.`, makeMainKeyboard(true, isAdmin));
        return;
    }
    
    if (pattern.length < 3) {
        await sendMessageWithRetry(ctx, `${EMOJI.ERROR} Pattern must be at least 3 characters long.`, makeMainKeyboard(true, isAdmin));
        return;
    }
    
    userSettings[userId].pattern = pattern;
    userSettings[userId].pattern_index = 0;
    
    await sendMessageWithRetry(ctx, 
        `${EMOJI.SUCCESS} ${STYLE.BOLD('BS Pattern set:')} ${pattern}\n` +
        `${EMOJI.INFO} Pattern length: ${pattern.length} characters\n` +
        `${EMOJI.INFO} First bet will be: ${pattern[0]}`, 
        makeMainKeyboard(true, isAdmin)
    );
    
    delete userState[userId];
    saveUserSettings();
} else if (currentState === "INPUT_PROFIT_TARGET") {
    const target = parseFloat(text);
    if (isNaN(target) || target <= 0) {
      await sendMessageWithRetry(ctx, `${EMOJI.ERROR} Invalid profit target.`, makeRiskManagementSubmenu());
      return;
    }
    userSettings[userId].target_profit = target;
    await sendMessageWithRetry(ctx, `${EMOJI.SUCCESS} ${STYLE.BOLD('TARGET set:')} ${target} Ks`, makeRiskManagementSubmenu());
    delete userState[userId];
    saveUserSettings();
  } else if (currentState === "INPUT_STOP_LIMIT") {
    const stopLoss = parseFloat(text);
    if (isNaN(stopLoss) || stopLoss <= 0) {
      await sendMessageWithRetry(ctx, `${EMOJI.ERROR} Invalid stop loss.`, makeRiskManagementSubmenu());
      return;
    }
    userSettings[userId].stop_loss = stopLoss;
    await sendMessageWithRetry(ctx, `${EMOJI.SUCCESS} ${STYLE.BOLD('STOP LOSS set:')} ${stopLoss} Ks`, makeRiskManagementSubmenu());
    delete userState[userId];
    saveUserSettings();
  } else {
    if (userSessions[userId] && text.trim() !== "") {
      if (text.length > 1 && !text.match(/^\/[a-zA-Z]/)) {
        await sendMessageWithRetry(ctx, `${EMOJI.ERROR} Unknown command.`, makeMainKeyboard(true, isAdmin));
      }
    }
  }
}

function escapeMarkdown(text) {
  if (typeof text !== 'string') return text;
  return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&');
}

async function showUserStats(ctx, userId) {
  const session = userSessions[userId];
  const userInfo = userGameInfo[userId];
  
  if (!userInfo) {
    await sendMessageWithRetry(ctx, `${EMOJI.ERROR} Failed to get user info. Please login first.`, makeMainKeyboard(!!userSessions[userId], userId === ADMIN_ID));
    return;
  }
  
  const settings = userSettings[userId] || {};
  const betSizes = settings.bet_sizes || [];
  const strategy = settings.strategy || "TREND_FOLLOW";
  const bettingStrategy = settings.betting_strategy || "Martingale";
  const gameType = settings.game_type || "TRX";
  const betType = settings.bet_type || "BS";
  const virtualMode = settings.virtual_mode || false;
  const profitTarget = settings.target_profit;
  const stopLoss = settings.stop_loss;
  const slLayer = settings.sl_layer;
  const layerLimit = settings.layer_limit || 1;
  
  // AI Mode Status ထည့်ရန်
  const aiMode = settings.ai_mode || { enabled: false, level: "SMART" };
  const aiStatus = aiMode.enabled ? `🟢 ${aiMode.level}` : '🔴 Disabled';
  
  const platformKey = settings.platform || "CKLOTTERY";
  const platform = PLATFORMS[platformKey];
  
  let balance;
  
  if (virtualMode) {
    balance = userStats[userId]?.virtual_balance || settings.virtual_balance || 0;
  } else {
    if (session) {
      balance = await getBalance(session, userId);
    } else {
      balance = userInfo.balance || 0;
    }
  }
  
  let betOrder = "N/A";
  if (strategy === "BS_ORDER") {
    betOrder = settings.pattern || "BS-Order";
  }
  
  let entryLayerDesc = layerLimit === 1 ? "Bet immediately" : layerLimit === 2 ? "Wait for 1 lose" : "Wait for 2 loses";
  let slStatus = userSLSkipWaitingForWin[userId] ? " (Waiting for Skip Win)" : (settings.consecutive_losses > 0 ? ` (${settings.consecutive_losses}/${slLayer || 0})` : "");
  
  const modeText = virtualMode ? `${EMOJI.VIRTUAL} Virtual Mode` : `${EMOJI.REAL} Real Mode`;
  const betTypeText = betType === "COLOR" ? `Color` : `Big/Small`;
  const freeModeStatus = freeModeEnabled ? `${EMOJI.ENABLE} Free Mode` : `${EMOJI.DISABLE} Restricted Mode`;
  
  const safeText = (text) => {
    if (text === null || text === undefined) return '';
    return String(text).replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&');
  };
  
  const infoText = 
    `${EMOJI.STATS} *အကောင့် အချက်အလက်*\n` +
    `${STYLE.SEPARATOR}\n\n` +
    
    `${EMOJI.USER} *USER DETAILS*\n` +
    `${STYLE.ITEM(`User ID: \`${safeText(userInfo.user_id?.toString() || 'N/A')}\``)}\n` +
    `${STYLE.ITEM(`Username: ${safeText(userInfo.nickname || userInfo.username || 'Unknown')}`)}\n` +
    `${STYLE.ITEM(`Platform: ${safeText(platform.name)} ${platform.color}`)}\n` +
    `${STYLE.LAST_ITEM(`Login Date: ${safeText(userInfo.login_date || 'N/A')}`)}\n` +
    `${STYLE.SEPARATOR}\n\n` +
    
    `${EMOJI.BALANCE} *BALANCE INFORMATION*\n` +
    `${STYLE.ITEM(`Balance: ${safeText(balance !== null && balance !== undefined ? balance.toFixed(2) : 'N/A')} Ks`)}\n` +
    `${STYLE.ITEM(`Mode: ${safeText(modeText)}`)}\n` +
    `${STYLE.ITEM(`AI Mode: ${safeText(aiStatus)}`)}\n` +
    `${STYLE.LAST_ITEM(`Status: ${safeText(freeModeStatus)}`)}\n` +
    `${STYLE.SEPARATOR}\n\n` +
    
    `${EMOJI.GAME} *GAME SETTINGS*\n` +
    `${STYLE.ITEM(`Game: ${safeText(gameType)}`)}\n` +
    `${STYLE.ITEM(`Type: ${safeText(betTypeText)}`)}\n` +
    `${STYLE.ITEM(`Strategy: ${safeText(strategy)}`)}\n` +
    `${STYLE.ITEM(`Betting: ${safeText(bettingStrategy)}`)}\n` +
    `${STYLE.LAST_ITEM(`Bet Sizes: ${safeText(betSizes.join(', ') || 'Not set')}`)}\n` +
    `${STYLE.SEPARATOR}\n\n` +
    
    `${EMOJI.STRATEGY} *STRATEGY CONFIGURATION*\n` +
    `${STYLE.ITEM(`BS Order: ${safeText(betOrder)}`)}\n` +
    `${STYLE.ITEM(`Profit Target: ${safeText(profitTarget ? profitTarget + ' Ks' : 'Not set')}`)}\n` +
    `${STYLE.ITEM(`Stop Loss: ${safeText(stopLoss ? stopLoss + ' Ks' : 'Not set')}`)}\n` +
    `${STYLE.ITEM(`SL Layer: ${safeText(slLayer ? slLayer + ' Layer' + slStatus : 'Not set')}`)}\n` +
    `${STYLE.LAST_ITEM(`Entry Layer: ${safeText(layerLimit.toString())} - ${safeText(entryLayerDesc)}`)}\n` +
    `${STYLE.SEPARATOR}\n\n` +
    
    `${EMOJI.START} *BOT STATUS*\n` +
    `${STYLE.LAST_ITEM(`Status: ${settings.running ? '🟢 ' : '🔴 '}${safeText(settings.running ? 'Running' : 'Stopped')}`)}\n\n` +
    `${STYLE.SEPARATOR}`;
  
  await sendMessageWithRetry(ctx, infoText, makeMainKeyboard(!!userSessions[userId], userId === ADMIN_ID));
}

// ⚙️ Config
const BASE_URL = PLATFORMS["CKLOTTERY"].baseUrl;
// ဒီလို ပြောင်းပါ (အောက်ဆုံးအနီး Config အပိုင်း)
const BOT_TOKEN = process.env.BOT_TOKEN || "8747393674:AAHKPjJ3qRi7ET3_kA3gyUj2PUUWL9n0drY";
const ADMIN_ID = parseInt(process.env.ADMIN_ID || "8877888465");
const IGNORE_SSL = true;
const WIN_LOSE_CHECK_INTERVAL = 2;
const MAX_RESULT_WAIT_TIME = 60;
const MAX_BALANCE_RETRIES = 10;
const BALANCE_RETRY_DELAY = 5;
const BALANCE_API_TIMEOUT = 20000;
const BET_API_TIMEOUT = 30000;
const MAX_BET_RETRIES = 5;
const BET_RETRY_DELAY = 5;
const MAX_CONSECUTIVE_ERRORS = 10;
const MESSAGE_RATE_LIMIT_SECONDS = 10;
const MAX_TELEGRAM_RETRIES = 3;
const TELEGRAM_RETRY_DELAY = 2000;
const DEFAULT_BS_ORDER = "BSBBSBSSSB";
const SNIPER_NOTIFICATIONS = true;
const SNIPER_MAX_HITS = 2;
const SNIPER_MAX_LOSSES = 4;

function main() {
  loadAllowedUsers();
  loadUserSettings();
  loadFreeModeSetting(); 
  
  setInterval(() => {
    const previousState = freeModeEnabled;
    loadFreeModeSetting();
    if (previousState !== freeModeEnabled) {
      logging.info(`Free Mode state changed: ${previousState ? 'ENABLED' : 'DISABLED'} → ${freeModeEnabled ? 'ENABLED' : 'DISABLED'}`);
    }
  }, 30000); 
  
  const bot = new Telegraf(BOT_TOKEN);
  
  bot.catch((err, ctx) => {
  logging.error(`[BOT.CATCH] Error during update ${ctx.updateType}: ${err.message}`);
  console.error(err.stack);
});

bot.start(cmdStartHandler);
bot.command('allow', cmdAllowHandler);
bot.command('remove', cmdRemoveHandler);
bot.command('showid', cmdShowIdHandler);
bot.command('users', cmdUsersHandler);
bot.command('send', cmdSendHandler);
bot.command('enable', cmdEnableFreeMode);
bot.command('disable', cmdDisableFreeMode);
bot.command('freemode', cmdCheckFreeMode);
bot.on('callback_query', callbackQueryHandler);
bot.on('text', textMessageHandler);

winLoseChecker(bot).catch(error => {
  logging.error(`Win/lose checker failed: ${error.message}`);
});

bot.launch().then(() => {
  logging.info('🚀 Bot started successfully with AI Mode');
}).catch(error => {
  logging.error(`❌ Bot failed to start: ${error.message}`);
});

  process.on('uncaughtException', (error) => {
    logging.error(`💥 Uncaught Exception: ${error.message}`);
    logging.error(error.stack);
  });
  
  process.on('unhandledRejection', (reason, promise) => {
    logging.error(`⚠️ Unhandled Rejection at: ${promise}, reason: ${reason}`);
  });
  
  process.once('SIGINT', () => {
    saveUserSettings();
    bot.stop('SIGINT');
  });
  
  process.once('SIGTERM', () => {
    saveUserSettings();
    bot.stop('SIGTERM');
  });
}

if (require.main === module) {
  main();
    }
