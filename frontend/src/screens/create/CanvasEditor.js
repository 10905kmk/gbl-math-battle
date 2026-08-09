// frontend/src/screens/create/CanvasEditor.js
import { h } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import htm from 'htm';
import Konva from 'konva';
import {
  ALL_SHAPES,
  getShapeGeometry,
  generatePartId,
  partScale,
  clampScale,
  SCALE_MIN,
  SCALE_MAX,
} from '../../../../shapes/registry.js';

const html = htm.bind(h);

export const CANVAS_SIZE = { width: 480, height: 480 };
// 서버(backend/routes/weaponChat.js)의 MAX_PARTS와 같은 값 — 부품 상한 25개(Global Constraints)를
// 수동 편집(팔레트 클릭) 경로에도 동일하게 적용한다. create.js의 부품 카운터도 이 값을 쓴다.
export const MAX_PARTS = 25;

// 팔레트 버튼 안에 들어가는 도형 미리보기. 이름만 적힌 버튼은 "코흐 눈꽃"이 뭔지 모르는
// 참가자에게 아무 정보도 주지 않는다 — 실제 렌더링에 쓰는 geometry를 그대로 축소해서
// 보여주므로 캔버스에 추가됐을 때의 모양과 항상 일치한다.
function ShapeIcon({ shapeId }) {
  const geometry = getShapeGeometry(shapeId);
  if (!geometry) return null;
  const polys = geometry.type === 'polygon' ? [geometry.points] : geometry.triangles;
  const all = polys.flat();
  const minX = Math.min(...all.map((p) => p.x));
  const minY = Math.min(...all.map((p) => p.y));
  const w = Math.max(...all.map((p) => p.x)) - minX;
  const hgt = Math.max(...all.map((p) => p.y)) - minY;
  const pad = Math.max(w, hgt) * 0.06;
  // 시에르핀스키는 깊이 4라 삼각형이 81개다 — 20px짜리 아이콘에 테두리까지 그리면 선이
  // 전부 뭉쳐서 그냥 회색 삼각형으로 보인다. 조각이 많으면 채움만으로 실루엣을 만든다.
  const dense = polys.length > 12;
  return html`
    <svg
      class="shape-icon"
      viewBox=${`${minX - pad} ${minY - pad} ${w + pad * 2} ${hgt + pad * 2}`}
      aria-hidden="true"
    >
      ${polys.map(
        (points) => html`
          <polygon
            points=${points.map((p) => `${p.x},${p.y}`).join(' ')}
            fill=${dense ? 'currentColor' : 'rgba(124,196,255,0.22)'}
            stroke=${dense ? 'none' : 'currentColor'}
            stroke-width=${dense ? 0 : Math.max(w, hgt) * 0.03}
            stroke-linejoin="round"
          />
        `,
      )}
    </svg>
  `;
}

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
    scaleX: partScale(part).sx,
    scaleY: partScale(part).sy,
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
    // 8개 앵커 전부 + keepRatio:false — 가로/세로를 따로 늘려 원을 타원으로, 사각형을
    // 임의 비율의 판때기로 만들 수 있다(그림판식 자유 변형). 예전엔 데이터 모델에 등비
    // scale 하나뿐이라 옆 앵커로 늘렸다가 손을 떼는 순간 등비로 튀어버려서, 어쩔 수 없이
    // 모서리 4개만 남겨뒀었다 — 이제 part가 scaleX/scaleY를 따로 들고 있으므로 그 제약이
    // 사라졌다. rotateEnabled는 Konva 기본값(true)이라 회전도 각도 제한 없이 자유롭다.
    const tr = new Konva.Transformer({
      keepRatio: false,
      // 앵커를 손가락으로도 잡을 수 있게 키운다 — 부스에서 태블릿/폰으로 쓴다.
      anchorSize: 12,
      rotateAnchorOffset: 28,
      borderStroke: '#7cc4ff',
      anchorStroke: '#7cc4ff',
      anchorFill: '#0f1729',
      // 뒤집기(음수 scale)까지 허용하면 회전과 구분이 안 돼서 참가자가 혼란스러워한다 —
      // 반대편으로 끌고 가도 최소 크기에서 멈추게 한다.
      boundBoxFunc: (oldBox, newBox) =>
        newBox.width < 6 || newBox.height < 6 ? oldBox : newBox,
    });
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
    // 평가 중(disabled)에는 새로 선택하는 것뿐 아니라 "이미 선택돼 있던 것"도 풀어야 한다 —
    // 안 그러면 evaluate()가 disabled로 넘어간 직후에도 Transformer가 이전 선택을 물고
    // 있다가 stage.toDataURL()에 파란 선택 핸들이 그대로 찍혀 나간다(Opus 리뷰 Important #3,
    // 실측: 핸들 있을 때 48254자 vs 없을 때 35890자로 실제로 다른 이미지였음).
    if (disabled) {
      selectedIdRef.current = null;
    }
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
        // 가로/세로를 따로 clamp한다(SCALE_MIN~SCALE_MAX) — 서버 쪽 clamp(applyToolCalls)와
        // 동일 범위를 수동 드래그 편집에도 적용. 노드 자체의 scale도 되돌려서 화면이
        // clamp된 값과 어긋나지 않게 한다. 음수(뒤집기)는 Transformer의 boundBoxFunc가
        // 이미 막지만, 혹시 새어 들어와도 절댓값으로 흡수한다.
        const rawX = Math.abs(node.scaleX());
        const rawY = Math.abs(node.scaleY());
        const wasClamped = rawX < SCALE_MIN || rawX > SCALE_MAX || rawY < SCALE_MIN || rawY > SCALE_MAX;
        const nextScaleX = clampScale(rawX);
        const nextScaleY = clampScale(rawY);
        node.scaleX(nextScaleX);
        node.scaleY(nextScaleY);
        // 앵커를 드래그해서 리사이즈하면 Konva가 반대쪽을 고정점으로 삼아 x/y도 같이
        // 옮기는데, 그 값은 "clamp 전" scale 기준으로 계산된 것이다. scale만 사후에 clamp하고
        // 그 x/y를 그대로 쓰면 실제 그려지는 도형과 안 맞아서, 최대/최소 크기에 걸릴 때마다
        // 도형이 옆으로 슬쩍 밀리는 것처럼 보인다(Opus 리뷰 Important #9, 최댓값 근처에서
        // 반복 리사이즈하면 y가 계속 밀리는 것으로 실측됨). clamp된 경우엔 이번 조작 시작 전
        // 위치(part.x/part.y)로 되돌리고, 정상 범위 안에서 끝난 경우에도 캔버스 범위
        // (dragBoundFunc와 동일 규칙)로 한 번 더 clamp한다.
        const nextX = wasClamped ? part.x : Math.min(CANVAS_SIZE.width, Math.max(0, node.x()));
        const nextY = wasClamped ? part.y : Math.min(CANVAS_SIZE.height, Math.max(0, node.y()));
        node.x(nextX);
        node.y(nextY);
        onChange(
          parts.map((p) =>
            p.id === part.id
              ? {
                  ...p,
                  x: nextX,
                  y: nextY,
                  rotation: node.rotation(),
                  scaleX: nextScaleX,
                  scaleY: nextScaleY,
                  // 등비 scale만 알던 예전 형식과 섞이지 않게 확실히 지운다 — 남아 있으면
                  // partScale()이 우선순위상 무시하긴 하지만, 캐시 키/AI 프롬프트에 죽은
                  // 필드가 실려 나간다.
                  scale: undefined,
                }
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
        scaleX: 1,
        scaleY: 1,
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

  function duplicateSelected() {
    if (disabled || parts.length >= MAX_PARTS) return;
    const selectedId = selectedIdRef.current;
    const source = parts.find((p) => p.id === selectedId);
    if (!source) return;

    const offset = 20;
    const nextX = source.x <= CANVAS_SIZE.width - offset ? source.x + offset : source.x - offset;
    const nextY = source.y <= CANVAS_SIZE.height - offset ? source.y + offset : source.y - offset;
    const copy = {
      ...source,
      id: generatePartId(),
      x: Math.min(CANVAS_SIZE.width, Math.max(0, nextX)),
      y: Math.min(CANVAS_SIZE.height, Math.max(0, nextY)),
    };

    selectedIdRef.current = copy.id;
    trRef.current?.nodes([]);
    onChange([...parts, copy]);
  }

  const paletteFull = parts.length >= MAX_PARTS;

  return html`
    <div class="canvas-editor">
      <div class="shape-palette">
        ${ALL_SHAPES.map(
          (s) => html`
            <button
              class="chip-btn"
              onClick=${() => addShape(s.id)}
              disabled=${disabled || paletteFull}
              title=${paletteFull ? `부품은 최대 ${MAX_PARTS}개까지예요` : `${s.name} 추가`}
            >
              <${ShapeIcon} shapeId=${s.id} />
              ${s.name}
            </button>
          `,
        )}
        <button
          class="chip-btn chip-btn--copy"
          onClick=${duplicateSelected}
          disabled=${disabled || paletteFull}
          title=${paletteFull ? `부품은 최대 ${MAX_PARTS}개까지예요` : '선택한 블록 복사'}
        >
          선택 복사
        </button>
        <button class="chip-btn chip-btn--danger" onClick=${deleteSelected} disabled=${disabled}>
          선택 삭제
        </button>
      </div>
      <div class="canvas-container" ref=${containerRef}></div>
      <p class="canvas-hint">
        도형을 눌러 선택 → 끌어서 이동 · 모서리로 크기 · 옆면으로 가로세로 늘이기 · 위쪽 핸들로 회전
      </p>
    </div>
  `;
}
