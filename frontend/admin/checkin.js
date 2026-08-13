import { h, render, Fragment } from 'preact';
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
  const [cameras, setCameras] = useState([]);
  const [cameraIndex, setCameraIndex] = useState(0);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const scanningRef = useRef(true);
  const lastScanRef = useRef(0);
  const lastUidRef = useRef(null);
  const rafRef = useRef(null);
  const streamRef = useRef(null);
  const camerasEnumeratedRef = useRef(false);

  useEffect(() => {
    socket.on('checkin:list', setCheckinList);
    // checkin:list는 실명/외부 허브 uid가 담겨 있어 관리자 화면만 구독한다(서버가 구독
    // 전에는 보내지 않는다) — 이 화면이 그 두 곳 중 하나다.
    socket.emit('checkin:subscribe');
    return () => socket.off('checkin:list', setCheckinList);
  }, [socket]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(timer);
  }, [toast]);

  // deviceId 없이 부르면 후면(environment) 카메라로 시작 — 전환 버튼(switchCamera)이
  // 이후 명시적 deviceId로 다시 호출한다. 기존 스트림은 새로 붙이기 전에 반드시
  // 정지해야 한다 — 안 그러면 아이패드/노트북 카메라가 "사용 중" 상태로 남아 다음
  // getUserMedia 호출이 실패하거나 두 카메라가 동시에 켜진 채로 남는다.
  async function startStream(deviceId) {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    const constraints = deviceId
      ? { video: { deviceId: { exact: deviceId } } }
      : { video: { facingMode: 'environment' } };
    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraError(null);
      // 카메라 label은 권한을 승인받기 전까지 브라우저가 빈 문자열로 감춘다 — 최초
      // 스트림을 딴 뒤 딱 한 번만 다시 열거해서 전환 버튼에 쓸 실제 목록을 채운다.
      if (!camerasEnumeratedRef.current) {
        camerasEnumeratedRef.current = true;
        const devices = await navigator.mediaDevices.enumerateDevices();
        setCameras(devices.filter((d) => d.kind === 'videoinput'));
      }
    } catch (err) {
      setCameraError(err.message || '카메라를 열 수 없습니다');
    }
  }

  function switchCamera() {
    if (cameras.length < 2) return;
    const nextIndex = (cameraIndex + 1) % cameras.length;
    setCameraIndex(nextIndex);
    startStream(cameras[nextIndex].deviceId);
  }

  useEffect(() => {
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

    // rAF 루프는 카메라 준비 여부와 무관하게 마운트 시 한 번만 시작한다 — tick()이
    // video.readyState를 매번 확인하므로 스트림이 아직 없거나 전환 중이어도 안전하게
    // 건너뛴다. 이러면 switchCamera()가 스트림만 교체해도(루프 재시작 없이) 다음
    // 프레임부터 바로 새 카메라를 읽는다.
    startStream();
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
    // eslint-disable-next-line
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
    <${Fragment}>
      <div class="card checkin-card">
        <p class="eyebrow">수학 도형 무기 배틀</p>
        <h2 class="title">부스 체크인</h2>
        <p class="subtitle">참가자의 QR 배지를 카메라에 비춰주세요</p>
        ${cameraError
          ? html`<p class="checkin-camera-error">카메라를 사용할 수 없습니다: ${cameraError}</p>`
          : html`
              <div class="checkin-camera">
                <video ref=${videoRef} playsinline muted></video>
                <canvas ref=${canvasRef} style="display:none"></canvas>
              </div>
              ${cameras.length > 1
                ? html`
                    <button class="btn btn--sm checkin-switch-camera" onClick=${switchCamera}>
                      카메라 전환 (${cameraIndex + 1}/${cameras.length})
                    </button>
                  `
                : null}
            `}
      </div>

      <div class="card checkin-list-card">
        <p class="eyebrow">체크인 목록</p>
        <h2 class="title">${checkinList.length}명</h2>
        ${checkinList.length === 0
          ? html`<p class="checkin-list-empty">아직 체크인된 참가자가 없습니다.</p>`
          : html`
              <ul class="checkin-list">
                ${checkinList.map(
                  (entry) => html`
                    <li key=${entry.uid}>
                      <span>${entry.name}</span>
                      <button class="btn btn--danger btn--sm" onClick=${() => unlink(entry.uid)}>연결 해제</button>
                    </li>
                  `,
                )}
              </ul>
            `}
      </div>

      ${toast ? html`<div class="checkin-toast">${toast}</div>` : null}
      ${pending
        ? html`
            <div class="checkin-modal-backdrop">
              <div class="card checkin-modal">
                ${pending.profile_image
                  ? html`<img class="checkin-modal-photo" src=${pending.profile_image} alt=${pending.name} />`
                  : null}
                <h2 class="checkin-modal-name">${pending.name}</h2>
                <p class="subtitle">본인이 맞나요?</p>
                <div class="checkin-modal-actions">
                  <button class="btn" onClick=${cancelPending}>아니오</button>
                  <button class="btn btn--primary" onClick=${confirmPending}>예</button>
                </div>
              </div>
            </div>
          `
        : null}
    <//>
  `;
}

render(html`<${CheckinApp} />`, document.getElementById('app'));
