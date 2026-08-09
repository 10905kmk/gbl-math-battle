import { h, render } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import htm from 'htm';
import { io } from 'socket.io-client';

import { state } from './state.js';
import { NameScreen } from './screens/name.js';
import { LearnScreen } from './screens/learn.js';
import { CreateScreen } from './screens/create.js';
import { BattleScreen } from './screens/battle.js';
import { ResultScreen } from './screens/result.js';
import { ThanksScreen } from './screens/thanks.js';

const html = htm.bind(h);
const NICKNAME_STORAGE_KEY = 'gbl-participant-nickname';

function loadSavedNickname() {
  try {
    const saved = localStorage.getItem(NICKNAME_STORAGE_KEY);
    return typeof saved === 'string' && saved.trim() ? saved.trim().slice(0, 20) : null;
  } catch {
    return null;
  }
}

function saveNickname(name) {
  const safeName = typeof name === 'string' ? name.trim().slice(0, 20) : '';
  try {
    if (safeName) localStorage.setItem(NICKNAME_STORAGE_KEY, safeName);
    else localStorage.removeItem(NICKNAME_STORAGE_KEY);
  } catch {
    // 저장소가 차단된 환경에서도 현재 접속 중 메모리 값은 계속 사용한다.
  }
  return safeName || null;
}

const SCREENS = {
  name: NameScreen,
  learn: LearnScreen,
  create: CreateScreen,
  battle: BattleScreen,
  result: ResultScreen,
  thanks: ThanksScreen,
};

function App() {
  const [stage, setStage] = useState('name');
  const [socket] = useState(() => io());
  // socket.io는 재연결 시 새 socket.id를 발급한다 — 서버가 이름을 참가자 엔트리에
  // socket.id 기준으로 들고 있어서(backend/socket/session.js), 재연결 후
  // participant:name을 다시 안 보내면 와이파이가 잠깐 끊겼다 붙는 것만으로 이름이
  // 사라진다. 예전엔 이 값으로 "이름 입력 화면을 아예 건너뛸지"도 결정했지만, 이제
  // 이름 입력은 서버 stage('name')가 결정하므로 nameRef는 순수하게 재접속 시
  // 재전송하는 용도로만 쓰인다.
  const nameRef = useRef(loadSavedNickname());
  // 결과 저장(Supabase) 완료 후 서버가 알려주는 저장된 행의 id — result-page QR/링크에 쓴다.
  // battle.js가 아니라 여기서 듣는 이유: 저장은 비동기라 stage가 이미 result로 넘어가
  // BattleScreen이 unmount된 뒤에 이 이벤트가 도착하는 경우가 흔한데, App은 화면 전환과
  // 무관하게 항상 떠 있어서 놓치지 않는다. 실제 UI 갱신(ResultScreen 리렌더)이 일어나려면
  // Preact state여야 하므로 state.js가 아니라 useState로 들고 내려준다.
  const [resultId, setResultId] = useState(null);

  useEffect(() => {
    function onStageChange(nextStage) {
      setStage(nextStage);
      // 새 라운드(battle)가 시작되면 지난 라운드의 결과 id는 더 이상 유효하지 않다 —
      // 다음 result:saved가 올 때까지 QR을 안 보여주는 게, 지난 라운드 QR을 잘못 보여주는
      // 것보다 낫다.
      if (nextStage === 'battle') setResultId(null);
    }
    socket.on('stage:change', onStageChange);
    return () => socket.off('stage:change', onStageChange);
  }, [socket]);

  useEffect(() => {
    function onSaved({ id }) {
      setResultId(id);
    }
    socket.on('result:saved', onSaved);
    return () => socket.off('result:saved', onSaved);
  }, [socket]);

  useEffect(() => {
    // 서버는 "누가 참가자 화면에 접속해 있는지"를 이 신호로만 안다(관리자/공용화면도 같은
    // 서버에 소켓으로 접속하므로 접속 자체로는 구분이 안 됨) — admin:startSession 시점에
    // 이 신호를 보낸 소켓 수가 그 세션의 목표 인원으로 고정된다(backend/socket/session.js
    // 참고). 네트워크가 끊겼다 재연결되는 경우에도 다시 등록되도록 'connect'에 건다.
    // 이름 입력 여부와는 완전히 무관하게 항상 즉시 보낸다 — 이름 입력에 시간이 걸려서 이
    // 신호가 늦어지면 인원수 집계가 어긋나는 사고로 이어질 수 있다(예전에 실제로 겪은
    // 문제와 같은 부류).
    function join() {
      // 닉네임을 참가 등록 payload에 함께 보내야 관리자 화면에 name=null 엔트리가 먼저
      // 나타났다 다음 이벤트에서 이름으로 바뀌는 깜빡임도 막을 수 있다.
      socket.emit('participant:join', { name: nameRef.current });
    }
    socket.on('connect', join);
    if (socket.connected) join();
    return () => socket.off('connect', join);
  }, [socket]);

  const Screen = SCREENS[stage] ?? LearnScreen;
  return html`<${Screen}
    socket=${socket}
    state=${state}
    resultId=${resultId}
    onNameSubmit=${(n) => {
      nameRef.current = saveNickname(n);
    }}
  />`;
}

render(html`<${App} />`, document.getElementById('app'));
