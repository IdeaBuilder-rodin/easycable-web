/* libsync.js — 라이브러리 부품을 서버로 자동 전송 (2026-09-14)

   무엇 — 사용자가 라이브러리에 부품을 추가·수정·삭제하면(library.save 가 돌면) 30초 조용한 뒤
          바뀐 부품만 Edge Function library-sync 로 보낸다. 사용자가 하는 일은 없다. 버튼도 설정도 없다.
   왜   — 어떤 부품을 쓰는지 알아야 공용 부품을 뭘 먼저 등록할지 정하고, 사용자가 만든 이미지·단자 배치를
          그대로 가져오면 등록 시간이 준다(고원빈). 관리자 페이지 「사용자 부품」 탭에서 본다.
   누구 — 로그인 없이도. 브라우저마다 기기 ID(localStorage we_device_id). 로그인해 있으면 supabase-js 가
          토큰을 같이 보내 서버가 계정을 붙인다.

   ★★ 최우선 원칙 — 에디터에 문제가 생기면 안 된다 (고원빈, 2026-09-14). 그래서:
     · 저장 경로를 건드리지 않는다. library.save() 가 끝난 뒤 touch() 로 타이머 하나만 건다.
       라이브러리 데이터 형식·저장 키는 변경 없음.
     · 이 파일 안의 모든 것은 try/catch 안에 있고 비동기다. 무슨 일이 나도 밖으로 안 나간다.
       콘솔에는 warn 만 — 검사가 error 를 잡는다.
     · 바쁠 때 안 한다: 저장 후 30초 디바운스 · requestIdleCallback · 한 번에 ~2.5MB 이하 · 큐는 하나(겹쳐 안 보냄).
     · 끄는 길 둘: flags.js LIBSYNC=false(배포로) · 서버가 { off:true } 를 주면 24시간 멈춤(배포 없이).
     · 서버가 거절(4xx/5xx)하면 조용히 포기하고 다음 저장 때 다시. 429 면 60초 뒤 이어서.
     · 첫 동기화는 앱이 다 뜬 뒤 60초 후에만.

   무엇을 보내나 — 부품 정보(이름·스펙·링크·단가·역할·전기값·단자·배치 큐·크기·폴더 이름·링크형 데이터시트·공용 출처)
          + 이미지(data:, 300KB 이하). 파일형 데이터시트(PDF)는 뺀다(고원빈 확정). 이미지는 바뀌었을 때만 다시 보낸다.
   "같은 부품" 판정은 서버·관리자 화면이 rev(내용 해시)로 한다 — 내용이 하나라도 다르면 다른 부품(고원빈). */
var WE = window.WE || {};
window.WE = WE;

WE.libsync = (function () {
  "use strict";
  var DEVICE_KEY = "we_device_id", STATE_KEY = "we_libsync_state";
  var DEBOUNCE_MS = 30 * 1000, FIRST_DELAY_MS = 60 * 1000, RECHECK_MS = 7 * 24 * 3600 * 1000;
  var OFF_MS = 24 * 3600 * 1000, RETRY_429_MS = 60 * 1000;
  var MAX_IMAGE_CHARS = 400 * 1024;     // data: 문자열 기준(≈ 300KB 바이트) — 서버 상한과 맞춤
  var BATCH_MAX = 25, BATCH_CHARS = 2.5 * 1024 * 1024;
  var APP_VERSION = "2026-09-14";
  var timer = null, running = false, state = null;

  function warn() { try { console.warn.apply(console, ["[libsync]"].concat([].slice.call(arguments))); } catch (e) { /* 무시 */ } }
  function enabled() {
    try { return !(WE.flags && WE.flags.LIBSYNC === false); } catch (e) { return false; }
  }
  function client() {
    try { return WE.auth && WE.auth._client ? WE.auth._client() : null; } catch (e) { return null; }
  }
  function uuid() {
    try { if (window.crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (e) { /* 아래로 */ }
    var s = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx";
    return s.replace(/[xy]/g, function (c) { var r = Math.random() * 16 | 0; return (c === "x" ? r : (r & 3 | 8)).toString(16); });
  }
  function deviceId() {
    try {
      var id = localStorage.getItem(DEVICE_KEY);
      if (!id || !/^[0-9a-f-]{36}$/i.test(id)) { id = uuid(); localStorage.setItem(DEVICE_KEY, id); }
      return id;
    } catch (e) { return null; }   // localStorage 를 못 쓰는 환경 — 그냥 안 보낸다
  }
  function loadState() {
    if (state) return state;
    try { state = JSON.parse(localStorage.getItem(STATE_KEY) || "null"); } catch (e) { state = null; }
    if (!state || typeof state !== "object") state = { rev: {}, img: {}, offUntil: 0, lastRun: 0 };
    state.rev = state.rev || {}; state.img = state.img || {};
    return state;
  }
  function saveState() { try { localStorage.setItem(STATE_KEY, JSON.stringify(state)); } catch (e) { /* 무시 */ } }

  // FNV-1a 32비트 — 빠르고 의존 없음. 8자리 hex.
  function fnv(str) {
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0; }
    return ("0000000" + h.toString(16)).slice(-8);
  }

  /* 보낼 부품 정보 — 라이브러리 부품에서 필요한 것만 뽑는다. 이미지·파일 데이터시트는 여기 없다. */
  var FIELDS = ["name", "spec", "link", "linkKr", "linkPref", "price", "priceKr",
                "role", "volt", "current", "power", "capacityAh", "dod", "minPerHour", "efficiency",
                "terminals", "terminalPlacementQueue", "terminalPlacementQueueVersion",
                "defaultWidth", "defaultHeight", "nameLabelPos", "publicId", "publicVersion", "createdAt"];
  function partData(p) {
    var out = {};
    FIELDS.forEach(function (k) { if (p[k] !== undefined && p[k] !== null && p[k] !== "") out[k] = p[k]; });
    try { var f = p.folderId && WE.library.getFolder ? WE.library.getFolder(p.folderId) : null; if (f && f.name) out.folder = f.name; } catch (e) { /* 무시 */ }
    out.datasheets = (p.datasheets || []).filter(function (d) { return d && d.type === "link" && typeof d.data === "string"; })
      .map(function (d) { return { name: d.name || "", type: "link", data: d.data }; });
    return out;
  }
  function imageOf(p) {
    var im = p.image;
    if (typeof im !== "string" || im.indexOf("data:image/") !== 0 || im.length > MAX_IMAGE_CHARS) return null;
    return im;
  }

  /* 지금 라이브러리와 마지막 전송 상태를 비교해 보낼 것을 만든다 */
  function diff() {
    var st = loadState(), parts = [], seen = {};
    var all = (WE.library && WE.library.getAll) ? WE.library.getAll() : [];
    var upserts = [];
    all.forEach(function (p) {
      if (!p || !p.id) return;
      seen[p.id] = 1;
      var data = partData(p), im = imageOf(p);
      var imgHash = im ? fnv(im) : "0";
      var rev = fnv(JSON.stringify(data)) + imgHash;      // 내용이 하나라도 다르면 다른 rev
      if (st.rev[p.id] === rev) return;                    // 마지막에 보낸 그대로
      upserts.push({ id: p.id, rev: rev, part: data, image: (im && st.img[p.id] !== imgHash) ? im : null, _img: imgHash });
    });
    var deletes = Object.keys(st.rev).filter(function (id) { return !seen[id]; });
    return { upserts: upserts, deletes: deletes };
  }

  /* 한 묶음 보내기. 결과에 따라 상태를 적는다. resolve 값: "ok" | "off" | "rate" | "fail" */
  function send(batch) {
    var c = client(); if (!c || !c.functions) return Promise.resolve("fail");
    var did = deviceId(); if (!did) return Promise.resolve("fail");
    var body = { deviceId: did, appVersion: APP_VERSION,
                 upserts: batch.upserts.map(function (u) { return { id: u.id, rev: u.rev, part: u.part, image: u.image }; }),
                 deletes: batch.deletes };
    return c.functions.invoke("library-sync", { body: body }).then(function (res) {
      if (res && res.error) {
        var status = res.error.context && res.error.context.status;
        if (status === 429) return "rate";
        warn("서버 응답 오류", status || res.error.message);
        return "fail";
      }
      var d = res && res.data;
      if (!d) return "fail";
      if (d.off) { loadState().offUntil = Date.now() + OFF_MS; saveState(); return "off"; }
      if (!d.ok) return "fail";
      var st = loadState(), okIds = {};
      (d.synced || []).forEach(function (id) { okIds[id] = 1; });
      batch.upserts.forEach(function (u) { if (okIds[u.id]) { st.rev[u.id] = u.rev; st.img[u.id] = u._img; } });
      (d.deleted || []).forEach(function (id) { delete st.rev[id]; delete st.img[id]; });
      st.lastRun = Date.now(); saveState();
      return "ok";
    }).catch(function (e) { warn("전송 실패", e && e.message); return "fail"; });
  }

  /* 전체 실행 — 바뀐 것을 묶음으로 나눠 차례로 보낸다. 겹쳐 돌지 않는다. */
  function run() {
    if (running) return Promise.resolve("busy");
    running = true;
    return new Promise(function (resolve) {
      try {
        if (!enabled()) return resolve("disabled");
        if (navigator.onLine === false) return resolve("offline");
        var st = loadState();
        if (st.offUntil && st.offUntil > Date.now()) return resolve("off");
        var d = diff();
        if (!d.upserts.length && !d.deletes.length) { st.lastRun = Date.now(); saveState(); return resolve("nothing"); }
        // 묶음 나누기 — 개수·크기 상한
        var batches = [], cur = { upserts: [], deletes: d.deletes.slice(0, 200) }, size = 0;
        d.upserts.forEach(function (u) {
          var n = JSON.stringify(u.part).length + (u.image ? u.image.length : 0);
          if (cur.upserts.length >= BATCH_MAX || (size + n > BATCH_CHARS && cur.upserts.length)) { batches.push(cur); cur = { upserts: [], deletes: [] }; size = 0; }
          cur.upserts.push(u); size += n;
        });
        batches.push(cur);
        var i = 0;
        (function next() {
          if (i >= batches.length) return resolve("ok");
          send(batches[i++]).then(function (r) {
            if (r === "ok") return next();
            if (r === "rate") { setTimeout(function () { running = false; touch(RETRY_429_MS); }, 0); return resolve("rate"); }
            resolve(r);   // off / fail — 여기서 멈추고 다음 저장 때 다시
          });
        })();
      } catch (e) { warn("실행 오류", e && e.message); resolve("fail"); }
    }).then(function (r) { running = false; return r; }, function () { running = false; return "fail"; });
  }

  /* 라이브러리가 저장될 때마다 불린다(library.js). 30초 조용하면 한 번 돈다. */
  function touch(delayMs) {
    try {
      if (!enabled()) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () {
        timer = null;
        var go = function () { run(); };
        if (window.requestIdleCallback) requestIdleCallback(go, { timeout: 5000 }); else go();
      }, delayMs || DEBOUNCE_MS);
    } catch (e) { warn("예약 실패", e && e.message); }
  }

  /* 앱이 다 뜬 뒤 60초 — 7일 넘게 안 보냈으면 한 번 확인(대개 0건) */
  try {
    document.addEventListener("DOMContentLoaded", function () {
      setTimeout(function () {
        try { var st = loadState(); if (!st.lastRun || Date.now() - st.lastRun > RECHECK_MS) touch(1000); } catch (e) { /* 무시 */ }
      }, FIRST_DELAY_MS);
    });
  } catch (e) { /* 무시 */ }

  return {
    touch: touch,
    // 검사용 — 디바운스 없이 지금 돌리고 결과("ok"|"nothing"|"off"|"rate"|"fail"|…)를 준다
    _테스트_지금: function () { return run(); },
    _테스트_상태: function () { return JSON.parse(JSON.stringify(loadState())); },
    _테스트_초기화: function () { state = null; try { localStorage.removeItem(STATE_KEY); } catch (e) { /* 무시 */ } },
    _테스트_차이: diff
  };
})();
