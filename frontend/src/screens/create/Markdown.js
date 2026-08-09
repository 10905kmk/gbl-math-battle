// frontend/src/screens/create/Markdown.js
// AI 응답 텍스트를 마크다운 + LaTeX(KaTeX)로 렌더링한다.
//
// 순서가 중요하다: 수식을 먼저 자리표시자로 빼둔 뒤 → 마크다운 파싱 → 새니타이즈 →
// 마지막에 KaTeX 결과를 끼워 넣는다.
//   - 수식을 먼저 빼는 이유: `$a_1 + b_2$` 같은 식의 `_`를 마크다운이 이탤릭으로 먹어버린다.
//   - KaTeX를 새니타이즈 "다음"에 넣는 이유: KaTeX 출력은 우리가 만든 신뢰할 수 있는 HTML인데,
//     그 안의 수많은 span/style/MathML을 DOMPurify에 통과시키면 깨질 여지만 생긴다.
//     자리표시자는 특수문자가 없는 평범한 텍스트라 마크다운/새니타이즈를 그대로 통과한다.
import { h } from 'preact';
import { useMemo } from 'preact/hooks';
import { marked } from 'marked';
import katex from 'katex';
import DOMPurify from 'dompurify';

marked.setOptions({
  gfm: true,
  // 채팅 말풍선이라 줄바꿈 한 번도 그대로 <br>로 보이는 게 자연스럽다.
  breaks: true,
});

// 정규식에 lookbehind((?<!...))를 쓰지 않는다 — 구형 Safari(부스에 아이패드가 올 수 있음)는
// lookbehind를 만나면 모듈 로드 시점에 SyntaxError로 죽어서 제작 화면 전체가 안 뜬다.
// 대신 인라인 `$...$`는 "여는 $ 바로 뒤가 공백이 아닐 것"만 요구해서 오탐을 줄인다.
const MATH_PATTERNS = [
  { re: /\$\$([\s\S]+?)\$\$/g, display: true },
  { re: /\\\[([\s\S]+?)\\\]/g, display: true },
  { re: /\\\(([\s\S]+?)\\\)/g, display: false },
  { re: /\$([^\s$][^$\n]*?)\$/g, display: false },
];

const PLACEHOLDER_PREFIX = '@@KTXMATH';
const PLACEHOLDER_SUFFIX = '@@';

function extractMath(source) {
  const found = [];
  let text = source;
  for (const { re, display } of MATH_PATTERNS) {
    text = text.replace(re, (_, tex) => {
      const token = `${PLACEHOLDER_PREFIX}${found.length}${PLACEHOLDER_SUFFIX}`;
      found.push({ tex, display });
      return token;
    });
  }
  return { text, found };
}

function renderMath({ tex, display }) {
  return katex.renderToString(tex, {
    displayMode: display,
    // 참가자가 보는 화면에서 LaTeX 문법 오류로 예외가 나면 안 된다 — KaTeX가 빨간 글씨로
    // 원문을 그대로 보여주고 넘어가게 한다.
    throwOnError: false,
    errorColor: '#ff8080',
    strict: false,
  });
}

export function renderMarkdown(source) {
  if (typeof source !== 'string' || source.trim() === '') return '';
  try {
    const { text, found } = extractMath(source);
    const parsed = marked.parse(text);
    let clean = DOMPurify.sanitize(parsed);
    found.forEach((math, i) => {
      clean = clean.split(`${PLACEHOLDER_PREFIX}${i}${PLACEHOLDER_SUFFIX}`).join(renderMath(math));
    });
    return clean;
  } catch (err) {
    // 렌더링 경로가 어떤 이유로든 실패해도 참가자는 최소한 원문은 봐야 한다.
    console.error('[markdown] 렌더 실패, 원문으로 대체', err);
    const escaped = source
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    return `<p>${escaped}</p>`;
  }
}

export function Markdown({ text, className }) {
  const rendered = useMemo(() => renderMarkdown(text), [text]);
  return h('div', { class: className, dangerouslySetInnerHTML: { __html: rendered } });
}
