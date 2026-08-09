// frontend/src/screens/create/ChatPanel.js
import { h } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import htm from 'htm';
import { Markdown } from './Markdown.js';

const html = htm.bind(h);

// 처음 화면이 텅 비어 있으면 "여기에 뭘 써야 하는지" 모르는 참가자가 많다 — 눌러서 바로
// 보낼 수 있는 예시를 깔아둔다. 실제 few-shot 샘플 무기(backend/lib/weaponEvaluationSamples.js)와
// 같은 결의 명령이라, 눌러보면 AI가 확실히 반응하는 것부터 경험하게 된다.
const EXAMPLE_PROMPTS = [
  '시에르핀스키 삼각형을 창의 촉으로 만들고 아래에 긴 막대를 붙여줘',
  '원을 세로로 길게 늘여서 칼날을 만들고 손잡이를 달아줘',
  '별과 육각형으로 던지는 표창을 만들어줘',
];

// 말풍선 대신 ChatGPT처럼 "아바타 + 왼쪽 정렬 본문"이 위에서 아래로 흐르는 구조.
// 말풍선은 폭이 좁아서(최대 88%) 마크다운 표나 $$...$$ 블록 수식이 들어오면 계속 줄바꿈되고
// 가로 스크롤이 생겼다 — 패널 전체 폭을 쓰는 이 구조가 수식/코드/목록에 훨씬 안정적이다.
function ChatTurn({ message }) {
  const { role, text } = message;
  if (role === 'error') {
    return html`<p class="chat-error">⚠ ${text}</p>`;
  }
  const isUser = role === 'user';
  return html`
    <div class="chat-turn chat-turn--${role}">
      <div class="chat-avatar chat-avatar--${role}">${isUser ? '나' : 'AI'}</div>
      ${isUser
        ? html`<div class="chat-body chat-body--user">${text}</div>`
        : html`<${Markdown} className="chat-body md" text=${text} />`}
    </div>
  `;
}

export function ChatPanel({ weaponState, onWeaponChange, disabled }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef(null);

  // 새 메시지가 들어오면 항상 맨 아래로 — 안 그러면 답변이 스크롤 밖에 쌓여서 참가자가
  // "AI가 대답을 안 한다"고 착각한다.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, sending]);

  async function send(text) {
    const message = (text ?? input).trim();
    if (!message || sending || disabled) return;
    setMessages((m) => [...m, { role: 'user', text: message }]);
    setInput('');
    setSending(true);
    try {
      const res = await fetch('/api/weapon/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ weaponState, message }),
      });
      if (!res.ok) throw new Error('chat failed');
      const data = await res.json();
      onWeaponChange(data.weaponState);
      setMessages((m) => [...m, { role: 'ai', text: data.reply }]);
    } catch (err) {
      setMessages((m) => [...m, { role: 'error', text: 'AI가 응답하지 못했어요. 다시 시도해주세요.' }]);
    } finally {
      setSending(false);
    }
  }

  return html`
    <div class="chat-panel">
      <div class="chat-header">
        <span class="chat-dot"></span>
        <strong>AI 도우미</strong>
        <span class="chat-header-hint">말로 도형을 배치해요</span>
      </div>

      <div class="chat-messages" ref=${scrollRef}>
        ${messages.length === 0 &&
        html`
          <div class="chat-empty">
            <p class="chat-empty-title">이렇게 말해보세요</p>
            ${EXAMPLE_PROMPTS.map(
              (p) => html`
                <button class="chat-example" onClick=${() => send(p)} disabled=${disabled || sending}>
                  ${p}
                </button>
              `,
            )}
          </div>
        `}
        ${messages.map((m) => html`<${ChatTurn} message=${m} />`)}
        ${sending &&
        html`
          <div class="chat-turn chat-turn--ai">
            <div class="chat-avatar chat-avatar--ai">AI</div>
            <div class="chat-body"><span class="dots"><i></i><i></i><i></i></span></div>
          </div>
        `}
      </div>

      <div class="chat-input-row">
        <input
          class="field"
          value=${input}
          onInput=${(e) => setInput(e.target.value)}
          onKeyDown=${(e) => e.key === 'Enter' && send()}
          disabled=${disabled || sending}
          placeholder="어떤 무기를 만들까요?"
        />
        <button class="btn btn--primary chat-send-btn" onClick=${() => send()} disabled=${disabled || sending}>
          ${sending ? '전송 중' : '보내기'}
        </button>
      </div>
    </div>
  `;
}
