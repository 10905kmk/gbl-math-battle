import { useEffect, useState } from 'preact/hooks';

// 절대경로 고정: fetch()는 import와 달리 "이 파일 위치" 기준이 아니라 "현재 페이지 URL" 기준으로
// 풀리기 때문에, 페이지마다 상대경로(./src/... vs ../src/...)를 따로 맞추다 어긋나기 쉽다.
const SLIDES_URL = '/src/content/shapes-slides.json';

let slidesPromise = null;
function loadSlides() {
  if (!slidesPromise) slidesPromise = fetch(SLIDES_URL).then((res) => res.json());
  return slidesPromise;
}

// 슬라이드 목록 로드 + 관리자 동기화(learn:slide) 구독을 한 곳에서 관리.
// 참가자(learn.js) / 공용화면(admin/display.js) / 관리자 미리보기(admin.js PresenterPanel)에서 공용으로 사용.
export function useSlideSync(socket) {
  const [slides, setSlides] = useState([]);
  const [slideIndex, setSlideIndex] = useState(0);

  useEffect(() => {
    loadSlides().then(setSlides);
  }, []);

  useEffect(() => {
    if (!socket) return;
    socket.on('learn:slide', setSlideIndex);
    return () => socket.off('learn:slide', setSlideIndex);
  }, [socket]);

  return { slides, slideIndex, slide: slides[slideIndex] };
}
