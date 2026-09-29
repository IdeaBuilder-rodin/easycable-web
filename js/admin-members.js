/* ─────────────────────────────────────────────────────────────────────
 *  admin-members — 관리자 「회원 · 결제 · 환불」 화면 (2026-09-22)
 *
 *  ★ 왜 만들었나
 *    환불을 **브라우저 콘솔에 함수 호출을 직접 쳐서** 하고 있었다
 *    (supabase/functions/payment-cancel/index.ts 머리말의 사용법).
 *    회원이 몇 명인지, 누가 결제했는지 볼 화면도 없었다.
 *    카드사 등록이 끝나면 실제 손님 결제·환불이 시작되는데 그때 이러면 안 된다.
 *
 *  ★ 무엇을 하지 않는가 — **환불 계산도 실행도 여기서 하지 않는다.**
 *    둘 다 Edge Function `payment-cancel` 한 곳에만 있다. 이 파일은 그것을
 *    두 번(계산 → 실행) 부르고 결과를 사람이 읽을 수 있게 옮겨 적을 뿐이다.
 *    금액 계산을 화면에도 두면 **서버와 화면이 다른 금액을 말하는 날**이 온다.
 *
 *  ★ 개인정보 — 왼쪽 회원 목록에는 이메일·이용권·결제 건수만 둔다.
 *    이름·휴대폰은 개인정보처리방침 2장에 「결제·환불 안내」 목적으로 적혀 있어서,
 *    **환불을 처리하는 맥락(오른쪽 상세)에서만** 보인다. 서버도 그렇게 나눠 준다 —
 *    admin_members() 는 연락처를 아예 안 돌려주고 admin_member_orders() 만 준다.
 *
 *  ★ 데이터 경로 (전부 관리자 가드가 서버에 있다)
 *      회원 목록   rpc("admin_members")        _ai/sql/2026-09-22_관리자_회원결제.sql
 *      주문 내역   rpc("admin_member_orders")  같은 파일
 *      환불        functions.invoke("payment-cancel")
 *
 *  ⚠ 관리자 정의가 **두 벌**이다 — 화면·DB 는 admin_users 표(is_easycable_admin),
 *     payment-cancel 은 환경변수 ADMIN_USER_IDS. 화면은 열리는데 환불만 404 가 날 수 있어
 *     그 경우 원인을 짚어서 알려 준다(아래 환불응답표시).
 * ───────────────────────────────────────────────────────────────────── */
(function () {
  "use strict";

  window.WE = window.WE || {};

  var PAGE = 60;            // 한 번에 읽는 회원 수. 더 필요하면 「더 보기」

  /* ★ 왼쪽 계정란은 두 모양이다 (2026-09-29 — 폴더를 이 화면으로 합침, 고원빈 결정)
       · 폴더 묶음(기본) — 「일반 회원」(폴더 없음) 과 폴더들이 파일 탐색기처럼 펼침·접힘으로 묶인다.
         묶음마다 따로 서버에서 60명씩 읽는다(일반 회원은 수천 명이 될 수 있어 한 번에 다 안 읽는다).
       · 검색 결과(평평) — 이메일로 찾을 때만. 묶음을 풀고 결과를 나열한다(9/28 까지의 목록 모양 그대로).
         누가 어느 폴더에 있든 한 번에 찾을 수 있어야 해서다. 검색창을 비우고 Enter 하면 묶음으로 돌아온다. */
  var 평평 = false;
  var 회원들 = [];          // 검색 결과
  var 전체수 = 0;
  var 읽는중 = false;
  var 읽기오류 = null;
  /* 묶음 — 키: "none"(일반 회원 = 폴더 없음) 또는 폴더 id
     값: { 열림, 회원: [], 전체, 읽는중, 오류, 읽음, 차례 } — 차례는 늦게 온 응답을 버리려고 센다 */
  var 묶음 = {};
  var 폴더목록 = [];        // admin_folders — 묶음 머리줄 · 「회원 설정」 의 폴더 고르기에 쓴다
  var 폴더오류 = null;

  var 고른회원 = null;      // user_id — 오른쪽 칸이 「회원」
  var 고른폴더 = null;      // folder id — 오른쪽 칸이 「폴더 관리」 (둘 중 하나만 선다)
  var 주문들 = [];
  var 고른주문 = null;      // order id
  var 계산결과 = null;      // payment-cancel 미리보기 응답
  var 주문오류 = null;
  var 들어온적 = false;

  function $(id) { return document.getElementById(id); }
  function client() { return WE.auth && WE.auth._client ? WE.auth._client() : null; }

  /* 화면에 넣는 모든 값은 이걸 통과한다. 이메일·사유 문구에 <> 가 섞여 들어올 수 있다. */
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  /* 알림은 관리자 페이지 공통 자리(#admMsg)를 쓴다 — admin.js 의 msg() 와 같은 규칙 */
  function msg(text, kind) {
    var el = $("admMsg"); if (!el) return;
    el.textContent = text || "";
    el.className = kind === "err" ? "error" : "muted";
  }

  /* 시각은 **한국 시각으로** 보여 준다. 서버는 timestamptz 를 그대로 주고 변환은 여기서 한다
     (_ai/sql/2026-08-25_환불판단조회.sql 의 규칙과 같은 이유 — UTC 를 그대로 보면 9시간을 헷갈린다) */
  function 날짜(v, 짧게) {
    if (!v) return "—";
    var d = new Date(v); if (isNaN(d.getTime())) return "—";
    var o = { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" };
    if (!짧게) { o.hour = "2-digit"; o.minute = "2-digit"; o.hour12 = false; }
    return d.toLocaleString("ko-KR", o).replace(/\.$/, "");
  }
  function 원(n) { return (Number(n) || 0).toLocaleString("ko-KR") + "원"; }

  /* Pro 판정은 **plan 과 만료일을 같이** 본다. plan 이 'pro' 라도 만료가 지났으면 무료다
     (order-create 의 이용중 판정, 01_profiles.sql 의 규칙과 같게 맞춘다 — 화면만 다르게 말하면 안 된다) */
  function 프로인가(m) {
    return m && m.plan === "pro" && m.expires_at && new Date(m.expires_at).getTime() > Date.now();
  }
  /* 기관 제공 Pro 가 살아 있는가 (2026-09-28). 결제 Pro 와 **따로** 본다 — 환불 판단이 다르다 */
  function 제공중(m) {
    return !!(m && m.grant_until && new Date(m.grant_until).getTime() > Date.now());
  }
  /* <input type="date"> 에 넣을 값 — 한국 시각의 날짜(YYYY-MM-DD).
     ⚠ toISOString().slice(0,10) 으로 자르면 안 된다. 「참여일부터 N일」 로 받은 기간은 끝나는 시각이
        제각각이라, 한국 시각 00~09시에 끝나면 UTC 로는 **전날**이다 → 하루 앞 날짜가 칸에 들어가고,
        관리자가 모르고 [저장]하면 기간이 하루 줄어든다. */
  function 날짜칸(v) {
    if (!v) return "";
    var d = new Date(v); if (isNaN(d.getTime())) return "";
    return d.toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
  }
  /* 고른 회원을 찾는다 — 지금 보이는 모양(검색 결과 / 묶음들) 어디에 있든 */
  function 회원찾기(uid) {
    if (!uid) return null;
    var 목록 = 평평 ? [회원들] : Object.keys(묶음).map(function (k) { return 묶음[k].회원; });
    for (var j = 0; j < 목록.length; j++) {
      for (var i = 0; i < 목록[j].length; i++) if (목록[j][i].user_id === uid) return 목록[j][i];
    }
    return null;
  }
  function 폴더찾기(id) {
    for (var i = 0; i < 폴더목록.length; i++) if (폴더목록[i].id === id) return 폴더목록[i];
    return null;
  }
  function 새묶음(열림) { return { 열림: !!열림, 회원: [], 전체: 0, 읽는중: false, 오류: null, 읽음: false, 차례: 0 }; }

  var 상태이름 = {
    pending: "미완료", paid: "결제완료", failed: "실패", canceled: "취소",
    partially_refunded: "부분환불", refunded: "환불완료"
  };
  function 상태클래스(s) {
    return s === "paid" ? "paid" : s === "pending" ? "pending"
         : (s === "refunded" || s === "partially_refunded") ? "refunded"
         : (s === "failed" || s === "canceled") ? "failed" : "";
  }

  // ── 검색 결과 읽기 (평평한 목록) ──────────────────────────────────────────
  /* 유지uid — 회원 설정을 저장한 뒤처럼 **고른 회원을 그대로 둔 채** 목록만 새로 읽을 때 준다 */
  function 회원읽기(이어서, 유지uid) {
    var c = client();
    if (!c) { 읽기오류 = "로그인 정보를 읽지 못했습니다."; 회원그리기(); return Promise.resolve(); }
    읽는중 = true; 읽기오류 = null;
    if (!이어서) {
      회원들 = [];
      if (!유지uid) { 고른회원 = null; 주문들 = []; 고른주문 = null; 계산결과 = null; }
    }
    회원그리기(); 회원설정그리기();

    var 검색 = ($("admMemSearch") && $("admMemSearch").value || "").trim();
    /* ⚠ 폴더 인자를 안 보낸다(인자 셋) — 검색은 폴더와 상관없이 전체에서 찾는다.
       덤으로 폴더 SQL 을 아직 안 돌린 DB 의 옛 admin_members(인자 셋)로도 검색은 그대로 돈다. */
    var 인자 = { p_q: 검색 || null, p_limit: PAGE, p_offset: 회원들.length };
    return c.rpc("admin_members", 인자)
      .then(function (res) {
        읽는중 = false;
        if (res.error) {
          // ⚠ 조용히 빈 목록을 보여 주지 않는다. SQL 을 아직 안 돌렸을 때가 가장 흔한데,
          //    그때 "회원이 없습니다" 라고 하면 원인을 영영 못 찾는다.
          읽기오류 = res.error.message || "알 수 없는 오류";
          회원그리기(); return;
        }
        var rows = res.data || [];
        전체수 = rows.length ? Number(rows[0].total_count || rows.length) : (이어서 ? 전체수 : 0);
        회원들 = 회원들.concat(rows);
        // 고른 회원이 새 목록에서 빠졌으면 선택을 푼다
        if (유지uid && !회원찾기(유지uid)) { 고른회원 = null; 주문들 = []; 고른주문 = null; 계산결과 = null; 주문그리기(); 상세그리기(); }
        회원그리기(); 오른쪽그리기(); msg("");
      })
      .catch(function (e) {
        읽는중 = false; 읽기오류 = (e && e.message) || "서버에 닿지 못했습니다.";
        회원그리기();
      });
  }

  // ── 묶음 읽기 (폴더 하나 · 일반 회원) ────────────────────────────────────
  /* 키 = "none"(폴더 없음) 또는 폴더 id. admin_members 의 p_no_folder / p_folder 로 그 묶음만 읽는다 */
  function 묶음읽기(키, 이어서) {
    var c = client(); var g = 묶음[키];
    if (!g) return Promise.resolve();
    if (!c) { g.오류 = "로그인 정보를 읽지 못했습니다."; 회원그리기(); return Promise.resolve(); }
    if (!이어서) g.회원 = [];
    g.읽는중 = true; g.오류 = null;
    var 이번 = ++g.차례;
    회원그리기();
    var 인자 = { p_q: null, p_limit: PAGE, p_offset: g.회원.length };
    if (키 === "none") 인자.p_no_folder = true; else 인자.p_folder = 키;
    return c.rpc("admin_members", 인자).then(function (res) {
      if (이번 !== g.차례) return;                    // 그 사이 같은 묶음을 또 읽었으면 늦게 온 것은 버린다
      g.읽는중 = false;
      if (res.error) {
        // ⚠ 조용히 빈 묶음을 보여 주지 않는다 — SQL 을 안 돌렸을 때가 가장 흔하다
        g.오류 = res.error.message || "알 수 없는 오류"; 회원그리기(); return;
      }
      var rows = res.data || [];
      g.전체 = rows.length ? Number(rows[0].total_count || rows.length) : (이어서 ? g.전체 : 0);
      g.회원 = g.회원.concat(rows); g.읽음 = true;
      회원그리기(); 오른쪽그리기();
    }).catch(function (e) {
      if (이번 !== g.차례) return;
      g.읽는중 = false; g.오류 = (e && e.message) || "서버에 닿지 못했습니다."; 회원그리기();
    });
  }

  // ── 그리기 ────────────────────────────────────────────────────────────────
  /* 회원 한 줄. 폴더태그 — 검색 결과에서만 붙인다(묶음 안에서는 이미 그 폴더 아래라 중복이다) */
  function 회원줄(m, 폴더태그) {
    var el = document.createElement("div");
    el.className = "adm-mem-user" + (m.user_id === 고른회원 ? " on" : "");
    el.setAttribute("role", "button");
    el.tabIndex = 0;
    el.dataset.uid = m.user_id;
    var 태그 = [];
    // 결제 Pro(초록) · 기관 제공(보라)을 따로 보인다. 둘 다 없을 때만 「무료」 —
    // 제공받는 학생에게 「무료」 와 「제공」 이 같이 붙으면 어느 쪽인지 헷갈린다.
    if (프로인가(m)) 태그.push('<span class="adm-mem-tag pro">Pro · ' + esc(날짜(m.expires_at, true)) + '까지</span>');
    else if (!제공중(m)) 태그.push('<span class="adm-mem-tag">무료</span>');
    if (제공중(m)) 태그.push('<span class="adm-mem-tag grant">제공 · ' + esc(날짜(m.grant_until, true)) + '까지</span>');
    if (폴더태그 && m.folder_name) 태그.push('<span class="adm-mem-tag fol">' + esc(m.folder_name) + '</span>');
    if (m.order_count > 0) 태그.push('<span class="adm-mem-tag">결제 ' + m.order_count + '건 · ' + esc(원(m.paid_total)) + '</span>');
    if (m.refund_count > 0) 태그.push('<span class="adm-mem-tag">환불 ' + m.refund_count + '건</span>');
    // 미완료 주문 — 「돈은 받고 이용권은 못 준」 후보라 눈에 띄게 (js/admin.js 의 놓친 결제 경고와 같은 취지)
    if (m.pending_count > 0) 태그.push('<span class="adm-mem-tag warn">미완료 ' + m.pending_count + '건</span>');
    el.innerHTML = "<b>" + esc(m.email || "(이메일 없음)") + "</b>" +
      '<span class="adm-col-meta">가입 ' + esc(날짜(m.joined_at, true)) + "</span>" +
      '<span class="adm-mem-tags">' + 태그.join("") + "</span>";
    return el;
  }

  function 회원그리기() {
    if (!평평) { 묶음그리기(); return; }
    var box = $("admMemUsers"); if (!box) return;
    var stats = $("admMemStats");
    if (stats) {
      stats.textContent = 읽는중 ? "읽는 중…"
        : 읽기오류 ? ""
        : "검색 " + (전체수 > 회원들.length ? 회원들.length + " / " + 전체수 + "명" : 회원들.length + "명");
    }

    if (읽는중 && !회원들.length) { box.innerHTML = '<div class="adm-batch-empty">읽는 중…</div>'; return; }
    if (읽기오류) {
      box.innerHTML = '<div class="adm-batch-empty">회원 목록을 읽지 못했습니다.<br />' + esc(읽기오류) +
        '<br /><br />관리자 권한과 <code>_ai/sql/2026-09-22_관리자_회원결제.sql</code> 실행 여부를 확인하세요.</div>';
      return;
    }
    if (!회원들.length) { box.innerHTML = '<div class="adm-batch-empty">조건에 맞는 회원이 없습니다.</div>'; return; }

    box.innerHTML = "";
    회원들.forEach(function (m) { box.appendChild(회원줄(m, true)); });

    if (회원들.length < 전체수) {
      var more = document.createElement("button");
      more.type = "button"; more.className = "adm-more"; more.id = "admMemMore";
      more.textContent = "더 보기 (" + (전체수 - 회원들.length) + "명 남음)";
      box.appendChild(more);
    }
  }

  /* 폴더 묶음 — 맨 위 폴더들(처음엔 접힘, 한 줄씩) → 새 폴더 입력줄 → 맨 아래 「일반 회원」(폴더 없음, 펼침).
     ⚠ 9/29 오전까지는 「일반 회원」 이 맨 위였다. 60명이 먼저 펼쳐져 폴더와 [새 폴더] 가 목록 한참 아래에 묻혔고,
        원빈이 "링크 만들기가 안 보인다" 고 했다(스크린샷으로 확인). 폴더 머리줄은 한 줄씩이라 몇 개든 첫 화면에 들어간다. */
  function 묶음그리기() {
    var box = $("admMemUsers"); if (!box) return;
    var stats = $("admMemStats");
    if (stats) stats.textContent = 폴더오류 ? "" : "폴더 " + 폴더목록.length + "개";
    // 새 폴더 입력줄에 적던 글자는 다시 그려도 남긴다(묶음 하나가 늦게 읽혀도 적던 것이 날아가지 않게)
    var 적던 = $("admFolNewName") ? $("admFolNewName").value : "";
    box.innerHTML = "";

    폴더목록.forEach(function (f) { 묶음하나(box, f.id); });

    if (폴더오류) {
      var 알림 = document.createElement("div");
      알림.className = "adm-batch-empty";
      알림.innerHTML = "폴더를 읽지 못했습니다.<br />" + esc(폴더오류) +
        "<br /><br /><code>_ai/sql/2026-09-28_폴더_참여링크.sql</code> 실행 여부를 확인하세요.";
      box.appendChild(알림);
    }

    var form = document.createElement("form");
    form.className = "adm-fol-new"; form.id = "admFolNew"; form.setAttribute("autocomplete", "off");
    form.innerHTML = '<input type="text" id="admFolNewName" maxlength="60" placeholder="새 폴더 이름 (예: 공주마이스터고)" />' +
      '<button type="submit" class="adm-edit-btn">새 폴더</button>';
    box.appendChild(form);
    if (적던) $("admFolNewName").value = 적던;

    묶음하나(box, "none");
  }

  /* 묶음 하나 — 머리줄(▸/▾ 이름 · 인원) + 펼쳤으면 회원 줄들 */
  function 묶음하나(box, 키) {
      var g = 묶음[키] || (묶음[키] = 새묶음(키 === "none"));
      var f = 키 === "none" ? null : 폴더찾기(키);
      var 수 = 키 === "none"
        ? (g.읽음 ? g.전체 + "명" : "")
        : (f.member_count || 0) + "명" + (f.granted_count ? " · 제공 " + f.granted_count : "");

      var head = document.createElement("button");
      head.type = "button";
      head.className = "adm-mem-grp" + (키 !== "none" && 키 === 고른폴더 ? " on" : "");
      head.dataset.grp = 키;
      if (키 !== "none") head.title = "더블클릭하면 이름을 바꿉니다";
      head.innerHTML = '<span class="arr">' + (g.열림 ? "▾" : "▸") + "</span>" +
        "<b>" + esc(키 === "none" ? "일반 회원" : f.name) + "</b>" +     // ⚠ 폴더 이름은 관리자가 적은 글
        '<span class="adm-col-meta">' + esc(수) + "</span>";
      box.appendChild(head);

      var body = document.createElement("div");
      body.className = "adm-mem-grp-body";
      body.dataset.body = 키;
      body.hidden = !g.열림;
      if (g.열림) {
        if (g.오류) {
          body.innerHTML = '<div class="adm-batch-empty">회원을 읽지 못했습니다.<br />' + esc(g.오류) +
            '<br /><br />관리자 권한과 <code>_ai/sql/2026-09-28_폴더_참여링크.sql</code> 실행 여부를 확인하세요.</div>';
        } else if (g.읽는중 && !g.회원.length) {
          body.innerHTML = '<div class="adm-col-meta">읽는 중…</div>';
        } else if (!g.회원.length) {
          body.innerHTML = '<div class="adm-col-meta">' + (키 === "none" ? "폴더 없는 회원이 없습니다." : "아직 참여한 회원이 없습니다.") + "</div>";
        } else {
          g.회원.forEach(function (m) { body.appendChild(회원줄(m, false)); });
          if (g.회원.length < g.전체) {
            var more = document.createElement("button");
            more.type = "button"; more.className = "adm-more"; more.dataset.more = 키;
            more.textContent = "더 보기 (" + (g.전체 - g.회원.length) + "명 남음)";
            body.appendChild(more);
          }
        }
      }
      box.appendChild(body);
  }

  // ── 폴더 (2026-09-28 · 09-29 이 화면으로 합침) ─────────────────────────────
  /* 폴더 목록 — 묶음 머리줄(이름·인원)과 「회원 설정」 의 폴더 고르기에 쓴다.
     못 읽으면 조용히 넘어가지 않고 계정란에 이유를 보인다(SQL 을 안 돌렸을 때가 가장 흔하다). */
  function 폴더읽기() {
    var c = client(); if (!c) return Promise.resolve();
    return c.rpc("admin_folders").then(function (res) {
      if (res.error) { 폴더오류 = res.error.message || "알 수 없는 오류"; 회원그리기(); return; }
      폴더오류 = null;
      폴더목록 = res.data || [];
      // 지워진 폴더의 묶음은 버린다 · 오른쪽 칸에 떠 있던 폴더가 지워졌으면 닫는다
      Object.keys(묶음).forEach(function (k) { if (k !== "none" && !폴더찾기(k)) delete 묶음[k]; });
      if (고른폴더 && !폴더찾기(고른폴더)) 고른폴더 = null;
      회원그리기(); 오른쪽그리기(true);
    }).catch(function (e) { 폴더오류 = (e && e.message) || "서버에 닿지 못했습니다."; 회원그리기(); });
  }

  /* 오른쪽 칸 — 폴더를 골랐으면 폴더 관리(admin-folders.js), 회원을 골랐으면 회원 설정 + 주문 상세.
     맨 위 제목으로 지금 무엇을 보는지 밝힌다. 폴더일 때는 가운데 주문 칸을 접고 이 칸을 넓힌다(CSS .fol-mode).
     폴더정보바뀜 — 폴더 목록을 새로 읽은 뒤(이름·인원이 바뀌었을 수 있다)만 true.
       그 밖에는 같은 폴더가 이미 떠 있으면 폴더 관리를 다시 그리지 않는다 — 묶음 하나 읽을 때마다
       링크를 다시 읽고, 적던 새 링크 양식이 지워지면 안 된다. */
  function 오른쪽그리기(폴더정보바뀜) {
    var head = $("admMemSideHead"), panel = $("admFolPanel"), det = $("admMemDetail");
    var body = document.querySelector("#admMembers .adm-mem-body");
    var f = 고른폴더 && 폴더찾기(고른폴더);
    if (f) {
      if (head) { head.textContent = "폴더 · " + f.name; head.hidden = false; }   // textContent — 관리자가 적은 글
      if (panel) panel.hidden = false;
      if (det) det.hidden = true;
      if (body) body.classList.add("fol-mode");
      회원설정그리기();                                 // 고른회원이 없으니 숨는다
      var 떠있음 = WE.adminFolders && WE.adminFolders.current && WE.adminFolders.current() === f.id;
      if (WE.adminFolders && WE.adminFolders.show && (폴더정보바뀜 || !떠있음)) WE.adminFolders.show(f);
      return;
    }
    if (WE.adminFolders && WE.adminFolders.current && WE.adminFolders.current()) WE.adminFolders.hide();
    if (panel) panel.hidden = true;
    if (det) det.hidden = false;
    if (body) body.classList.remove("fol-mode");
    var m = 회원찾기(고른회원);
    if (head) { head.hidden = !m; head.textContent = m ? "회원 · " + (m.email || "(이메일 없음)") : ""; }
    회원설정그리기();
  }

  /* 폴더 머리줄을 눌렀다 — 처음 누르면 펼치고 오른쪽에 그 폴더 관리, 떠 있는 폴더를 다시 누르면 접는다.
     「일반 회원」 머리줄은 펼침·접힘만 한다(관리할 폴더가 아니다). */
  function 머리줄누름(키) {
    var g = 묶음[키] || (묶음[키] = 새묶음(false));
    if (키 !== "none" && 고른폴더 !== 키) {
      고른폴더 = 키; 고른회원 = null; 주문들 = []; 고른주문 = null; 계산결과 = null;
      g.열림 = true;
    } else {
      g.열림 = !g.열림;
    }
    if (g.열림 && !g.읽음 && !g.읽는중) 묶음읽기(키, false);
    회원그리기(); 오른쪽그리기(); 주문그리기(); 상세그리기();
  }

  /* 폴더 관리(admin-folders.js)가 무언가를 바꿨다 — 인원수·이름을 다시 읽는다.
     opts.select: 그 뒤 오른쪽 칸에 둘 폴더(null 이면 닫는다) · opts.removed: 지운 폴더 · opts.reload: 다시 읽을 묶음 */
  function foldersChanged(opts) {
    opts = opts || {};
    if ("select" in opts) 고른폴더 = opts.select || null;
    if (opts.removed) delete 묶음[opts.removed];
    var 다시 = opts.reload;
    return 폴더읽기().then(function () {
      if (다시 && 묶음[다시] && (묶음[다시].읽음 || 묶음[다시].열림)) 묶음읽기(다시, false);
    });
  }

  /* 폴더 이름 바꾸기 — 머리줄을 더블클릭하면 그 자리에 입력칸을 끼운다 (2026-09-29 원빈 — 파일 탐색기처럼)
     Enter = 저장 · Esc · 바깥 누르기 = 취소 · 빈 이름·같은 이름은 저장하지 않는다.
     ⚠ 입력칸을 머리줄 <button> **안에** 두면 Enter·Space 가 버튼을 눌러 펼침/접힘이 돼 버린다 → 버튼은 숨기고 바로 앞에 둔다.
     ⚠ 머리줄은 CSS 가 display:flex 라 hidden 속성으로는 안 숨는다 → style 로 숨긴다(다시 그리면 원래대로 돌아온다).
     저장은 WE.adminFolders.rename — 메모를 함께 보내 메모가 지워지지 않게 한다. */
  function 이름바꾸기(머리) {
    var 키 = 머리.dataset.grp, f = 폴더찾기(키);
    if (!f || !WE.adminFolders || !WE.adminFolders.rename) return;
    var 칸 = document.createElement("input");
    칸.type = "text"; 칸.className = "adm-mem-grp-rename"; 칸.id = "admFolRename"; 칸.maxLength = 60; 칸.value = f.name;
    머리.style.display = "none";
    머리.parentNode.insertBefore(칸, 머리);
    칸.focus(); 칸.select();
    var 끝 = false;
    function 취소() { if (끝) return; 끝 = true; 회원그리기(); }
    칸.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape") { ev.preventDefault(); 취소(); return; }
      if (ev.key !== "Enter") return;
      ev.preventDefault();
      var 새 = 칸.value.trim();
      if (!새 || 새 === f.name) { 취소(); return; }
      끝 = true; 칸.disabled = true;
      WE.adminFolders.rename(f, 새).then(function (ok) {
        if (ok) foldersChanged({ select: 고른폴더 });   // 머리줄·오른쪽 제목을 새 이름으로 다시 그린다
        else 회원그리기();                               // 실패(같은 이름 폴더 등) — 이유는 아래 알림줄에 뜬다
      });
    });
    칸.addEventListener("blur", 취소);
  }

  /* 새 폴더 — 계정란 맨 아래 입력줄. 만들면 그 폴더를 펼치고 오른쪽에 관리 화면을 연다 */
  function 새폴더() {
    var 칸 = $("admFolNewName"); var 이름 = 칸 ? 칸.value : "";
    if (!WE.adminFolders || !WE.adminFolders.create) return;
    WE.adminFolders.create(이름).then(function (id) {
      if (!id) return;
      if ($("admFolNewName")) $("admFolNewName").value = "";
      묶음[id] = 새묶음(true);
      고른폴더 = id; 고른회원 = null; 주문들 = []; 고른주문 = null; 계산결과 = null;
      폴더읽기().then(function () { 묶음읽기(id, false); 주문그리기(); 상세그리기(); });
    });
  }

  /* 회원 설정 — 고른 회원의 폴더와 기관 제공 종료일.
     ⚠ 주문 상세(#admMemDetail)와 다른 상자다. 주문을 누를 때마다 상세는 새로 그려지는데
        여기까지 같이 그리면 적던 값이 날아간다. 그래서 회원이 바뀔 때만 다시 그린다. */
  function 회원설정그리기() {
    var box = $("admMemSet"); if (!box) return;
    var m = 고른회원 && 회원찾기(고른회원);
    if (!m) { box.hidden = true; box.innerHTML = ""; return; }
    var 옵션 = '<option value="">폴더 없음</option>';
    var 있음 = false;
    폴더목록.forEach(function (f) {
      if (f.id === m.folder_id) 있음 = true;
      옵션 += '<option value="' + esc(f.id) + '"' + (f.id === m.folder_id ? " selected" : "") + ">" + esc(f.name) + "</option>";
    });
    // 폴더 목록을 아직 못 읽었어도 지금 소속은 보여야 한다(모르고 저장하면 폴더에서 빠진다)
    if (m.folder_id && !있음) 옵션 += '<option value="' + esc(m.folder_id) + '" selected>' + esc(m.folder_name || "(현재 폴더)") + "</option>";
    box.innerHTML =
      "<h4>회원 설정</h4>" +
      '<label class="adm-col-f">폴더<select id="admMemSetFolder">' + 옵션 + "</select></label>" +
      '<label class="adm-col-f" style="margin-top:6px">기관 제공 Pro 종료일 (비우면 제공 없음)' +
      '<input type="date" id="admMemSetUntil" value="' + esc(날짜칸(m.grant_until)) + '" /></label>' +
      '<div class="adm-col-meta" style="margin-top:4px">한국 시각으로 그날 끝까지 · 결제한 이용권과는 따로 계산됩니다. ' +
      "폴더를 바꾸면 참여 링크의 자리가 하나 돌아갑니다.</div>" +
      '<div class="adm-col-tools"><button type="button" class="adm-edit-btn" id="admMemSetSave">저장</button></div>';
    box.hidden = false;
  }

  function 회원설정저장() {
    var c = client(); var m = 고른회원 && 회원찾기(고른회원);
    if (!c || !m) return;
    var 폴더 = ($("admMemSetFolder") && $("admMemSetFolder").value) || null;
    var 종료 = ($("admMemSetUntil") && $("admMemSetUntil").value) || null;   // "YYYY-MM-DD" — 변환은 서버가 한다
    // 살아 있는 제공을 끝내는 것만 확인받는다(학생이 수업 중에 무료로 떨어진다)
    if (!종료 && 제공중(m) && !window.confirm(
      "이 회원의 기관 제공 Pro 를 끝냅니다.\n\n" + (m.email || "") + "\n" + 날짜(m.grant_until, true) + "까지였습니다. 계속할까요?")) return;
    var btn = $("admMemSetSave"); if (btn) btn.disabled = true;
    c.rpc("admin_member_set", { p_user: m.user_id, p_folder: 폴더, p_until: 종료 }).then(function (res) {
      if (res.error) {
        msg("회원 설정을 저장하지 못했습니다 — " + (res.error.message || "알 수 없는 오류"), "err");
        if ($("admMemSetSave")) $("admMemSetSave").disabled = false;
        return;
      }
      msg("저장했습니다 — " + (m.email || ""));
      // 서버가 정한 값(그날 끝 시각 등)으로 다시 그린다
      if (평평) { 회원읽기(false, m.user_id); return; }
      /* 묶음: **옮기기 전·후 두 묶음을 다시 읽는다** — 한쪽만 읽으면 그 회원이 두 곳에 보이거나 사라진다.
         옮겨 간 묶음은 펼친다 — 고른 회원이 어디로 갔는지 그 자리에서 보이고, 선택도 이어진다. */
      var 전 = m.folder_id || "none", 후 = 폴더 || "none";
      if (!묶음[후]) 묶음[후] = 새묶음(true); else 묶음[후].열림 = true;
      폴더읽기();                                      // 머리줄의 인원수
      묶음읽기(후, false);
      if (전 !== 후 && 묶음[전] && 묶음[전].읽음) 묶음읽기(전, false);
    }).catch(function (e) {
      msg("회원 설정을 저장하지 못했습니다 — " + ((e && e.message) || "서버에 닿지 못했습니다."), "err");
      if ($("admMemSetSave")) $("admMemSetSave").disabled = false;
    });
  }

  // ── 한 회원의 주문 ────────────────────────────────────────────────────────
  function 주문읽기(uid) {
    var c = client(); if (!c) return;
    주문들 = []; 고른주문 = null; 계산결과 = null; 주문오류 = null;
    주문그리기(true); 상세그리기();
    c.rpc("admin_member_orders", { p_user: uid }).then(function (res) {
      if (uid !== 고른회원) return;                 // 그 사이 다른 회원을 골랐으면 버린다
      if (res.error) { 주문오류 = res.error.message || "알 수 없는 오류"; 주문그리기(); return; }
      주문들 = res.data || [];
      주문그리기(); 상세그리기();
    }).catch(function (e) {
      if (uid !== 고른회원) return;
      주문오류 = (e && e.message) || "서버에 닿지 못했습니다."; 주문그리기();
    });
  }

  function 주문그리기(loading) {
    var box = $("admMemOrders"); if (!box) return;
    if (!고른회원) { box.innerHTML = '<div class="adm-batch-empty">왼쪽에서 회원을 고르세요.</div>'; return; }
    if (loading) { box.innerHTML = '<div class="adm-batch-empty">읽는 중…</div>'; return; }
    if (주문오류) { box.innerHTML = '<div class="adm-batch-empty">주문을 읽지 못했습니다.<br />' + esc(주문오류) + "</div>"; return; }
    if (!주문들.length) { box.innerHTML = '<div class="adm-batch-empty">결제 기록이 없습니다.</div>'; return; }

    box.innerHTML = "";
    주문들.forEach(function (o) {
      var el = document.createElement("button");
      el.type = "button";
      el.className = "adm-mem-order" + (o.id === 고른주문 ? " on" : "");
      el.dataset.oid = o.id;
      var 금액 = o.refund_amount > 0
        ? esc(원(o.amount)) + ' <span class="adm-col-meta" style="display:inline">− 환불 ' + esc(원(o.refund_amount)) + "</span>"
        : esc(원(o.amount));
      el.innerHTML =
        '<span class="adm-mem-order-top"><b>' + esc(o.plan === "year" ? "1년 이용권" : "1개월 이용권") + "</b>" +
        '<span class="adm-mem-amt">' + 금액 + "</span></span>" +
        '<span class="adm-col-meta">' + esc(o.id) + " · " +
        esc(o.paid_at ? 날짜(o.paid_at) + " 결제" : 날짜(o.created_at) + " 생성") + " " +
        '<span class="adm-mem-st ' + 상태클래스(o.status) + '">' + esc(상태이름[o.status] || o.status) + "</span></span>";
      box.appendChild(el);
    });
  }

  // ── 주문 상세 + 환불 ──────────────────────────────────────────────────────
  function 주문찾기(id) {
    for (var i = 0; i < 주문들.length; i++) if (주문들[i].id === id) return 주문들[i];
    return null;
  }

  function 상세그리기() {
    var box = $("admMemDetail"); if (!box) return;
    var o = 고른주문 && 주문찾기(고른주문);
    if (!o) { box.innerHTML = '<div class="adm-batch-empty">주문을 고르면 상세와 환불이 여기에 나옵니다.</div>'; return; }

    function kv(k, v) { return '<div class="adm-mem-kv"><span class="k">' + esc(k) + '</span><span class="v">' + v + "</span></div>"; }

    var html = "<h4 style=\"margin:0 0 10px;font-size:var(--fs-sm)\">주문 상세</h4>";
    html += kv("주문번호", "<code>" + esc(o.id) + "</code>");
    html += kv("상품", esc(o.plan === "year" ? "1년 이용권" : "1개월 이용권"));
    html += kv("결제액", esc(원(o.amount)));
    if (o.refund_amount > 0) html += kv("환불액", esc(원(o.refund_amount)));
    html += kv("상태", '<span class="adm-mem-st ' + 상태클래스(o.status) + '">' + esc(상태이름[o.status] || o.status) + "</span>");
    html += kv("결제일", esc(날짜(o.paid_at)));
    html += kv("이용 기간", esc(날짜(o.entitlement_started_at, true) + " ~ " + 날짜(o.entitlement_ended_at, true)));
    // 유료 기능 사용 여부 — 예전 약관에서는 환불 판단 근거였다. 지금은 7일 이내면 무관하지만
    // 상황을 알 수 있게 그대로 보여 준다(2026-09-22 약관 개정).
    html += kv("유료 기능", o.used_at ? esc(날짜(o.used_at) + " 사용") : "안 씀");
    // ★ 연락처는 여기에만 — 환불·분쟁 연락 목적(개인정보처리방침 2장)
    html += kv("구매자", esc(o.buyer_name || "—") + " · " + esc(o.buyer_phone || "—"));
    html += kv("이메일", esc(o.buyer_email || "—"));
    if (o.method) html += kv("결제수단", esc(o.method));
    if (o.payment_key) html += kv("PG 거래번호", "<code>" + esc(o.payment_key) + "</code>");
    if (o.receipt_url) html += kv("영수증", '<a href="' + esc(o.receipt_url) + '" target="_blank" rel="noopener">열기</a>');
    if (o.cancel_reason) html += kv("취소 사유", esc(o.cancel_reason));

    // ── 환불 ──
    var 환불가능 = o.status === "paid" || o.status === "partially_refunded";
    html += '<div class="adm-mem-refund"><h4>환불</h4>';
    if (!환불가능) {
      html += '<div class="adm-col-meta">이 상태의 주문은 환불할 수 없습니다 (결제완료·부분환불만 가능).</div>';
    } else {
      html += '<div class="adm-col-meta">먼저 [환불 계산]으로 약관상 금액을 확인한 뒤 실행합니다. 계산은 아무것도 바꾸지 않습니다.</div>' +
        '<div class="adm-col-tools" style="margin-top:8px">' +
        '<button type="button" class="adm-edit-btn" id="admMemCalc">환불 계산</button>' +
        '<button type="button" class="adm-edit-btn danger" id="admMemDo" disabled>환불 실행</button>' +
        "</div>" +
        '<label class="adm-col-f" style="margin-top:6px">금액을 직접 정할 때 (비우면 계산값)' +
        '<input type="number" class="adm-mem-amt-in" id="admMemAmt" min="1" step="1" placeholder="원" /></label>';
    }
    html += '<div id="admMemRes"></div></div>';
    box.innerHTML = html;

    // 계산 결과가 남아 있으면 다시 그린다(다른 주문을 골랐다 돌아온 경우는 계산결과가 비어 있다)
    if (계산결과 && 계산결과.orderId === 고른주문) 결과그리기(계산결과.kind, 계산결과.text, 계산결과.실행가능);
  }

  function 결과그리기(kind, text, 실행가능) {
    var el = $("admMemRes"); if (!el) return;
    el.innerHTML = '<div class="adm-mem-res ' + kind + '">' + esc(text) + "</div>";
    var go = $("admMemDo"); if (go) go.disabled = !실행가능;
  }

  /* payment-cancel 의 응답을 사람이 읽을 수 있게 옮긴다.
     ⚠ 상태코드마다 **다른 색·다른 문구**를 쓴다. 특히 409 와 500 을 뭉뚱그리면
        「돈은 나갔는데 장부가 안 맞는」 상황을 그냥 지나친다. */
  function 환불응답표시(res, 실행인가) {
    // supabase-js 는 4xx·5xx 면 data 를 비우고 error 만 준다. 본문은 error.context 에 들어 있다.
    var 상태 = (res && res.error && res.error.context && res.error.context.status) || (res && res.error ? 0 : 200);
    var 본문 = (res && res.data) || null;

    function 본문읽기() {
      // 오류 본문은 비동기로만 읽을 수 있다(Response). 못 읽으면 메시지로 대신한다.
      var ctx = res && res.error && res.error.context;
      if (ctx && typeof ctx.json === "function") return ctx.json().catch(function () { return null; });
      return Promise.resolve(null);
    }

    if (!res || (!res.error && !본문)) { 결과그리기("err", "응답을 읽지 못했습니다.", false); return Promise.resolve(); }

    if (!res.error) {
      if (!실행인가) {
        // 미리보기 — 환불 예정액과 근거
        var 예정 = 본문["환불예정액"];
        var 근거 = 본문["계산근거"] || (본문["상세"] && 본문["상세"].reason) || "";
        var 이력 = 본문["상세"] && 본문["상세"].prior_full_refunds;
        var t = "환불 예정액: " + 원(예정) + "\n" + (근거 || "");
        if (이력 > 0) t += "\n\n⚠ 이 회원은 전에 전액환불을 " + 이력 + "회 받았습니다.\n약관 제8조 1항의 청약철회는 「회원당 1회」입니다 — 실행 전 확인하세요.";
        if (!예정) t += "\n\n약관상 환불 대상이 아닙니다. 그래도 돌려주려면 아래 칸에 금액을 직접 넣고 실행하세요.";
        계산결과 = { orderId: 고른주문, kind: 예정 ? "info" : "warn", text: t, 실행가능: true };
        결과그리기(계산결과.kind, 계산결과.text, true);
        return Promise.resolve();
      }
      // 실행 성공
      var 금 = 본문["환불액"];
      결과그리기("ok", "환불이 처리되었습니다.\n환불액 " + 원(금) + (본문["영수증"] ? "\n영수증: " + 본문["영수증"] : ""), false);
      계산결과 = null;
      msg("환불 완료 — " + 고른주문 + " · " + 원(금));
      var uid = 고른회원;
      주문읽기(uid);                                  // 원장이 바뀌었으니 다시 읽는다
      return Promise.resolve();
    }

    // ── 오류 ──
    return 본문읽기().then(function (b) {
      var 사유 = (b && (b.error || b.message)) || (res.error && res.error.message) || "알 수 없는 오류";
      if (상태 === 409) {
        // 취소가 PG 에서 아직 확정되지 않았다. 원장은 안 건드렸다(payment-cancel 이 보장).
        결과그리기("warn",
          "환불이 아직 확정되지 않았습니다.\n" + 사유 +
          "\n\n원장은 그대로이고 이용권도 회수하지 않았습니다.\n포트원 콘솔에서 취소 결과를 확인한 뒤 다시 실행하세요.", true);
      } else if (상태 === 500) {
        // ★ 가장 위험한 경우 — 돈은 나갔는데 우리 장부가 안 맞는다
        결과그리기("err",
          "⚠ 돈은 나갔는데 기록 갱신에 실패했습니다.\n" + 사유 +
          "\n\n주문번호: " + 고른주문 +
          "\n포트원 콘솔에서 취소를 확인하고 원장을 손으로 맞춰야 합니다.", false);
        msg("★ 환불 후 원장 갱신 실패 — " + 고른주문, "err");
      } else if (상태 === 404) {
        // 관리자 정의가 두 벌이라 생기는 일 — 화면은 열리는데 환불만 막힌다
        결과그리기("err",
          "환불 권한이 없습니다.\n\n이 화면은 admin_users 표로 판정하지만, 환불 실행은 Edge Function 의\n" +
          "ADMIN_USER_IDS 환경변수로 따로 판정합니다. 그 값에 이 계정의 user id 가 들어 있어야 합니다.", false);
      } else if (상태 === 401) {
        결과그리기("err", "로그인이 만료되었습니다. 새로고침한 뒤 다시 시도하세요.", false);
      } else {
        결과그리기("err", 사유, true);
      }
    });
  }

  function 환불부르기(실행인가) {
    var c = client(); if (!c || !고른주문) return;
    var calc = $("admMemCalc"), go = $("admMemDo");
    if (calc) calc.disabled = true;
    if (go) go.disabled = true;
    결과그리기("info", 실행인가 ? "환불을 요청하는 중…" : "계산하는 중…", false);

    var body = { orderId: 고른주문 };
    if (실행인가) {
      body.confirm = true;
      var 직접 = $("admMemAmt") && $("admMemAmt").value;
      if (직접 && Number(직접) > 0) body.amount = Number(직접);
      body.reason = "관리자 환불 (관리자 화면)";
    }
    c.functions.invoke("payment-cancel", { body: body })
      .then(function (res) { return 환불응답표시(res, 실행인가); })
      .catch(function (e) { 결과그리기("err", (e && e.message) || "서버에 닿지 못했습니다.", false); })
      .then(function () { if ($("admMemCalc")) $("admMemCalc").disabled = false; });
  }

  // ── 이벤트 ────────────────────────────────────────────────────────────────
  function bind() {
    var users = $("admMemUsers");
    if (users) users.addEventListener("click", function (e) {
      if (e.target.id === "admMemMore") { 회원읽기(true); return; }           // 검색 결과 더 보기
      var 더 = e.target.closest("[data-more]");                               // 묶음 안 더 보기
      if (더) { 묶음읽기(더.dataset.more, true); return; }
      var 머리 = e.target.closest(".adm-mem-grp");                            // 폴더 머리줄
      // ⚠ 더블클릭은 클릭 두 번을 먼저 일으킨다. 두 번째 클릭(detail 2)까지 받으면 펼쳤다가 곧바로 접혀 깜빡인다 —
      //    두 번째부터는 무시하고, 이름 바꾸기는 아래 dblclick 이 맡는다
      if (머리) { if (e.detail > 1) return; 머리줄누름(머리.dataset.grp); return; }
      var el = e.target.closest(".adm-mem-user"); if (!el) return;
      // 회원을 고르면 오른쪽 칸은 「회원」 — 떠 있던 폴더 관리는 닫는다
      고른회원 = el.dataset.uid; 고른폴더 = null; 고른주문 = null; 계산결과 = null;
      회원그리기(); 오른쪽그리기(); 주문읽기(고른회원);
    });
    // 폴더 이름 더블클릭 → 그 자리에서 바꾸기 (2026-09-29 원빈 — 파일 탐색기처럼)
    if (users) users.addEventListener("dblclick", function (e) {
      var 머리 = e.target.closest(".adm-mem-grp");
      if (!머리 || 머리.dataset.grp === "none") return;          // 「일반 회원」 은 폴더가 아니다
      이름바꾸기(머리);
    });
    // 새 폴더 입력줄 — 계정란을 다시 그릴 때마다 새로 생기므로 상위에서 받는다
    if (users) users.addEventListener("submit", function (e) {
      if (!e.target || e.target.id !== "admFolNew") return;
      e.preventDefault(); 새폴더();
    });

    // 회원 설정 저장 (2026-09-28)
    var 설정 = $("admMemSet");
    if (설정) 설정.addEventListener("click", function (e) {
      if (e.target.id === "admMemSetSave") 회원설정저장();
    });

    var orders = $("admMemOrders");
    if (orders) orders.addEventListener("click", function (e) {
      var el = e.target.closest(".adm-mem-order"); if (!el) return;
      고른주문 = el.dataset.oid;
      계산결과 = null;                                 // 주문이 바뀌면 이전 계산은 버린다
      주문그리기(); 상세그리기();
    });

    // 환불 단추는 상세를 다시 그릴 때마다 새로 생기므로 상위에 위임한다
    var detail = $("admMemDetail");
    if (detail) detail.addEventListener("click", function (e) {
      if (e.target.id === "admMemCalc") { 환불부르기(false); return; }
      if (e.target.id === "admMemDo") {
        var o = 주문찾기(고른주문); if (!o) return;
        var 직접 = $("admMemAmt") && $("admMemAmt").value;
        var 금액표시 = 직접 && Number(직접) > 0 ? 원(Number(직접)) : "계산된 금액";
        /* ⚠ 되돌릴 수 없다. 무엇을·얼마를·누구에게 인지 한 번에 보여 준다
           (admin-collect.js 의 기기 삭제 확인과 같은 원칙) */
        if (!window.confirm(
          "환불을 실행합니다.\n\n주문: " + o.id + "\n금액: " + 금액표시 + "\n구매자: " + (o.buyer_email || "?") +
          "\n\n실제로 카드사에 취소가 나가며 되돌릴 수 없습니다. 계속할까요?")) return;
        환불부르기(true);
      }
    });

    // 검색 — 검색어가 있으면 묶음을 풀고 결과만 나열, 비우고 Enter 하면 묶음으로 돌아온다
    var search = $("admMemSearch");
    if (search) search.addEventListener("keydown", function (e) {
      if (e.key !== "Enter") return;
      e.preventDefault();
      if ((search.value || "").trim()) { 평평 = true; 회원읽기(false); }
      else { 평평 = false; 회원그리기(); 오른쪽그리기(); }
    });
    // 새로 읽기 — 지금 모양 그대로 다시 읽는다(묶음이면 폴더 목록과 **펼쳐 둔** 묶음만)
    var refresh = $("admMemRefresh");
    if (refresh) refresh.addEventListener("click", function () {
      if (평평) { 회원읽기(false); return; }
      폴더읽기();
      Object.keys(묶음).forEach(function (k) { if (묶음[k].열림) 묶음읽기(k, false); });
    });
  }

  /* 탭에 들어올 때 읽는다 (admin-batch.js 의 setMode 가 부른다).
     ⚠ 처음 한 번만 자동으로 읽는다 — 탭을 오갈 때마다 전체 회원을 다시 읽으면
        관리자가 「더 보기」로 불러 놓은 목록과 고른 회원이 매번 초기화된다.
     처음 모양은 폴더 묶음 — 「일반 회원」 만 펼쳐 읽고, 폴더들은 접어 둔다(누를 때 읽는다). */
  function enter() {
    if (들어온적) return;
    들어온적 = true;
    bind();
    평평 = false;
    묶음.none = 새묶음(true);
    폴더읽기();
    묶음읽기("none", false);
    주문그리기(); 상세그리기();
  }

  WE.adminMembers = {
    enter: enter,
    foldersChanged: foldersChanged,     // 폴더 관리(admin-folders.js)가 바꾼 뒤 부른다
    _테스트_폴더심기: function (목록) { 폴더목록 = 목록 || []; 폴더오류 = null; 회원그리기(); 오른쪽그리기(); },
    /* 묶음 하나를 읽은 것처럼 채운다 (키 = "none" 또는 폴더 id) */
    _테스트_묶음심기: function (키, 목록, 총수) {
      var g = 묶음[키] || (묶음[키] = 새묶음(true));
      g.열림 = true; g.회원 = 목록 || []; g.전체 = 총수 == null ? g.회원.length : 총수;
      g.읽음 = true; g.읽는중 = false; g.오류 = null; 평평 = false; 회원그리기(); 오른쪽그리기();
    },
    /* 검사용 이음매 — 로그인·DB 를 흉내 낸 뒤 화면을 그리게 한다.
       이게 없으면 검사가 권한 확인에서 막혀 클릭 동작을 잴 수 없다
       (admin.js·admin-collect.js 의 _테스트_* 와 같은 목적). */
    /* _테스트_심기 · _테스트_오류 는 **검색 결과(평평한 목록)** 를 그린다 — 9/28 까지 목록의 모양이 그것이었고,
       그 모양을 재는 verify_adminmembers 를 손대지 않고 그대로 돌리기 위해서다(검색 경로는 지금도 실제로 쓰인다). */
    _테스트_심기: function (목록, 총수) { 평평 = true; 회원들 = 목록 || []; 전체수 = 총수 == null ? (목록 || []).length : 총수; 읽는중 = false; 읽기오류 = null; 회원그리기(); },
    _테스트_오류: function (m) { 평평 = true; 읽기오류 = m; 읽는중 = false; 회원그리기(); },
    _테스트_회원고르기: function (uid) { 고른회원 = uid; 고른폴더 = null; 회원그리기(); 오른쪽그리기(); },
    _테스트_주문심기: function (목록) { 주문들 = 목록 || []; 주문오류 = null; 주문그리기(); },
    _테스트_주문고르기: function (oid) { 고른주문 = oid; 주문그리기(); 상세그리기(); },
    _테스트_응답: function (res, 실행인가) { return 환불응답표시(res, 실행인가); },
    _테스트_bind: bind
  };
})();
