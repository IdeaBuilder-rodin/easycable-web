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
  /* 프로젝트당 무료 배선 수. 시트를 나눠도 합산한다(과금 단위가 프로젝트 전체다).

     ⚠ 2026-08-26~27 에 시험 편의로 잠깐 2 로 낮춰 뒀었다. 2026-08-27 에 되돌렸다.
        다시 낮춰서 시험해야 하면 **이 줄을 고치지 말고** `?limit=2` 를 쓸 것 —
        주소로만 낮추면 "시험값을 잊고 출시하는" 사고가 구조적으로 안 난다. */
  var LIMIT = 30;          // 프로젝트당 무료 배선 수

  /* 프로젝트당 무료 부품 수. 10개를 넘겨 그리는 사람은 이미 진지하게 쓰는 것이므로
     그 지점을 결제 접점으로 삼는다. (고원빈 판단, 2026-08-26)

     ⚠ 제한하는 것은 **도면에 배치한 부품**뿐이다.
        내 부품 라이브러리(WE.library)는 무제한이다 —
        pricing.html 무료 카드에 "내 부품 라이브러리 무제한" 이라고 써 두었다.
        library.addPart() 에는 절대 한도를 걸지 않는다. */
  var COMP_LIMIT = 10;

  /* 프로젝트당 무료 도면 페이지(시트) 수. (2026-09-06 고원빈 결정)

     왜 1 인가: 두 장째를 만드는 순간이 "이 장비를 제대로 그리고 있다" 는 신호다.
     한 장은 끝까지 그려 볼 수 있으니 제품을 판단할 재료는 충분하다.
     (2026-09-06 에 잠깐 2 였다가 2026-09-07 에 1 로 확정)

     ⚠ 과금 단위는 여기서도 **프로젝트 전체**다. 시트를 세는 것이므로 당연하지만,
        파일을 나눠 우회하는 것은 막지 않는다 — 그건 배선·부품 한도도 마찬가지고,
        파일을 나누면 도면으로서 쓸모가 떨어지므로 실질적인 우회가 못 된다. */
  var SHEET_LIMIT = 1;
  /* ⚠ 예전에는 여기에 '_noticed = 도면당 한 번만' 이 있었다. 그것이 틀렸다 —
        입구가 넷(배치·복제·붙여넣기·시트복제)이라, 첫 한 번을 쓰고 나면
        나머지는 전부 무음이 되어 "눌렀는데 아무 일도 안 일어난다" 가 됐다.
        막힐 때는 **매번** 알린다. 겹치는 것만 막는다. (2026-08-26 고원빈 지적) */

  var _openNoticed = false;   // '한도 넘는 도면' 안내를 이미 띄웠는가

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
    return !!(WE.auth && WE.auth.isPro());
  }

  /* 제한을 적용해야 하는 상태인가.

     ⚠ FREE_LIMIT 이 꺼져 있으면 아무에게도 한도를 걸지 않는다 (심사 기간).
        `=== false` 로 **명시해서** 비교한다 — 플래그가 없거나 이름을 잘못 쓰면
        '한도를 적용하는' 쪽으로 붙어야 안전하다. 반대로 붙으면 유료화가 조용히 풀린다. */
  function limited() {
    if (WE.flags && WE.flags.FREE_LIMIT === false) return false;
    return !isPro();
  }

  /* 프로젝트 전체 배선 수. 시트를 모두 합친다. */
  function count() {
    if (!WE.model || !WE.model.allWires) return 0;
    return WE.model.allWires().length;
  }

  /* 프로젝트 전체 부품 수. 배선과 같은 이유로 시트를 합친다 —
     시트당으로 세면 시트를 쪼개서 우회된다. */
  function compCount() {
    if (!WE.model || !WE.model.allComponents) return 0;
    return WE.model.allComponents().length;
  }

  function compLimit() { return COMP_LIMIT; }

  /* 프로젝트의 도면 페이지 수 */
  function sheetCount() {
    if (!WE.model || !WE.model.project || !WE.model.project.sheets) return 0;
    return WE.model.project.sheets.length;
  }
  function sheetLimit() { return SHEET_LIMIT; }

  /* 결과물에 워터마크를 찍는가. (2026-09-06 신설)

     ⚠ limited() 를 쓰지 않는다. limited() 는 '개수 한도를 적용하는가' 이고,
        심사 기간에는 FREE_LIMIT 이 꺼져 있어 **무료 사용자도 false** 다.
        워터마크는 개수 한도와 무관한 별개의 경계라, 여기서 그 스위치를 따라가면
        심사 기간 내내 아무에게도 워터마크가 안 찍힌다.
        기준은 오직 "Pro 인가" 하나다.

     ⚠ 출시 전(LAUNCH=false)에는 isPro() 가 true 라 워터마크가 없다 — 의도한 것이다.
        유료화 자체가 없는 상태이므로 결과물에 서명할 근거도 없다. */
  function watermark() { return !isPro(); }

  /* 페이지를 n 장 더 만들 수 있는가.
     ⚠ 배선·부품과 달리 canAddBundle 에 합치지 않았다. 시트 추가는 '빈 장을 만드는 것'이라
        배선·부품이 0 개인데, canAddBundle 에 넣으면 0 개짜리 요청이 되어 아무것도 안 막는다.
        시트 복제(duplicateSheet)는 배선·부품도 함께 늘어나므로 **양쪽 다** 확인해야 한다. */
  function canAddSheet(n) {
    if (!limited()) { _유료사용기록_시트(n || 1); return true; }
    return sheetCount() + (n || 1) <= sheetLimit();
  }

  function remaining() { return Math.max(0, limit() - count()); }

  /* ── 유료 기능을 처음 쓴 순간을 서버에 남긴다 ───────────────────────
     약관 제8조 1항이 "무료 이용 범위를 넘는 배선 추가 등 유료 회원 전용 기능을
     1회 이상 실행"한 것을 청약철회(환불) 제한 기준으로 삼는다.
     그 시점을 안 남기면 환불 분쟁에서 우리 쪽 근거가 하나도 없다.

     ⚠ 이 값의 증거력에는 한계가 있다 — 브라우저가 스스로 신고하는 것이라
        개발자도구로 거짓으로 찍거나, 통신이 막혀 못 남길 수 있다.
        에디터가 전부 브라우저에서 도는 이상 서버가 독립 확인할 방법이 없다.
        "우리 쪽 기록으로는 이렇다" 수준으로 쓴다. (2026-08-24 Codex 검토)

     ⚠ 한 번만 부르고, 실패해도 다시 부르지 않는다.
        환불 기록 때문에 사용자의 그림 그리기가 느려지거나 막히면 안 된다.
     ⚠ 서버 함수가 '이미 값이 있으면 덮어쓰지 않는다'. 그래서 새로고침 뒤
        또 불려도 '처음' 시각은 그대로다. */
  var _사용보고함 = false;

  function _유료사용기록(배선수, 부품수) {
    if (_사용보고함) return;
    if (!WE.flags || !WE.flags.LAUNCH) return;              // 출시 전에는 아무 일도 안 한다

    /* ⚠⚠ 무료 사용자에게는 **절대** 남기지 않는다.
       이 기록은 약관 제8조의 환불 제한 근거다. 돈을 낸 적 없는 사람에게 찍히면
       나중에 이용권을 샀을 때 7일 전액 환불이 부당하게 막힌다.

       예전에는 이 방어가 필요 없었다 — canAddBundle 이 `!limited()` 일 때만 부르는데,
       그때 limited() 가 false 인 경우는 '출시 전' 아니면 '진짜 Pro' 둘뿐이었다.
       FREE_LIMIT 을 끄면서 **무료 사용자도 limited()==false 가 됐다.**
       그래서 이 방어가 없으면 심사 기간에 30개를 넘긴 무료 사용자마다 기록이 남는다.
       (2026-09-01) */
    if (!(WE.auth && WE.auth.isPro && WE.auth.isPro())) return;
    // 배선이든 부품이든 무료 범위를 넘겨야 '유료 기능 사용' 이다.
    // 둘 다 범위 안이면 아직 무료로 쓰는 중이다.
    // ⚠ 요청한 종류만 본다 (canAddBundle 과 같은 이유)
    var 배선넘음 = (배선수 || 0) > 0 && count()     + 배선수 > limit();
    var 부품넘음 = (부품수 || 0) > 0 && compCount() + 부품수 > compLimit();
    if (!배선넘음 && !부품넘음) return;

    _사용보고함 = true;   // 호출 전에 세운다 — 실패해도 재시도하지 않는다
    try {
      var c = WE.auth && WE.auth._client && WE.auth._client();
      if (!c) return;
      c.rpc("mark_paid_feature_used").then(function (res) {
        if (res && res.error) {
          try { console.warn("[pro] 유료 사용 기록 실패:", res.error); } catch (e) { /* 무시 */ }
        }
      }, function () { /* 네트워크 오류 — 조용히 넘어간다 */ });
    } catch (e) { /* 무시 */ }
  }

  /* 시트 쪽 유료 사용 기록. 배선·부품과 같은 이유(약관 제8조)로 남긴다.
     _유료사용기록 은 배선/부품 개수를 받는 형태라 시트는 따로 판정해서 넘긴다. */
  function _유료사용기록_시트(n) {
    if (_사용보고함) return;
    if (!WE.flags || !WE.flags.LAUNCH) return;
    if (!(WE.auth && WE.auth.isPro && WE.auth.isPro())) return;
    if (sheetCount() + (n || 1) <= sheetLimit()) return;    // 아직 무료 범위 안이다
    _사용보고함 = true;
    try {
      var c = WE.auth && WE.auth._client && WE.auth._client();
      if (!c) return;
      c.rpc("mark_paid_feature_used").then(function (res) {
        if (res && res.error) { try { console.warn("[pro] 유료 사용 기록 실패:", res.error); } catch (e) {} }
      }, function () { /* 네트워크 오류 — 조용히 */ });
    } catch (e) { /* 무시 */ }
  }

  /* n 개를 더 넣을 수 있는가

     ⚠ 여기서 기록을 남기는 이유 — canAdd 는 model.js 세 곳(배선 그리기·붙여넣기·
        시트 복제)에서만 불리고, 셋 다 통과하면 곧바로 추가한다. 즉 'true 를 받았다'가
        '실제로 유료 범위를 썼다'와 같다. UI 표시용으로 부르는 곳은 없다. */
  function canAdd(n) {
    return canAddBundle(n || 1, 0);
  }

  /* 부품 n 개를 더 놓을 수 있는가 */
  function canAddComp(n) {
    return canAddBundle(0, n || 1);
  }

  /* 배선·부품을 한꺼번에 넣을 때(붙여넣기·시트복제) 쓴다.
     ⚠ 둘 중 하나라도 넘치면 **통째로** 거부한다.
        일부만 들어오면 배선이 끊긴 채 도면이 망가진다 — 기존 붙여넣기 원칙 그대로다. */
  function canAddBundle(배선수, 부품수) {
    var w = 배선수 || 0, c = 부품수 || 0;
    if (!limited()) { _유료사용기록(w, c); return true; }
    /* ⚠ **이번에 넣으려는 종류만** 본다.
          `count() + 0 > limit()` 처럼 0 개를 요청할 때도 검사하면
          두 한도가 서로를 잠근다 — 배선 30개를 다 쓴 사람이 부품은
          0개인데도 부품을 못 넣게 된다. (2026-08-26 실제로 이렇게 만들었다가 잡음) */
    if (w > 0 && count()     + w > limit())     return false;
    if (c > 0 && compCount() + c > compLimit()) return false;
    return true;
  }

  /* 문구는 완전한 문장 하나로 두고 {} 를 나중에 채운다.
     "…배선 " + n + "개…" 처럼 조각내면 번역 단위가 쪼개져 다른 언어에서 어순이 깨진다. */
  function msg(ko, vals) {
    var s = WE.i18n.t(ko);
    for (var k in vals) s = s.replace("{" + k + "}", vals[k]);
    return s;
  }

  /* 도면 페이지 한도로 막혔을 때. (2026-09-06 신설)
     배선·부품과 문구를 섞지 않는다 — 막힌 이유와 보여주는 숫자가 어긋나면
     사용자가 무엇을 지워야 할지 모른다. */
  function denySheet() {
    var 지금 = sheetCount(), 최대 = sheetLimit();
    if (WE.app && WE.app.setHint) {
      WE.app.setHint(
        msg("도면 페이지 {n}/{max}", { n: 지금, max: 최대 }),
        msg("무료 버전은 도면 하나에 페이지 {max}장까지 만들 수 있습니다.", { max: 최대 })
      );
    }
    var 떠있다 = WE.app && WE.app.isNoticeOpen && WE.app.isNoticeOpen();
    if (!떠있다 && WE.app && WE.app.notice) {
      WE.app.notice(
        WE.i18n.t("페이지 한도에 도달했습니다"),
        msg("무료 버전은 도면 하나에 페이지 {max}장까지 만들 수 있습니다.", { max: 최대 })
        + "\n\n"
        + msg("도면 페이지 {n}/{max}", { n: 지금, max: 최대 })
      );
    }
    return false;
  }

  /* 거부됐을 때 사용자에게 알린다.
     need: 이번 작업에 필요한 배선 수 (붙여넣기·시트복제는 여러 개) */
  /* 거부됐을 때 사용자에게 알린다.
     배선수·부품수 = 이번 작업에 필요한 개수 (붙여넣기·시트복제는 여러 개)

     ⚠ 어느 쪽 때문에 막혔는지를 제목으로 알린다. 둘 다 넘치면 합쳐서 말한다.
        본문에는 **두 한도를 모두** 숫자로 보여 준다 —
        "배선은 꽉 찼는데 부품은 여유가 있구나" 를 알아야 다음 행동을 정할 수 있다. */
  function deny(what, 배선수, 부품수) {
    /* 페이지 한도는 세는 대상이 달라 앞에서 따로 처리한다 —
       아래 배선/부품 문구를 그대로 쓰면 "배선 12/30 인데 왜 막히지" 가 된다. */
    if (what === "sheet") return denySheet();

    var 배선지금 = count(), 부품지금 = compCount();
    // ⚠ 실제로 막은 이유와 제목이 어긋나면 안 된다 — canAddBundle 과 판정을 맞춘다
    var 배선넘음 = (배선수 || 0) > 0 && 배선지금 + 배선수 > limit();
    var 부품넘음 = (부품수 || 0) > 0 && 부품지금 + 부품수 > compLimit();

    var 제목 = 배선넘음 && 부품넘음 ? WE.i18n.t("무료 한도에 도달했습니다")
             : 부품넘음            ? WE.i18n.t("부품 한도에 도달했습니다")
             :                       WE.i18n.t("배선 한도에 도달했습니다");

    // 상태줄에는 항상 남긴다 — 모달을 닫아도 이유가 보여야 한다
    if (WE.app && WE.app.setHint) {
      WE.app.setHint(
        msg("배선 {w}/{wmax} · 부품 {c}/{cmax}",
            { w: 배선지금, wmax: limit(), c: 부품지금, cmax: compLimit() }),
        msg("무료 버전은 도면 하나에 배선 {wmax}개 · 부품 {cmax}개까지 그릴 수 있습니다.",
            { wmax: limit(), cmax: compLimit() })
      );
    }

    // 막힐 때마다 띄운다. 단, **이미 떠 있는 동안에는** 다시 열지 않는다 —
    // 모달을 열어 둔 채 뒤에서 또 눌리는 경우에 초점이 튀는 것만 막는 것이다.
    var 떠있다 = WE.app && WE.app.isNoticeOpen && WE.app.isNoticeOpen();
    if (!떠있다 && WE.app && WE.app.notice) {
      var 본문 = msg("무료 버전은 도면 하나에 배선 {wmax}개 · 부품 {cmax}개까지 그릴 수 있습니다.",
                     { wmax: limit(), cmax: compLimit() })
               + "\n\n"
               + msg("배선 {w}/{wmax} · 부품 {c}/{cmax}",
                     { w: 배선지금, wmax: limit(), c: 부품지금, cmax: compLimit() });

      // 여러 개를 한꺼번에 넣으려던 경우(붙여넣기·시트복제)에만 덧붙인다
      if ((배선수 || 0) > 1 || (부품수 || 0) > 1) {
        본문 += "\n" + msg("이 작업에는 배선 {w}개 · 부품 {c}개가 필요합니다.",
                           { w: 배선수 || 0, c: 부품수 || 0 });
      }

      WE.app.notice(제목, 본문);
    }
    return false;
  }

  /* 한도를 넘는 파일을 열었을 때.
     ⚠ 열기를 막지 않는다 — 막으면 사용자가 자기 도면을 못 여는 데이터 손실이 된다.
        열되 '더 추가'만 막힌다. 삭제·내보내기는 그대로 된다. */
  function checkOpened() {
    if (_openNoticed) return;

    /* 아직 판단할 수 없으면 **미뤄 둔다.** 미뤘다는 표시를 남겨,
       요금제 확인이 끝났을 때 그때 한 번만 다시 본다(파일 맨 아래 훅).

       ⚠ 두 가지를 다 기다려야 한다:
         · ready()      — 최초 세션·프로필 확인이 끝났는가
         · proState()   — '확인중' 이면 아직 답이 안 나온 것이다.
                          applySession 이 여러 번 겹쳐 도는 동안 ready 는 섰는데
                          조회는 아직 도는 창이 실제로 생긴다(2026-09-09 계측으로 확인).
                          그 창에서 isPro() 는 localStorage 기억에 기대는데,
                          기억이 없으면(새 브라우저·데이터 삭제·7일 경과) 무료로 떨어진다. */
    if (WE.flags && WE.flags.LAUNCH && WE.auth) {
      var 안끝남 = (WE.auth.ready && !WE.auth.ready()) ||
                   (WE.auth.proState && WE.auth.proState() === "확인중");
      if (안끝남) { _보류중 = true; return; }
    }
    _보류중 = false;
    if (!limited()) return;

    var 배선 = count(), 부품 = compCount(), 페이지 = sheetCount();
    var 배선넘음 = 배선 > limit(), 부품넘음 = 부품 > compLimit();
    var 페이지넘음 = 페이지 > sheetLimit();
    if (!배선넘음 && !부품넘음 && !페이지넘음) return;

    _openNoticed = true;
    if (WE.app && WE.app.notice) {
      WE.app.notice(
        WE.i18n.t("무료 한도를 넘는 도면입니다"),
        msg("이 도면에는 배선 {w}개 · 부품 {c}개 · 페이지 {s}장이 있습니다.",
            { w: 배선, c: 부품, s: 페이지 })
        + "\n"
        + msg("무료 버전은 배선 {wmax}개 · 부품 {cmax}개 · 페이지 {smax}장까지입니다.",
              { wmax: limit(), cmax: compLimit(), smax: sheetLimit() })
        + "\n\n"
        + WE.i18n.t("열어서 보거나 지우는 것은 됩니다. 새로 추가하는 것만 막힙니다.")
      );
    }
  }

  /* 요금제 확인이 안 끝나서 '한도 넘는 도면' 판단을 미뤄 뒀는가.
     ⚠ 이게 필요한 이유 — 예전에는 auth 가 **바뀔 때마다** 다시 판단했다.
        그래서 한도 넘는 도면을 연 채 **로그아웃하는 순간** 안내창이 떴고,
        곧바로 Pro 계정으로 다시 로그인해도 _openNoticed 가 서 있어 화면에 남았다.
        "Pro 인데 무료 한도 안내가 뜬다" 가 바로 이것이었다(2026-09-09 재현).
        다시 볼 이유는 '미뤄 뒀을 때' 하나뿐이다. */
  var _보류중 = false;

  /* 도면을 새로 열거나 만들면 안내 상태를 초기화한다 */
  function reset() { _openNoticed = false; _보류중 = false; }

  /* 미뤄 둔 판단이 있으면 그때만 다시 본다. 파일 맨 아래 onChange 훅이 쓴다. */
  function 보류였으면다시보기() { if (_보류중) checkOpened(); }

  /* 도면이 바뀌었다 — model.loadProject / newProject 가 부른다.
     파일열기 · 자동저장 복원 · 최근작업 · 샘플 · 되돌리기가 모두 그 두 함수를 지난다. */
  function projectChanged() {
    reset();
    checkOpened();
  }

  return {
    LIMIT: LIMIT,
    COMP_LIMIT: COMP_LIMIT,
    SHEET_LIMIT: SHEET_LIMIT,
    limit: limit,          // 실제 적용되는 배선 한도 (미리보기 override 반영)
    compLimit: compLimit,  // 부품 한도
    sheetLimit: sheetLimit,      // 도면 페이지 한도
    sheetCount: sheetCount,      // 프로젝트의 도면 페이지 수
    watermark: watermark,        // 결과물(PNG·PDF·인쇄)에 워터마크를 찍는가
    isPro: isPro,
    limited: limited,
    count: count,          // 프로젝트 전체 배선 수
    compCount: compCount,  // 프로젝트 전체 부품 수 (도면 배치분만 — 라이브러리는 무제한)
    remaining: remaining,
    canAdd: canAdd,          // 배선 n 개
    canAddComp: canAddComp,  // 부품 n 개
    canAddBundle: canAddBundle,  // 배선·부품 동시 (붙여넣기·시트복제)
    canAddSheet: canAddSheet,    // 도면 페이지 n 장
    deny: deny,
    checkOpened: checkOpened,
    보류였으면다시보기: 보류였으면다시보기,
    projectChanged: projectChanged,
    reset: reset,
  };
})();


/* 로그인 확인이 도면을 연 뒤에 끝나는 경우가 있다.
   그때 한 번 더 봐야 '한도 넘는 도면' 안내를 놓치지 않는다.

   ⚠ **미뤄 뒀을 때만** 다시 본다. 예전에는 auth 가 바뀔 때마다 무조건 다시 봤는데,
      로그아웃도 auth 변화라 그 순간 무료로 판정되어 안내창이 떴다.
      그리고 _openNoticed 는 한 번 서면 안 내려가서, 다시 로그인해도 안 사라졌다.
      (2026-09-09 고원빈 신고 — 로그아웃했다 다시 로그인하면 재현된다) */
if (WE.auth && WE.auth.onChange) {
  WE.auth.onChange(function () {
    WE.pro.보류였으면다시보기();
    // Pro 여부가 바뀌면 워터마크도 따라가야 한다 — 로그인은 화면이 다 뜬 뒤에 끝난다.
    if (WE.render && WE.render.refreshWatermark) WE.render.refreshWatermark();
  });
}
