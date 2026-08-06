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
