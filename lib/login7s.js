/**
 * 7S Crown auto login using reverse-engineered RSA+DES
 * body: { username, password, device: "MTH" }
 * returns token string or null
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const https = require('https');

const BASE = process.env.S7_BASE || 'https://www.7scrown48.xyz';
const MERCHANT = '7smmkf5';

let sandbox = null;

function loadCrypto() {
  if (sandbox) return sandbox;
  const cryptoJsCode = fs.readFileSync(path.join(__dirname, 'crypto-js.js'), 'utf8');
  const encryptCode = fs.readFileSync(path.join(__dirname, 'vendor.encrypt.js'), 'utf8');
  sandbox = {
    console, Math, parseInt, parseFloat, isNaN, Number, String, Array, Object, JSON, Date, RegExp, Error,
    setTimeout, clearTimeout, Buffer, Uint8Array,
    window: {}, document: { createElement: () => ({ style: {} }), documentElement: {} },
    navigator: { userAgent: 'Mozilla/5.0', onLine: true },
    location: { href: BASE + '/m/login', protocol: 'https:' },
    XMLHttpRequest: class {
      open() {}
      setRequestHeader() {}
      send() {
        this.status = 200;
        this.response = sandbox.__MOD || '';
        if (this.onload) this.onload();
      }
    },
    module: { exports: {} }, exports: {}, define: undefined,
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(cryptoJsCode, sandbox);
  sandbox.CryptoJS = sandbox.CryptoJS || sandbox.module.exports;
  vm.runInContext(encryptCode, sandbox);
  return sandbox;
}

function httpGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname, path: u.pathname + u.search, method: 'GET', headers
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    req.on('error', reject);
    req.end();
  });
}

function httpPost(url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = typeof body === 'string' ? body : JSON.stringify(body);
    const req = https.request({
      hostname: u.hostname, path: u.pathname + u.search, method: 'POST',
      headers: { 'Content-Length': Buffer.byteLength(data), ...headers }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function login7s(username, password) {
  const sb = loadCrypto();
  const modRes = await httpGet(BASE + '/wps/session/key/rsa', {
    accept: '*/*', merchant: MERCHANT, language: 'MY',
    Referer: BASE + '/m/login',
    'User-Agent': 'Mozilla/5.0 (Linux; Android 12) Chrome/147.0.0.0 Mobile Safari/537.36',
    'x-requested-with': 'prod.app_7smmkf5.com',
  });
  const mod = (modRes.body || '').trim();
  if (!mod || mod.length < 64) throw new Error('RSA key failed: ' + modRes.body);
  sb.__MOD = mod;

  const body = { username: String(username), password: String(password), device: 'MTH' };
  const enc = await new Promise((resolve, reject) => {
    sb.reRsaV2(body).then(resolve).catch(reject);
  });
  if (!enc || !enc.success) throw new Error('Encrypt failed: ' + (enc && enc.message));

  const res = await httpPost(BASE + '/wps/session/login', JSON.stringify(enc.DES), {
    accept: 'application/json, text/plain, */*',
    'content-type': 'application/json',
    merchant: MERCHANT,
    language: 'MY',
    Encryption: enc.RSA,
    Device: 'MTH',
    Referer: BASE + '/m/login',
    'User-Agent': 'Mozilla/5.0 (Linux; Android 12) Chrome/147.0.0.0 Mobile Safari/537.36',
    'x-requested-with': 'prod.app_7smmkf5.com',
  });

  let data;
  try { data = JSON.parse(res.body); } catch (e) { throw new Error('Login bad response: ' + res.body.slice(0, 200)); }
  if (data.success && data.value && data.value.token) {
    return {
      token: data.value.token,
      userName: data.value.userName,
      id: data.value.id,
      raw: data.value,
    };
  }
  throw new Error(data.message || data.errorCode || 'Login failed');
}

module.exports = { login7s, BASE, MERCHANT };
