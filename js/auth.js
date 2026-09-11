/* ─────────────────────────────────────────────────────────────────────
   auth.js — 로그인과 구독 상태

   설계 원칙:
     · 서버는 "누가 Pro 인가" 만 안다. 도면은 계속 브라우저에 있다.
       → 무료 사용자는 가입 없이 그대로 쓴다. 로그인은 결제를 위한 것뿐.
     · 앱은 어떤 결제사로 냈는지 모른다. plan 만 본다.
       → 나중에 해외 결제를 붙여도 이 파일 말고는 바뀌지 않는다.

   ⚠ WE.flags.LAUNCH 가 false 면 이 파일은 아무것도 하지 않는다.
      출시(2026-09-01) 전까지 기술 배포에 딸려 나가도 동작하지 않게 하기 위함이다.
      네트워크 요청도, 클라이언트 생성도 하지 않는다.

   ⚠ file:// 로 열었을 때도 죽지 않아야 한다. 개발은 file:// 로 하고 있다.
   ───────────────────────────────────────────────────────────────────── */
var WE = window.WE || {};
window.WE = WE;

WE.auth = (function () {
  // 공개 설정 — 브라우저에 그대로 노출되며, 노출돼도 안전하다.
  // 안전한 이유는 DB 의 행 수준 보안(RLS):
  //   읽기는 본인 행만 / 쓰기는 아무도 못 함(결제 웹훅의 secret 키만 가능)
  var URL = "https://ukttsmkenaappsazervx.supabase.co";
  var KEY = "sb_publishable_iOM0RKk_q8ZB9AwX414sDQ_-YLieQxy";
  /* 동의받은 약관의 '시행일'을 버전으로 쓴다.
     약관을 고치면 여기도 바꾼다 — 그래야 "누가 옛 약관에만 동의했는가"를
     나중에 골라내 재동의를 받을 수 있다.
     ⚠ terms.html · privacy.html 의 시행일과 반드시 같아야 한다. */
  var TERMS_VER   = "2026-09-01";   // terms.html 시행일 (아직 미정 → 출시일로 잡아 둠)
  var PRIVACY_VER = "2026-09-01";   // privacy.html 시행일

  var client = null;      // supabase 클라이언트 (LAUNCH 가 켜져야 만든다)
  var _user = null;       // 로그인한 사용자 (없으면 null)
  var _profile = null;    // { plan, expires_at, source } (없으면 null)
  /* 프로필 조회 상태. 예전에는 _profile = null 하나로
       "아직 안 봤다" · "보다가 실패했다" · "무료 회원이다"
     세 가지를 다 표현했다. 그래서 인터넷이 끊기면 돈 낸 사람이 무료가 됐다.
     이제 셋을 나눠, 확인 못 한 상태에서는 단정하지 않는다. */
  var _조회상태 = "없음";   // 없음 · 확인중 · 확인됨 · 실패

  /* 마지막으로 확인된 Pro 를 기억해 둔다.
     조회가 안 될 때 이 기억을 유예 기간 동안 인정한다 —
     잠깐 끊겼다고 편집이 막히면 안 된다.
     유예를 무한정 두면 해지한 사람이 계속 쓰므로 기한을 둔다.
     (업계는 7~30일을 쓴다. 유니티가 30일)
     ⚠ 이 값은 브라우저에 있어 고칠 수 있다. 서버가 진짜 방어선이고,
        이건 정직한 사용자가 끊겼을 때 불편하지 않게 하는 장치다. */
  var 기억키 = "we_last_pro";
  var 유예일 = 7;

  /* 기억을 지운다 — 로그아웃·탈퇴에서 반드시 부른다.
     안 지우면 로그아웃한 뒤에도 유예 기간(7일) 동안 Pro 로 보이고,
     같은 브라우저를 쓰는 다른 사람에게까지 그 상태가 넘어간다.
     개인정보처리방침에도 "로그아웃하면 함께 삭제됩니다" 라고 적어 두었다. */
  function 기억지우기() {
    try { localStorage.removeItem(기억키); } catch (e) { /* 무시 */ }
  }

  // 종류 = "month" | "year" | null.
  // ⚠ profiles 에는 'free'·'pro' 밖에 없어서 **어느 이용권인지 모른다.**
  //    그래서 예전에는 요금제 화면이 Pro 를 무조건 월권으로 표시했다 —
  //    1년권을 산 사람에게 "1개월권 현재 이용 중 / 1년 이용권으로 변경" 이라고
  //    거짓말을 했다(2026-08-31 발견). 그래서 종류를 같이 기억한다.
  function 기억하기(prof, 종류) {
    try {
      if (prof && prof.plan === "pro") {
        localStorage.setItem(기억키, JSON.stringify({
          id: _user && _user.id, t: Date.now(),
          expires_at: prof.expires_at || null,
          kind: 종류 || null
        }));
      } else {
        기억지우기();   // 무료로 확인됐으면 기억도 지운다
      }
    } catch (e) { /* 무시 */ }
  }

  /* 지금 효력이 있는 이용권이 월권인지 1년권인지 알아본다.
     ⚠ 판정 규칙을 order-create 와 **똑같이** 둔다 —
        '아직 효력이 남은 paid/partially_refunded 주문에 year 가 있으면 1년권'.
        한쪽만 고치면 화면과 서버가 어긋나, 화면은 살 수 있다고 하는데
        결제 화면에서 막히는 헛걸음이 생긴다.
     못 읽어도 그냥 넘어간다 — 이건 화면 표시용이고, 진짜 판정은 서버가 한다. */
  function 이용권종류(client, done) {
    try {
      client.from("orders").select("plan")
        .in("status", ["paid", "partially_refunded"])
        .gt("entitlement_ended_at", new Date().toISOString())
        .then(function (res) {
          var 목록 = (res && res.data) || [];
          if (!목록.length) { done(null); return; }
          done(목록.some(function (o) { return o.plan === "year"; }) ? "year" : "month");
        })
        .catch(function () { done(null); });
    } catch (e) { done(null); }
  }

  function 기억된Pro() {
    try {
      var m = JSON.parse(localStorage.getItem(기억키) || "null");
      if (!m || !_user || m.id !== _user.id) return false;
      if (Date.now() - (m.t || 0) > 유예일 * 86400000) return false;
      if (m.expires_at && new Date(m.expires_at) <= new Date()) return false;
      return true;
    } catch (e) { return false; }
  }

  var _listeners = [];    // 상태가 바뀌면 부를 함수들
  var _ready = false;     // 최초 세션·프로필 확인이 끝났는가.
                          // 이걸 안 구분하면 '아직 모름'과 '무료'가 같아져
                          // 확인 중인 Pro 사용자를 무료로 취급하게 된다.
  var _reqSeq = 0;        // 프로필 조회 일련번호 (늦게 온 응답을 걸러내기 위해)

  /* 이 브라우저에서 로그인을 쓸 수 있는가.
     file:// 은 출처(origin)가 없어 OAuth 리디렉션이 성립하지 않는다. */
  function usable() {
    return !!(WE.flags && WE.flags.LAUNCH) &&
           location.protocol.indexOf("http") === 0;
  }

  /* ── 로그인 상태 유지 ───────────────────────────────
     세션은 항상 localStorage 에 둔다. 탭마다 따로 놓으면(sessionStorage)
     관리자 페이지를 새 탭으로 열기만 해도 로그인이 풀린다.

     ⚠ 그렇다고 영원히 두면 안 된다.
        우리 사용자는 중소 제조 현장이 많아 PC 한 대를 여럿이 쓰는 일이 흔하다.
        그래서 「로그인 상태 유지」를 안 켜면 **마지막으로 쓴 지 방치일이 지나면**
        스스로 풀린다. 예전에는 「탭 단위」로 막았는데, 그건 같은 사람이
        탭 하나 더 여는 것까지 막아버려서 쓸 수 없었다. */
  var 유지키 = "we_keep_login";
  var 본키 = "we_login_seen";   // 마지막으로 이지케이블을 열어 본 시각
  var 방치일 = 14;

  function 유지하나() {
    try { return localStorage.getItem(유지키) === "1"; } catch (e) { return false; }
  }

  // 창고 안의 세션 열쇠들 (SDK 가 'sb-' 로 시작하는 이름을 쓴다)
  function 세션열쇠(창고) {
    var 목록 = [];
    try {
      for (var i = 0; i < 창고.length; i++) {
        var k = 창고.key(i);
        if (k && k.indexOf("sb-") === 0) 목록.push(k);
      }
    } catch (e) { /* 무시 */ }
    return 목록;
  }

  // 「지금 쓰고 있다」로 도장을 찍는다. 여기서부터 방치일을 센다.
  function 사용표시() {
    try { localStorage.setItem(본키, String(Date.now())); } catch (e) { /* 무시 */ }
  }

  /* 너무 오래 방치된 세션인가.
     도장이 아예 없으면 '이번에 처음 찍는 중'이므로 만료로 보지 않는다 —
     이 기능이 생기기 전부터 로그인해 둔 사람을 내쪽으면 안 된다. */
  function 방치만료() {
    if (유지하나()) return false;          // 체크했으면 기한 없음
    try {
      var t = parseInt(localStorage.getItem(본키), 10);
      if (!t) return false;
      return (Date.now() - t) > 방치일 * 24 * 60 * 60 * 1000;
    } catch (e) { return false; }
  }

  function 세션치우기() {
    try {
      var a = 세션열쇠(localStorage), b = 세션열쇠(sessionStorage), i;
      for (i = 0; i < a.length; i++) localStorage.removeItem(a[i]);
      for (i = 0; i < b.length; i++) sessionStorage.removeItem(b[i]);
      localStorage.removeItem(본키);
    } catch (e) { /* 무시 */ }
  }

  /* SDK 를 띄우기 전에 한 번 정리한다.
     ① 예전 방식으로 sessionStorage 에 남아 있는 세션을 localStorage 로 옮긴다.
        안 옮기면 지금 로그인된 사람들이 이번 배포에서 한 번씩 튀긴다.
     ② 방치 기한을 넘겼으면 지운다. */
  function 묵은세션정리() {
    try {
      var 옮길것 = 세션열쇠(sessionStorage);
      for (var j = 0; j < 옮길것.length; j++) {
        var v = sessionStorage.getItem(옮길것[j]);
        if (v !== null && localStorage.getItem(옮길것[j]) === null) localStorage.setItem(옮길것[j], v);
        sessionStorage.removeItem(옮길것[j]);
      }
    } catch (e) { /* 무시 */ }
    if (방치만료()) 세션치우기();
  }

  /* 체크를 켜고 끕 때. 이젠 자리를 옮길 일이 없다 — 항상 localStorage 다.
     끄는 순간부터 방치일을 세야 하므로 도장을 지금으로 다시 찍는다. */
  function 유지설정(켬) {
    try {
      if (켬) localStorage.setItem(유지키, "1");
      else { localStorage.removeItem(유지키); 사용표시(); }
    } catch (e) { /* 무시 */ }
  }

  /* SDK 에 넘길 저장소. 모든 탭이 같이 보도록 localStorage 만 쓴다.
     읽기에서 sessionStorage 를 한 번 더 보는 건, 정리 전에 SDK 가 먼저
     물어볼 수 있기 때문이다. */
  var 저장소 = {
    getItem: function (k) {
      try {
        var v = localStorage.getItem(k);
        return v !== null ? v : sessionStorage.getItem(k);
      } catch (e) { return null; }
    },
    setItem: function (k, v) {
      try {
        localStorage.setItem(k, v);
        sessionStorage.removeItem(k);
        사용표시();          // 토큰을 갱신했다 = 쓰고 있다는 뜻
      } catch (e) { /* 무시 */ }
    },
    removeItem: function (k) {
      try { sessionStorage.removeItem(k); localStorage.removeItem(k); } catch (e) { /* 무시 */ }
    },
  };

  /* SDK(207KB)를 필요할 때만 내려받는다.
     app.html 에 <script> 로 박아두면 출시 전에도 모든 방문자가 받게 된다.
     쓰지도 않을 207KB 를 받게 할 이유가 없다.
     자체 호스팅이므로 CSP(script-src 'self')를 풀 필요가 없다. */
  function loadSdk(done) {
    if (window.supabase) { done(true); return; }
    var s = document.createElement("script");
    s.src = "js/vendor/supabase.js";
    s.onload = function () { done(!!window.supabase); };
    s.onerror = function () { done(false); };   // 실패해도 앱은 계속 돌아야 한다
    document.head.appendChild(s);
  }

  function notify() {
    _listeners.forEach(function (fn) {
      try { fn(); } catch (e) { /* 한 곳이 터져도 나머지는 돌아야 한다 */ }
    });
  }

  /* 로그인 후 프로필 한 줄을 읽어 온다.
     RLS 때문에 남의 행은 애초에 안 온다 — 조건을 걸 필요가 없다.

     ⚠ 응답이 늦게 도착하는 경우를 반드시 걸러내야 한다.
        조회를 시작한 뒤 로그아웃하거나 계정을 바꾸면,
        이전 사람의 응답이 나중에 도착해 _profile 을 덮어쓴다.
        그러면 로그아웃했는데 Pro 상태가 되살아난다. */
  function loadProfile(done) {
    if (!client || !_user) { _profile = null; _조회상태 = "없음"; if (done) done(); return; }
    _조회상태 = "확인중";
    var seq = ++_reqSeq;            // 이번 요청의 일련번호
    var who = _user.id;             // 누구의 프로필을 묻는가

    // 응답을 반영해도 되는 상황인가 —
    // 더 최신 요청이 생겼거나, 로그아웃했거나, 계정이 바뀌었으면 무시한다.
    function 유효한가() { return seq === _reqSeq && _user && _user.id === who; }

    client.from("profiles").select("plan, expires_at, source, agreed_at, marketing_opt_in").single()
      .then(function (res) {
        if (!유효한가()) { if (done) done(); return; }
        if (res.error) {
          // 조회 실패와 '무료 회원'은 다르다. 예전에는 둘 다 null 로 뭉개서,
          // 인터넷이 끊기면 돈 낸 사람이 무료로 떨어졌다.
          _조회상태 = "실패";
        } else {
          _profile = res.data;
          _조회상태 = "확인됨";
          // 무료면 종류를 물어볼 것도 없다 — 쓸데없는 조회를 안 한다
          if (res.data && res.data.plan === "pro") {
            이용권종류(client, function (종류) {
              if (유효한가()) 기억하기(res.data, 종류);
            });
          } else {
            기억하기(res.data, null);
          }
        }
        if (done) done();
      })
      .catch(function () {
        if (!유효한가()) { if (done) done(); return; }
          _조회상태 = "실패";      // 네트워크 오류 등 — 무료로 단정하지 않는다
          if (done) done();
      });
  }

  function applySession(session, done) {
    _user = session ? session.user : null;
    loadProfile(function () { _ready = true; notify(); if (done) done(); });
  }

  /* 프로필을 서버에서 다시 읽는다 — '방금 서버 쪽이 바뀌었다'고 아는 순간에 부른다.
     지금은 결제가 없어 부를 곳이 없지만, 결제를 붙이면 곧바로 필요해진다.

     ⚠ 왜 필요한가:
        loadProfile 은 안에만 있어 밖에서 부를 수 없었다. 그래서 결제 웹훅이
        profiles.plan 을 'pro' 로 바꿔도 **이미 열려 있던 에디터는 무료로 남는다.**
        사용자는 결제를 마치고 돌아왔는데 여전히 배선 30개에서 막힌다.
        "돈 냈는데 무료" CS 가 정확히 여기서 난다.

     ⚠ notify() 를 반드시 부른다 — 다시 읽기만 하면 화면은 옛 상태 그대로다.

     done(err) — 성공이면 null. 실패해도 '무료'로 단정하지 않는다(_조회상태 가 '실패'로 남고
     기존 유예 규칙이 그대로 적용된다). 화면은 "잠시 후 다시" 정도만 안내하면 된다. */
  function refreshProfile(done) {
    if (!client || !_user) { if (done) done("로그인이 필요합니다."); return; }
    loadProfile(function () {
      notify();
      if (done) done(_조회상태 === "확인됨" ? null : "요금제를 다시 확인하지 못했습니다.");
    });
  }

  /* ── 공개 API ───────────────────────────────────────────────────── */

  function init(done) {
    // 출시 전에는 로그인을 안 하지만, 주소에 토큰이 붙어 왔다면 지우고 끝낸다
    if (!usable()) { 남은토큰지우기(); if (done) done(); return; }

    loadSdk(function (ok) {
      if (!ok) { if (done) done(); return; }       // SDK 를 못 받아도 앱은 돈다

      /* ⚠ createClient 보다 먼저 불러야 한다.
         SDK 는 만들자마자 저장소를 읽어서, 늦으면 지워야 할 세션을
         이미 들고 난 뒤가 된다. */
      묵은세션정리();

      client = window.supabase.createClient(URL, KEY, {
        auth: {
          persistSession: true,       // 새로고침해도 로그인 유지
          autoRefreshToken: true,     // 토큰 만료 전에 자동 갱신
          detectSessionInUrl: true,   // 구글에서 돌아온 주소의 토큰을 알아서 처리
          /* 항상 localStorage 다 — 모든 탭이 같은 로그인을 본다.
             「로그인 상태 유지」를 안 켜면 방치 14일 뒤 자동으로 풀린다. */
          storage: 저장소,
        },
      });

      // 로그인·로그아웃·토큰갱신이 일어날 때마다 상태를 다시 맞춘다
      client.auth.onAuthStateChange(function (_evt, session) {
        if (session) 사용표시();
        applySession(session);
      });

      client.auth.getSession()
        .then(function (res) {
          var se = res.data ? res.data.session : null;
          if (se) 사용표시();   // 이번에 열었으니 방치일을 다시 센다
          applySession(se, done);
        })
        .catch(function () { if (done) done(); });
    });
  }

  /* 구글·메일 링크에서 돌아올 주소.

     ⚠ pathname 만 쓰면 ?launch=1 이 떨어져 나간다.
        그러면 돌아왔을 때 유료화가 꺼진 채라 SDK 를 아예 안 불러서
        ① 로그인이 안 되고 ② 주소에 붙어 온 접속 토큰도 안 지워진다.
        (2026-08-19 에 메일 인증 링크로 실제로 겪었다)
        실서비스는 주소가 곧 스위치라 상관없지만, 로컬 확인은 이게 없으면 늘 깨진다.

     다른 값(?limit= 등)은 일부러 안 넘긴다 — 돌아온 뒤에도 남으면 헷갈린다. */
  function 돌아올주소() {
    var 표시 = /[?&]launch=1(&|$)/.test(String(location.search || "")) ? "?launch=1" : "";
    return location.origin + location.pathname + 표시;
  }

  /* 주소에 남은 접속 토큰을 지운다.
     SDK 가 켜져 있으면 SDK 가 알아서 지우지만, 출시 전(LAUNCH=false)에는
     SDK 를 안 불러서 토큰이 주소창에 그대로 남는다.
     토큰은 로그인 자격증명이라 방문 기록·화면 캡처·주소 공유로 샌다. */
  function 남은토큰지우기() {
    try {
      if (!/access_token=|refresh_token=/.test(String(location.hash || ""))) return;
      history.replaceState(null, "", location.pathname + location.search);
    } catch (e) { /* 무시 */ }
  }

  /* 마지막으로 쓴 로그인 수단.
     소셜 로그인의 최대 실패 지점이 "저번에 뭘로 가입했더라"다.
     다른 걸로 누르면 같은 사람인데 계정이 하나 더 생긴다.
     수단 이름만 남기므로 개인정보가 아니다. */
  var LAST_KEY = "we_last_login";
  function lastProvider() {
    try { return localStorage.getItem(LAST_KEY) || ""; } catch (e) { return ""; }
  }
  function rememberProvider(p) {
    try { localStorage.setItem(LAST_KEY, p); } catch (e) { /* 무시 */ }
  }

  /* 메일 확인 링크를 눌러 돌아왔는가.

     ⚠ 이 판정은 '지금 당장' 해야 한다. supabase SDK 가 주소의 토큰을 처리하면서
        해시를 지워버리기 때문이다. init() 안에서 보면 이미 늦다.
        그래서 이 파일이 읽히는 시점(SDK 를 부르기 전)에 미리 읽어 둔다.

     type 값: signup(회원가입 확인) · email(이메일 변경 확인) · magiclink 등 */
  var _가입확인함 = (function () {
    try {
      var t = new URLSearchParams(String(location.hash || "").slice(1)).get("type") ||
              new URLSearchParams(String(location.search || "").slice(1)).get("type");
      return t === "signup" || t === "email";
    } catch (e) { return false; }
  })();

  /* 한 번만 알려준다 — 두 번 부르면 안내 화면이 두 번 뜬다 */
  function consumedSignup() { var v = _가입확인함; _가입확인함 = false; return v; }

  /* 비밀번호 재설정 링크를 눌러 돌아왔는가. type=recovery 로 온다.
     가입 확인과 같은 이유로 SDK 가 해시를 지우기 전에 미리 읽어 둔다. */
  var _재설정함 = (function () {
    try {
      var t = new URLSearchParams(String(location.hash || "").slice(1)).get("type") ||
              new URLSearchParams(String(location.search || "").slice(1)).get("type");
      return t === "recovery";
    } catch (e) { return false; }
  })();
  function consumedRecovery() { var v = _재설정함; _재설정함 = false; return v; }

  /* 구글에서 취소하거나 실패하면 주소에 error 가 붙어 돌아온다.
     예전에는 이걸 아무도 안 읽어서, 사용자 눈에는
     "버튼을 눌렀는데 아무 일도 안 일어났다"로 보였다.
     한 번 읽고 주소에서 지운다 — 안 지우면 새로고침할 때마다 다시 뜬다. */
  function consumeOAuthError() {
    var qs = String(location.search || "").slice(1);   // 맨 앞 ? 를 뗀다
    var hs = String(location.hash || "").slice(1);     // 맨 앞 # 를 뗀다
    var p = new URLSearchParams(qs), h = new URLSearchParams(hs);
    var code = p.get("error") || h.get("error");
    if (!code) return "";
    var desc = p.get("error_description") || h.get("error_description") || "";
    // error 관련 값만 걷어낸다. ?limit= 같은 다른 값은 남겨야 미리보기가 안 깨진다.
    ["error", "error_code", "error_description"].forEach(function (k) { p.delete(k); });
    try {
      var rest = p.toString();
      history.replaceState(null, "", location.pathname + (rest ? "?" + rest : ""));
    } catch (e) { /* 무시 */ }
    if (code === "access_denied") return "로그인을 취소했습니다.";
    return desc || code;
  }

  /* 구글 로그인 시작. 구글 페이지로 이동했다가 이 주소로 돌아온다.
     실패하면 onFail(사유) 로 알린다 — 조용히 끝내면 사용자도 나도 원인을 모른다. */
  /* 소셜 로그인 시작.

     provider 는 Supabase 에 설정한 식별자를 그대로 넘긴다.
       기본 제공(구글·카카오)  "google" · "kakao"
       커스텀 OIDC(네이버)     "custom:naver"  ← 반드시 custom: 으로 시작한다

     ⚠ 여기에 이름을 박지 않는다. 수단 목록(아래 '수단')이 갖고 있고
        이 함수는 받은 것을 그대로 쓴다 — 예전에는 "google" 이 박혀 있어서
        카카오·네이버 버튼을 눌러도 구글로 갔다. */
  function signIn(provider, onFail) {
    // 예전 형태 signIn(onFail) 로 부르는 곳이 있어도 깨지지 않게 받아 준다
    if (typeof provider === "function") { onFail = provider; provider = "google"; }
    provider = provider || "google";

    function fail(msg) { if (onFail) onFail(msg); }
    if (!usable()) { fail("이 환경에서는 로그인을 사용할 수 없습니다."); return; }
    if (!client) {
      fail("로그인 기능을 불러오지 못했습니다. 인터넷 연결을 확인하고 새로고침해 주세요.");
      return;
    }
    // '최근 사용' 배지는 짧은 이름으로 기억한다 — custom: 접두어는 뺀다
    rememberProvider(String(provider).replace(/^custom:/, ""));
    // 구글로 보내기 직전. 닫기 확인("이 사이트를 나가시겠습니까?")이 먼저 뜨면
    // 로그인 버튼을 눌렀는데 엉뚱한 창이 뜨는 꼴이 된다.
    // 작업 저장은 store.js 의 beforeunload/pagehide 가 따로 하므로 잃지 않는다.
    try { if (WE.io && WE.io.allowLeave) WE.io.allowLeave(); } catch (e) { /* 무시 */ }
    try {
      /* prompt=select_account — 누를 때마다 **계정 선택 화면**을 띄운다. (2026-09-02)

         우리 signOut() 은 **우리 세션만** 지운다. 카카오·구글 쪽 로그인은 브라우저에
         그대로 남아서, 로그아웃한 뒤 다시 누르면 제공자가 곧바로 통과시킨다.
         PC 한 대를 여럿이 쓰는 현장에서는 **다음 사람이 앞사람 계정으로 그냥 들어간다.**
         「로그인 상태 유지」를 기본 꺼 둔 것과 같은 위험이 소셜 쪽에 남아 있었다.
         (고원빈 보고: "카카오로 로그아웃했는데 다시 누르면 그냥 로그인돼 버린다")

         카카오·구글 모두 같은 값을 받는다 — login(재인증) · select_account(계정 선택) · none(자동).
         login 은 매번 비밀번호를 받아 「로그인 상태 유지」와 부딪히므로 select_account 로 둔다.
         유지를 켜 둔 사람은 세션이 살아 있어 이 화면 자체를 볼 일이 없다. */
      var r = client.auth.signInWithOAuth({
        provider: provider,
        options: {
          redirectTo: 돌아올주소(),
          queryParams: { prompt: "select_account" },
        },
      });
      // 실패가 나중에 도착하는 경우도 있다
      if (r && r.then) {
        r.then(function (res) {
          if (res && res.error) fail("로그인을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.");
        }).catch(function () {
          fail("로그인을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.");
        });
      }
    } catch (e) {
      fail("로그인을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    }
  }

  function signOut() {
    if (!client) return;
    /* 서버 응답을 기다리지 않고 먼저 지운다 —
       인터넷이 끊겨 .then 이 안 오면 Pro 기억이 그대로 남기 때문이다. */
    기억지우기();
    client.auth.signOut().then(function () {
      _user = null; _profile = null; notify();
    });
  }

  function user() { return _user; }

  /* Pro 판정 — 이 한 곳에서만 정한다.
     만료일이 지났으면 plan 이 'pro' 여도 무료로 본다.
     → 해지·결제실패로 웹훅이 늦어도 자동으로 무료로 떨어진다. */
  /* Pro 인가.
     ⚠ "확인 못 했다"를 "무료다"로 단정하면 안 된다 — 그것이 예전 버그였다.
        인터넷이 끊기거나 앱을 막 켠 순간, 돈 낸 사람이 무료로 떨어져
        30개 넘는 도면을 못 고쳤다.
     그래서 상태별로 다르게 답한다:
        확인됨  → 서버가 말한 대로
        확인중  → 마지막으로 확인된 Pro 를 인정 (깜빡임 방지)
        실패    → 유예 기간(7일) 안이면 인정
        없음    → 로그아웃. 무료 */
  function isPro() {
    // 로그아웃 상태면 무조건 무료다.
    // _profile 만 보면 늦게 도착한 응답이나 정리 순서 때문에
    // 로그아웃했는데 Pro 로 남을 수 있다.
    if (!_user) return false;

    if (_조회상태 === "확인됨") {
      if (!_profile || _profile.plan !== "pro") return false;
      if (!_profile.expires_at) return true;              // 만료 없음(수동 부여 등)
      return new Date(_profile.expires_at) > new Date();
    }

    // 아직 확인 못 했다 — 마지막으로 확인된 Pro 를 유예 기간 안에서 인정한다.
    // 무료 사용자는 기억이 없으므로 그대로 무료다.
    return 기억된Pro();
  }

  /* 확인이 끝났는가. 화면이 "확인 중"과 "무료"를 구분해 보여줄 때 쓴다. */
  function proConfirmed() { return _조회상태 === "확인됨"; }

  /* 검사 전용 통로 — Pro 판정을 시험하려면 상태를 직접 만들어야 한다.
     실제 서버를 부르지 않고 "조회 실패", "확인 중" 같은 상황을 재현한다.
     ⚠ 로컬(127.0.0.1·localhost)에서만 열린다. 실서비스에서는 undefined 라
        이 통로로 Pro 를 켤 수 없다. */
  function _테스트_상태(st) {
    if (!WE.flags || !WE.flags._isLocalHost || !WE.flags._isLocalHost(location.hostname)) return;
    _user = st.user || null;
    _조회상태 = st.조회상태 || "없음";
    _profile = st.profile || null;
    if (_조회상태 === "확인됨") {
      // 이미 적어 둔 종류를 지우지 않는다 — 여기서는 만료 시각만 새로 고친다
      var 이전 = null;
      try { 이전 = JSON.parse(localStorage.getItem(기억키) || "null"); } catch (e) {}
      기억하기(_profile, 이전 && 이전.kind);
    }
  }
  function proState() { return _조회상태; }

  /* ── 동의 ─────────────────────────────────────────────────────────
     동의를 아직 안 받았는가.
     '확인됨' 일 때만 판단한다 — 조회 실패를 "동의 안 함"으로 읽으면
     인터넷이 끊길 때마다 동의 화면이 떠서 앱을 못 쓴다. */
  function needsConsent() {
    if (!_user) return false;
    if (_조회상태 !== "확인됨") return false;
    return !_profile || !_profile.agreed_at;
  }

  /* 동의를 서버에 남긴다.
     ⚠ profiles 를 직접 update 하지 않는다 — 같은 행에 plan 이 있어서
        UPDATE 를 열어 주면 사용자가 콘솔에서 스스로 Pro 가 될 수 있다.
        동의 컬럼만 건드리는 record_consent() 함수만 열어 뒀다.
        (SQL: _ai/sql/2026-08-19_동의기록.sql) */
  function recordConsent(marketing, done) {
    function 끝(err) { if (done) done(err || null); }
    if (!client || !_user) { 끝("로그인이 필요합니다."); return; }
    client.rpc("record_consent", {
      p_terms_version:   TERMS_VER,
      p_privacy_version: PRIVACY_VER,
      p_marketing:       !!marketing,
    }).then(function (res) {
      if (res && res.error) {
        // 서버가 준 진짜 이유를 콘솔에 남긴다 — 화면 문구만으로는 원인을 알 수 없다
        try { console.error("[auth] record_consent 실패:", res.error); } catch (e) { /* 무시 */ }
        끝("동의 기록을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.");
        return;
      }
      loadProfile(function () { notify(); 끝(null); });   // agreed_at 을 다시 읽어 화면을 맞춘다
    }).catch(function (e) {
      try { console.error("[auth] record_consent 예외:", e); } catch (x) { /* 무시 */ }
      끝("동의 기록을 저장하지 못했습니다. 인터넷 연결을 확인해 주세요.");
    });
  }

  /* ── 이메일 가입·로그인 ────────────────────────────────────────────
     Supabase 오류 메시지는 영어다. 그대로 보여주면 무슨 말인지 모른다. */
  /* 이미 가입된 이메일일 때 쓰는 문구. 두 경로에서 나오므로 한 곳에 둔다 —
     ① Supabase 가 오류를 준 경우  ② 오류 없이 빈 사용자를 준 경우(아래 signUpEmail 참조)
     경로마다 다른 말을 하면 같은 상황인데 화면이 달라진다. */
  var 중복메일문구 = "이미 존재하는 이메일입니다.";

  function 가입오류(err) {
    var m = String((err && err.message) || "");
    if (/already registered|already exists|User already/i.test(m)) return 중복메일문구;
    if (/Password should be at least/i.test(m))                    return "비밀번호는 6자 이상이어야 합니다.";
    if (/rate limit|too many/i.test(m))                            return "시도가 너무 잦습니다. 잠시 후 다시 시도해 주세요.";
    if (/email/i.test(m) && /invalid|not valid/i.test(m))          return "이메일 주소를 확인해 주세요.";
    return "가입에 실패했습니다. 입력한 내용을 확인해 주세요.";
  }

  /* 이메일 회원가입.
     동의는 폼에서 이미 받았으므로 가입 정보에 같이 실어 보낸다.
     ⚠ 프로젝트 설정에 '메일 확인'이 켜져 있으면 이 시점엔 세션이 없다.
        세션이 없으면 auth.uid() 가 없어 서버에 동의를 남길 수 없다.
        그때는 확인 메일을 누르고 처음 로그인할 때 동의 화면이 뜬다. */
  function signUpEmail(정보, done) {
    /* 칸: 어느 입력칸의 문제인지("email"). 호출부가 그 칸 아래에 오류를 붙인다. */
    function 끝(err, 상태, 칸) { if (done) done(err || null, 상태 || null, 칸 || null); }
    if (!client) { 끝("로그인 기능을 불러오지 못했습니다. 새로고침해 주세요."); return; }
    client.auth.signUp({
      email: 정보.email,
      password: 정보.password,
      options: {
        // consent_at 은 '가입 폼에서 이미 동의를 받았다' 는 표시다.
        // 메일 확인 후 첫 로그인에서 이걸 보고 동의를 자동 기록해, 두 번 묻지 않는다.
        // ⚠ 실제로 DB 에 남는 동의 시각은 서버의 now() 다 —
        //    클라이언트가 정한 시각을 믿으면 조작할 수 있다. 이 값은 '표시' 로만 쓴다.
        data: {
          name: 정보.name,
          marketing_opt_in: !!정보.marketing,
          consent_at: new Date().toISOString(),
        },
        emailRedirectTo: 돌아올주소(),
      },
    }).then(function (res) {
      if (res && res.error) {
        var msg = 가입오류(res.error);
        끝(msg, null, msg === 중복메일문구 ? "email" : null);
        return;
      }
      /* ⚠ 이미 가입된 이메일이어도 Supabase 는 오류를 내지 않는다.
         "이 주소는 가입돼 있다" 를 알려주면 남의 회원 목록을 캐낼 수 있어서(열거 방지),
         일부러 성공처럼 응답하고 사용자 정보를 비워서 돌려준다.
         그 신호가 identities 빈 배열이다 — 신규 가입이면 항목이 하나 들어 있다.
         (2026-08-24 실측: 오류 null · 세션 없음 · identities [] · confirmed_at null)

         이걸 안 걸러내면 아래 '메일확인' 가지로 빠져서, 아무것도 안 보내 놓고
         "인증 링크를 보냈습니다" 화면이 뜬다. 사용자는 오지 않을 메일을 기다리게 된다. */
      var 받은사용자 = res && res.data && res.data.user;
      if (받은사용자 && Array.isArray(받은사용자.identities) && 받은사용자.identities.length === 0) {
        끝(중복메일문구, null, "email");
        return;
      }
      rememberProvider("email");
      if (!(res && res.data && res.data.session)) { 끝(null, "메일확인"); return; }
      recordConsent(정보.marketing, function () { 끝(null, "완료"); });
    }).catch(function () { 끝("가입에 실패했습니다. 잠시 후 다시 시도해 주세요."); });
  }

  /* 가입 폼에서 받아 계정 정보에 실어 보낸 동의.
     메일 확인 후 첫 로그인에서 이걸 읽어 자동으로 기록한다 — 사용자에게 두 번 묻지 않는다.
     소셜 로그인은 폼이 없으므로 null 이 나오고, 그때는 동의 화면을 띄운다. */
  function signupConsent() {
    var m = _user && _user.user_metadata;
    if (!m || !m.consent_at) return null;
    return { marketing: !!m.marketing_opt_in };
  }

  /* 확인 메일을 다시 보낸다 (스팸함에 갔거나 못 받은 경우). */
  function resendConfirm(email, done) {
    function 끝(err) { if (done) done(err || null); }
    if (!client) { 끝("로그인 기능을 불러오지 못했습니다. 새로고침해 주세요."); return; }
    client.auth.resend({
      type: "signup",
      email: email,
      options: { emailRedirectTo: 돌아올주소() },
    }).then(function (res) {
      if (res && res.error) {
        try { console.error("[auth] resend 실패:", res.error); } catch (e) { /* 무시 */ }
        var m = String(res.error.message || "");
        if (/rate limit|too many|only request this after/i.test(m)) {
          끝("메일을 너무 자주 보냈습니다. 잠시 후 다시 시도해 주세요."); return;
        }
        끝("메일을 다시 보내지 못했습니다. 잠시 후 시도해 주세요."); return;
      }
      끝(null);
    }).catch(function (e) {
      try { console.error("[auth] resend 예외:", e); } catch (x) { /* 무시 */ }
      끝("메일을 다시 보내지 못했습니다. 인터넷 연결을 확인해 주세요.");
    });
  }

  function signInEmail(email, password, done) {
    /* 두 번째 인자로 '왜 실패했는가' 를 알려준다.
       미인증은 오류가 아니라 '아직 안 끝난 절차' 라서, 화면 자체를 바꿔야 한다. */
    function 끝(err, 상태) { if (done) done(err || null, 상태 || null); }
    if (!client) { 끝("로그인 기능을 불러오지 못했습니다. 새로고침해 주세요."); return; }
    // 구글 로그인과 같은 이유 — 나가기 확인창이 먼저 뜨면 안 된다
    try { if (WE.io && WE.io.allowLeave) WE.io.allowLeave(); } catch (e) { /* 무시 */ }
    client.auth.signInWithPassword({ email: email, password: password })
      .then(function (res) {
        if (res && res.error) {
          var m = String(res.error.message || "");
          // 빨간 오류 줄로 알리지 않는다 — 인증 안내 화면으로 보내야
          //   [이메일 다시 보내기] 를 그 자리에서 누를 수 있다
          if (/Email not confirmed/i.test(m)) { 끝(null, "미인증"); return; }
          끝("이메일 또는 비밀번호가 맞지 않습니다.");
          return;
        }
        rememberProvider("email");
        끝(null);
      })
      .catch(function () { 끝("로그인에 실패했습니다. 인터넷 연결을 확인해 주세요."); });
  }

  /* 비밀번호 재설정 메일을 보낸다.

     ⚠ 그 메일이 존재하는 계정인지 알려 주지 않는다.
        "가입되지 않은 이메일입니다" 라고 답하면 남의 가입 여부를 캐낼 수 있다.
        Supabase 도 같은 이유로 성공/실패를 구분하지 않는다.
        화면에도 "가입된 주소라면 메일을 보냈습니다" 라고만 쓴다. */
  function resetPassword(email, done) {
    function 끝(err) { if (done) done(err || null); }
    if (!client) { 끝("로그인 기능을 불러오지 못했습니다. 새로고침해 주세요."); return; }
    client.auth.resetPasswordForEmail(email, { redirectTo: 돌아올주소() })
      .then(function (res) {
        if (res && res.error) {
          try { console.error("[auth] resetPasswordForEmail 실패:", res.error); } catch (e) { /* 무시 */ }
          var m = String(res.error.message || "");
          if (/rate limit|too many|only request this after/i.test(m)) {
            끝("메일을 너무 자주 보냈습니다. 잠시 후 다시 시도해 주세요."); return;
          }
          끝("메일을 보내지 못했습니다. 잠시 후 다시 시도해 주세요."); return;
        }
        끝(null);
      })
      .catch(function (e) {
        try { console.error("[auth] resetPasswordForEmail 예외:", e); } catch (x) { /* 무시 */ }
        끝("메일을 보내지 못했습니다. 인터넷 연결을 확인해 주세요.");
      });
  }

  /* 새 비밀번호로 바꾼다.
     재설정 링크를 누르고 돌아오면 그 순간 '임시로 로그인된' 상태가 된다.
     그 세션으로 자기 비밀번호만 바꾸는 것이라 별도 인증이 필요 없다. */
  function updatePassword(pw, done) {
    function 끝(err) { if (done) done(err || null); }
    if (!client) { 끝("로그인 기능을 불러오지 못했습니다. 새로고침해 주세요."); return; }
    client.auth.updateUser({ password: pw })
      .then(function (res) {
        if (res && res.error) {
          try { console.error("[auth] updateUser 실패:", res.error); } catch (e) { /* 무시 */ }
          var m = String(res.error.message || "");
          if (/should be at least|at least 6/i.test(m)) { 끝("비밀번호는 6자 이상이어야 합니다."); return; }
          if (/same.*password|different from the old/i.test(m)) { 끝("이전과 다른 비밀번호를 입력해 주세요."); return; }
          if (/session|expired|invalid/i.test(m)) {
            끝("재설정 링크가 만료되었습니다. 메일을 다시 받아 주세요."); return;
          }
          끝("비밀번호를 바꾸지 못했습니다. 잠시 후 다시 시도해 주세요."); return;
        }
        끝(null);
      })
      .catch(function (e) {
        try { console.error("[auth] updateUser 예외:", e); } catch (x) { /* 무시 */ }
        끝("비밀번호를 바꾸지 못했습니다. 인터넷 연결을 확인해 주세요.");
      });
  }

  /* 회원 탈퇴.

     ⚠ profiles 를 지우는 것만으로는 탈퇴가 아니다. auth.users 에 계정이 남아 있으면
        같은 메일로 다시 가입할 수 없고, 로그인도 계속 된다.
        그렇다고 클라이언트에 auth 스키마를 열어 줄 수는 없다 — 남의 계정도 지울 수 있게 된다.
        그래서 '부른 사람 자신만' 지우는 함수 하나만 열어 뒀다.
        (SQL: _ai/sql/2026-08-19_회원탈퇴.sql)

     지우고 나면 세션이 무효가 되므로 signOut 으로 브라우저 쪽도 정리한다.
     도면은 건드리지 않는다 — 원래 서버에 없고, 탈퇴 후에도 무료로 계속 쓸 수 있어야 한다. */
  function deleteAccount(done) {
    function 끝(err) { if (done) done(err || null); }
    if (!client || !_user) { 끝("로그인이 필요합니다."); return; }
    client.rpc("delete_my_account").then(function (res) {
      if (res && res.error) {
        try { console.error("[auth] delete_my_account 실패:", res.error); } catch (e) { /* 무시 */ }
        끝("탈퇴 처리에 실패했습니다. 잠시 후 다시 시도해 주세요.");
        return;
      }
      // 계정이 없어졌으니 남은 세션도 지운다. 실패해도 탈퇴 자체는 끝난 것이라 무시한다.
      기억지우기();   // 계정이 사라졌는데 Pro 기억만 남으면 유예 기간 동안 Pro 로 보인다
      client.auth.signOut().then(function () {
        _user = null; _profile = null; _조회상태 = "없음"; notify(); 끝(null);
      }).catch(function () {
        _user = null; _profile = null; _조회상태 = "없음"; notify(); 끝(null);
      });
    }).catch(function (e) {
      try { console.error("[auth] delete_my_account 예외:", e); } catch (x) { /* 무시 */ }
      끝("탈퇴 처리에 실패했습니다. 인터넷 연결을 확인해 주세요.");
    });
  }

  function profile() { return _profile; }

  /* 최초 확인이 끝났는가. 끝나기 전에는 Pro 여부를 단정하면 안 된다. */
  function ready() { return _ready; }

  /* 상태가 바뀔 때 화면을 갱신하려는 쪽에서 등록한다 */
  function onChange(fn) { if (typeof fn === "function") _listeners.push(fn); }

  return {
    init: init,
    signIn: signIn,
    signOut: signOut,
    lastProvider: lastProvider,
    consumeOAuthError: consumeOAuthError,
    user: user,
    profile: profile,
    refreshProfile: refreshProfile,
    ready: ready,
    isPro: isPro,
    proConfirmed: proConfirmed,
    _테스트_상태: _테스트_상태,
    proState: proState,
    needsConsent: needsConsent,
    recordConsent: recordConsent,
    signUpEmail: signUpEmail,
    signInEmail: signInEmail,
    deleteAccount: deleteAccount,
    resetPassword: resetPassword,
    updatePassword: updatePassword,
    consumedRecovery: consumedRecovery,
    signupConsent: signupConsent,
    resendConfirm: resendConfirm,
    consumedSignup: consumedSignup,
    onChange: onChange,
    keepLogin: 유지하나,
    setKeepLogin: 유지설정,
    // 검사·디버깅용 — 클라이언트가 실제로 만들어졌는지 확인한다
    _client: function () { return client; },
    _usable: usable,
  };
})();

/* 스스로 시작한다 — app.js 를 고치지 않기 위해서다.
   출시 전까지 기존 파일 수정을 최소로 두면, 기술 배포에 미완성 코드가
   섞일 위험이 그만큼 줄어든다.
   LAUNCH 가 false 면 init() 이 즉시 끝나므로 아무 일도 일어나지 않는다. */
document.addEventListener("DOMContentLoaded", function () { WE.auth.init(); });

/* ── 계정 버튼 (화면) ─────────────────────────────────────────────────
   로그인 '로직'은 위 WE.auth 안에, '화면'은 여기에 둔다.
   버튼 모양·위치가 바뀌어도 인증 코드는 한 줄도 안 건드리게 하려는 것.

   ⚠ 출시 전에는 버튼이 아예 안 보인다(_usable() 이 false).
      지금 배포돼도 사용자 화면이 그대로여야 한다.
   ─────────────────────────────────────────────────────────────────── */
(function () {

  /* 문구 번역. **i18n 이 없어도 돌아가야 한다.**
     랜딩(index.html)은 i18n.js(70KB)를 싣지 않는다 — 랜딩은 한국어 전용이고,
     저장된 언어에 따라 랜딩 본문까지 번역되면 성격이 달라진다.

     ⚠ 예전에는 `WE.i18n.t(...)` 를 그대로 불렀다. 그래서 랜딩에서 로그인을 누르면
        버튼을 '로그인 중…' 으로 바꾸려는 순간 예외가 나서, **버튼만 회색이 된 채 멈췄다.**
        오류를 띄우는 안내() 도 같은 줄에서 막혀 아무 말도 못 했다.
        (2026-09-02 고원빈 보고 — 에디터에서는 멀쩡했다. i18n 을 싣기 때문이다) */
  function 문구(s) { return (window.WE && WE.i18n && WE.i18n.t) ? WE.i18n.t(s) : s; }
  function el() { return document.getElementById("btnAccount"); }

  /* 화면에 보여줄 사람 이름.
     'gwb0723' 보다 '고원빈' 이 알아보기 쉽다.
     카카오·구글은 닉네임을, 이메일 가입은 폼에서 받은 이름을 넣어 준다.
     없으면 이메일 앞부분으로 물러난다.
     ⚠ 카카오 동의항목에 "서비스 내 계정 표시 이름으로 사용합니다" 라고 적어 냈다.
        실제로 쓰지 않으면 신청 내용과 달라져 API 사용이 거부될 수 있다. */
  function 사람이름(u) {
    u = u || WE.auth.user(); if (!u) return "";
    var m = u.user_metadata || {};
    var 이름 = m.name || m.full_name || m.nickname || m.preferred_username ||
               String(u.email || "").split("@")[0];
    return String(이름 || "").trim() || String(u.email || "").split("@")[0];
  }

  /* 아바타에 넣을 이니셜.
     한글은 한 글자로도 알아보지만(고) 알파벳은 한 글자면 구분이 안 돼(g)
     두 글자를 쓴다(GW). 30px 원 안에 들어가야 하므로 최대 두 글자다. */
  function 이니셜(이름) {
    var v = String(이름 || "").trim();
    if (!v) return "?";
    var 첫 = v.charAt(0);
    if (첫 >= "가" && 첫 <= "힣") return 첫;   // 한글 음절이면 한 글자
    return v.slice(0, 2).toUpperCase();
  }

  function paint() {
    var b = el(); if (!b) return;
    var wrap = document.getElementById("acctWrap");
    if (!WE.auth._usable()) {                              // 출시 전 · file:// → 숨김
      b.hidden = true; if (wrap) wrap.hidden = true; return;
    }
    b.hidden = false; if (wrap) wrap.hidden = false;
    var u = WE.auth.user();
    if (!u) {
      /* 로그인 전 — 글자 버튼 그대로 둔다.
         아바타로 바꾸면 무엇을 눌러야 로그인인지 알 수 없다. */
      b.classList.remove("is-face");
      b.textContent = 문구("로그인");
      b.title = 문구("구글 계정으로 로그인");
      메뉴닫기();                                          // 로그아웃되면 열려 있던 메뉴를 정리한다
    } else {
      b.classList.add("is-face");
      b.textContent = 이니셜(사람이름(u));
      b.title = 사람이름(u) + " (" + (u.email || "") + ")";
      메뉴채우기();
    }
    b.classList.toggle("is-pro", !!u && WE.auth.isPro());
  }

  /* ── 계정 메뉴 ───────────────────────────────────────────────
     예전에는 계정 버튼이 곧바로 window.confirm("로그아웃할까요?") 를 띄웠다.
     ① 브라우저 기본 창이라 우리가 만든 모달들과 따로 놀았고
     ② 계정으로 할 수 있는 유일한 일이 로그아웃이었다.
        이메일 확인·요금제·회원 탈퇴는 전부 설정 안쪽에 묻혀 있었다. */
  function 메뉴() { return document.getElementById("acctMenu"); }
  function 메뉴열림() { var m = 메뉴(); return !!m && !m.hidden; }
  function 메뉴닫기() { var m = 메뉴(); if (m) m.hidden = true; }
  function 메뉴열기() { var m = 메뉴(); if (m) { 메뉴채우기(); m.hidden = false; } }

  function 메뉴채우기() {
    var u = WE.auth.user(); if (!u) return;
    var 이름 = 사람이름(u);
    var f = document.getElementById("acctFace");
    var n = document.getElementById("acctName");
    var e = document.getElementById("acctMail");
    var p = document.getElementById("acctPlan");
    if (f) f.textContent = 이니셜(이름);
    if (n) n.textContent = 이름;
    if (e) e.textContent = u.email || "";
    if (p) p.hidden = !WE.auth.isPro();
  }

  /* ── 로그인 모달 ──────────────────────────────────────
     예전에는 계정 버튼을 누르면 곧바로 구글로 튀었다. 그래서
     ① 약관·수집 항목을 고지할 자리가 없었고 (개인정보보호법상 필요)
     ② 취소하고 돌아와도 아무 표시가 없어 "눌러도 반응이 없다"가 됐다.
     모달을 한 단계 두면 둘 다 풀린다. */
  function modal() { return document.getElementById("loginModal"); }

  // 로그인 수단 목록. 심사가 끝나는 대로 ready 를 true 로 바꾸면 된다.
  /* 로그인 수단 목록.
  
     provider 는 Supabase 대시보드에 설정한 식별자다. 바꿀 일이 있으면 여기만 고친다.
       구글·카카오  Supabase 기본 제공 → 이름 그대로
       네이버       기본 제공이 없어 커스텀 OIDC 로 붙인다 → 반드시 "custom:" 으로 시작
                    (issuer https://nid.naver.com — OIDC 표준을 지원하는 것을 확인했다)
  
     버튼의 data-ready 는 app.html 에 있다. 심사가 끝나면 0 → 1 로 바꾸면 켜진다.
     코드는 미리 준비해 두고, 켜는 것은 스위치 하나로 끝나게 한다. */
  var 수단 = [
    { id: "google", provider: "google",       버튼: "loginGoogle", 배지: "loginRecentGoogle", 이름: "Google" },
    { id: "naver",  provider: "custom:naver", 버튼: "loginNaver",  배지: "loginRecentNaver",  이름: "네이버" },
    { id: "kakao",  provider: "kakao",        버튼: "loginKakao",  배지: "loginRecentKakao",  이름: "카카오" },
  ];

  function 안내(msg, 정보인가) {
    var e = document.getElementById("loginError");
    if (!e) return;
    e.hidden = !msg;
    e.textContent = msg ? 문구(msg) : "";
    e.classList.toggle("is-info", !!정보인가);
  }

  /* 안내() 의 일반형. 회원가입·동의 화면도 같은 자리·같은 모양의 알림줄을 쓴다.
     세 벌로 만들면 한쪽만 고쳐져 어긋난다. */
  /* 이메일처럼 생겼는가. 서버에 보내기 전에 여기서 거른다 —
     왕복 한 번을 아끼고 안내도 우리말로 나간다.
     ⚠ 한 벌만 둔다. 회원가입과 비밀번호 찾기가 각자 갖고 있으면 한쪽만 고쳐진다. */
  function 이메일형식(v) { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(v || "")); }

  function 알림(id, msg, 정보인가) {
    var e = document.getElementById(id);
    if (!e) return;
    e.hidden = !msg;
    e.textContent = msg ? 문구(msg) : "";
    e.classList.toggle("is-info", !!정보인가);
  }

  /* 특정 입력칸의 문제를 그 칸 바로 아래에 붙인다 (알림() 은 화면 위쪽 전체 오류용).
     문구를 빈 값으로 부르면 지운다.
     값을 고치기 시작하면 스스로 지워진다 — 고쳤는데도 빨간 채로 두면 고장처럼 보인다.
     듣기(listener)는 칸마다 한 번만 단다 (속성 표시로 중복 등록을 막는다). */
  /* ⚠ 세 번째 인자 이름을 `문구` 로 두면 안 된다. 이 파일 870행의 **번역 함수 `문구()` 를 가려서**
     `문구(문구)` 가 "문자열을 함수처럼 부르는" 꼴이 되고 TypeError 가 난다. (2026-09-11 고침)

     실제 증상 — 이미 가입된 이메일로 회원가입하면:
       signUpEmail 이 중복을 제대로 잡아 칸="email" 로 "이미 가입된 이메일입니다." 를 넘긴다
       → 여기서 터진다 → 바깥 .catch 가 삼켜서
       → 화면에는 엉뚱한 "가입에 실패했습니다. 잠시 후 다시 시도해 주세요." 가 뜬다.
     ⚠ 오류를 **지울 때**(빈 문자열)는 삼항연산자에 걸려 안 터진다.
        그래서 평소 조작으로는 안 드러나고, 진짜 오류가 났을 때만 터졌다. */
  function 칸오류(입력id, 오류id, msg) {
    var i = document.getElementById(입력id);
    var e = document.getElementById(오류id);
    if (e) {
      e.hidden = !msg;
      e.textContent = msg ? 문구(msg) : "";
    }
    if (!i) return;
    i.classList.toggle("is-invalid", !!msg);
    if (!msg) return;
    i.focus();
    if (!i.getAttribute("data-fielderr")) {
      i.setAttribute("data-fielderr", "1");
      i.addEventListener("input", function () { 칸오류(입력id, 오류id, ""); });
    }
  }

  /* 동의 체크박스 묶음 하나를 다룬다.
     회원가입 폼과 동의 모달에 같은 markup 이 있고 동작은 이 함수 하나가 맡는다.
     '모두 동의'는 아래 항목들과 양방향으로 맞물린다 —
     위를 켜면 전부 켜지고, 아래 하나라도 꺼지면 위도 꺼진다. */
  function 동의블록(root, 바뀔때) {
    var all = root.querySelector('[data-cs="all"]');
    var 항목 = [].slice.call(root.querySelectorAll("[data-cs]")).filter(function (c) { return c !== all; });
    var 필수 = 항목.filter(function (c) { return c.hasAttribute("data-req"); });

    function 위쪽맞추기() {
      all.checked = 항목.length > 0 && 항목.every(function (c) { return c.checked; });
      if (바뀔때) 바뀔때();
    }
    all.addEventListener("change", function () {
      항목.forEach(function (c) { c.checked = all.checked; });
      if (바뀔때) 바뀔때();
    });
    항목.forEach(function (c) { c.addEventListener("change", 위쪽맞추기); });

    return {
      ok: function () { return 필수.every(function (c) { return c.checked; }); },
      marketing: function () { var m = root.querySelector('[data-cs="mkt"]'); return !!(m && m.checked); },
      비우기: function () {
        all.checked = false;
        항목.forEach(function (c) { c.checked = false; });
        if (바뀔때) 바뀔때();
      },
    };
  }

  /* 창을 열 때 폼을 비우는 함수. 실제 내용은 아래 DOMContentLoaded 안에서 채운다 —
     화면 전환(화면)과 동의 블록(가입동의)이 그 안에만 있기 때문이다. */
  var _창비우기 = null;

  function openLogin(errMsg) {
    var m = modal(); if (!m) return;
    /* 열 때마다 지난 입력을 지운다. 예전에는 그대로 남아서, 로그인에 실패하고 창을 닫았다
       다시 열면 **틀린 아이디·비밀번호가 그대로** 들어 있었다(2026-09-02 고원빈 지적). */
    if (_창비우기) _창비우기();
    안내(errMsg, false);
    // '최근 사용' 배지는 저번에 실제로 쓴 수단 하나에만 붙인다
    var 마지막 = WE.auth.lastProvider();
    수단.forEach(function (s) {
      var b = document.getElementById(s.배지);
      if (b) b.hidden = (마지막 !== s.id);
    });
    m.hidden = false;
    var g = document.getElementById("loginGoogle");
    if (g) g.focus();
  }

  function closeLogin() { var m = modal(); if (m) m.hidden = true; }

  document.addEventListener("DOMContentLoaded", function () {
    var m = modal();
    if (m) {
      수단.forEach(function (s) {
        var btn = document.getElementById(s.버튼);
        if (!btn) return;
        btn.addEventListener("click", function () {
          // 아직 심사가 안 끝난 수단 — 아무 반응 없는 버튼은 만들지 않는다
          if (btn.getAttribute("data-ready") !== "1") {
            안내(s.이름 + " 로그인은 준비 중입니다. 지금은 Google 로그인을 이용해 주세요.", true);
            return;
          }
          // 실패하면 모달을 닫지 않고 그 자리에 이유를 띄운다
          WE.auth.signIn(s.provider, function (msg) { 안내(msg, false); });
        });
      });
      var x = document.getElementById("loginClose");
      if (x) x.addEventListener("click", closeLogin);
      // 바깥을 눌러도 닫힌다 (안쪽 클릭은 통과시키면 안 된다)
      m.addEventListener("click", function (ev) { if (ev.target === m) closeLogin(); });
      document.addEventListener("keydown", function (ev) {
        if (ev.key === "Escape" && !m.hidden) closeLogin();
      });

      // 구글에서 취소·실패하고 돌아온 경우 — 그 자리에서 이유를 보여준다.
      // 주소 정리는 조건 없이 한다 — 남겨두면 새로고침할 때마다 다시 뜬다.
      // 다만 '보여주는' 것은 _usable() 일 때만. 출시 전에는 로그인이 아예 없으므로
      // 누가 주소에 ?error= 를 붙여 들어와도 모달이 뜨면 안 된다
      // (LAUNCH 가 꺼져 있어도 이 블록 자체는 돌기 때문에 여기서 막아야 한다).
      var back = WE.auth.consumeOAuthError();
      if (back && WE.auth._usable()) openLogin(back);
    }

    /* ── 로그인 ↔ 회원가입 화면 전환 ────────────────────────────── */
    var paneIn = document.getElementById("loginPaneIn");
    var paneUp = document.getElementById("loginPaneUp");
    var paneSent = document.getElementById("loginPaneSent");
    var paneFind = document.getElementById("loginPaneFind");
    /* 화면은 넷이다 — "in" 로그인 · "up" 회원가입 · "sent" 인증 링크 안내 · "find" 비밀번호 찾기 */
    function 화면(어느쪽) {
      if (!paneIn || !paneUp) return;
      paneIn.hidden = (어느쪽 !== "in");
      paneUp.hidden = (어느쪽 !== "up");
      if (paneSent) paneSent.hidden = (어느쪽 !== "sent");
      if (paneFind) paneFind.hidden = (어느쪽 !== "find");
      알림("loginError", "");            // 화면을 바꾸면 이전 오류는 지운다
      알림("signupError", "");
      알림("sentError", "");
      알림("findError", "");
      var 첫칸 = { up: "signupName", sent: "goSigninFromSent", find: "findEmail" }[어느쪽] || "loginEmail";
      var f = document.getElementById(첫칸);
      if (f) f.focus();
    }
    var _up = document.getElementById("goSignup");
    if (_up) _up.addEventListener("click", function () { 화면("up"); });
    var _in = document.getElementById("goSignin");
    if (_in) _in.addEventListener("click", function () { 화면("in"); });

    /* 창을 열 때 지난 입력을 지운다 (openLogin 이 부른다).
       ⚠ 「로그인 상태 유지」는 **저장된 설정**이라 건드리지 않는다 —
          form.reset() 을 쓰면 그것까지 꺼져 사용자의 선택이 사라진다.
       ⚠ 회원가입은 동의 체크도 풀어야 한다. 안 그러면 입력칸만 비고 동의는 남아
          [회원가입] 이 눌리는 상태가 된다. 동의블록의 비우기() 가 버튼도 다시 잠근다. */
    _창비우기 = function () {
      화면("in");                                  // 늘 로그인 화면부터
      ["loginEmail", "loginPw", "signupName", "signupEmail", "signupPw",
       "findEmail", "resetPw", "resetPw2"].forEach(function (id) {
        var e = document.getElementById(id); if (e) e.value = "";
      });
      ["loginError", "signupError", "signupEmailError", "sentError", "findError"]
        .forEach(function (id) { 알림(id, ""); });
      if (가입동의) 가입동의.비우기();
    };

    /* 밖에서 로그인 창을 여는 유일한 통로. 랜딩(index.html)의 「로그인」·「회원가입」이 쓴다.
       openLogin 과 화면() 이 서로 다른 범위에 있어서, 둘을 함께 아는 여기서만 묶을 수 있다. */
    WE.auth.openAuth = function (어느쪽) {
      if (WE.authmodal) WE.authmodal.ensure();   // 랜딩은 스크립트 순서상 아직 안 꽂혔을 수 있다
      openLogin("");
      화면(어느쪽 === "signup" ? "up" : "in");
    };

    /* 랜딩(index.html)의 「로그인」·「회원가입」에서 넘어온 경우 — ?auth=login / ?auth=signup.
       랜딩에는 인증 스크립트를 안 싣는다(auth.js 77KB + Supabase SDK 207KB). 첫 화면 속도를
       그만큼 깎을 이유가 없어서, 여기 와서 해당 화면을 여는 방식으로 뒀다.

       ⚠ **세션 복원이 끝난 뒤에** 판단한다. 이미 로그인해 둔 사람에게 로그인 창을 띄우면 안 되는데,
          DOMContentLoaded 시점에는 user() 가 아직 비어 있다.
       ⚠ 주소는 조건 없이 지운다. 남겨두면 새로고침할 때마다 다시 뜬다(?error= 처리와 같은 이유). */
    var 요청화면 = null;
    try { 요청화면 = new URLSearchParams(location.search).get("auth"); } catch (e) { 요청화면 = null; }
    if (요청화면 === "login" || 요청화면 === "signup") {
      try {
        var _u = new URL(location.href);
        _u.searchParams.delete("auth");
        history.replaceState(null, "", _u.pathname + _u.search + _u.hash);
      } catch (e) { /* 주소 정리는 실패해도 동작에 지장 없다 */ }
      var 열었나 = false;
      var 요청대로열기 = function () {
        if (열었나 || !WE.auth.ready()) return;
        열었나 = true;
        if (!WE.auth._usable()) return;   // 출시 전에는 로그인이 아예 없다
        if (WE.auth.user()) return;       // 이미 로그인해 둔 사람에게는 안 띄운다
        WE.auth.openAuth(요청화면);
      };
      if (WE.auth.ready()) 요청대로열기();
      else WE.auth.onChange(요청대로열기);
    }

    /* ── 회원가입 ───────────────────────────────────────────────
       필수 동의를 다 체크해야 [회원가입] 이 눌린다. */
    var 가입동의 = null;
    var 가입버튼 = document.getElementById("signupSubmit");
    var 가입root = document.querySelector('[data-consent="signup"]');
    if (가입root) {
      가입동의 = 동의블록(가입root, function () {
        if (가입버튼) 가입버튼.disabled = !가입동의.ok();
      });
    }

    var sf = document.getElementById("signupForm");
    if (sf) sf.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var 이름 = (document.getElementById("signupName").value || "").trim();
      var 메일 = (document.getElementById("signupEmail").value || "").trim();
      var 비번 = document.getElementById("signupPw").value || "";
      // 지난번 오류를 먼저 지운다 — 위쪽 알림줄과 칸 아래 오류가 겹쳐 남으면 안 된다
      알림("signupError", "");
      칸오류("signupEmail", "signupEmailError", "");
      // 서버에 보내기 전에 여기서 거른다 — 왕복 한 번을 아끼고 안내도 우리말로 나간다
      if (!이름) { 알림("signupError", "이름을 입력해 주세요."); return; }
      if (!이메일형식(메일)) { 알림("signupError", "이메일 주소를 확인해 주세요."); return; }
      if (비번.length < 6) { 알림("signupError", "비밀번호는 6자 이상이어야 합니다."); return; }
      if (!가입동의 || !가입동의.ok()) { 알림("signupError", "필수 항목에 동의해 주세요."); return; }

      가입버튼.disabled = true;
      가입버튼.textContent = 문구("가입하는 중…");
      WE.auth.signUpEmail({ name: 이름, email: 메일, password: 비번, marketing: 가입동의.marketing() },
        function (err, 상태, 칸) {
          가입버튼.disabled = false;
          가입버튼.textContent = 문구("회원가입");
          if (err) {
            // 어느 칸의 문제인지 알면 그 칸 아래에 붙인다. 아니면 위쪽 알림줄에.
            if (칸 === "email") 칸오류("signupEmail", "signupEmailError", err);
            else 알림("signupError", err);
            return;
          }
          if (상태 === "메일확인") {
            // 세션이 아직 없다. 메일의 링크를 눌러야 로그인된다.
            // 어느 주소로 보냈는지 보여준다 — 오타로 못 받는 경우가 가장 흔하다.
            var 보낸곳 = document.getElementById("sentMail");
            if (보낸곳) { 보낸곳.textContent = 메일; 보낸곳.classList.remove("is-error"); }
            _확인용비번 = 비번;   // [로그인] 을 누를 때 인증 여부를 확인하는 데 쓴다
            화면("sent");
            return;
          }
          closeLogin();
        });
    });

    /* ── 인증 링크 안내 화면 ─────────────────────────────────────

       이 화면의 [로그인] 은 '인증이 끝났는지 확인해서 들어간다' 는 뜻이다.
       Supabase 에는 세션 없이 "이 메일이 인증됐나" 를 묻는 공개 API 가 없다 —
       있으면 남의 가입 여부를 아무나 알아낼 수 있기 때문이다.
       그래서 방금 입력한 비밀번호로 다시 로그인해 보는 것이 유일한 확인 방법이다.

       ⚠ 비밀번호는 메모리에만 둔다. localStorage 에 넣으면 브라우저를 닫아도 남는다.
          새로고침하면 사라지고, 그때는 로그인 화면으로 보내 다시 입력받는다. */
    var _확인용비번 = "";

    var _in2 = document.getElementById("goSigninFromSent");
    if (_in2) _in2.addEventListener("click", function () {
      var 보낸곳 = document.getElementById("sentMail");
      var 메일 = ((보낸곳 && 보낸곳.textContent) || "").trim();

      // 비밀번호를 모르면(새로고침 등) 확인할 방법이 없다 — 로그인 화면에서 다시 받는다
      if (!메일 || !_확인용비번) {
        화면("in");
        var le = document.getElementById("loginEmail");
        if (le && 메일) le.value = 메일;   // 이메일은 채워 준다 — 두 번 치게 하지 않는다
        var lp = document.getElementById("loginPw");
        if (lp) lp.focus();
        return;
      }

      _in2.disabled = true;
      _in2.textContent = 문구("확인하는 중…");
      WE.auth.signInEmail(메일, _확인용비번, function (err, 상태) {
        _in2.disabled = false;
        _in2.textContent = 문구("로그인");
        if (상태 === "미인증") {
          if (보낸곳) 보낸곳.classList.add("is-error");
          알림("sentError", "이메일 인증이 아직 완료되지 않았습니다. 메일함을 확인해 주세요.");
          return;
        }
        if (err) { 알림("sentError", err); return; }
        _확인용비번 = "";                 // 들어갔으면 곧바로 지운다
        // 성공하면 onChange 가 모달을 닫는다
      });
    });

    var 재발송 = document.getElementById("resendMail");
    if (재발송) 재발송.addEventListener("click", function () {
      var 보낸곳 = document.getElementById("sentMail");
      var 메일 = ((보낸곳 && 보낸곳.textContent) || "").trim();
      if (!메일) return;
      재발송.disabled = true;
      WE.auth.resendConfirm(메일, function (err) {
        재발송.disabled = false;
        if (err) { 알림("sentError", err); return; }
        알림("sentError", "확인 메일을 다시 보냈습니다. 받은 편지함을 확인해 주세요.", true);
      });
    });

    /* ── 이메일 로그인 ─────────────────────────────────────────── */
    var lf = document.getElementById("loginEmailForm");
    if (lf) lf.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var 메일 = (document.getElementById("loginEmail").value || "").trim();
      var 비번 = document.getElementById("loginPw").value || "";
      if (!메일 || !비번) { 알림("loginError", "이메일과 비밀번호를 입력해 주세요."); return; }
      var sb = document.getElementById("loginSubmit");
      sb.disabled = true; sb.textContent = 문구("로그인 중…");
      WE.auth.signInEmail(메일, 비번, function (err, 상태) {
        sb.disabled = false; sb.textContent = 문구("로그인");
        if (상태 === "미인증") {
          /* 빨간 줄 한 줄로 알리면 사용자는 '그래서 뭘 하라고?' 가 된다.
             인증 안내 화면으로 보내면 [이메일 다시 보내기] 를 그 자리에서 누를 수 있다.
             화면은 그대로 두고 이메일 칸을 붉게 + 아래에 경고를 띄운다 (미리캔버스와 같은 방식). */
          var 보낸곳 = document.getElementById("sentMail");
          if (보낸곳) { 보낸곳.textContent = 메일; 보낸곳.classList.add("is-error"); }
          _확인용비번 = 비번;   // 메일 확인을 마친 뒤 [로그인] 으로 바로 들어갈 수 있게
          화면("sent");   // 화면() 이 알림을 지우므로 경고는 그 뒤에 띄운다
          알림("sentError", "이메일 인증이 아직 완료되지 않았습니다. 메일함을 확인해 주세요.");
          return;
        }
        if (err) { 알림("loginError", err); return; }
        // 성공하면 onChange 가 모달을 닫는다
      });
    });

    /* ── 비밀번호 찾기 ─────────────────────────────────────────── */
    var _find = document.getElementById("goFind");
    if (_find) _find.addEventListener("click", function () {
      화면("find");
      // 로그인 화면에 이미 적어 둔 주소가 있으면 옮겨 준다 — 두 번 치게 하지 않는다
      var le = document.getElementById("loginEmail");
      var fe = document.getElementById("findEmail");
      if (le && fe && le.value) fe.value = le.value;
    });
    var _findBack = document.getElementById("goSigninFromFind");
    if (_findBack) _findBack.addEventListener("click", function () { 화면("in"); });

    var ff = document.getElementById("findForm");
    if (ff) ff.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var 메일 = (document.getElementById("findEmail").value || "").trim();
      if (!이메일형식(메일)) {
        알림("findError", "이메일 주소를 확인해 주세요."); return;
      }
      var fb = document.getElementById("findSubmit");
      fb.disabled = true; fb.textContent = 문구("보내는 중…");
      WE.auth.resetPassword(메일, function (err) {
        fb.disabled = false; fb.textContent = 문구("재설정 링크 받기");
        if (err) { 알림("findError", err); return; }
        /* ⚠ "보냈습니다" 가 아니라 "가입된 주소라면 보냈습니다" 다.
           단정하면 그 주소가 가입돼 있는지를 알려 주는 꼴이 된다. */
        알림("findError", "가입된 주소라면 재설정 링크를 보냈습니다. 메일함을 확인해 주세요.", true);
      });
    });

    /* ── 새 비밀번호 설정 ──────────────────────────────────────── */
    function 재설정모달() { return document.getElementById("resetModal"); }
    function 재설정열기() { var rm = 재설정모달(); if (rm) rm.hidden = false; }
    function 재설정닫기() { var rm = 재설정모달(); if (rm) rm.hidden = true; }

    var rf = document.getElementById("resetForm");
    if (rf) rf.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var p1 = document.getElementById("resetPw").value || "";
      var p2 = document.getElementById("resetPw2").value || "";
      if (p1.length < 6) { 알림("resetError", "비밀번호는 6자 이상이어야 합니다."); return; }
      if (p1 !== p2) { 알림("resetError", "두 비밀번호가 다릅니다."); return; }
      var rb = document.getElementById("resetGo");
      rb.disabled = true; rb.textContent = 문구("바꾸는 중…");
      WE.auth.updatePassword(p1, function (err) {
        rb.disabled = false; rb.textContent = 문구("비밀번호 바꾸기");
        if (err) { 알림("resetError", err); return; }
        재설정닫기();
        if (WE.app && WE.app.notice) {
          WE.app.notice(문구("비밀번호를 바꿨습니다"),
                        문구("새 비밀번호로 로그인되어 있습니다."));
        }
      });
    });

    /* ── 동의 모달 (소셜로 처음 들어온 사람) ──────────────────────
       닫기가 없다 — 동의하지 않으면 서비스를 쓸 수 없어서,
       그냥 닫으면 "로그인은 됐는데 아무것도 안 되는" 상태가 된다. */
    var 모달동의 = null;
    var 동의버튼 = document.getElementById("consentOk");
    var 동의root = document.querySelector('[data-consent="modal"]');
    if (동의root) {
      모달동의 = 동의블록(동의root, function () {
        if (동의버튼) 동의버튼.disabled = !모달동의.ok();
      });
    }
    function 동의모달() { return document.getElementById("consentModal"); }
    function 닫기동의() { var cm = 동의모달(); if (cm) cm.hidden = true; }
    function 열기동의() {
      var cm = 동의모달(); if (!cm || !cm.hidden) return;
      알림("consentError", "");
      if (모달동의) 모달동의.비우기();
      cm.hidden = false;
    }
    /* 동의가 필요한 상태인가를 매번 다시 판단한다.
       needsConsent() 는 조회가 '확인됨' 일 때만 참이라,
       인터넷이 끊긴 동안 잘못 뜨지 않는다. */
    function 동의확인() {
      if (!WE.auth.needsConsent()) { 닫기동의(); return; }
      /* 가입 폼에서 이미 동의를 받았으면 그 값으로 조용히 기록한다.
         메일 확인을 거치면 세션이 나중에 생겨서 가입 시점에는 서버에 못 남긴다 —
         그렇다고 여기서 또 물으면 사용자는 같은 동의를 두 번 하게 된다.
         소셜 로그인은 폼이 없으므로 null 이 나오고, 그때만 화면으로 받는다. */
      var 폼동의 = WE.auth.signupConsent();
      if (폼동의) {
        WE.auth.recordConsent(폼동의.marketing, function (err) {
          if (err) 열기동의();   // 자동 기록이 실패하면 그때는 화면으로 받는다
          else 닫기동의();
        });
        return;
      }
      열기동의();
    }

    /* ── 인증 완료 안내 ────────────────────────────────────────
       메일의 링크를 눌러 돌아왔을 때 한 번 보여준다.
       이게 없으면 링크를 눌러도 에디터만 떠서 뭐가 된 건지 알 수 없다. */
    function 열기인증완료() {
      var vm = document.getElementById("verifiedModal");
      if (vm) vm.hidden = false;
    }
    var _vok = document.getElementById("verifiedOk");
    if (_vok) _vok.addEventListener("click", function () {
      var vm = document.getElementById("verifiedModal");
      if (vm) vm.hidden = true;
    });

    /* ── 회원 탈퇴 ─────────────────────────────────────────────
       약관 제9조에 "언제든지 탈퇴할 수 있다" 고 써 놓고 기능이 없었다.
       설정 맨 아래에 조용히 두고, 되돌릴 수 없으므로 체크를 한 번 거치게 한다. */
    function 탈퇴모달() { return document.getElementById("deleteAccountModal"); }
    function 탈퇴닫기() {
      var dm = 탈퇴모달(); if (dm) dm.hidden = true;
      var c = document.getElementById("delConfirm");
      var g = document.getElementById("delGo");
      if (c) c.checked = false;             // 다음에 열 때 체크가 남아 있으면 안 된다
      if (g) { g.disabled = true; g.textContent = 문구("탈퇴하기"); }
      알림("delError", "");
    }
    function 탈퇴열기() {
      var dm = 탈퇴모달(); if (!dm) return;
      탈퇴닫기();                            // 상태를 먼저 비우고
      dm.hidden = false;
    }

    var _del = document.getElementById("btnDeleteAccount");
    if (_del) _del.addEventListener("click", function () {
      var sm = document.getElementById("settingsModal");
      if (sm) sm.hidden = true;             // 설정 위에 겹치지 않게 닫는다
      탈퇴열기();
    });

    var _delC = document.getElementById("delConfirm");
    var _delGo = document.getElementById("delGo");
    if (_delC) _delC.addEventListener("change", function () {
      if (_delGo) _delGo.disabled = !_delC.checked;
    });
    var _delX = document.getElementById("delCancel");
    if (_delX) _delX.addEventListener("click", 탈퇴닫기);

    if (_delGo) _delGo.addEventListener("click", function () {
      if (!_delC || !_delC.checked) return;
      _delGo.disabled = true;
      _delGo.textContent = 문구("처리하는 중…");
      WE.auth.deleteAccount(function (err) {
        if (err) {
          _delGo.disabled = false;
          _delGo.textContent = 문구("탈퇴하기");
          알림("delError", err);
          return;
        }
        탈퇴닫기();
        // 도면은 그대로 남는다 — 그 점을 분명히 알려 준다
        if (WE.app && WE.app.notice) {
          WE.app.notice(문구("탈퇴가 완료되었습니다"),
                        문구("계정이 삭제되었습니다. 이 브라우저의 배선도는 그대로 남아 있으며 계속 사용하실 수 있습니다."));
        }
      });
    });

    if (동의버튼) 동의버튼.addEventListener("click", function () {
      if (!모달동의 || !모달동의.ok()) return;
      동의버튼.disabled = true;
      동의버튼.textContent = 문구("저장하는 중…");
      WE.auth.recordConsent(모달동의.marketing(), function (err) {
        동의버튼.disabled = false;
        동의버튼.textContent = 문구("동의하고 시작하기");
        if (err) { 알림("consentError", err); return; }
        닫기동의();
      });
    });
    var 동의취소 = document.getElementById("consentCancel");
    if (동의취소) 동의취소.addEventListener("click", function () {
      닫기동의();
      WE.auth.signOut();   // 동의 없이는 쓸 수 없으므로 로그인 상태를 남기지 않는다
    });

    /* 「로그인 상태 유지」 — 켜고 끄는 즉시 지금 세션을 옮긴다.
       버튼을 누르기 전에 값이 정해져 있어야 소셜 로그인에도 적용된다
       (저장소는 세션을 쓰는 시점에 이 값을 읽는다). */
    var _유지 = document.getElementById("loginKeep");
    if (_유지) {
      _유지.checked = WE.auth.keepLogin();
      _유지.addEventListener("change", function () { WE.auth.setKeepLogin(_유지.checked); });
    }

    var b = el(); if (!b) return;
    b.addEventListener("click", function (e) {
      e.stopPropagation();                       // 아래 바깥클릭 감시가 곧바로 닫지 않게
      if (!WE.auth.user()) { openLogin(""); return; }
      if (메뉴열림()) 메뉴닫기(); else 메뉴열기();
    });

    /* 메뉴 항목 — 앱 메뉴(☰)와 같은 방식으로 닫는다:
       항목 클릭 / 바깥 클릭 / Esc */
    /* 미리보기 표시(?launch=1)를 넘겨준다.
       account.html 도 auth.js 를 싣는데, LAUNCH 가 꺼져 있으면 로그인이 아예 없다. */
    function 표시() {
      return /[?&]launch=1(&|$)/.test(String(location.search || "")) ? "?launch=1" : "";
    }

    var _내계정 = document.getElementById("acctAccount");
    if (_내계정) _내계정.addEventListener("click", function () {
      메뉴닫기();
      /* 새 탭으로 연다 — 도면 작업 중에 누르는 자리라 화면을 덮으면 안 된다.
         예전에는 설정 모달을 열었다. 설정은 「에디터 환경설정」이라
         자동저장 주기 옆에 계정이 얹히는 꼴이었다.

         ⚠ noopener 를 주면 안 된다. 「로그인 상태 유지」를 끈 상태(기본)에서는
            세션이 sessionStorage 에 있는데, noopener 를 주면 브라우저가
            그것을 새 탭에 물려주지 않아 「로그인이 필요합니다」가 뜬다.
            (실측: noopener 있으면 null, 없으면 물려받는다)
            우리 같은 오리진 페이지라 noopener 로 막을 위험도 없다. */
      window.open("account.html" + 표시(), "_blank");
    });

    var _요금제 = document.getElementById("acctPricing");
    if (_요금제) _요금제.addEventListener("click", function () {
      메뉴닫기();
      // 새 탭으로 연다 — 작업 중인 도면 위에서 페이지를 갈아치우지 않는다
      window.open("pricing.html", "_blank", "noopener");
    });

    var _나가기 = document.getElementById("acctOut");
    if (_나가기) _나가기.addEventListener("click", function () {
      /* 예전에는 confirm 으로 한 번 더 물었다. 이제는 메뉴를 열어
         「로그아웃」을 고르는 것 자체가 한 단계라 다시 묻지 않는다. */
      메뉴닫기();
      WE.auth.signOut();
    });

    document.addEventListener("pointerdown", function (e) {
      if (메뉴열림() && !e.target.closest("#acctWrap")) 메뉴닫기();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && 메뉴열림()) 메뉴닫기();
    });
    WE.auth.onChange(function () {
      paint();
      if (WE.auth.user()) closeLogin();   // 로그인되면 모달은 볼 일이 없다
      동의확인();                          // 동의를 아직 안 받았으면 동의 화면을 띄운다
      // 메일 확인 링크를 눌러 돌아왔으면 한 번 알려준다 (consumedSignup 은 한 번만 참)
      if (WE.auth.user() && WE.auth.consumedSignup()) 열기인증완료();
      // 재설정 링크로 돌아왔으면 새 비밀번호를 받는다 (임시로 로그인된 상태다)
      if (WE.auth.user() && WE.auth.consumedRecovery()) 재설정열기();
    });
    // 미리보기의 Pro 전환 버튼이 상태를 바꾼 뒤 이걸 불러 다시 그린다
    WE.ui = WE.ui || {};
    WE.ui.repaintAccount = paint;
    /* 검사 전용 통로 — 칸 아래 오류가 **실제로 글자를 뿌리는지** 재려고 연다.
       이 함수는 매개변수 이름 하나 때문에 조용히 터진 적이 있다(2026-09-11).
       화면을 통째로 몰지 않고 이 함수만 직접 불러야 그 결함을 정확히 잡는다. */
    WE.ui.칸오류 = 칸오류;
    paint();
  });
})();
