// backend/lib/apiKeys.js — provider별 API 키 배열을 담은 JSON 설정 파일(backend/config/apiKeys.json)
// 로더. GEMINI 외 다른 provider(OpenAI 등)가 나중에 추가돼도 이 파일은 안 바뀐다 —
// apiKeys.json에 provider 키만 더 추가하면 됨.
import { readFileSync } from 'node:fs';
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
  return keys.filter((k) => typeof k === 'string' && k.trim().length > 0);
}

let cache = null;

export function getApiKeys(provider) {
  if (!cache) {
    cache = loadApiKeysFromFile(DEFAULT_CONFIG_PATH);
  }
  return filterValidKeys(cache[provider]);
}
