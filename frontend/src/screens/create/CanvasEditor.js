// frontend/src/screens/create/CanvasEditor.js
import { h } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import htm from 'htm';
import Konva from 'konva';
import { ALL_SHAPES, getShapeGeometry, generatePartId } from '../../../../shapes/registry.js';

const html = htm.bind(h);

export const CANVAS_SIZE = { width: 480, height: 480 };
// 서버(backend/routes/weaponChat.js)의 MAX_PARTS와 같은 값 — 부품 상한 10개(Global Constraints)를
// 수동 편집(팔레트 클릭) 경로에도 동일하게 적용한다.
const MAX_PARTS = 10;

function drawShapeNode(part) {
  const geometry = getShapeGeometry(part.shapeId);
  return new Konva.Shape({
    x: part.x,
    y: part.y,
    rotation: part.rotation,
    scaleX: part.scale,
    scaleY: part.scale,
    draggable: true,
    id: part.id,
    name: 'part',
    fill: '#8fd3ff',
    stroke: '#1a5f8a',
    strokeWidth: 2,
    // 모든 좌표는 캔버스 범위(480x480) 내로 clamp (Global Constraints) — 서버 clamp(applyToolCalls)와
    // 동일 규칙을 드래그 중에도 적용.
    dragBoundFunc(pos) {
      return {
        x: Math.min(CANVAS_SIZE.width, Math.max(0, pos.x)),
        y: Math.min(CANVAS_SIZE.height, Math.max(0, pos.y)),
      };
    },
    sceneFunc: (ctx, shape) => {
      ctx.beginPath();
      if (geometry.type === 'polygon') {
        geometry.points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
        ctx.closePath();
      } else if (geometry.type === 'triangles') {
        geometry.triangles.forEach(([a, b, c]) => {
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.lineTo(c.x, c.y);
          ctx.closePath();
        });
      }
      ctx.fillStrokeShape(shape);
    },
  });
}

// 캔버스(좌) — 팔레트로 도형 추가, 드래그로 이동. 회전/크기조절 핸들은 Task 11에서 추가.
export function CanvasEditor({ parts, onChange, onStageReady }) {
  const containerRef = useRef(null);
  const stageRef = useRef(null);
  const layerRef = useRef(null);

  useEffect(() => {
    const stage = new Konva.Stage({
      container: containerRef.current,
      width: CANVAS_SIZE.width,
      height: CANVAS_SIZE.height,
    });
    const layer = new Konva.Layer();
    stage.add(layer);
    stageRef.current = stage;
    layerRef.current = layer;
    if (onStageReady) onStageReady(stage);
    return () => stage.destroy();
  }, []);

  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    layer.find('.part').forEach((n) => n.destroy());
    parts.forEach((part) => {
      const node = drawShapeNode(part);
      node.on('dragend', () => {
        onChange(parts.map((p) => (p.id === part.id ? { ...p, x: node.x(), y: node.y() } : p)));
      });
      layer.add(node);
    });
    layer.draw();
  }, [parts]);

  function addShape(shapeId) {
    if (parts.length >= MAX_PARTS) return;
    onChange([
      ...parts,
      {
        id: generatePartId(),
        shapeId,
        x: CANVAS_SIZE.width / 2,
        y: CANVAS_SIZE.height / 2,
        rotation: 0,
        scale: 1,
      },
    ]);
  }

  return html`
    <div class="canvas-editor">
      <div class="shape-palette">
        ${ALL_SHAPES.map((s) => html`<button onClick=${() => addShape(s.id)}>${s.name}</button>`)}
      </div>
      <div class="canvas-container" ref=${containerRef}></div>
    </div>
  `;
}
