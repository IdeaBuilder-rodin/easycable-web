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
    if (!client || !_user) { _profile = null; if (done) done(); return; }
    var seq = ++_reqSeq;            // 이번 요청의 일련번호
    var who = _user.id;             // 누구의 프로필을 묻는가

    // 응답을 반영해도 되는 상황인가 —
    // 더 최신 요청이 생겼거나, 로그아웃했거나, 계정이 바뀌었으면 무시한다.
    function 유효한가() { return seq === _reqSeq && _user && _user.id === who; }

    client.from("profiles").select("plan, expires_at, source").single()
      .then(function (res) {
        if (!유효한가()) { if (done) done(); return; }
        _profile = res.error ? null : res.data;
        if (done) done();
      })
      .catch(function () {
        if (!유효한가()) { if (done) done(); return; }
        _profile = null; if (done) done();
      });
  }

  function applySession(session, done) {
    _user = session ? session.user : null;
    loadProfile(function () { _ready = true; notify(); if (done) done(); });
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
    client.auth.signOut().then(function () {
      _user = null; _profile = null; notify();
    });
  }

  function user() { return _user; }

  /* Pro 판정 — 이 한 곳에서만 정한다.
     만료일이 지났으면 plan 이 'pro' 여도 무료로 본다.
     → 해지·결제실패로 웹훅이 늦어도 자동으로 무료로 떨어진다. */
  function isPro() {
    // 로그아웃 상태면 무조건 무료다.
    // _profile 만 보면 늦게 도착한 응답이나 정리 순서 때문에
    // 로그아웃했는데 Pro 로 남을 수 있다.
    if (!_user) return false;
    if (!_profile || _profile.plan !== "pro") return false;
    if (!_profile.expires_at) return true;              // 만료 없음(수동 부여 등)
    return new Date(_profile.expires_at) > new Date();
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
    user: user,
    profile: profile,
    ready: ready,
    isPro: isPro,
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
