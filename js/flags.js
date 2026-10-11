/* ─────────────────────────────────────────────────────────────────────
   기능 스위치
   ─────────────────────────────────────────────────────────────────────
   왜 이 파일이 있는가:
     2026-09-01 출시 전까지 유료화(로그인·결제·사용 제한)를 만들지만,
     그 사이에도 버그 수정은 계속 배포해야 한다.
     브랜치로 나누면 배포할 때마다 합쳐야 하고, 한 번만 잊으면 누락된다.
     그래서 같은 코드에 두고 이 스위치로 끈다 — 누락이 구조적으로 불가능해진다.

   쓰는 법:
     if (!WE.flags.LAUNCH) return;      // 유료화 코드는 전부 이 뒤에

   2026-09-01 출시하면서 LAUNCH 를 true 로 바꿨고,
   배포폴더_동기화.ps1 의 '출시 잠금' 블록도 지웠다.
   아래 '미리보기' 블록은 실채널 전환까지 남겨 둔다 — 아직 시험할 것이 있다.
   ───────────────────────────────────────────────────────────────────── */
window.WE = window.WE || {};

WE.flags = {
  // 유료화 전체의 유일한 스위치. 2026-09-01 출시로 켰다.
  LAUNCH: true,
  /* 라이브러리 부품 자동 수집(js/libsync.js) — 배포로 끄는 스위치. 서버 쪽 스위치(LIBSYNC_MODE secret)는
     재배포 없이 끈다. 둘 중 하나만 꺼져도 안 보낸다. (2026-09-14) */
  LIBSYNC: true,

  /* ── 무료 한도를 적용할 것인가 (배선 30 · 부품 10 · 페이지 1) ──────
     지금 값: **true — 무료 사용자에게 한도가 걸린다.** 2026-10-12 정식 출시(9/30 고원빈 확정 · 10/11 로컬 적용).

     왜 이제 켜는가: 9/10 에 false 로 내린 이유는 「막히는데 살 수는 없다」 였다(포트원 테스트 채널).
       지금은 KG이니시스 **실연동**(카드사 10곳 등록 10/02 · 실결제→환불 1건) — 막힌 손님이 그 자리에서 살 수 있다.
       출시 안내 모달이 「10/12 부터 요금제 적용」 을 미리 알렸다(고원빈 「갑자기 끊으면 당황」 에 대한 답).

     ⚠⚠ 서버 `PAY_OPEN=true` 와 **짝**이다. 이것만 켜고 PAY_OPEN 이 꺼져 있으면 다시 「막히는데 살 수는 없는」
         상태가 된다(결제 화면이 결제를 누른 뒤에 「지금은 판매하지 않습니다」). 출시일 순서 = PAY_OPEN 먼저 → 이 값 배포.
     되돌리기: false 로 바꿔 배포하면 아무에게도 한도가 안 걸린다. 요금제 화면의 한도 문구는 그대로 둬도 손님 손해는 없다.
     이력: 9/07 true(시험) → 9/10 false(테스트 채널) → 10/12 true.

     ⚠ 표 내보내기(CSV·엑셀)는 이 스위치와 **무관하다 — 무료도 된다**(2026-10-11 고원빈 · js/app.js exportBomCSV 위 주석).
        워터마크도 여기 안 걸린다. 그건 막는 것이 아니라 서명이라 Pro 여부(isPro)만 본다. */
  FREE_LIMIT: true,

  // 미리보기 주소에서 켜졌는지 (상단에 띠를 띄우는 표시)
  PREVIEW: false,
};

/* ── 미리보기 주소 ────────────────────────────────────────────────────
   출시 전에 '실제 도메인·실제 HTTPS'에서 로그인을 시험할 통로가 필요하다.
   로컬(file://)은 출처가 없어 OAuth 가 성립하지 않고,
   CSP 헤더는 Cloudflare 가 붙이므로 로컬에서는 검증할 수 없다.
   나중에 결제(PG 콜백)도 실제 도메인이 있어야 시험할 수 있다.

   ★ 스위치를 '파일'이 아니라 '주소'가 정한다.
     이렇게 하면 preview 브랜치와 main 브랜치의 파일이 한 바이트도 다르지 않아
     `git push origin main:preview` 로 그대로 복사할 수 있고,
     합치다가 충돌하거나 한쪽만 낡는 일이 생길 수 없다.

     https://easycable.co.kr/                   → 꺼짐 (본판)
     https://easycable-web.pages.dev/           → 꺼짐 (프로덕션 별칭, 공개 주소)
     https://preview.easycable-web.pages.dev/   → 켜짐 (미리보기)

   ⚠ 이 주소는 '비밀'이 아니라 '안 알려진' 것이다.
      실제 잠금은 구글 OAuth 가 '테스트' 상태라 등록된 계정만 로그인되는 것으로 이뤄진다.
      남이 주소를 찾아내도 로그인 자체가 실패한다.
   ─────────────────────────────────────────────────────────────────── */

// 판정을 함수로 빼 둔다 — 실제 preview 주소에 접속하지 않고도 검사할 수 있어야 한다.
// 'preview.' 로 시작하는 pages.dev 만 켠다:
//   · 프로덕션 별칭 easycable-web.pages.dev      → 안 켜짐 (공개 주소이므로 반드시 제외)
//   · evil-preview.easycable-web.pages.dev      → 안 켜짐 (앞에 뭘 붙여도 소용없게)
//   · preview.easycable.co.kr                   → 안 켜짐 (pages.dev 가 아님)
WE.flags._isPreviewHost = function (host) {
  return /^preview\..*\.pages\.dev$/i.test(String(host || ""));
};

// 내 컴퓨터에서 띄운 것인가.
// 로컬은 남이 접속할 수 없으므로, 여기서만 열리는 시험용 통로를 둘 수 있다.
// (검사가 Pro 판정 같은 상태를 직접 만들어야 할 때 쓴다)
WE.flags._isLocalHost = function (host) {
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
};

/* ── 로컬에서 '출시 상태'를 눈으로 보는 통로 ──────────────────────────
   조건이 둘 다 필요하다 — 내 컴퓨터 + 주소에 ?launch=1.
   그래서 실제 서비스 주소에서는 무슨 짓을 해도 켜지지 않는다.

   ⚠ 이 함수는 **순수하게 둔다** (인자만 보고 판단, 아무것도 저장하지 않는다).
      verify_auth 가 여러 조합을 연달아 물어보기 때문이다.
      여기서 뭔가를 기억하면 앞 질문이 뒤 답을 오염시켜 검사가 헛돈다.
      '기억'은 아래 _localLaunchOn 이 맡는다. */
WE.flags._wantsLocalLaunch = function (host, search) {
  return WE.flags._isLocalHost(host) && /[?&]launch=1(&|$)/.test(String(search || ""));
};

/* ── 한 번 켜면 이 브라우저가 기억한다 ────────────────────────────────
   ⚠ 왜 기억하게 만들었는가 —
      예전에는 ?launch=1 쿼리만 봤다. 그런데 상태가 '주소'에 실려 있으면
      페이지를 옮길 때마다 그 값을 손으로 이어붙여야 한다.
      링크 하나만 빠져도 끊기는데, 끊기면 로그인해 두고도
      "로그인이 필요합니다" 가 떠서 원인을 찾기 어렵다.
      2026-08-24 하루에 네 번 막혔다 —
      로그인 링크 · 요금제 버튼 · 토스 successUrl · 내 계정 링크.

   켜기: ?launch=1   ·   끄기: ?launch=0
   (끄는 길을 남겨 둔 이유 — 로컬에서 무료 사용자 화면도 봐야 한다)

   ⚠ 실서비스에서는 저장값을 읽지도 않는다. _isLocalHost 를 먼저 확인하고
      아니면 그 자리에서 false 다. 남이 localStorage 를 심어도 소용없다. */
WE.flags._LOCAL_LAUNCH_KEY = "we_local_launch";

WE.flags._localLaunchOn = function (host, search) {
  if (!WE.flags._isLocalHost(host)) return false;   // ★ 여기서 먼저 끊는다
  var s = String(search || "");
  var 키 = WE.flags._LOCAL_LAUNCH_KEY;
  try {
    if (/[?&]launch=0(&|$)/.test(s)) { localStorage.removeItem(키); return false; }
    if (/[?&]launch=1(&|$)/.test(s)) { localStorage.setItem(키, "1"); return true; }
    return localStorage.getItem(키) === "1";
  } catch (e) {
    // localStorage 를 못 쓰는 환경(사생활 보호 모드 등) — 쿼리만 보고 판단한다
    return /[?&]launch=1(&|$)/.test(s);
  }
};

try {
  if (WE.flags._isPreviewHost(location.hostname)) {
    WE.flags.LAUNCH = true;
    WE.flags.PREVIEW = true;
  } else if (WE.flags._localLaunchOn(location.hostname, location.search)) {
    WE.flags.LAUNCH = true;
    WE.flags.PREVIEW = true;   // 상단 띠를 띄워 '지금 켜져 있다'를 보이게 한다
  }
} catch (e) { /* 어떤 이유로도 앱 로딩을 막지 않는다 */ }

/* 미리보기 띠는 2026-09-01 출시 준비로 없앴다 (에디터 = 지금의 app.html 에서 요소째 삭제).
   PREVIEW 값 자체는 남는다 — js/pro.js 의 ?limit=N 이 이 값을 본다. */

/* 개발 중 확인용 —
   콘솔에서 WE.flags.LAUNCH = true 로 바꾸면 그 자리에서 켜보고 확인할 수 있다.
   새로고침하면 파일 값(false)으로 돌아간다. */
