import { Router } from 'express';
import { interpretCommand } from '../lib/aiClient.js';
import { ALL_SHAPES, isValidShapeId, generatePartId } from '../../shapes/registry.js';

export const CANVAS_SIZE = { width: 480, height: 480 };
export const MAX_PARTS = 10;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
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
        rotation: call.rotation ?? 0,
        scale: clamp(call.scale ?? 1, 0.2, 3),
      });
    } else if (call.op === 'movePart') {
      parts = parts.map((p) =>
        p.id === call.partId
          ? { ...p, x: clamp(call.x, 0, CANVAS_SIZE.width), y: clamp(call.y, 0, CANVAS_SIZE.height) }
          : p,
      );
    } else if (call.op === 'rotatePart') {
      parts = parts.map((p) => (p.id === call.partId ? { ...p, rotation: call.rotation } : p));
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
  const { weaponState, message } = req.body;
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
    res.status(502).json({ error: 'chat failed' });
  }
});

export default router;
