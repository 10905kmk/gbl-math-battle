import { maskApiKey } from './apiKeys.js';

export const AI_SLOT_CAPACITY = 2;

const slots = new Map();

function normalizeCredential(input) {
  if (typeof input === 'string') return { provider: 'gemini', apiKey: input };
  return { provider: input?.provider ?? 'gemini', apiKey: input?.apiKey ?? '' };
}

function credentialId(input) {
  const { provider, apiKey } = normalizeCredential(input);
  return `${provider}:${apiKey}`;
}

function ensureSlot(credential) {
  const id = credentialId(credential);
  let slot = slots.get(id);
  if (!slot) {
    slot = {
      active: 0,
      queue: [],
      completed: 0,
      failed: 0,
      lastStartedAt: null,
      lastFinishedAt: null,
      lastErrorStatus: null,
    };
    slots.set(id, slot);
  }
  return slot;
}

function drain(credential, slot) {
  while (slot.active < AI_SLOT_CAPACITY && slot.queue.length > 0) {
    const job = slot.queue.shift();
    slot.active += 1;
    slot.lastStartedAt = Date.now();

    Promise.resolve()
      .then(job.task)
      .then((value) => {
        slot.completed += 1;
        slot.lastErrorStatus = null;
        job.resolve(value);
      })
      .catch((error) => {
        slot.failed += 1;
        slot.lastErrorStatus = Number.isFinite(error?.status) ? error.status : error?.name ?? 'ERROR';
        job.reject(error);
      })
      .finally(() => {
        slot.active -= 1;
        slot.lastFinishedAt = Date.now();
        drain(credential, slot);
      });
  }
}

export function runInAiSlot(credential, task) {
  const slot = ensureSlot(credential);
  return new Promise((resolve, reject) => {
    slot.queue.push({ task, resolve, reject });
    drain(credential, slot);
  });
}

export function getAiSlotStatus(apiCredentials) {
  const credentials = Array.isArray(apiCredentials) ? apiCredentials.map(normalizeCredential) : [];
  return {
    capacityPerKey: AI_SLOT_CAPACITY,
    totals: credentials.reduce((totals, credential) => {
      const slot = ensureSlot(credential);
      totals.active += slot.active;
      totals.queued += slot.queue.length;
      totals.capacity += AI_SLOT_CAPACITY;
      return totals;
    }, { active: 0, queued: 0, capacity: 0 }),
    slots: credentials.map((credential, index) => {
      const slot = ensureSlot(credential);
      const providerIndex = credentials.slice(0, index + 1).filter((item) => item.provider === credential.provider).length;
      const providerLabel = credential.provider === 'github'
        ? 'GitHub Models'
        : credential.provider === 'openrouter' ? 'OpenRouter' : 'Gemini';
      return {
        id: `${credential.provider}-${providerIndex}`,
        provider: credential.provider,
        label: `${providerLabel} ${providerIndex}`,
        maskedKey: maskApiKey(credential.apiKey),
        capacity: AI_SLOT_CAPACITY,
        active: slot.active,
        queued: slot.queue.length,
        completed: slot.completed,
        failed: slot.failed,
        lastStartedAt: slot.lastStartedAt,
        lastFinishedAt: slot.lastFinishedAt,
        lastErrorStatus: slot.lastErrorStatus,
      };
    }),
  };
}

export function resetAiSlotsForTests() {
  slots.clear();
}
