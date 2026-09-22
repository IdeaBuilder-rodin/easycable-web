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
  var 회원들 = [];
  var 전체수 = 0;
  var 고른회원 = null;      // user_id
  var 주문들 = [];
  var 고른주문 = null;      // order id
  var 계산결과 = null;      // payment-cancel 미리보기 응답
  var 읽는중 = false;
  var 읽기오류 = null;
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

  var 상태이름 = {
    pending: "미완료", paid: "결제완료", failed: "실패", canceled: "취소",
    partially_refunded: "부분환불", refunded: "환불완료"
  };
  function 상태클래스(s) {
    return s === "paid" ? "paid" : s === "pending" ? "pending"
         : (s === "refunded" || s === "partially_refunded") ? "refunded"
         : (s === "failed" || s === "canceled") ? "failed" : "";
  }

  // ── 회원 목록 읽기 ────────────────────────────────────────────────────────
  function 회원읽기(이어서) {
    var c = client();
    if (!c) { 읽기오류 = "로그인 정보를 읽지 못했습니다."; 회원그리기(); return Promise.resolve(); }
    읽는중 = true; 읽기오류 = null;
    if (!이어서) { 회원들 = []; 고른회원 = null; 주문들 = []; 고른주문 = null; 계산결과 = null; }
    회원그리기();

    var 검색 = ($("admMemSearch") && $("admMemSearch").value || "").trim();
    return c.rpc("admin_members", { p_q: 검색 || null, p_limit: PAGE, p_offset: 회원들.length })
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
        회원그리기(); msg("");
      })
      .catch(function (e) {
        읽는중 = false; 읽기오류 = (e && e.message) || "서버에 닿지 못했습니다.";
        회원그리기();
      });
  }

  function 회원그리기() {
    var box = $("admMemUsers"); if (!box) return;
    var stats = $("admMemStats");
    if (stats) {
      stats.textContent = 읽는중 ? "읽는 중…"
        : 읽기오류 ? ""
        : (전체수 > 회원들.length ? 회원들.length + " / " + 전체수 + "명" : 회원들.length + "명");
    }

    if (읽는중 && !회원들.length) { box.innerHTML = '<div class="adm-batch-empty">읽는 중…</div>'; return; }
    if (읽기오류) {
      box.innerHTML = '<div class="adm-batch-empty">회원 목록을 읽지 못했습니다.<br />' + esc(읽기오류) +
        '<br /><br />관리자 권한과 <code>_ai/sql/2026-09-22_관리자_회원결제.sql</code> 실행 여부를 확인하세요.</div>';
      return;
    }
    if (!회원들.length) { box.innerHTML = '<div class="adm-batch-empty">조건에 맞는 회원이 없습니다.</div>'; return; }

    box.innerHTML = "";
    회원들.forEach(function (m) {
      var el = document.createElement("div");
      el.className = "adm-mem-user" + (m.user_id === 고른회원 ? " on" : "");
      el.setAttribute("role", "button");
      el.tabIndex = 0;
      el.dataset.uid = m.user_id;
      var 태그 = [];
      태그.push(프로인가(m)
        ? '<span class="adm-mem-tag pro">Pro · ' + esc(날짜(m.expires_at, true)) + '까지</span>'
        : '<span class="adm-mem-tag">무료</span>');
      if (m.order_count > 0) 태그.push('<span class="adm-mem-tag">결제 ' + m.order_count + '건 · ' + esc(원(m.paid_total)) + '</span>');
      if (m.refund_count > 0) 태그.push('<span class="adm-mem-tag">환불 ' + m.refund_count + '건</span>');
      // 미완료 주문 — 「돈은 받고 이용권은 못 준」 후보라 눈에 띄게 (js/admin.js 의 놓친 결제 경고와 같은 취지)
      if (m.pending_count > 0) 태그.push('<span class="adm-mem-tag warn">미완료 ' + m.pending_count + '건</span>');
      el.innerHTML = "<b>" + esc(m.email || "(이메일 없음)") + "</b>" +
        '<span class="adm-col-meta">가입 ' + esc(날짜(m.joined_at, true)) + "</span>" +
        '<span class="adm-mem-tags">' + 태그.join("") + "</span>";
      box.appendChild(el);
    });

    if (회원들.length < 전체수) {
      var more = document.createElement("button");
      more.type = "button"; more.className = "adm-more"; more.id = "admMemMore";
      more.textContent = "더 보기 (" + (전체수 - 회원들.length) + "명 남음)";
      box.appendChild(more);
    }
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
      if (e.target.id === "admMemMore") { 회원읽기(true); return; }
      var el = e.target.closest(".adm-mem-user"); if (!el) return;
      고른회원 = el.dataset.uid; 고른주문 = null; 계산결과 = null;
      회원그리기(); 주문읽기(고른회원);
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

    var search = $("admMemSearch");
    if (search) search.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); 회원읽기(false); }
    });
    var refresh = $("admMemRefresh");
    if (refresh) refresh.addEventListener("click", function () { 회원읽기(false); });
  }

  /* 탭에 들어올 때 읽는다 (admin-batch.js 의 setMode 가 부른다).
     ⚠ 처음 한 번만 자동으로 읽는다 — 탭을 오갈 때마다 전체 회원을 다시 읽으면
        관리자가 「더 보기」로 불러 놓은 목록과 고른 회원이 매번 초기화된다. */
  function enter() {
    if (들어온적) return;
    들어온적 = true;
    bind();
    회원읽기(false);
    주문그리기(); 상세그리기();
  }

  WE.adminMembers = {
    enter: enter,
    /* 검사용 이음매 — 로그인·DB 를 흉내 낸 뒤 화면을 그리게 한다.
       이게 없으면 검사가 권한 확인에서 막혀 클릭 동작을 잴 수 없다
       (admin.js·admin-collect.js 의 _테스트_* 와 같은 목적). */
    _테스트_심기: function (목록, 총수) { 회원들 = 목록 || []; 전체수 = 총수 == null ? (목록 || []).length : 총수; 읽는중 = false; 읽기오류 = null; 회원그리기(); },
    _테스트_오류: function (m) { 읽기오류 = m; 읽는중 = false; 회원그리기(); },
    _테스트_회원고르기: function (uid) { 고른회원 = uid; 회원그리기(); },
    _테스트_주문심기: function (목록) { 주문들 = 목록 || []; 주문오류 = null; 주문그리기(); },
    _테스트_주문고르기: function (oid) { 고른주문 = oid; 주문그리기(); 상세그리기(); },
    _테스트_응답: function (res, 실행인가) { return 환불응답표시(res, 실행인가); },
    _테스트_bind: bind
  };
})();
