// 运行时配置和策略

// XAI Top10 固定账号列表
const XAI_TOP10_FIXED_ACCOUNTS = [
  'BitcoinMagazine',
  'AltcoinDaily',
  'TrendingBitcoin',
  'Vivek4real_',
  'BinanceUS',
  'ABTC',
  'coinspace_',
  'WatcherGuru',
  'CoinDesk',
  'BitcoinNews21M',
  'DocumentingBTC',
  'BitcoinArchive',
  'cz_binance',
  'TomLeeTracker',
  'BMNRBullz',
  'web3bannie',
  'fiatarchive',
  'SimplyBitcoin',
  'WOLF_Bitcoin_',
  'KevinWSHPod',
  'elonmusk'
];

// Runtime Jobs 保留时间（48 小时）
const RUNTIME_RETENTION_MS = 48 * 60 * 60 * 1000;

// 可编辑的 JSON 文件白名单
const EDITABLE_JSON_FILES = new Set([
  'workflow_api.json',
  'audio.json',
  'result.json',
  'director.json'
]);

// WeChat 账号字段
const WECHAT_ACCOUNT_FIELDS = [
  'displayName',
  'finderUserName',
  'helperAccount',
  'openPlatformAppId',
  'appId',
  'appSecret',
  'refreshToken',
  'accountId',
  'notes'
];

// 默认 ComfyUI 地址
const DEFAULT_COMFYUI_BASE_URL = process.env.COMFYUI_BASE_URL ||
  'https://u920820-82c4-2ba7d3b1.westc.seetacloud.com:8443';

module.exports = {
  XAI_TOP10_FIXED_ACCOUNTS,
  RUNTIME_RETENTION_MS,
  EDITABLE_JSON_FILES,
  WECHAT_ACCOUNT_FIELDS,
  DEFAULT_COMFYUI_BASE_URL
};
