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

   9월 1일 출시할 때:
     LAUNCH 를 true 로 바꾸고, 배포폴더_동기화.ps1 의 잠금을 푼다.
     아래 '미리보기' 블록도 그때 지운다.
   ───────────────────────────────────────────────────────────────────── */
window.WE = window.WE || {};

WE.flags = {
  // 유료화 전체의 유일한 스위치. 출시 전까지 반드시 false.
  LAUNCH: false,
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

try {
  if (WE.flags._isPreviewHost(location.hostname)) {
    WE.flags.LAUNCH = true;
    WE.flags.PREVIEW = true;
  }
} catch (e) { /* 어떤 이유로도 앱 로딩을 막지 않는다 */ }

/* 미리보기일 때 상단 띠를 보인다.
   이 파일은 DOM 보다 먼저 실행되므로 로드 후에 건다. */
if (WE.flags.PREVIEW) {
  document.addEventListener("DOMContentLoaded", function () {
    var b = document.getElementById("previewBanner");
    if (b) b.hidden = false;
  });
}

/* 개발 중 확인용 —
   콘솔에서 WE.flags.LAUNCH = true 로 바꾸면 그 자리에서 켜보고 확인할 수 있다.
   새로고침하면 파일 값(false)으로 돌아간다. */
