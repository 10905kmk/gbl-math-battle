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
  const allPoints = geometry.type === 'polygon' ? geometry.points : geometry.triangles.flat();
  const minX = Math.min(...allPoints.map((p) => p.x));
  const minY = Math.min(...allPoints.map((p) => p.y));
  const maxX = Math.max(...allPoints.map((p) => p.x));
  const maxY = Math.max(...allPoints.map((p) => p.y));
  const width = maxX - minX;
  const height = maxY - minY;

  return new Konva.Shape({
    x: part.x,
    y: part.y,
    // Konva.Transformer(및 hit 판정)는 width/height로 정의된 로컬 [0,width]x[0,height] 사각형을
    // node의 bounding box로 취급한다 — sceneFunc가 실제로 뭘 그리는지는 안 본다. shapes.js/
    // fractals.js의 좌표는 "원점 중심"이라 이 관례와 안 맞으므로, 그리기 좌표를 (minX,minY)만큼
    // 옮겨서 [0,width]x[0,height] 안에 들어오게 하고, offsetX/Y로 중심을 node의 x,y에 맞춘다.
    // 이렇게 안 하면 width/height가 기본값 0이라 Transformer 핸들이 전부 중심 한 점에 뭉친다.
    width,
    height,
    offsetX: width / 2,
    offsetY: height / 2,
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
        geometry.points.forEach((p, i) => {
          const px = p.x - minX;
          const py = p.y - minY;
          i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
        });
        ctx.closePath();
      } else if (geometry.type === 'triangles') {
        geometry.triangles.forEach(([a, b, c]) => {
          ctx.moveTo(a.x - minX, a.y - minY);
          ctx.lineTo(b.x - minX, b.y - minY);
          ctx.lineTo(c.x - minX, c.y - minY);
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
  // parts가 바뀔 때마다(드래그/변형/추가/삭제) 모든 '.part' 노드를 destroy 후 새로 만든다(아래
  // effect) — 이때 Transformer가 이전 렌더의(이제 destroy된) 노드 객체를 여전히 tr.nodes()에
  // 들고 있으면, 그 다음 마우스 이동에서 Konva 내부가 죽은 노드에 접근해 크래시한다(직접 재현:
  // 리사이즈 한 번 하고 나서 바로 회전 핸들을 드래그하면 "Cannot read properties of null
  // (reading 'getAbsoluteTransform')"). 그래서 "무엇이 선택돼 있었는지"는 id로만 기억해두고,
  // 매 렌더마다 그 id에 해당하는 새 노드를 찾아 Transformer를 다시 붙여준다.
  const selectedIdRef = useRef(null);

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
      if (e.target === stage) {
        selectedIdRef.current = null;
        tr.nodes([]);
      }
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
    let selectedNode = null;
    parts.forEach((part) => {
      const node = drawShapeNode(part, disabled);
      // 평가 중(disabled)에는 선택/변형도 같이 막아야 한다 — Transformer 핸들은 노드의
      // draggable 속성과 무관하게 동작하므로, 애초에 tr.nodes()에 올리지 않아야 회전/크기
      // 조절도 확실히 막힌다(그냥 draggable만 꺼서는 리사이즈 핸들이 여전히 먹힘).
      node.on('click tap', () => {
        if (disabled) return;
        selectedIdRef.current = part.id;
        tr.nodes([node]);
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
      if (part.id === selectedIdRef.current) selectedNode = node;
    });
    // 선택돼 있던 부품이 이번 렌더에도 있으면 새로 만든 노드로 Transformer를 재부착하고,
    // 삭제됐다면(selectedNode가 안 잡히면) 선택을 비운다.
    tr.nodes(selectedNode ? [selectedNode] : []);
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
    selectedIdRef.current = null;
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
