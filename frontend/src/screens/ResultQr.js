import { h } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import htm from 'htm';
import QRCode from 'qrcode';

const html = htm.bind(h);

const RESULT_PAGE_URL = 'https://gbl-math-battle.vercel.app/';

// 결과 화면(result.js)과 감사 화면(thanks.js)이 똑같은 QR을 보여줘야 해서(result 화면에서
// 못 찍은 참가자를 위해 thanks 화면에서도 마지막 기회로 계속 표시, docs/초안.md 7-⑤) 공용
// 컴포넌트로 뺐다. resultId가 아직 없으면(Supabase 저장이 아직 안 끝났거나 실패) 조용히
// 아무것도 안 그린다 — 존재하지 않는 id로 QR을 만들면 스캔했을 때 "결과 없음"만 보게 된다.
export function ResultQr({ resultId }) {
  const [dataUrl, setDataUrl] = useState(null);

  useEffect(() => {
    if (!resultId) {
      setDataUrl(null);
      return;
    }
    let cancelled = false;
    const url = `${RESULT_PAGE_URL}?id=${encodeURIComponent(resultId)}`;
    QRCode.toDataURL(url, { width: 180, margin: 1 })
      .then((generated) => {
        if (!cancelled) setDataUrl(generated);
      })
      .catch(() => {
        if (!cancelled) setDataUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [resultId]);

  if (!dataUrl) return null;
  return html`<img class="result-qr" src=${dataUrl} alt="결과 QR 코드" width="180" height="180" />`;
}

// QR을 그냥 이미지 하나로 두면 참가자가 "이걸 왜 찍어야 하는지" 모른 채 지나간다 — 실제
// 목적(휴대폰으로 결과 PDF 받기)을 QR 바로 옆에 붙여서 같이 보여준다. 저장이 아직 안
// 끝나 resultId가 없을 때도 빈 칸으로 두지 않고 "준비 중"을 알려준다.
export function ResultQrPanel({ resultId }) {
  return html`
    <div class="qr-panel">
      <p class="qr-panel-title">📱 휴대폰으로 결과 받기</p>
      <p class="qr-panel-desc">QR을 찍으면 내 무기 증서를 PDF로 저장할 수 있어요</p>
      <div class="qr-slot">
        ${resultId
          ? html`<${ResultQr} resultId=${resultId} />`
          : html`<span class="qr-pending">결과를 저장하는 중<span class="dots"><i></i><i></i><i></i></span></span>`}
      </div>
    </div>
  `;
}
