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

  const Screen = SCREENS[stage] ?? LearnScreen;
  return html`<${Screen} socket=${socket} state=${state} />`;
}

render(html`<${App} />`, document.getElementById('app'));
