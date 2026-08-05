import { h, render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import htm from 'htm';
import { io } from 'socket.io-client';

import { state } from './state.js';
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

  useEffect(() => {
    socket.on('stage:change', setStage);
    return () => socket.off('stage:change', setStage);
  }, [socket]);

  useEffect(() => {
    // 서버는 "누가 참가자 화면에 접속해 있는지"를 이 신호로만 안다(관리자/공용화면도 같은
    // 서버에 소켓으로 접속하므로 접속 자체로는 구분이 안 됨) — admin:startSession 시점에
    // 이 신호를 보낸 소켓 수가 그 세션의 목표 인원으로 고정된다(backend/socket/session.js
    // 참고). 네트워크가 끊겼다 재연결되는 경우에도 다시 등록되도록 'connect'에 건다.
    function join() {
      socket.emit('participant:join');
    }
    socket.on('connect', join);
    if (socket.connected) join();
    return () => socket.off('connect', join);
  }, [socket]);

  const Screen = SCREENS[stage] ?? LearnScreen;
  return html`<${Screen} socket=${socket} state=${state} />`;
}

render(html`<${App} />`, document.getElementById('app'));
