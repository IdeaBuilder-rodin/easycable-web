/* ─────────────────────────────────────────────────────────────────────
   pro.js — 무료/Pro 경계

   과금 단위는 **프로젝트(파일) 전체**다. 시트가 아니다.
   시트당으로 세면 시트를 쪼개서 우회된다.
   → 그래서 project.wires(현재 시트 별칭)가 아니라 allWires()를 쓴다.

   ⚠ WE.flags.LAUNCH 가 false 면 제한이 전혀 걸리지 않는다.
      출시(2026-09-01) 전까지 기술 배포에 딸려 나가도 동작이 그대로여야 한다.

   ⚠ 이건 보안 경계가 아니라 '정직한 사용자용 소프트 페이월'이다.
      앱이 브라우저에서 도는 이상 개발자도구로 우회할 수 있다.
      그걸 막으려 난독화·무결성검사에 비용을 쓰는 것은 손해다(감사 판정 LOW).
      막을 가치가 있는 것은 '정상 UI 로 31번째를 그리는 행위'뿐이다.
   ───────────────────────────────────────────────────────────────────── */
var WE = window.WE || {};
window.WE = WE;

WE.pro = (function () {
  var LIMIT = 30;          // 프로젝트당 무료 배선 수
  var _noticed = false;    // 안내를 이미 띄웠는가 (연속 클릭에 모달이 겹치지 않게)

  /* 미리보기 전용 — Pro/무료를 눌러서 바꿔 보기 위한 강제값.
     null 이면 서버(profiles.plan)를 따른다.
     ⚠ 본 서비스에서는 무시된다(아래 isPro 참조). 시험 편의일 뿐 보안과 무관하다 —
        어차피 브라우저 앱이라 콘솔로 같은 일을 할 수 있다(소프트 페이월). */
  var _proOverride = null;

  /* 미리보기에서만 한도를 낮춰 시험할 수 있다.
       preview.easycable-web.pages.dev/?limit=2
     30개를 매번 그려서 시험하기는 번거롭다.

     ⚠ 본 서비스에서는 무시된다 — WE.flags.PREVIEW 가 false 이기 때문.
        코드의 LIMIT 은 30 그대로 두므로 "시험값 2를 잊고 출시하는" 사고가 날 수 없다. */
  function _limitOverride() {
    if (!WE.flags || !WE.flags.PREVIEW) return null;
    try {
      var m = /[?&]limit=(\d+)/.exec(location.search);
      if (!m) return null;
      var n = parseInt(m[1], 10);
      return (n > 0 && n <= 1000) ? n : null;
    } catch (e) { return null; }
  }

  function limit() { return _limitOverride() || LIMIT; }

  /* Pro 인가. 출시 전에는 모두 Pro 로 본다 → 제한이 아예 안 걸린다. */
  function isPro() {
    if (!WE.flags || !WE.flags.LAUNCH) return true;
    // 강제값은 미리보기에서만 통한다. 본 서비스에서는 항상 서버 값을 본다.
    if (WE.flags.PREVIEW && _proOverride !== null) return _proOverride;
    return !!(WE.auth && WE.auth.isPro());
  }

  /* 제한을 적용해야 하는 상태인가 */
  function limited() { return !isPro(); }

  /* 프로젝트 전체 배선 수. 시트를 모두 합친다. */
  function count() {
    if (!WE.model || !WE.model.allWires) return 0;
    return WE.model.allWires().length;
  }

  function remaining() { return Math.max(0, limit() - count()); }

  /* n 개를 더 넣을 수 있는가 */
  function canAdd(n) {
    if (!limited()) return true;
    return count() + (n || 1) <= limit();
  }

  /* 문구는 완전한 문장 하나로 두고 {} 를 나중에 채운다.
     "…배선 " + n + "개…" 처럼 조각내면 번역 단위가 쪼개져 다른 언어에서 어순이 깨진다. */
  function msg(ko, vals) {
    var s = WE.i18n.t(ko);
    for (var k in vals) s = s.replace("{" + k + "}", vals[k]);
    return s;
  }

  /* 거부됐을 때 사용자에게 알린다.
     need: 이번 작업에 필요한 배선 수 (붙여넣기·시트복제는 여러 개) */
  function deny(what, need) {
    var now = count();

    // 상태줄에는 항상 남긴다 — 모달을 닫아도 이유가 보여야 한다
    if (WE.app && WE.app.setHint) {
      WE.app.setHint(
        msg("배선 한도 {now}/{max}", { now: now, max: limit() }),
        msg("무료 버전은 도면 하나에 배선 {max}개까지 그릴 수 있습니다.", { max: limit() })
      );
    }

    // 모달은 한 번만. 연달아 클릭할 때마다 뜨면 작업을 방해한다.
    if (!_noticed && WE.app && WE.app.notice) {
      _noticed = true;
      var detail = msg("무료 버전은 도면 하나에 배선 {max}개까지 그릴 수 있습니다.", { max: limit() });
      if (need && need > 1) {
        detail += "\n\n" + msg("이 작업에는 배선 {need}개가 필요합니다. (현재 {now}/{max})",
                               { need: need, now: now, max: limit() });
      }
      WE.app.notice(WE.i18n.t("배선 한도에 도달했습니다"), detail);
    }
    return false;
  }

  /* 한도를 넘는 파일을 열었을 때.
     ⚠ 열기를 막지 않는다 — 막으면 사용자가 자기 도면을 못 여는 데이터 손실이 된다.
        열되 '더 추가'만 막힌다. 삭제·내보내기는 그대로 된다. */
  function checkOpened() {
    if (!limited()) return;
    var n = count();
    if (n <= limit()) return;
    if (WE.app && WE.app.notice) {
      WE.app.notice(
        WE.i18n.t("배선 한도를 넘는 도면입니다"),
        msg("이 도면에는 배선이 {n}개 있습니다. 열어서 보거나 지우는 것은 됩니다. 새 배선 추가만 막힙니다.",
            { n: n })
      );
    }
  }

  /* 도면을 새로 열거나 만들면 안내 상태를 초기화한다 */
  function reset() { _noticed = false; }

  return {
    LIMIT: LIMIT,
    limit: limit,        // 실제 적용되는 한도 (미리보기 override 반영)
    isPro: isPro,
    limited: limited,
    count: count,
    remaining: remaining,
    canAdd: canAdd,
    deny: deny,
    checkOpened: checkOpened,
    reset: reset,
    // 미리보기 전용 시험 도구
    setOverride: function (v) { _proOverride = v; _noticed = false; },
    getOverride: function () { return _proOverride; },
  };
})();

/* ── Pro/무료 전환 버튼 (미리보기 전용 시험 도구) ─────────────────────
   Supabase 대시보드를 오가지 않고 그 자리에서 Pro 를 켜고 끄기 위한 것.

   ⚠ 미리보기(preview.*.pages.dev)에서만 보인다. 본 서비스에서는 버튼 자체가 없다.
   ⚠ 보안과 무관하다 — 브라우저 앱이라 콘솔로도 같은 일을 할 수 있다(소프트 페이월).
      막을 가치가 있는 것은 '정상 UI 로 한도를 넘기는 행위'뿐이라고 판단했다.

   9월 1일 출시할 때 이 블록과 index.html 의 #btnProToggle 을 함께 지운다.
   ─────────────────────────────────────────────────────────────────── */
(function () {
  if (!WE.flags || !WE.flags.PREVIEW) return;   // 본 서비스에서는 아무 일도 안 한다

  document.addEventListener("DOMContentLoaded", function () {
    var b = document.getElementById("btnProToggle");
    if (!b) return;
    b.hidden = false;

    function paint() {
      var ov = WE.pro.getOverride();
      // null = 서버 값을 따르는 중 (로그인한 계정의 profiles.plan)
      var 상태 = ov === null ? (WE.pro.isPro() ? "Pro(서버)" : "무료(서버)")
                             : (ov ? "Pro(강제)" : "무료(강제)");
      b.textContent = "시험: " + 상태;
      b.classList.toggle("on", WE.pro.isPro());
      if (WE.ui && WE.ui.repaintAccount) WE.ui.repaintAccount();
    }

    // 서버값 → 무료강제 → Pro강제 → 서버값 … 순으로 돈다
    b.addEventListener("click", function () {
      var ov = WE.pro.getOverride();
      WE.pro.setOverride(ov === null ? false : (ov === false ? true : null));
      paint();
    });

    WE.auth.onChange(paint);   // 로그인 상태가 바뀌면 표시도 따라간다
    paint();
  });
})();
