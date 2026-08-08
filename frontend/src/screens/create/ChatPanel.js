// frontend/src/screens/create/ChatPanel.js
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';

const html = htm.bind(h);

export function ChatPanel({ weaponState, onWeaponChange, disabled }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);

  async function send() {
    const message = input.trim();
    if (!message || sending) return;
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
      <div class="chat-messages">
        ${messages.map((m) => html`<p class="chat-msg chat-msg--${m.role}">${m.text}</p>`)}
      </div>
      <div class="chat-input-row">
        <input
          value=${input}
          onInput=${(e) => setInput(e.target.value)}
          onKeyDown=${(e) => e.key === 'Enter' && send()}
          disabled=${disabled || sending}
          placeholder="어떤 무기를 만들까요?"
        />
        <button class="chat-send-btn" onClick=${send} disabled=${disabled || sending}>${sending ? '전송 중...' : '보내기'}</button>
      </div>
    </div>
  `;
}