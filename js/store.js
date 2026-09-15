// store.js — IndexedDB 자동 임시저장 / 새로고침 복구
var WE = window.WE || {};
window.WE = WE;

WE.store = (function () {
  var DB = "wiringEditor", STORE = "state";
  var ASTORE = "assets";    // 첨부물(이미지·PDF) 전용 — 본문과 분리해 중복 없이 1벌만 보관
  var DB_VERSION = 2;       // 1 → 2: assets 저장소 추가
  // 자동저장 슬롯은 '문서 단위'다. 예전엔 주소(pathname)당 1개뿐이라
  // 탭 두 개로 서로 다른 도면을 그리면 3초마다 서로를 덮어썼다.
  var DRAFT_P = "draft::", SNAP_P = "snap::";
  // 옛 슬롯 키에는 주소(pathname)가 들어간다.
  // 같은 서비스라도 사람마다 들어오는 주소가 다르다 — 어떤 사람은 easycable.co.kr/ 로,
  // 어떤 사람은 /index.html 로 북마크해 두었다. 지금 주소로만 찾으면
  // 다른 주소로 쓰던 사람의 옛 자동저장본을 영영 못 찾는다.
  // (자동저장 개편이 7/29 였으므로, 그 뒤로 한 번도 안 들어온 사람이 해당된다)
  // 그래서 옛 주소들도 함께 뒤진다.
  function legacyPaths() {
    var p = location.pathname || "";
    var list = [p, "/", "/index.html"];
    /* 주소가 app.html 이면 index.html 밑도 같이 뒤진다 — 옛 자동저장본을 놓치지 않으려고.
       ⚠ 이 줄 자체는 **전부터 있었다.** file:// 로 옛 app.html 을 쓰던 사람들 때문이었다.
          2026-09-11 에 에디터가 index.html → app.html 로 바뀌면서(랜딩이 루트가 됐다)
          **대상이 지금 에디터 사용자 전체로 넓어졌다** — 그들의 옛 슬롯 키에 /index.html 이 들어 있다.
          여기서 되짚지 않으면 7/29 이전 자동저장본을 영영 못 찾는다.
       (7/29 이후 슬롯은 문서 id 로 잡히므로 주소와 무관하다 — 이 처리는 그 이전 것만 위한 것이다)
       ⚠ 점을 이스케이프한다: /app.html$/ 는 'appXhtml' 같은 것도 맞힌다. */
    if (/app\.html$/i.test(p)) list.push(p.replace(/app\.html$/i, "index.html"));
    var out = [], seen = {};
    for (var i = 0; i < list.length; i++) {
      if (list[i] && !seen[list[i]]) { seen[list[i]] = 1; out.push(list[i]); }
    }
    return out;
  }

  var db = null;
  var lastJson = "";
  var timer = null;
  var _lastSaveTs = 0;   // 마지막으로 내용이 바뀌어 기록된 시각 (PDF 작성일에 사용)

  function init(cb) {
    try {
      var req = indexedDB.open(DB, DB_VERSION);
      req.onupgradeneeded = function (e) {
        var d = e.target.result;
        if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE);
        if (!d.objectStoreNames.contains(ASTORE)) d.createObjectStore(ASTORE);
      };
      // 다른 탭이 옛 버전으로 열어둔 상태면 업그레이드가 막힌다 → 사용자에게 알려야 원인을 안다
      req.onblocked = function () {
        alert((window.WE && WE.i18n ? WE.i18n.t("이지케이블이 다른 탭에서도 열려 있어 저장소를 갱신하지 못했습니다.") : "이지케이블이 다른 탭에서도 열려 있어 저장소를 갱신하지 못했습니다.") + "\n" + (window.WE && WE.i18n ? WE.i18n.t("다른 탭을 모두 닫고 새로고침해 주세요.") : "다른 탭을 모두 닫고 새로고침해 주세요."));
      };
      req.onsuccess = function (e) {
        db = e.target.result;
        // 다른 탭이 업그레이드를 시도하면 이 연결을 놓아준다(그 탭이 막히지 않도록)
        db.onversionchange = function () { try { db.close(); } catch (_) {} db = null; };
        cb && cb();
      };
      req.onerror = function () { db = null; cb && cb(); };
    } catch (e) { db = null; cb && cb(); }
  }

  // ---- 자산 저장소 (assets) ----
  // 성공 여부를 넘겨준다 — 실패했는데 참조만 저장되면 첨부물이 유실되므로 호출 측에서 재시도해야 한다
  function assetPutMany(items, cb) {
    if (!db) { cb && cb(false); return; }
    if (!items.length) { cb && cb(true); return; }
    try {
      var tx = db.transaction(ASTORE, "readwrite");
      var os = tx.objectStore(ASTORE);
      items.forEach(function (it) { os.put(it.val, it.key); });
      tx.oncomplete = function () { cb && cb(true); };
      tx.onerror = function () { cb && cb(false); };
      tx.onabort = function () { cb && cb(false); };
    } catch (e) { cb && cb(false); }
  }
  function assetDelMany(keys, cb) {
    if (!db || !keys.length) { cb && cb(); return; }
    try {
      var tx = db.transaction(ASTORE, "readwrite");
      var os = tx.objectStore(ASTORE);
      keys.forEach(function (k) { os.delete(k); });
      tx.oncomplete = function () { cb && cb(); };
      tx.onerror = function () { cb && cb(); };
    } catch (e) { cb && cb(); }
  }
  function assetGetAll(cb) {
    if (!db) { cb({}); return; }
    try {
      var out = {};
      var rq = db.transaction(ASTORE, "readonly").objectStore(ASTORE).openCursor();
      rq.onsuccess = function () {
        var c = rq.result;
        if (!c) { cb(out); return; }
        out[c.key] = c.value;
        c.continue();
      };
      rq.onerror = function () { cb(out); };
    } catch (e) { cb({}); }
  }

  // 지금 편집 중인 문서의 슬롯 키
  function docId() {
    var m = WE.model.project.meta;
    if (!m.id) m.id = WE.model.newDocId();
    return m.id;
  }
  function draftKey() { return DRAFT_P + docId(); }
  function snapKey() { return SNAP_P + docId(); }

  // 저장본(문자열) → 프로젝트 객체. 첨부물 참조를 되돌린다.
  // 구버전이 남긴 통짜 저장본도 그대로 읽힌다(참조가 없으면 unpack이 원본을 그대로 통과시킨다).
  function decode(v) {
    if (!v) return null;
    try {
      var o = JSON.parse(v), t = 0, body = o;
      if (o && o._v === 2) { body = o.p; t = o._t; }   // 시각이 함께 담긴 형식
      var proj = WE.assets.unpack(body);
      // model.loadProject가 아는 필드만 옮기므로 _savedAt은 프로젝트엔 남지 않는다.
      // 방금 연 도면의 '최종 수정'이 맞도록 마지막 저장 시각도 이어받는다(PDF 작성일에 쓰임).
      if (t) { proj._savedAt = t; _lastSaveTs = t; }
      return proj;
    } catch (e) { return null; }   // 손상된 저장본은 없는 것으로 취급 — 빈 화면으로 시작
  }

  // 특정 문서의 자동저장본 불러오기
  function loadDraft(id, cb) { getRaw(DRAFT_P + id, function (v) { cb(decode(v)); }); }

  // 보관 중인 자동저장본 목록 (최신순). 어느 것을 이어서 열지 고르는 데 쓴다.
  function listDrafts(cb) {
    if (!db) { cb([]); return; }
    try {
      var out = [];
      var range = IDBKeyRange.bound(DRAFT_P, DRAFT_P + "￿");
      var rq = db.transaction(STORE, "readonly").objectStore(STORE).openCursor(range);
      rq.onsuccess = function () {
        var c = rq.result;
        if (!c) { out.sort(function (a, b) { return b.t - a.t; }); cb(out); return; }
        try {
          var o = JSON.parse(c.value);
          var p = (o && o._v === 2) ? o.p : o;
          if (p && !isEmptyProject(p)) {
            out.push({
              id: String(c.key).slice(DRAFT_P.length),
              t: (o && o._t) || 0,
              mig: !!(o && o._mig),   // 옛 슬롯에서 옮겨온 것 — 정리에서 지킨다
              name: (p.meta && p.meta.name) || "",
              // 시트가 여러 장이면 합산한다 — 안 그러면 목록이 전부 '0부품'으로 보인다
              comps: WE.model.countOf(p, "components"),
              wires: WE.model.countOf(p, "wires")
            });
          }
        } catch (e) { /* 손상된 항목은 건너뜀 */ }
        c.continue();
      };
      rq.onerror = function () { cb(out); };
    } catch (e) { cb([]); }
  }

  // 문서 슬롯이 무한정 쌓이지 않게 오래된 것부터 정리한다.
  // 지금 열려 있는 문서와 다른 탭이 편집 중인 문서는 건드리지 않는다.
  function pruneDrafts(max, cb) {
    listDrafts(function (list) {
      var here = docId();
      var dead = list.slice(max).filter(function (d) {
        return d.id !== here && !claimedByOther(d.id) && !d.mig;
      });
      if (!dead.length) { cb && cb(0); return; }
      var i = 0;
      (function next() {
        if (i >= dead.length) {
          console.log("[store] 오래된 자동저장본 " + dead.length + "건을 정리했습니다.");
          cb && cb(dead.length);
          return;
        }
        var id = dead[i++].id;
        delRaw(DRAFT_P + id, function () { delRaw(SNAP_P + id, next); });
      })();
    });
  }

  // 저장 시각을 함께 남긴다 — 복원 안내에 "언제 작업분인지" 표시하기 위함.
  // 시각은 감싸는 껍데기에만 넣는다(본문 json에 섞으면 매번 내용이 달라져 변경 감지가 무력해진다).
  function write(json) {
    if (!db) return;
    try {
      _lastSaveTs = Date.now();
      var rec = '{"_v":2,"_t":' + _lastSaveTs + ',"p":' + json + '}';
      db.transaction(STORE, "readwrite").objectStore(STORE).put(rec, draftKey());
    } catch (e) { /* 무시 */ }
  }

  // ---- 예전 슬롯(주소 기준 1개) → 문서 슬롯으로 이관 ----
  // 새 슬롯에 제대로 들어간 것을 확인한 뒤에만 옛 것을 지운다.
  // 후보 주소를 하나씩 훑는다. 두 곳에 다 있으면 각각 별개 문서로 살린다
  // (합치면 한쪽이 사라지므로 절대 합치지 않는다).
  function migrateLegacy(cb) {
    var paths = legacyPaths(), i = 0;
    (function next() {
      if (i >= paths.length) { cb(); return; }
      migrateOne(paths[i++], next);
    })();
  }

  function migrateOne(path, cb) {
    var LEGACY_DRAFT = "current::" + path;
    var LEGACY_SNAP = "history::" + path;
    getRaw(LEGACY_DRAFT, function (v) {
      getRaw(LEGACY_SNAP, function (h) {
        if (!v && !h) { cb(); return; }
        var id = WE.model.newDocId(), t = Date.now(), body = null;
        if (v) {
          try {
            var o = JSON.parse(v);
            body = (o && o._v === 2) ? o.p : o;
            if (o && o._t) t = o._t;
            if (body && body.meta) body.meta.id = id;
          } catch (e) { body = null; }
        }
        // _mig: 옛 슬롯에서 옮겨온 것이라는 표시.
        //   이관본은 '옛 작업 시각'을 그대로 물려받으므로(t = o._t) 최신순 목록에서 뒤로 밀리고,
        //   바로 뒤에 도는 pruneDrafts(20) 이 21번째부터 지운다. 옛 원본은 이미 지운 뒤라 복구가 안 된다.
        //   '방금 나타난 것'을 '가장 오래된 것'으로 오해하는 것이 문제이므로, 표시를 보고 정리에서 뺀다.
        //   이관본은 많아야 후보 경로 수(3개)라 20칸 한도에는 사실상 영향이 없다.
        var newDraft = body ? '{"_v":2,"_mig":1,"_t":' + t + ',"p":' + JSON.stringify(body) + '}' : null;
        // 도면 본체 없이 스냅샷만 남은 옛 슬롯 — 옮기면 안 된다.
        // 목록(listDrafts)은 draft:: 만 훑으므로 snap:: 만 있는 문서는 화면에 안 나타나고,
        // 옛 자리는 지워지므로 열 방법이 아예 사라진다. 그냥 옛 자리에 둔다.
        if (!newDraft) {
          console.warn("[store] 옛 슬롯에 도면 본체가 없어 옮기지 않고 그대로 둡니다.");
          cb(); return;
        }
        putRaw(DRAFT_P + id, newDraft);
        if (h) putRaw(SNAP_P + id, h);
        // 확인 후 삭제
        getRaw(DRAFT_P + id, function (chk) {
          var draftOk = !newDraft || !!chk;
          getRaw(SNAP_P + id, function (chk2) {
            var snapOk = !h || !!chk2;
            if (!draftOk || !snapOk) {
              console.warn("[store] 예전 자동저장본 이관을 확인하지 못해 원본을 남겨둡니다.");
              cb(); return;
            }
            console.log("[store] 예전 자동저장본을 문서 슬롯으로 옮겼습니다. (문서 " + id + ", 옛 주소 " + path + ")");
            delRaw(LEGACY_DRAFT, function () { delRaw(LEGACY_SNAP, cb); });
          });
        });
      });
    });
  }

  // ---- 탭 점유 표시 ----
  // 문서마다 슬롯을 나눠도, 탭 두 개가 '같은' 문서를 되살리면 여전히 서로 덮어쓴다.
  // 그래서 편집 중인 문서를 localStorage에 표시해 두고, 다른 탭은 그 문서를 되살리지 않는다.
  // 탭이 그냥 죽어도 표시가 영원히 남지 않도록 주기적으로 갱신하고, 오래된 표시는 무시한다.
  var CLAIM_KEY = "we_docClaims", CLAIM_TTL = 12000, CLAIM_BEAT = 4000;
  var _tabId = null;
  function tabId() {
    if (_tabId) return _tabId;
    var v = null;
    try { v = sessionStorage.getItem("we_tabId"); } catch (e) { /* 무시 */ }
    if (!v) {
      v = "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      try { sessionStorage.setItem("we_tabId", v); } catch (e) { /* 무시 */ }
    }
    _tabId = v;
    return v;
  }
  function readClaims() {
    var c = {};
    try { c = JSON.parse(localStorage.getItem(CLAIM_KEY) || "{}") || {}; } catch (e) { c = {}; }
    var now = Date.now();
    for (var k in c) if (!c[k] || now - (c[k].t || 0) > CLAIM_TTL) delete c[k];
    return c;
  }
  function writeClaims(c) {
    try { localStorage.setItem(CLAIM_KEY, JSON.stringify(c)); } catch (e) { /* 무시 */ }
  }
  // 다른 탭이 지금 편집 중인 문서인가
  function claimedByOther(id) {
    var c = readClaims();
    return !!(c[id] && c[id].tab !== tabId());
  }
  /* 같은 문서를 두 탭이 열었을 때.
     나중에 연 탭이 임자가 되고, 먼저 있던 탭은 **자동저장을 멈춘다.**
     안 멈추면 먼저 있던 탭이 자기 옛 내용을 3초마다 덮어써서, 새 탭에서 한 작업이 사라진다.
     (예전에는 아예 다른 도면을 열어 이 상황을 피했는데, 그게 "매번 다른 화면이 뜬다"의 원인이었다) */
  var _양보함 = false, _양보알림 = null;
  function yielded() { return _양보함; }
  function onYield(fn) { _양보알림 = fn; }
  function 임자잃었나() {
    var id = _claimedId || docId();
    var c = readClaims();
    if (!(c[id] && c[id].tab !== tabId())) return false;
    if (!_양보함) {
      _양보함 = true;
      /* ⚠ 예전에는 여기서 자동저장 시계를 껐다(clearInterval). **그러면 안 된다.**
         시계를 끄면 saveNow 가 다시는 불리지 않아서, 이 탭이 나중에 **다른 문서로**
         옮겨가도 그 사실을 알아챌 기회가 영영 없다.
         실제 증상(2026-09-11 코덱스 감사에서 잡힘):
           같은 도면을 두 탭에서 열어 이 탭이 물러난 뒤
           → 「새 배선도로 시작」을 누르면
           → 그 새 도면이 **자동저장이 하나도 안 되는데 사용자는 모른다.**
         시계는 그대로 돌리고, 저장할지 말지는 saveNow 가 그때그때 판단한다.
         (3초마다 점유표를 한 번 더 읽을 뿐이라 비용은 무시할 수준이다) */
      try { if (_양보알림) _양보알림(); } catch (e) { /* 무시 */ }
    }
    return true;
  }

  function claim(id) {
    if (!id) return;
    var c = readClaims();
    c[id] = { tab: tabId(), t: Date.now() };
    writeClaims(c);
  }
  function releaseClaim(id) {
    var c = readClaims();
    if (c[id] && c[id].tab === tabId()) { delete c[id]; writeClaims(c); }
  }
  // 지금 열려 있는 문서를 점유한다. 파일 열기·최근 작업 열기 등으로 문서가 바뀌면
  // 옛 문서를 자동으로 놓아준다 — 안 그러면 다른 탭이 그 문서를 영영 못 연다.
  var _claimedId = null;
  function claimCurrent() {
    var id = docId();
    if (_claimedId && _claimedId !== id) releaseClaim(_claimedId);
    claim(id);
    rememberDoc(id);
    _claimedId = id;
  }

  /* 보던 문서를 기억한다. 두 군데에 적는다.
       탭 서랍(sessionStorage)  이 탭이 보던 것 — '새 작업'으로 비운 뒤 새로고침해도
                               버린 도면이 되살아나지 않게 한다.
       브라우저 서랍(localStorage) 마지막으로 보던 것 — **새 탭도 이걸 보고 같은 도면을 연다.**

     ⚠ 예전에는 탭 서랍에만 적었다. 그러니 관리자 페이지를 새 탭으로 열었다 돌아오거나
        랜딩에서 에디터로 들어오면, 그 탭은 "내가 뭘 보고 있었는지"를 몰라 엉뚱한 도면을
        열었다. 사용자에게 탭은 보이지 않는다 — 어디서 들어오든 하던 작업이 나와야 한다.
        (2026-09-02) */
  var SESS_DOC = "we_docId";
  var LAST_DOC = "we_docId_last";
  function rememberDoc(id) {
    try { sessionStorage.setItem(SESS_DOC, id); } catch (e) { /* 무시 */ }
    try { localStorage.setItem(LAST_DOC, id); } catch (e) { /* 무시 */ }
  }
  function myDoc() { try { return sessionStorage.getItem(SESS_DOC); } catch (e) { return null; } }
  // 이 탭이 보던 것 우선, 없으면(새 탭) 마지막으로 보던 것
  function lastDoc() {
    var v = myDoc();
    if (v) return v;
    try { return localStorage.getItem(LAST_DOC); } catch (e) { return null; }
  }

  // ---- 범용 키-값 (라이브러리 등) ----
  function putRaw(key, val) {
    if (!db) return;
    try { db.transaction(STORE, "readwrite").objectStore(STORE).put(val, key); }
    catch (e) { /* 무시 */ }
  }
  function getRaw(key, cb) {
    if (!db) { cb(null); return; }
    try {
      var rq = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
      rq.onsuccess = function () { cb(rq.result || null); };
      rq.onerror = function () { cb(null); };
    } catch (e) { cb(null); }
  }
  // state 저장소의 모든 값을 한 건씩 흘려보낸다. 고아 첨부물을 찾을 때
  // 저장된 모든 곳(라이브러리·도면·스냅샷)에서 참조를 훑기 위해 쓴다.
  // 끝에 ok=false면 도중에 실패한 것 → 참조를 다 못 봤으므로 삭제하면 안 된다.
  function scanStateValues(fn, cb) {
    if (!db) { cb(false); return; }
    try {
      var rq = db.transaction(STORE, "readonly").objectStore(STORE).openCursor();
      rq.onsuccess = function () {
        var c = rq.result;
        if (!c) { cb(true); return; }
        try { fn(c.value); } catch (e) { cb(false); return; }
        c.continue();
      };
      rq.onerror = function () { cb(false); };
    } catch (e) { cb(false); }
  }

  // 지금 이 브라우저에 살아 있는 '다른' 탭이 있는가
  function anyOtherTab() {
    var c = readClaims(), me = tabId();
    for (var k in c) if (c[k] && c[k].tab !== me) return true;
    return false;
  }

  function delRaw(key, cb) {
    if (!db) { cb && cb(); return; }
    try {
      var tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(key);
      tx.oncomplete = function () { cb && cb(); };
      tx.onerror = function () { cb && cb(); };
    } catch (e) { cb && cb(); }
  }

  // ---- 스냅샷 히스토리 (이전 버전 복구) ----
  // 자동저장 슬롯은 1개뿐이라 실수로 덮어쓰면 복구 불가였음 →
  // 5분 간격 자동 스냅샷을 롤링 보관(가장 오래된 것부터 밀려남).
  // 예전엔 이미지가 base64로 통째로 들어가 스냅샷 하나가 수 MB여서 3개까지만 뒀지만,
  // 이제 첨부물은 자산 풀 참조라 한 부가 수십 KB다 → 넉넉히 보관해 되돌릴 수 있는 범위를 넓힌다.
  var SNAP_MAX = 40, SNAP_INTERVAL = 5 * 60 * 1000;   // 5분 × 40 ≈ 3시간 20분치
  var _lastSnapTs = 0;

  // 판정은 model.js 한 곳에만 둔다 — 여기 복사해 두었다가 시트를 못 보고
  // 자동저장 복원이 통째로 막혔던 적이 있다 (2026-08-18).
  function isEmptyProject(p) { return !WE.model.hasContent(p); }
  // 빈 프로젝트는 보관 가치 없어 스킵
  function pushSnapshot(cb) {
    var p = WE.model.project;
    if (isEmptyProject(p)) { cb && cb(false); return; }
    var json = JSON.stringify(WE.assets.pack(p));
    // 목록에 쓸 정보도 지금 확정해 둔다. 아래 getRaw는 비동기라, 그 사이에
    // '새로 만들기'가 프로젝트를 비워버리면 부품 0개짜리로 잘못 기록된다.
    var info = {
      name: (p.meta && p.meta.name) || "",
      comps: (p.components || []).length,
      wires: (p.wires || []).length
    };
    WE.assets.flush();
    getRaw(snapKey(), function (v) {
      var list = [];
      if (v) { try { list = JSON.parse(v); } catch (e) { list = []; } }
      // 직전 스냅샷과 내용이 같으면 중복 보관하지 않음
      if (list.length && list[list.length - 1].json === json) { cb && cb(false); return; }
      list.push({
        t: Date.now(),
        name: info.name, comps: info.comps, wires: info.wires,
        json: json
      });
      while (list.length > SNAP_MAX) list.shift();
      putRaw(snapKey(), JSON.stringify(list));
      _lastSnapTs = Date.now();
      cb && cb(true);
    });
  }
  // 목록 조회(최신순). json 포함 — 복구 시 재조회 없이 바로 사용
  function getSnapshots(cb) {
    getRaw(snapKey(), function (v) {
      var list = [];
      if (v) { try { list = JSON.parse(v); } catch (e) { list = []; } }
      cb(list.slice().reverse());
    });
  }

  // 저장용 직렬화 — 첨부물은 자산 풀로 빼고 참조만 남긴다.
  // 덕분에 3초마다 쓰는 양이 수 MB에서 수십 KB로 줄고, 비교(변경 감지)도 그만큼 가벼워진다.
  function serialize() { return JSON.stringify(WE.assets.pack(WE.model.project)); }

  // 변경 있을 때만 저장
  function saveNow() {
    /* ⚠ 예전에는 `if (_양보함) return;` 이었다. _양보함 은 **한 번 켜지면 꺼지지 않는
       기억**이라, 이 탭이 다른 문서로 옮겨가도 계속 "물러난 탭" 으로 남았다.
       이제 **저장하려는 순간마다 점유표를 실제로 확인**한다 —
       문서가 바뀌면 보는 줄이 저절로 바뀌므로 "기억을 지워 주는 코드" 가 필요 없다.
       (그런 코드는 새로운 '문서 여는 길' 이 생길 때마다 넣어야 하고, 빠뜨리면 같은 버그가 난다) */
    if (임자잃었나()) return;   // 이 문서의 임자는 다른 탭이다 — 덮어쓰면 안 된다
    var json = serialize();
    if (json === lastJson) return;
    lastJson = json;
    WE.assets.flush();   // 참조가 가리키는 첨부물을 먼저 확보
    write(json);
    claimCurrent();      // 저장한 문서 = 지금 편집 중인 문서 (바뀌었으면 옛 것은 놓아준다)
    // 주기 스냅샷: 마지막 보관 후 5분 지났으면 히스토리에도 한 부 남김
    if (Date.now() - _lastSnapTs > SNAP_INTERVAL) pushSnapshot();
  }

  // 방금 로드한 상태를 기준선으로 삼아 즉시 재저장 방지
  function syncBaseline() { lastJson = serialize(); }

  // 저장된 스냅샷 삭제 (새 프로젝트 시)
  function clear() {
    lastJson = "";
    if (!db) return;
    try { db.transaction(STORE, "readwrite").objectStore(STORE).delete(draftKey()); }
    catch (e) { /* 무시 */ }
  }

  var autosaveEnabled = true;
  var autosaveInterval = 3000;
  var started = false;

  function applyTimer() {
    if (timer) { clearInterval(timer); timer = null; }
    if (autosaveEnabled) timer = setInterval(saveNow, autosaveInterval);
  }

  // 자동저장 켜기/끄기 + 주기(ms) 설정
  function setAutosave(enabled, intervalMs) {
    autosaveEnabled = !!enabled;
    if (intervalMs && intervalMs >= 500) autosaveInterval = intervalMs;
    applyTimer();
  }

  // 주기 자동저장 + 종료 직전 저장 시작
  function start() {
    if (started) return;
    started = true;
    applyTimer();
    claimCurrent();
    // 편집 중이라는 표시를 계속 갱신 (탭이 죽으면 표시가 저절로 낡아 다른 탭이 이어받는다)
    // 그 사이 다른 탭이 같은 문서를 열었으면 여기서 알아채고 물러난다.
    setInterval(function () { if (!임자잃었나()) claimCurrent(); }, CLAIM_BEAT);
    // 마지막 작업이 항상 복구되도록, 닫기/숨김 직전엔 자동저장 설정과 무관하게 저장.
    // beforeunload는 모바일 사파리/안드로이드에서 생략되는 경우가 많아 pagehide를 함께 건다.
    function bye() { saveNow(); releaseClaim(_claimedId || docId()); }
    window.addEventListener("beforeunload", bye);
    window.addEventListener("pagehide", bye);
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) saveNow();
    });
  }

  return {
    init: init, saveNow: saveNow, syncBaseline: syncBaseline,
    clear: clear, start: start, setAutosave: setAutosave,
    putRaw: putRaw, getRaw: getRaw, delRaw: delRaw,
    scanStateValues: scanStateValues, anyOtherTab: anyOtherTab,
    assetPutMany: assetPutMany, assetDelMany: assetDelMany, assetGetAll: assetGetAll,
    pushSnapshot: pushSnapshot, getSnapshots: getSnapshots,
    lastDoc: lastDoc, yielded: yielded, onYield: onYield,
    // 문서 슬롯
    loadDraft: loadDraft, listDrafts: listDrafts, migrateLegacy: migrateLegacy, pruneDrafts: pruneDrafts,
    docId: docId, claim: claim, claimCurrent: claimCurrent, releaseClaim: releaseClaim, claimedByOther: claimedByOther,
    myDoc: myDoc, rememberDoc: rememberDoc,
    lastSavedAt: function () { return _lastSaveTs; },
    tabId: tabId
  };
})();
