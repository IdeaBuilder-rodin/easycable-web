// payrecover.js — 결제는 됐는데 이용권이 안 붙은 주문을 **다음에 들어올 때 알아서 되살린다.**
//
// 왜 필요한가 (2026-08-31)
//   결제는 이렇게 끝난다: 결제창에서 승인 → 브라우저가 우리 주소로 돌아옴 →
//   payment-confirm 이 확인 → 이용권이 붙는다.
//
//   ★ 가운데 '브라우저가 돌아옴' 이 끊기면 전부 멈춘다.
//     · 카카오페이·토스페이는 **앱으로 전환**됐다가 돌아온다. 이때 실패가 잦다
//     · 지하철에서 네트워크가 끊긴다
//     · 결제 끝나고 창을 닫아 버린다
//
//   그러면 **돈은 나갔는데 이용권이 없다.** 우리 원장에는 pending 으로 남고,
//   PG 에는 PAID 로 남는다. 손님은 "결제했는데 안 되네" 를 본다.
//
// ★★ 더 나쁜 것 — 이중 결제
//   order-create 의 중복 차단은 profiles.plan === 'pro' 를 본다.
//   pending 이면 profiles 는 아직 free 라 **차단이 안 된다.**
//   손님이 "실패했나 보다" 하고 다시 결제하면 **두 번 결제된다.**
//   유니크 색인 (provider, payment_key) 도 못 막는다 — 두 번째는 거래번호가 다르다.
//
// 그래서 이 파일이 하는 일은 하나다:
//   **로그인한 사람이 화면을 열 때, 최근 pending 주문을 조용히 다시 확인한다.**
//   진짜 결제된 것이면 payment-confirm 이 이용권을 붙여 주고, 아니면 아무 일도 없다.
//
// ⚠ 이건 '복구'지 '예방'이 아니다. 손님이 아예 안 돌아오면 못 잡는다.
//    그 경우는 웹훅이 맡는다(별도). 웹훅이 생겨도 이 파일은 **그 백업으로 남는다** —
//    웹훅 설정이 틀어져도(Supabase 는 기본이 verify_jwt=true 라 조용히 401 이 난다)
//    여기가 받쳐 준다.
var WE = window.WE || {};
window.WE = WE;

WE.payRecover = (function () {
  "use strict";
  // 번역 — 이 파일은 checkout.html 처럼 i18n.js 가 없는 페이지에서도 실리므로 있을 때만 쓴다
  function tr(s) { return (window.WE && WE.i18n && WE.i18n.t) ? WE.i18n.t(s) : s; }

  // 얼마나 지난 주문까지 되살릴까.
  // ⚠ 너무 길면 '그냥 창 닫은' 옛 주문까지 매번 PG 에 물어보게 된다.
  //   결제가 끊긴 사람은 대개 그날 안에 다시 들어온다. 하루면 넉넉하다.
  var 되살릴시간 = 24 * 60 * 60 * 1000;

  /* ⚠⚠ 만든 지 이만큼 안 된 주문은 **건드리지 않는다** (2026-09-22 추가).
     왜 — 주문은 결제 화면에 들어가는 순간 생기는데, 그 번호는 **결제창을 열기 전까지
     포트원에 없다.** 그 상태로 payment-confirm 을 부르면 포트원이 404 를 주고,
     예전에는 그걸 '결제 기록 없음' 으로 보고 주문을 **failed 로 바꿔 버렸다.**
     그 뒤 손님이 진짜로 결제를 끝내도 「이미 종료된 주문」이 되어
     **돈은 나갔는데 이용권이 없는** 상태가 된다.

     실제로 이 경로는 쉽게 열린다 — 결제 화면을 띄워 둔 채 에디터나 내 계정 탭을
     하나 더 열면 그 탭에서 이 파일이 돌기 때문이다(app.html·account.html·admin.html·checkout.html).

     서버(payment-confirm)에도 같은 유예를 뒀다. 둘 다 두는 이유는, 여기만 막으면
     다른 경로로 들어온 호출을 못 막고, 서버만 막으면 쓸데없는 호출이 계속 나가서다. */
  var 갓만든것_유예 = 15 * 60 * 1000;

  var 돌았다 = false;   // 한 화면에서 한 번만

  function 알림(글) {
    // 화면마다 알리는 방식이 달라서 있는 것만 쓴다. 없으면 조용히 넘어간다.
    try {
      if (WE.app && WE.app.notice) { WE.app.notice(tr("이용권이 적용되었습니다"), 글); return; }
      if (WE.app && WE.app.setHint) { WE.app.setHint(글); return; }
    } catch (e) { /* 무시 */ }
  }

  function 되살리기(client, 주문들, i, 살아난것) {
    if (i >= 주문들.length) {
      if (살아난것 > 0) {
        // ⚠ 조용히 넘어가지 않는다. 손님은 결제가 실패한 줄 알고 있다가
        //   이용권이 생긴 것이므로, 그 사실을 알려야 한다.
        알림(tr("결제가 확인되어 이용권이 적용되었습니다."));
        // 권한이 바뀌었으니 화면이 다시 읽게 한다
        try { if (WE.auth.refreshProfile) WE.auth.refreshProfile(); } catch (e) {}
      }
      return;
    }
    var 주문 = 주문들[i];
    client.functions.invoke("payment-confirm", { body: { paymentId: 주문.id } })
      .then(function (res) {
        // 성공(res.data.ok)이면 되살아난 것이다.
        // 실패는 정상이다 — 대부분은 '진짜로 결제 안 된 주문' 이라 400 이 온다.
        var 됨 = !!(res && res.data && res.data.ok);
        되살리기(client, 주문들, i + 1, 살아난것 + (됨 ? 1 : 0));
      })
      .catch(function () { 되살리기(client, 주문들, i + 1, 살아난것); });
  }

  function run() {
    if (돌았다) return;
    // 유료화가 꺼져 있으면 로그인 자체가 없다(auth.js). 할 일이 없다.
    if (!WE.flags || !WE.flags.LAUNCH) return;
    if (!WE.auth || !WE.auth.user || !WE.auth.user()) return;
    var client = WE.auth._client && WE.auth._client();
    if (!client) return;
    돌았다 = true;

    var 기준 = new Date(Date.now() - 되살릴시간).toISOString();
    var 최소경과 = new Date(Date.now() - 갓만든것_유예).toISOString();   // 이보다 **오래된** 것만 본다

    // ⚠ 본인 주문만 읽는다. RLS 가 막아 주지만 조건도 같이 건다 —
    //   나중에 정책이 느슨해져도 여기서 한 번 더 걸린다.
    client.from("orders").select("id")
      .eq("user_id", WE.auth.user().id)
      .eq("status", "pending")
      .gte("created_at", 기준)
      .lte("created_at", 최소경과)   // ★ 갓 만든 주문은 제외 (위 갓만든것_유예 주석)
      .then(function (res) {
        var 목록 = (res && res.data) || [];
        if (!목록.length) return;
        // ⚠ 결제 화면이 스스로 확인 중이면(주소에 paymentId 가 있다) 비켜 준다.
        //   같이 부르면 결과가 두 번 뜨고, 손님은 무슨 일인지 모른다.
        //   (중복 호출 자체는 안전하다 — confirm_order_paid 가 for update 로 막는다)
        try {
          if (new URLSearchParams(location.search).get("paymentId")) return;
        } catch (e) { /* 무시 */ }
        되살리기(client, 목록, 0, 0);
      })
      .catch(function () { /* 조용히 넘어간다 — 이건 배경 복구지 사용자 동작이 아니다 */ });
  }

  // 로그인 상태가 확정된 뒤에 돈다. auth 는 세션 복원이 비동기다.
  function 시작() {
    if (!WE.auth) return;
    if (WE.auth.ready && WE.auth.ready()) { run(); return; }
    if (WE.auth.onChange) {
      WE.auth.onChange(function () {
        if (WE.auth.ready && WE.auth.ready()) run();
      });
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", 시작);
  else 시작();

  return { run: run, _되살릴시간: 되살릴시간 };
})();
