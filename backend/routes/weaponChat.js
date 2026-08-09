import { Router } from 'express';
import { interpretCommand } from '../lib/aiClient.js';
import { ALL_SHAPES, isValidShapeId, generatePartId, clampScale, partScale } from '../../shapes/registry.js';
import { validateWeaponState } from '../lib/weaponStateValidation.js';
import { logError } from '../lib/errorLog.js';

export const CANVAS_SIZE = { width: 480, height: 480 };
export const MAX_PARTS = 25;

function clamp(value, min, max) {
  const num = Number(value);
  if (!Number.isFinite(num)) return min;
  return Math.min(max, Math.max(min, num));
}

// rotation은 0~360 어떤 값도 유효한 각도라 clamp(min,max)를 씌울 수 없다 — "숫자가 아니면
// 대체값으로" 만 방어한다. 예전엔 call.rotation을 검증 없이 그대로 저장해서, AI가(또는
// 나중에 실제 Gemini 응답이) 문자열/undefined rotation을 보내면 normalize()의 캐시 키가
// 깨지고 Konva의 rotation 속성에도 NaN이 들어가 도형이 화면에서 사라졌다(Opus 리뷰 Important #7).
function safeRotation(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

// AI 툴콜의 크기 인자를 (scaleX, scaleY)로 푼다. 모델이 scaleX/scaleY를 따로 줄 수도,
// 예전처럼 등비 scale 하나만 줄 수도 있어서(프롬프트를 바꿔도 100% 지키지는 않는다)
// 양쪽을 모두 받아들이고, 아무것도 안 주면 기존 값(fallback)을 유지한다.
function resolveCallScale(call, fallback) {
  const uniform = call.scale;
  const rawX = call.scaleX ?? uniform;
  const rawY = call.scaleY ?? uniform;
  return {
    scaleX: rawX === undefined || rawX === null ? fallback.sx : clampScale(rawX, fallback.sx),
    scaleY: rawY === undefined || rawY === null ? fallback.sy : clampScale(rawY, fallback.sy),
  };
}

export function applyToolCalls(weaponState, toolCalls) {
  let parts = [...weaponState.parts];
  for (const call of toolCalls) {
    if (call.op === 'addPart') {
      if (!isValidShapeId(call.shapeId)) continue;
      if (parts.length >= MAX_PARTS) continue;
      const { scaleX, scaleY } = resolveCallScale(call, { sx: 1, sy: 1 });
      parts.push({
        id: generatePartId(),
        shapeId: call.shapeId,
        x: clamp(call.x, 0, CANVAS_SIZE.width),
        y: clamp(call.y, 0, CANVAS_SIZE.height),
        rotation: safeRotation(call.rotation, 0),
        scaleX,
        scaleY,
      });
    } else if (call.op === 'movePart') {
      parts = parts.map((p) =>
        p.id === call.partId
          ? { ...p, x: clamp(call.x, 0, CANVAS_SIZE.width), y: clamp(call.y, 0, CANVAS_SIZE.height) }
          : p,
      );
    } else if (call.op === 'rotatePart') {
      parts = parts.map((p) => (p.id === call.partId ? { ...p, rotation: safeRotation(call.rotation, p.rotation) } : p));
    } else if (call.op === 'scalePart') {
      parts = parts.map((p) => {
        if (p.id !== call.partId) return p;
        const { scaleX, scaleY } = resolveCallScale(call, partScale(p));
        // 등비 scale만 들고 있던 예전 형식의 part를 고친 경우, 죽은 필드가 캐시 키와 AI
        // 프롬프트에 계속 실려 나가지 않도록 같이 지운다.
        const { scale, ...rest } = p;
        return { ...rest, scaleX, scaleY };
      });
    } else if (call.op === 'removePart') {
      parts = parts.filter((p) => p.id !== call.partId);
    }
  }
  return { parts };
}

const router = Router();

router.post('/', async (req, res) => {
  const { weaponState, message } = req.body ?? {};
  const validation = validateWeaponState(weaponState);
  if (!validation.ok) {
    return res.status(400).json({ error: validation.error });
  }
  try {
    const availableShapeIds = ALL_SHAPES.map((s) => s.id);
    const { toolCalls, reply } = await interpretCommand({
      weaponState,
      message,
      availableShapeIds,
      canvasSize: CANVAS_SIZE,
    });
    const updated = applyToolCalls(weaponState, toolCalls);
    res.json({ weaponState: updated, reply });
  } catch (err) {
    logError('weaponChat', err);
    res.status(502).json({ error: 'chat failed' });
  }
});

export default router;
