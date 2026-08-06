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

const SCREENS = {
  learn: LearnScreen,
  create: CreateScreen,
  battle: BattleScreen,
  result: ResultScreen,
  thanks: ThanksScreen,
};

function App() {
  const [stage, setStage] = useState('learn');
  const [socket] = useState(() => io());
  // null이면 아직 이름을 안 넣은 상태 — 단계(stage)와 무관하게 이름 입력 화면을 먼저 보여준다.
  const [name, setName] = useState(null);
  // socket.io는 재연결 시 새 socket.id를 발급한다 — 서버가 이름을 socket.id 기준으로 들고
  // 있어서(backend/socket/session.js의 participantNames), 재연결 후 참가자:name을 다시 안
  // 보내면 와이파이가 잠깐 끊겼다 붙는 것만으로 이름이 영구히 사라진다(Opus 리뷰 Important
  // I1, 실제로 재현됨). ref로 들고 있다가 매 join()마다 같이 보낸다 — join 이펙트의
  // [socket] 의존성 배열은 그대로 둬서(이름과 무관하게 유지) 인원수 집계 타이밍에 영향을
  // 주지 않는다.
  const nameRef = useRef(null);

  useEffect(() => {
    socket.on('stage:change', setStage);
    return () => socket.off('stage:change', setStage);
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
      socket.emit('participant:join');
      // 재연결로 socket.id가 바뀌었을 수 있으니, 이미 입력된 이름이 있으면 새 id에도
      // 다시 등록해준다 — participant:join과 같은 타이밍(지연 없이 즉시)이라 인원수
      // 집계에는 영향이 없다.
      if (nameRef.current !== null) {
        socket.emit('participant:name', nameRef.current);
      }
    }
    socket.on('connect', join);
    if (socket.connected) join();
    return () => socket.off('connect', join);
  }, [socket]);

  if (name === null) {
    return html`<${NameScreen} onSubmit=${(n) => {
      nameRef.current = n;
      socket.emit('participant:name', n);
      setName(n);
    }} />`;
  }

  const Screen = SCREENS[stage] ?? LearnScreen;
  return html`<${Screen} socket=${socket} state=${state} />`;
}

render(html`<${App} />`, document.getElementById('app'));
