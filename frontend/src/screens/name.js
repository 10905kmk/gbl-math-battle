import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';

const html = htm.bind(h);

// 매 세션(라운드)마다 새로 보여지는 stage — 기기를 새로고침 없이 계속 켜두므로, 이름
// 입력은 전역 게이트가 아니라 서버가 관리하는 'name' stage로 존재한다(app.js 참고).
// 빈 값으로 제출해도 넘어갈 수 있다 — 서버가 어차피 trim/길이 제한으로 다시 검증하므로
// 여기선 자유롭게 입력받는다. 제출 후엔 다음 단계(learn)로 서버가 넘겨줄 때까지 대기
// 화면을 보여준다 — 폼이 그대로 남아있으면 "제출이 안 된 것처럼" 보인다.
export function NameScreen({ socket, onNameSubmit }) {
  const [name, setName] = useState('');
  const [submitted, setSubmitted] = useState(false);

  function handleSubmit(e) {
    e.preventDefault();
    onNameSubmit(name);
    socket.emit('participant:name', name);
    setSubmitted(true);
  }

  if (submitted) {
    return html`
      <div class="card name-screen">
        <p class="eyebrow">준비 완료</p>
        <h2 class="title">${name.trim() || '도전자'}님, 반가워요!</h2>
        <p class="subtitle">
          진행자가 시작하면 자동으로 넘어가요
          <span class="dots"><i></i><i></i><i></i></span>
        </p>
      </div>
    `;
  }

  return html`
    <div class="card name-screen">
      <p class="eyebrow">수학 도형 무기 배틀</p>
      <h2 class="title">이름을 알려주세요</h2>
      <p class="subtitle">공용화면 리더보드에 표시돼요<br />안 넣어도 진행할 수 있어요</p>
      <form onSubmit=${handleSubmit}>
        <input
          class="field"
          type="text"
          value=${name}
          onInput=${(e) => setName(e.target.value)}
          placeholder="이름"
          maxlength="20"
        />
        <button class="btn btn--primary btn--block" type="submit">시작하기</button>
      </form>
    </div>
  `;
}
