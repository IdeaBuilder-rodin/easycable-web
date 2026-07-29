// assets.js — 첨부물(부품 이미지 · 데이터시트 PDF) 중복 제거 저장소
//
// 배경: 이미지/PDF는 base64 문자열로 부품·도면 안에 통째로 박혀 있었다.
// 그래서 같은 PDF 하나가 라이브러리 1벌 + 도면 1벌 + 자동저장 1벌 + 스냅샷 3벌 = 최대 6벌씩
// 저장됐고, 데이터의 99.8%가 이 덩어리였다(메타는 0.2%).
//
// 해결: 덩어리에 내용 해시로 이름을 붙여 자산 풀에 딱 1벌만 두고,
// 저장할 때는 "@ezc:<키>" 참조로 바꿔 넣는다(pack). 읽을 때 되돌린다(unpack).
// 런타임 객체는 손대지 않고 저장/로드 경계에서만 변환하므로 렌더·편집 코드는 그대로다.
var WE = window.WE || {};
window.WE = WE;

WE.assets = (function () {
  var PREFIX = "@ezc:";     // 참조 표기. 사용자가 입력한 텍스트와 겹치지 않도록 고유 접두사 사용
  var MIN_LEN = 1024;       // 1KB 미만은 분리해도 이득이 없어 그대로 둠

  var pool = {};            // 키 → base64 원본 (메모리 상주)
  var keyCache = null;      // base64 원본 → 키 (해시 재계산 방지)
  var pending = {};         // 아직 IndexedDB에 안 쓴 키
  var ready = false;

  function resetCache() {
    try { keyCache = new Map(); } catch (e) { keyCache = null; }
  }
  resetCache();

  // 동기 해시 — beforeunload에서도 저장해야 하므로 async(crypto.subtle)는 쓸 수 없다.
  // FNV-1a와 djb2를 한 번에 돌려 32비트 두 개를 뽑고 길이까지 붙여 실질적으로 충돌을 없앤다.
  function hashOf(s) {
    var h1 = 0x811c9dc5, h2 = 5381;
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      h1 ^= c;
      h1 = (h1 + ((h1 << 1) + (h1 << 4) + (h1 << 7) + (h1 << 8) + (h1 << 24))) >>> 0;
      h2 = (((h2 << 5) + h2) + c) >>> 0;
    }
    return s.length.toString(36) + "-" + h1.toString(36) + h2.toString(36);
  }

  function isAssetStr(v) {
    return typeof v === "string" && v.length >= MIN_LEN && v.slice(0, 5) === "data:";
  }
  function isRef(v) {
    return typeof v === "string" && v.slice(0, 5) === PREFIX;
  }

  // 자산 등록 → 키 반환. 이미 있으면 재사용(여기서 중복이 제거된다)
  function put(s) {
    var k = keyCache && keyCache.get(s);
    if (k) return k;
    k = hashOf(s);
    if (keyCache) keyCache.set(s, k);
    if (!pool[k]) { pool[k] = s; pending[k] = 1; }
    return k;
  }
  function get(k) { return pool[k] || null; }

  function isArr(o) { return Object.prototype.toString.call(o) === "[object Array]"; }

  // 저장용 변환: 큰 data: 문자열을 자산 풀로 옮기고 참조로 치환한 사본을 만든다
  function pack(o) {
    if (typeof o === "string") return isAssetStr(o) ? PREFIX + put(o) : o;
    if (!o || typeof o !== "object") return o;
    if (isArr(o)) {
      var a = new Array(o.length);
      for (var i = 0; i < o.length; i++) a[i] = pack(o[i]);
      return a;
    }
    var r = {};
    for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) r[k] = pack(o[k]);
    return r;
  }

  // 읽기용 변환: 참조를 원본으로 되돌린다.
  // 풀에 없는 참조는 그대로 남긴다 — 지워버리면 나중에 자산이 돌아와도 되살릴 수 없기 때문이다.
  // 다만 예전엔 이때 아무 말 없이 그림만 사라져 원인을 찾기 어려웠다 → 몇 개가 끊겼는지 세어 알린다.
  var _missing = 0;
  function unpackRoot(o) {
    _missing = 0;
    var r = unpack(o);
    if (_missing) {
      console.warn("[assets] 첨부물 " + _missing + "개를 찾지 못했습니다. " +
        "해당 부품 그림·데이터시트가 비어 보일 수 있습니다. (WE.assets.report()로 상태 확인)");
    }
    return r;
  }
  function unpack(o) {
    if (typeof o === "string") {
      if (!isRef(o)) return o;
      var v = pool[o.slice(PREFIX.length)];
      if (v == null) { _missing++; return o; }
      return v;
    }
    if (!o || typeof o !== "object") return o;
    if (isArr(o)) {
      var a = new Array(o.length);
      for (var i = 0; i < o.length; i++) a[i] = unpack(o[i]);
      return a;
    }
    var r = {};
    for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) r[k] = unpack(o[k]);
    return r;
  }

  // packed 객체가 참조하는 키를 모두 모은다 (사용하지 않는 자산 정리용)
  function collectRefs(o, out) {
    out = out || {};
    if (typeof o === "string") { if (isRef(o)) out[o.slice(PREFIX.length)] = 1; return out; }
    if (!o || typeof o !== "object") return out;
    if (isArr(o)) { for (var i = 0; i < o.length; i++) collectRefs(o[i], out); return out; }
    for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) collectRefs(o[k], out);
    return out;
  }

  // 새로 등록된 자산만 IndexedDB에 기록.
  // 기록에 성공한 것만 대기열에서 뺀다 — 실패한 채로 참조만 저장되면 첨부물이 사라지므로,
  // 다음 flush 때 다시 시도되도록 남겨둔다.
  function flush(cb) {
    var keys = Object.keys(pending);
    if (!keys.length) { cb && cb(0); return; }
    WE.store.assetPutMany(keys.map(function (k) {
      return { key: k, val: pool[k] };
    }), function (ok) {
      if (ok) keys.forEach(function (k) { delete pending[k]; });
      else console.warn("[assets] 첨부물 " + keys.length + "개 기록 실패 — 다음 저장 때 다시 시도합니다.");
      cb && cb(ok ? keys.length : 0);
    });
  }

  // 파일에서 들여온 첨부물을 자산 풀에 들인다.
  // 키는 내용 해시라, 이미 갖고 있는 첨부물이면 그대로 합쳐진다(중복 저장 안 됨).
  function adopt(map) {
    if (!map) return 0;
    var n = 0;
    for (var k in map) {
      if (!Object.prototype.hasOwnProperty.call(map, k)) continue;
      var v = map[k];
      if (typeof v !== "string") continue;
      if (!pool[k]) { pool[k] = v; pending[k] = 1; n++; }
      if (keyCache && !keyCache.has(v)) keyCache.set(v, k);
    }
    if (n) flush();
    return n;
  }

  // IndexedDB의 자산을 전부 메모리로 (unpack이 동기로 동작하려면 미리 올려둬야 한다)
  function loadAll(cb) {
    WE.store.assetGetAll(function (map) {
      pool = map || {};
      resetCache();
      for (var k in pool) if (keyCache) keyCache.set(pool[k], k);
      ready = true;
      cb && cb();
    });
  }

  // 참조되지 않는 자산 제거. keepRefs = collectRefs()로 모은 { 키: 1 }
  function sweep(keepRefs, cb) {
    var dead = [], bytes = 0;
    for (var k in pool) if (!keepRefs[k]) { dead.push(k); bytes += pool[k].length; }
    if (!dead.length) { cb && cb(0, 0); return; }
    dead.forEach(function (k) {
      if (keyCache) keyCache.delete(pool[k]);
      delete pool[k];
    });
    WE.store.assetDelMany(dead, function () { cb && cb(dead.length, bytes); });
  }

  // ---- 고아 첨부물 정리 ----
  // 부품을 지우거나 도면을 갈아엎어도 첨부물은 자산 풀에 남는다. 그대로 두면 계속 쌓인다.
  // 다만 살아 있는 첨부물을 잘못 지우면 그림이 사라지므로, 안전을 여러 겹으로 둔다:
  //   ① 다른 탭이 열려 있으면 하지 않는다 (그 탭이 아직 저장 안 한 첨부물을 지울 수 있다)
  //   ② 저장된 값을 하나라도 못 읽으면 그만둔다 (참조를 다 못 본 채로 지우면 안 되므로)
  //   ③ 파싱 대신 원문에서 참조 문자열을 훑는다 — 어떤 키·중첩 구조든 놓치지 않는다
  //   ④ 아직 기록 전인 첨부물(pending)과 지금 메모리에 열려 있는 내용은 무조건 남긴다
  var REF_RE = /@ezc:[0-9a-z-]+/g;
  var SWEEP_GAP = 6 * 60 * 60 * 1000;   // 너무 자주 돌 필요는 없다
  var SWEEP_TS = "we_assetSweepTs";

  function sweepAll(cb) {
    if (!ready) { cb && cb(0, "자산 풀 미준비"); return; }
    if (WE.store.anyOtherTab()) { cb && cb(0, "다른 탭이 열려 있어 건너뜀"); return; }

    var keep = {};
    // ④ 메모리에 열려 있는 것부터 확보 (아직 저장 전일 수 있다)
    try {
      collectRefs(pack(WE.model.project), keep);
      collectRefs(pack({ f: WE.library.getFolders(), p: WE.library.getAll() }), keep);
    } catch (e) { cb && cb(0, "메모리 참조 수집 실패"); return; }
    for (var pk in pending) keep[pk] = 1;

    // ③ 저장된 모든 값에서 참조를 훑는다
    var bad = false;
    WE.store.scanStateValues(function (v) {
      if (typeof v !== "string") { bad = true; return; }
      var m = v.match(REF_RE);
      if (m) for (var i = 0; i < m.length; i++) keep[m[i].slice(PREFIX.length)] = 1;
    }, function (ok) {
      if (!ok || bad) { cb && cb(0, "저장소를 다 읽지 못해 중단"); return; }   // ②
      sweep(keep, function (n, bytes) {
        if (n) console.log("[assets] 쓰이지 않는 첨부물 " + n + "개(" +
          (bytes / 1048576).toFixed(2) + " MB)를 정리했습니다.");
        cb && cb(n, null, bytes);
      });
    });
  }

  // 시작 시 호출 — 너무 자주 돌지 않도록 간격을 둔다
  function sweepIfDue(cb) {
    var last = 0;
    try { last = Number(localStorage.getItem(SWEEP_TS) || 0); } catch (e) { /* 무시 */ }
    if (Date.now() - last < SWEEP_GAP) { cb && cb(0, "아직 주기 전"); return; }
    sweepAll(function (n, skip, bytes) {
      if (!skip) { try { localStorage.setItem(SWEEP_TS, String(Date.now())); } catch (e) { /* 무시 */ } }
      cb && cb(n, skip, bytes);
    });
  }

  // ---- 진단 (F12 콘솔에서 직접 호출해 검증) ----
  function stats() {
    var n = 0, bytes = 0;
    for (var k in pool) { n++; bytes += pool[k].length; }
    return { count: n, bytes: bytes };
  }

  function mb(n) { return (n / 1048576).toFixed(2) + " MB"; }

  // 자산 분리로 실제 얼마나 줄었는지 콘솔에 출력
  function report() {
    var s = stats();
    WE.store.getRaw("library", function (oldJson) {
      WE.store.getRaw("library2", function (newJson) {
        var oldLen = oldJson ? oldJson.length : 0;
        var newLen = newJson ? newJson.length : 0;
        console.log("%c=== 이지케이블 자산 풀 진단 ===", "font-weight:bold");
        console.log("자산 풀            :", s.count + "개", mb(s.bytes));
        console.log("라이브러리 메타(신):", mb(newLen), newJson ? "" : "(아직 없음)");
        console.log("라이브러리 원본(구):", mb(oldLen), oldJson ? "← 검증 후 cleanup()으로 정리 가능" : "(정리됨)");
        console.log("-----------------------------------");
        console.log("현재 총 사용량     :", mb(s.bytes + newLen + oldLen));
        console.log("정리 후 예상       :", mb(s.bytes + newLen));
        if (oldLen) console.log("정리 시 절감       :", mb(oldLen));
        console.log("");
        console.log("무손실 검증  : WE.assets.verify()");
        console.log("구본 정리    : WE.assets.cleanup()");
        console.log("고아 첨부물  : WE.assets.sweepAll(function(n,skip,b){console.log(n,skip,b);})");
      });
    });
  }

  // pack → unpack 왕복이 원본과 완전히 같은지 확인 (구본이 남아 있을 때만 가능)
  function verify() {
    WE.store.getRaw("library", function (oldJson) {
      if (!oldJson) { console.log("구본이 이미 정리되어 비교 대상이 없습니다."); return; }
      var orig;
      try { orig = JSON.parse(oldJson); } catch (e) { console.log("구본을 읽을 수 없습니다."); return; }
      var round = unpack(pack(orig));
      var ok = JSON.stringify(round) === JSON.stringify(orig);
      console.log(ok
        ? "%c✔ 무손실 검증 통과 — 자산 분리 후 원본과 100% 일치합니다."
        : "%c✘ 검증 실패 — 구본을 정리하지 마세요.",
        "font-weight:bold;color:" + (ok ? "green" : "red"));
      return ok;
    });
  }

  // 마이그레이션이 확인된 뒤 구 라이브러리 레코드 삭제
  function cleanup() {
    WE.store.getRaw("library2", function (newJson) {
      if (!newJson) { console.log("새 형식 라이브러리가 없습니다. 정리를 중단합니다."); return; }
      WE.store.delRaw("library", function () {
        console.log("%c✔ 구 라이브러리 레코드를 정리했습니다.", "color:green");
        report();
      });
    });
  }

  return {
    pack: pack, unpack: unpackRoot, put: put, get: get, collectRefs: collectRefs,
    adopt: adopt, flush: flush, loadAll: loadAll,
    sweep: sweep, sweepAll: sweepAll, sweepIfDue: sweepIfDue,
    stats: stats, report: report, verify: verify, cleanup: cleanup,
    lastMissing: function () { return _missing; },
    isReady: function () { return ready; }
  };
})();
