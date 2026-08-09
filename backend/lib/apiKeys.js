// backend/lib/apiKeys.js — provider별 API 키 배열을 담은 JSON 설정 파일(backend/config/apiKeys.json)
// 로더. GEMINI 외 다른 provider(OpenAI 등)가 나중에 추가돼도 이 파일은 안 바뀐다 —
// apiKeys.json에 provider 키만 더 추가하면 됨.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CONFIG_PATH = path.join(__dirname, '../config/apiKeys.json');

// 파일이 없거나(아직 설정 안 함) JSON이 깨졌으면 빈 객체를 반환한다 — 호출부(getApiKeys)가
// 빈 배열로 처리해서, 키 미설정 상태에서도 서버 기동 자체는 죽지 않고 실제 그 provider를
// 쓰려고 할 때만("키가 없습니다" 에러로) 실패한다.
export function loadApiKeysFromFile(filePath) {
  try {
    const raw = readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function filterValidKeys(keys) {
  if (!Array.isArray(keys)) return [];
  return [...new Set(keys.filter((k) => typeof k === 'string').map((k) => k.trim()).filter(Boolean))];
}

export function maskApiKey(key) {
  const value = String(key ?? '').trim();
  if (value.length < 4) return '****';
  return `****${value.slice(-4)}`;
}

export const AI_PROVIDERS = ['gemini', 'github', 'openrouter'];

export function detectApiKeyProvider(apiKey) {
  const value = typeof apiKey === 'string' ? apiKey.trim() : '';
  if (value.startsWith('ghp_') || value.startsWith('github_pat_')) return 'github';
  if (value.startsWith('sk-or-')) return 'openrouter';
  if (value.startsWith('AIza') || value.startsWith('AQ.')) return 'gemini';
  return null;
}

function validateNewApiKey(provider, apiKey) {
  if (!AI_PROVIDERS.includes(provider)) throw new Error('unsupported API provider');
  const value = typeof apiKey === 'string' ? apiKey.trim() : '';
  // Gemini 키는 일반적으로 이보다 훨씬 길다. 지나치게 짧거나 공백이 섞인 값은 입력 실수로 본다.
  if (value.length < 20 || value.length > 256 || /\s/.test(value)) {
    throw new Error('invalid API key format');
  }
  const detected = detectApiKeyProvider(value);
  if (detected && detected !== provider) throw new Error(`API key belongs to ${detected}, not ${provider}`);
  return value;
}

export function addApiKeyToFile(filePath, provider, apiKey) {
  const value = validateNewApiKey(provider, apiKey);
  let config = {};
  if (existsSync(filePath)) {
    const raw = readFileSync(filePath, 'utf-8');
    try {
      config = JSON.parse(raw);
    } catch {
      throw new Error('API key config is not valid JSON');
    }
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
      throw new Error('API key config must be an object');
    }
  }
  const current = filterValidKeys(config[provider]);
  if (current.includes(value)) return { added: false, keys: current };
  const keys = [...current, value];
  const next = { ...config, [provider]: keys };
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(next, null, 2)}\n`, { encoding: 'utf-8', mode: 0o600 });
  return { added: true, keys };
}

let cache = null;

export function getApiKeys(provider) {
  if (!cache) {
    cache = loadApiKeysFromFile(DEFAULT_CONFIG_PATH);
  }
  return filterValidKeys(cache[provider]);
}

export function getApiKeyStatus(provider = 'gemini') {
  const keys = getApiKeys(provider);
  return { provider, count: keys.length, maskedKeys: keys.map(maskApiKey) };
}

export function getAllApiCredentials() {
  return AI_PROVIDERS.flatMap((provider) =>
    getApiKeys(provider).map((apiKey) => ({ provider, apiKey })));
}

export function getAllApiKeyStatus() {
  const providers = Object.fromEntries(AI_PROVIDERS.map((provider) => [provider, getApiKeyStatus(provider)]));
  return {
    count: Object.values(providers).reduce((sum, item) => sum + item.count, 0),
    providers,
  };
}

export function addApiKey(provider, apiKey) {
  const result = addApiKeyToFile(DEFAULT_CONFIG_PATH, provider, apiKey);
  // 실행 중인 aiClient가 다음 요청부터 새 키를 즉시 사용하도록 메모리 캐시도 갱신한다.
  cache = loadApiKeysFromFile(DEFAULT_CONFIG_PATH);
  return { added: result.added, ...getApiKeyStatus(provider) };
}
