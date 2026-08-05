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

function drawShapeNode(part, disabled) {
  const geometry = getShapeGeometry(part.shapeId);
  return new Konva.Shape({
    x: part.x,
    y: part.y,
    rotation: part.rotation,
    scaleX: part.scale,
    scaleY: part.scale,
    draggable: !disabled,
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

// 캔버스(좌) — 팔레트로 도형 추가, 드래그로 이동 + 회전/크기조절 핸들(Transformer) + 선택 삭제.
export function CanvasEditor({ parts, onChange, onStageReady, disabled }) {
  const containerRef = useRef(null);
  const stageRef = useRef(null);
  const layerRef = useRef(null);
  const trRef = useRef(null);

  useEffect(() => {
    const stage = new Konva.Stage({
      container: containerRef.current,
      width: CANVAS_SIZE.width,
      height: CANVAS_SIZE.height,
    });
    const layer = new Konva.Layer();
    const tr = new Konva.Transformer();
    layer.add(tr);
    stage.add(layer);
    stage.on('click tap', (e) => {
      if (e.target === stage) tr.nodes([]);
    });
    stageRef.current = stage;
    layerRef.current = layer;
    trRef.current = tr;
    if (onStageReady) onStageReady(stage);
    return () => stage.destroy();
  }, []);

  useEffect(() => {
    const layer = layerRef.current;
    const tr = trRef.current;
    if (!layer) return;
    layer.find('.part').forEach((n) => n.destroy());
    parts.forEach((part) => {
      const node = drawShapeNode(part, disabled);
      // 평가 중(disabled)에는 선택/변형도 같이 막아야 한다 — Transformer 핸들은 노드의
      // draggable 속성과 무관하게 동작하므로, 애초에 tr.nodes()에 올리지 않아야 회전/크기
      // 조절도 확실히 막힌다(그냥 draggable만 꺼서는 리사이즈 핸들이 여전히 먹힘).
      node.on('click tap', () => {
        if (!disabled) tr.nodes([node]);
      });
      node.on('dragend', () => {
        onChange(parts.map((p) => (p.id === part.id ? { ...p, x: node.x(), y: node.y() } : p)));
      });
      node.on('transformend', () => {
        // scale 범위 0.2~3.0 (Global Constraints) — 서버 쪽 clamp(applyToolCalls)와 동일 범위를
        // 수동 드래그 편집에도 적용. 노드 자체의 scale도 되돌려서 화면이 clamp된 값과 어긋나지 않게 한다.
        const clampedScale = Math.min(3, Math.max(0.2, node.scaleX()));
        node.scaleX(clampedScale);
        node.scaleY(clampedScale);
        onChange(
          parts.map((p) =>
            p.id === part.id
              ? { ...p, x: node.x(), y: node.y(), rotation: node.rotation(), scale: clampedScale }
              : p,
          ),
        );
      });
      layer.add(node);
    });
    tr.moveToTop();
    layer.draw();
  }, [parts, disabled]);

  function addShape(shapeId) {
    if (disabled || parts.length >= MAX_PARTS) return;
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

  function deleteSelected() {
    if (disabled) return;
    const tr = trRef.current;
    const selected = tr.nodes();
    if (selected.length === 0) return;
    const ids = selected.map((n) => n.id());
    tr.nodes([]);
    onChange(parts.filter((p) => !ids.includes(p.id)));
  }

  return html`
    <div class="canvas-editor">
      <div class="shape-palette">
        ${ALL_SHAPES.map((s) => html`<button onClick=${() => addShape(s.id)} disabled=${disabled}>${s.name}</button>`)}
        <button onClick=${deleteSelected} disabled=${disabled}>선택 삭제</button>
      </div>
      <div class="canvas-container" ref=${containerRef}></div>
    </div>
  `;
}
