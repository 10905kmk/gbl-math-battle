import { h, render } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import htm from 'htm';
import { io } from 'socket.io-client';
import jsQR from 'jsqr';

const html = htm.bind(h);
// 매 프레임(보통 60fps)마다 디코딩하면 저전력 부스 기기에서 카메라 미리보기가 버벅인다.
const SCAN_INTERVAL_MS = 250;

function parseQrPayload(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (!data || data.version !== 1 || typeof data.uid !== 'string' || !data.uid) return null;
  return data.uid;
}

function CheckinApp() {
  const [socket] = useState(() => io());
  const [checkinList, setCheckinList] = useState([]);
  const [pending, setPending] = useState(null);
  const [toast, setToast] = useState(null);
  const [cameraError, setCameraError] = useState(null);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const scanningRef = useRef(true);
  const lastScanRef = useRef(0);
  const lastUidRef = useRef(null);
  const rafRef = useRef(null);

  useEffect(() => {
    socket.on('checkin:list', setCheckinList);
    return () => socket.off('checkin:list', setCheckinList);
  }, [socket]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    let stream;

    function tick() {
      rafRef.current = requestAnimationFrame(tick);
      const now = Date.now();
      if (!scanningRef.current || now - lastScanRef.current < SCAN_INTERVAL_MS) return;
      lastScanRef.current = now;
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || video.readyState !== video.HAVE_ENOUGH_DATA) return;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(imageData.data, imageData.width, imageData.height);
      if (!code) return;
      const uid = parseQrPayload(code.data);
      if (!uid || uid === lastUidRef.current) return;
      lastUidRef.current = uid;
      handleScan(uid);
    }

    async function startCamera() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
      } catch (err) {
        setCameraError(err.message || '카메라를 열 수 없습니다');
        return;
      }
      tick();
    }

    async function handleScan(uid) {
      scanningRef.current = false;
      try {
        const res = await fetch(`/api/checkin/user/${encodeURIComponent(uid)}`);
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setToast(body.error || `사용자를 찾지 못했습니다 (${res.status})`);
          resumeScanning();
          return;
        }
        const data = await res.json();
        setPending({ uid, name: data.name, profile_image: data.profile_image });
      } catch (err) {
        setToast(err.message || '네트워크 오류');
        resumeScanning();
      }
    }

    function resumeScanning() {
      lastUidRef.current = null;
      scanningRef.current = true;
    }

    startCamera();
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  function cancelPending() {
    setPending(null);
    lastUidRef.current = null;
    scanningRef.current = true;
  }

  function confirmPending() {
    const { uid, name, profile_image } = pending;
    socket.emit('checkin:confirmAssign', { uid, name, profile_image }, (response) => {
      if (response.ok) {
        setToast(`${name}님 체크인 완료`);
      } else if (response.reason === 'no_device') {
        setToast('빈 기기가 없습니다. 기기를 정리한 뒤 다시 스캔해주세요');
      } else if (response.reason === 'already_checked_in') {
        setToast('이미 체크인된 사용자입니다');
      } else {
        setToast('체크인 실패');
      }
      setPending(null);
      lastUidRef.current = null;
      scanningRef.current = true;
    });
  }

  function unlink(uid) {
    socket.emit('checkin:unlink', uid);
  }

  return html`
    <div class="checkin-shell">
      <header class="checkin-header"><h1>부스 체크인</h1></header>
      ${cameraError
        ? html`<p class="checkin-camera-error">카메라를 사용할 수 없습니다: ${cameraError}</p>`
        : html`
            <div class="checkin-camera">
              <video ref=${videoRef} playsinline muted></video>
              <canvas ref=${canvasRef} style="display:none"></canvas>
            </div>
          `}
      ${toast ? html`<div class="checkin-toast">${toast}</div>` : null}
      ${pending
        ? html`
            <div class="checkin-modal-backdrop">
              <div class="checkin-modal">
                ${pending.profile_image
                  ? html`<img class="checkin-modal-photo" src=${pending.profile_image} alt=${pending.name} />`
                  : null}
                <p class="checkin-modal-name">${pending.name}</p>
                <p>본인이 맞나요?</p>
                <div class="checkin-modal-actions">
                  <button onClick=${cancelPending}>아니오</button>
                  <button class="primary" onClick=${confirmPending}>예</button>
                </div>
              </div>
            </div>
          `
        : null}
      <section class="checkin-list-panel">
        <h2>체크인 목록 (${checkinList.length}건)</h2>
        ${checkinList.length === 0
          ? html`<p class="empty">아직 체크인된 참가자가 없습니다.</p>`
          : html`
              <ul class="checkin-list">
                ${checkinList.map(
                  (entry) => html`
                    <li key=${entry.uid}>
                      <span>${entry.name}</span>
                      <button class="kick" onClick=${() => unlink(entry.uid)}>연결 해제</button>
                    </li>
                  `,
                )}
              </ul>
            `}
      </section>
    </div>
  `;
}

render(html`<${CheckinApp} />`, document.getElementById('checkin-app'));
