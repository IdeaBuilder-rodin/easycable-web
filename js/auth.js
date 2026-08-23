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

  function 기억하기(prof) {
    try {
      if (prof && prof.plan === "pro") {
        localStorage.setItem(기억키, JSON.stringify({
          id: _user && _user.id, t: Date.now(), expires_at: prof.expires_at || null
        }));
      } else {
        기억지우기();   // 무료로 확인됐으면 기억도 지운다
      }
    } catch (e) { /* 무시 */ }
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

  /* SDK(207KB)를 필요할 때만 내려받는다.
     index.html 에 <script> 로 박아두면 출시 전에도 모든 방문자가 받게 된다.
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

    client.from("profiles").select("plan, expires_at, source").single()
      .then(function (res) {
        if (!유효한가()) { if (done) done(); return; }
        if (res.error) {
          // 조회 실패와 '무료 회원'은 다르다. 예전에는 둘 다 null 로 뭉개서,
          // 인터넷이 끊기면 돈 낸 사람이 무료로 떨어졌다.
          _조회상태 = "실패";
        } else {
          _profile = res.data;
          _조회상태 = "확인됨";
          기억하기(res.data);
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
    if (!usable()) { if (done) done(); return; }   // 출시 전에는 여기서 끝

    loadSdk(function (ok) {
      if (!ok) { if (done) done(); return; }       // SDK 를 못 받아도 앱은 돈다

      client = window.supabase.createClient(URL, KEY, {
        auth: {
          persistSession: true,       // 새로고침해도 로그인 유지
          autoRefreshToken: true,     // 토큰 만료 전에 자동 갱신
          detectSessionInUrl: true,   // 구글에서 돌아온 주소의 토큰을 알아서 처리
        },
      });

      // 로그인·로그아웃·토큰갱신이 일어날 때마다 상태를 다시 맞춘다
      client.auth.onAuthStateChange(function (_evt, session) { applySession(session); });

      client.auth.getSession()
        .then(function (res) { applySession(res.data ? res.data.session : null, done); })
        .catch(function () { if (done) done(); });
    });
  }

  /* 구글 로그인 시작. 구글 페이지로 이동했다가 이 주소로 돌아온다. */
  function signIn() {
    if (!usable() || !client) return;
    client.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: location.origin + location.pathname },
    });
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
    if (_조회상태 === "확인됨") 기억하기(_profile);
  }
  function proState() { return _조회상태; }

  function profile() { return _profile; }

  /* 최초 확인이 끝났는가. 끝나기 전에는 Pro 여부를 단정하면 안 된다. */
  function ready() { return _ready; }

  /* 상태가 바뀔 때 화면을 갱신하려는 쪽에서 등록한다 */
  function onChange(fn) { if (typeof fn === "function") _listeners.push(fn); }

  return {
    init: init,
    signIn: signIn,
    signOut: signOut,
    user: user,
    profile: profile,
    refreshProfile: refreshProfile,
    ready: ready,
    isPro: isPro,
    proConfirmed: proConfirmed,
    _테스트_상태: _테스트_상태,
    proState: proState,
    onChange: onChange,
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
  function el() { return document.getElementById("btnAccount"); }

  function label() {
    var u = WE.auth.user();
    if (!u) return WE.i18n.t("로그인");
    if (WE.auth.isPro()) return "✦ Pro";
    // 이메일 앞부분만 — 툴바가 좁아 전체를 넣으면 다른 버튼을 밀어낸다
    var name = String(u.email || "").split("@")[0];
    return name.length > 12 ? name.slice(0, 12) + "…" : name;
  }

  function paint() {
    var b = el(); if (!b) return;
    if (!WE.auth._usable()) { b.hidden = true; return; }   // 출시 전 · file:// → 숨김
    b.hidden = false;
    b.textContent = label();
    var u = WE.auth.user();
    b.title = u ? u.email + " — " + WE.i18n.t("클릭하면 로그아웃")
                : WE.i18n.t("구글 계정으로 로그인");
    b.classList.toggle("is-pro", !!u && WE.auth.isPro());
  }

  document.addEventListener("DOMContentLoaded", function () {
    var b = el(); if (!b) return;
    b.addEventListener("click", function () {
      if (!WE.auth.user()) { WE.auth.signIn(); return; }
      // 실수로 로그아웃되면 다시 구글을 거쳐야 해 번거롭다 — 한 번 묻는다
      if (window.confirm(WE.i18n.t("로그아웃할까요?"))) WE.auth.signOut();
    });
    WE.auth.onChange(paint);   // 로그인·로그아웃·프로필 갱신 때마다 다시 그린다
    // 미리보기의 Pro 전환 버튼이 상태를 바꾼 뒤 이걸 불러 다시 그린다
    WE.ui = WE.ui || {};
    WE.ui.repaintAccount = paint;
    paint();
  });
})();
