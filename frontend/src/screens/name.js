import { h } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
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
  const submittedRef = useRef(false);

  // 입력폼과 name:prefill 둘 다 결국 "이 이름으로 제출한다"로 귀결되므로 한 곳에
  // 모아둔다 — submittedRef까지 같이 갱신해야 완료 화면으로 넘어간다.
  function submitName(value) {
    submittedRef.current = true;
    onNameSubmit(value);
    socket.emit('participant:name', value);
    setSubmitted(true);
  }

  useEffect(() => {
    // 관리자가 부스 입구에서 이 참가자의 QR 배지를 스캔해 이 기기에 배정하면, 서버가
    // 이름을 미리 채워준다 — 체크인 자체가 "이 사람이 맞다"는 확인 절차이므로 그 자리에서
    // 바로 제출된 것으로 보고 완료 화면으로 넘어간다(참가자가 다시 시작하기를 누를
    // 필요 없음). 이름이 틀렸으면 완료 화면의 "이름 수정" 버튼으로 고칠 수 있다.
    // 이미 제출한 뒤에 도착하면 무시한다(다음 화면으로 이미 넘어간 참가자를 건드리지
    // 않기 위함 — submittedRef로 확인하는 이유는 이 클로저가 마운트 시점에 한 번만
    // 만들어져 최신 submitted 값을 모르기 때문).
    function onPrefill(prefillName) {
      if (submittedRef.current) return;
      const safeName = prefillName ?? '';
      setName(safeName);
      submitName(safeName);
    }
    socket.on('name:prefill', onPrefill);
    return () => socket.off('name:prefill', onPrefill);
  }, [socket]);

  function handleSubmit(e) {
    e.preventDefault();
    submitName(name);
  }

  // 제출 후 화면에서 다시 입력폼으로 돌아간다 — 체크인 QR로 배정된 이름이 오탈자가
  // 있거나 본인이 아닌 경우 등, 제출 후에도 고칠 길을 열어둔다. submittedRef도 같이
  // 되돌려야 이 동안 도착하는 name:prefill을 다시 받아들일 수 있다.
  function handleEdit() {
    submittedRef.current = false;
    setSubmitted(false);
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
        <button class="btn btn--block" onClick=${handleEdit} style="margin-top: 0.75rem">이름 수정</button>
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
