# GBL 부스 프로젝트 — 수학 도형 무기 온라인 베틀 (36조)

**실제 부스 관련 환경, 진행 방식, 소감 등을 확인하고 싶으시다면 [`부스 진행 방식.md`](<부스 진행 방식.md>)을 참고해주시기 바랍니다**  
대전대신고등학교 GBL(2026-08-14) 부스 체험용 프로젝트. 상세 기획은 [`docs/초안.md`](docs/초안.md) 참고.

## 구조

- `frontend/` — 부스 현장 참가자 기기용 화면 (로컬 서버가 서빙)
- `backend/` — 로컬 서버 (Express + Socket.io), AI API 프록시 및 세션 관리
- `shapes/` — 프론트/백엔드 공통 도형·스탯 로직
- `result-page/` — 결과 상시 조회 페이지 (Vercel 배포)
- `docs/` — 기획 문서

## 개발 환경

- 전체 JavaScript, 프론트는 번들러 없이 CDN(Preact + htm)을 `<script type="module">`로 사용
- 백엔드 실행: `cd backend && npm install && npm start`
