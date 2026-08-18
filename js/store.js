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
  var LEGACY_DRAFT = "current::" + (location.pathname || "");
  var LEGACY_SNAP = "history::" + (location.pathname || "");
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
        alert("이지케이블이 다른 탭에서도 열려 있어 저장소를 갱신하지 못했습니다.\n다른 탭을 모두 닫고 새로고침해 주세요.");
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
        return d.id !== here && !claimedByOther(d.id);
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
  function migrateLegacy(cb) {
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
        var newDraft = body ? '{"_v":2,"_t":' + t + ',"p":' + JSON.stringify(body) + '}' : null;
        if (newDraft) putRaw(DRAFT_P + id, newDraft);
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
            console.log("[store] 예전 자동저장본을 문서 슬롯으로 옮겼습니다. (문서 " + id + ")");
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

  // 탭은 자기가 보던 문서를 기억한다(sessionStorage는 탭 단위이고 새로고침에도 남는다).
  // 이게 없으면 '새 작업'으로 비운 뒤 새로고침했을 때, 버린 도면이 '가장 최근 작업'으로 잡혀 되살아난다.
  var SESS_DOC = "we_docId";
  function rememberDoc(id) { try { sessionStorage.setItem(SESS_DOC, id); } catch (e) { /* 무시 */ } }
  function myDoc() { try { return sessionStorage.getItem(SESS_DOC); } catch (e) { return null; } }

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
    setInterval(claimCurrent, CLAIM_BEAT);
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
    // 문서 슬롯
    loadDraft: loadDraft, listDrafts: listDrafts, migrateLegacy: migrateLegacy, pruneDrafts: pruneDrafts,
    docId: docId, claim: claim, claimCurrent: claimCurrent, releaseClaim: releaseClaim, claimedByOther: claimedByOther,
    myDoc: myDoc, rememberDoc: rememberDoc,
    lastSavedAt: function () { return _lastSaveTs; },
    tabId: tabId
  };
})();
