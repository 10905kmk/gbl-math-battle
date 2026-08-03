import { h, render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import htm from 'htm';

const html = htm.bind(h);

// Supabase에서 URL의 id로 결과를 조회하는 상시 페이지.
// 현장 result.js와 동일한 수준의 요약을 영구 소장하는 용도. docs/초안.md 7-④ 참고.
function ResultPage() {
  const [result, setResult] = useState(null);
  const id = new URLSearchParams(location.search).get('id');

  useEffect(() => {
    if (!id) return;
    // TODO: Supabase REST API로 id 기반 조회 (docs/초안.md 3번 참고)
  }, [id]);

  if (!result) return html`<p>결과를 불러오는 중...</p>`;

  return html`
    <div class="result-card">
      <h2>${result.weaponName}</h2>
      <img src=${result.image} alt=${result.weaponName} />
      <p>공격 ${result.attack} / 방어 ${result.defense}</p>
    </div>
  `;
}

render(html`<${ResultPage} />`, document.getElementById('result-app'));
