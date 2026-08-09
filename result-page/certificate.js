// result-page/certificate.js — 결과 1건을 A4 "무기 증서" 한 장으로 그려서 PDF로 내려준다.
//
// 왜 캔버스에 직접 그리는가:
//   1) jsPDF의 내장 폰트는 한글을 못 그린다(글자가 통째로 깨진다). 한글 TTF를 base64로
//      끼워 넣으면 수 MB를 부스 현장 휴대폰이 매번 받아야 한다.
//   2) html2canvas 같은 DOM 캡처는 기기/브라우저마다 결과가 미묘하게 달라진다.
//   캔버스 2D는 브라우저의 시스템 한글 폰트를 그대로 쓰면서 픽셀 단위로 결과가 예측
//   가능하다 — 그린 캔버스를 PNG로 만들어 PDF 한 페이지에 통째로 얹는다.
//
// 배경을 어둡게 하지 않고 종이색으로 잡은 이유: 참가자가 실제로 인쇄할 수도 있고,
// 무기 이미지(Konva toDataURL)가 투명 배경 + 밝은 하늘색 채움이라 흰 바탕에서 가장 잘 보인다.

// A4 210x297mm를 150dpi로 렌더링한 픽셀 크기.
const PAGE = { width: 1240, height: 1754 };
const MARGIN = 96;

const COLORS = {
  paper: '#fdfbf6',
  grid: '#e9eef6',
  ink: '#14203a',
  muted: '#7385a3',
  accent: '#2b7fd4',
  accentSoft: '#eaf2fb',
  gold: '#c9a227',
  line: '#c9d5e6',
};

const FONT = '"Malgun Gothic", "맑은 고딕", system-ui, -apple-system, sans-serif';

function roundRect(ctx, x, y, w, h, r) {
  // ctx.roundRect는 비교적 최근 API라(구형 iOS Safari 미지원) 직접 그린다.
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// 무기 이름은 24자까지 들어올 수 있어서 고정 크기로 그리면 증서 밖으로 삐져나간다 —
// 폭에 들어올 때까지 글자 크기를 줄인다.
function fitFontSize(ctx, text, maxWidth, startSize, weight = 700) {
  let size = startSize;
  do {
    ctx.font = `${weight} ${size}px ${FONT}`;
    if (ctx.measureText(text).width <= maxWidth) break;
    size -= 2;
  } while (size > 20);
  return size;
}

function loadImage(src) {
  return new Promise((resolve) => {
    if (!src) {
      resolve(null);
      return;
    }
    const img = new Image();
    // 무기 이미지는 data: URL(Konva toDataURL)이라 캔버스를 오염시키지 않는다 — 혹시
    // 나중에 Storage URL로 바뀌어도 toDataURL()이 막히지 않도록 미리 걸어둔다.
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function formatDate(value) {
  const d = value ? new Date(value) : new Date();
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
}

function drawCenteredText(ctx, text, y, { size, weight = 700, color = COLORS.ink }) {
  ctx.fillStyle = color;
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.fillText(text, PAGE.width / 2, y);
}

function drawStatBox(ctx, { x, y, w, h, label, value, valueColor }) {
  ctx.fillStyle = COLORS.accentSoft;
  roundRect(ctx, x, y, w, h, 14);
  ctx.fill();
  ctx.strokeStyle = COLORS.line;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.fillStyle = COLORS.muted;
  ctx.font = `600 24px ${FONT}`;
  ctx.fillText(label, x + w / 2, y + 52);

  ctx.fillStyle = valueColor;
  const size = fitFontSize(ctx, value, w - 40, 52, 800);
  ctx.font = `800 ${size}px ${FONT}`;
  ctx.fillText(value, x + w / 2, y + 118);
}

// 1등에게만 붙는 금색 도장. 등수를 모르면(집계 실패) 아예 안 그린다.
function drawSeal(ctx, cx, cy, rank) {
  const r = 88;
  ctx.save();
  ctx.strokeStyle = rank === 1 ? COLORS.gold : COLORS.accent;
  ctx.fillStyle = rank === 1 ? 'rgba(201, 162, 39, 0.1)' : 'rgba(43, 127, 212, 0.08)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(cx, cy, r - 12, 0, Math.PI * 2);
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.fillStyle = rank === 1 ? COLORS.gold : COLORS.accent;
  ctx.font = `800 ${rank === 1 ? 46 : 40}px ${FONT}`;
  ctx.fillText(rank === 1 ? '우승' : `${rank}위`, cx, cy - 4);
  ctx.font = `600 20px ${FONT}`;
  ctx.fillText('36조 인증', cx, cy + 36);
  ctx.restore();
}

export async function buildCertificateCanvas(result) {
  const canvas = document.createElement('canvas');
  canvas.width = PAGE.width;
  canvas.height = PAGE.height;
  const ctx = canvas.getContext('2d');
  ctx.textBaseline = 'alphabetic';

  // 배경 + 도형 격자(현장 화면 배경과 같은 모티프)
  ctx.fillStyle = COLORS.paper;
  ctx.fillRect(0, 0, PAGE.width, PAGE.height);
  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 1;
  for (let x = 0; x <= PAGE.width; x += 62) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, PAGE.height);
    ctx.stroke();
  }
  for (let y = 0; y <= PAGE.height; y += 62) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(PAGE.width, y);
    ctx.stroke();
  }

  // 이중 테두리
  ctx.strokeStyle = COLORS.accent;
  ctx.lineWidth = 4;
  roundRect(ctx, 54, 54, PAGE.width - 108, PAGE.height - 108, 20);
  ctx.stroke();
  ctx.strokeStyle = COLORS.line;
  ctx.lineWidth = 1.5;
  roundRect(ctx, 72, 72, PAGE.width - 144, PAGE.height - 144, 14);
  ctx.stroke();

  // 헤더
  drawCenteredText(ctx, '대전대신고등학교 GBL · 36조', 178, { size: 26, weight: 600, color: COLORS.muted });
  drawCenteredText(ctx, '무기 증서', 262, { size: 76, weight: 800, color: COLORS.ink });
  ctx.strokeStyle = COLORS.accent;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(PAGE.width / 2 - 90, 296);
  ctx.lineTo(PAGE.width / 2 + 90, 296);
  ctx.stroke();
  drawCenteredText(ctx, '수학 도형으로 직접 설계한 무기임을 증명합니다', 348, {
    size: 26,
    weight: 500,
    color: COLORS.muted,
  });

  // 무기 이미지 액자
  const boxW = 560;
  const boxH = 560;
  const boxX = (PAGE.width - boxW) / 2;
  const boxY = 400;
  ctx.fillStyle = '#ffffff';
  roundRect(ctx, boxX, boxY, boxW, boxH, 18);
  ctx.fill();
  ctx.strokeStyle = COLORS.line;
  ctx.lineWidth = 2;
  ctx.stroke();

  const img = await loadImage(result.weapon_image);
  if (img && img.width > 0 && img.height > 0) {
    const pad = 36;
    const scale = Math.min((boxW - pad * 2) / img.width, (boxH - pad * 2) / img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    ctx.drawImage(img, boxX + (boxW - w) / 2, boxY + (boxH - h) / 2, w, h);
  } else {
    drawCenteredText(ctx, '이미지 없음', boxY + boxH / 2, { size: 28, weight: 500, color: COLORS.muted });
  }

  // 무기 이름
  const name = result.weapon_name || '이름 없는 무기';
  const nameSize = fitFontSize(ctx, name, PAGE.width - MARGIN * 2 - 40, 64, 800);
  drawCenteredText(ctx, name, boxY + boxH + 96, { size: nameSize, weight: 800, color: COLORS.ink });

  // 스탯 3칸
  const gap = 24;
  const statW = (PAGE.width - MARGIN * 2 - gap * 2) / 3;
  const statY = boxY + boxH + 148;
  const rank = Number.isFinite(result.rank) ? result.rank : null;
  drawStatBox(ctx, {
    x: MARGIN,
    y: statY,
    w: statW,
    h: 156,
    label: 'AI 전투력',
    value: result.weapon_damage != null ? String(result.weapon_damage) : '-',
    valueColor: COLORS.accent,
  });
  drawStatBox(ctx, {
    x: MARGIN + statW + gap,
    y: statY,
    w: statW,
    h: 156,
    label: '순위',
    value: rank ? `${rank}위` : '-',
    valueColor: rank === 1 ? COLORS.gold : COLORS.ink,
  });
  drawStatBox(ctx, {
    x: MARGIN + (statW + gap) * 2,
    y: statY,
    w: statW,
    h: 156,
    label: '획득 점수',
    value: result.score != null ? String(result.score) : '-',
    valueColor: COLORS.ink,
  });

  // 발급 정보 + 도장은 스탯 아래에 붙이지 않고 페이지 하단에 고정한다 — 스탯 바로 밑에
  // 붙이면 A4 아래쪽 4분의 1이 통째로 비어서 증서가 위로 쏠려 보인다(실측 후 조정).
  const footerY = PAGE.height - 250;

  ctx.strokeStyle = COLORS.line;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(MARGIN, footerY - 72);
  ctx.lineTo(PAGE.width - MARGIN, footerY - 72);
  ctx.stroke();

  if (rank) drawSeal(ctx, PAGE.width - MARGIN - 100, footerY + 30, rank);

  ctx.textAlign = 'left';
  ctx.fillStyle = COLORS.muted;
  ctx.font = `600 26px ${FONT}`;
  ctx.fillText(`발급일  ${formatDate(result.created_at)}`, MARGIN, footerY);
  ctx.fillStyle = COLORS.ink;
  ctx.font = `800 32px ${FONT}`;
  ctx.fillText('수학 도형 무기 온라인 베틀', MARGIN, footerY + 52);
  ctx.fillStyle = COLORS.muted;
  ctx.font = `500 24px ${FONT}`;
  ctx.fillText('대전대신고등학교 GBL 36조', MARGIN, footerY + 96);

  return canvas;
}

function triggerDownload(href, filename) {
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function safeFileName(result) {
  // 파일명에 못 쓰는 문자만 걸러낸다(한글은 그대로 둔다 — 모바일 브라우저도 잘 받는다).
  const base = (result.weapon_name || '무기').replace(/[\\/:*?"<>|]/g, '').trim() || '무기';
  return `무기증서_${base}`;
}

// PDF 생성. jsPDF는 눌렀을 때만 동적으로 받아온다 — 페이지 첫 로딩(부스에서 막 나온
// 참가자의 휴대폰 데이터)을 300KB 넘게 무겁게 만들 이유가 없다. CDN이 막히거나 실패하면
// 같은 캔버스를 PNG로 내려주는 것으로 대체한다 — 참가자가 빈손으로 돌아가진 않게.
export async function downloadCertificate(result) {
  const canvas = await buildCertificateCanvas(result);
  const png = canvas.toDataURL('image/png');
  try {
    const { jsPDF } = await import('jspdf');
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    doc.addImage(png, 'PNG', 0, 0, 210, 297, undefined, 'FAST');
    doc.save(`${safeFileName(result)}.pdf`);
    return 'pdf';
  } catch (err) {
    console.error('[certificate] PDF 생성 실패, PNG로 대체', err);
    triggerDownload(png, `${safeFileName(result)}.png`);
    return 'png';
  }
}
