import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';

const html = htm.bind(h);

// 참가자 화면 맨 처음(단계와 무관하게) 뜨는 이름 입력 화면. 빈 값으로 제출해도 넘어갈 수
// 있다(건너뛰기와 같은 효과) — 서버가 어차피 trim/길이 제한으로 다시 검증하므로 여기선
// 자유롭게 입력받는다.
export function NameScreen({ onSubmit }) {
  const [name, setName] = useState('');

  function handleSubmit(e) {
    e.preventDefault();
    onSubmit(name);
  }

  return html`
    <div class="name-screen">
      <h2>이름을 알려주세요</h2>
      <p>공용화면 리더보드에 표시돼요 (안 넣어도 진행할 수 있어요)</p>
      <form onSubmit=${handleSubmit}>
        <input
          type="text"
          value=${name}
          onInput=${(e) => setName(e.target.value)}
          placeholder="이름"
          maxlength="20"
        />
        <button type="submit">시작하기</button>
      </form>
    </div>
  `;
}
