import { Router } from 'express';
import { interpretCommand } from '../lib/aiClient.js';
import { ALL_SHAPES, isValidShapeId, generatePartId } from '../../shapes/registry.js';
import { validateWeaponState } from '../lib/weaponStateValidation.js';

export const CANVAS_SIZE = { width: 480, height: 480 };
export const MAX_PARTS = 10;

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

export function applyToolCalls(weaponState, toolCalls) {
  let parts = [...weaponState.parts];
  for (const call of toolCalls) {
    if (call.op === 'addPart') {
      if (!isValidShapeId(call.shapeId)) continue;
      if (parts.length >= MAX_PARTS) continue;
      parts.push({
        id: generatePartId(),
        shapeId: call.shapeId,
        x: clamp(call.x, 0, CANVAS_SIZE.width),
        y: clamp(call.y, 0, CANVAS_SIZE.height),
        rotation: safeRotation(call.rotation, 0),
        scale: clamp(call.scale ?? 1, 0.2, 3),
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
      parts = parts.map((p) => (p.id === call.partId ? { ...p, scale: clamp(call.scale, 0.2, 3) } : p));
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
    console.error('[weaponChat] AI 채팅 처리 실패:', err);
    res.status(502).json({ error: 'chat failed' });
  }
});

export default router;
