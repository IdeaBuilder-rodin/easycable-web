// catalogbackup.js — 공용 부품 카탈로그를 **로컬 폴더에 이중으로** 떠 둔다.
//
// 왜: 카탈로그는 시간이 쌓여야 생기는 자산인데 지금은 서버(Supabase) 한 군데에만 있다.
//     게다가 무료 플랜은 **자동 백업이 0일**이다 — 잘못 지워도 되돌릴 사본이 서버에 없다.
//     (Supabase 공식 안내도 무료 플랜은 직접 내보내 오프사이트에 두라고 한다)
//
// ★ 이미지를 반드시 같이 담는다. Supabase 는 **어느 플랜이든 DB 백업에 Storage 파일을
//   포함하지 않는다**(메타데이터만). 즉 돈을 내도 이미지는 우리가 챙겨야 한다.
//
// ★ 분류의 id(uuid)를 그대로 담는다. 부품은 분류를 id 로 가리키므로,
//   복원할 때 분류를 새로 만들면 **모든 부품의 분류 연결이 끊긴다.**
//
// ── 배치 (판 2) ─────────────────────────────────────────────────────────────
//   백업폴더/
//     catalog.json                        분류(구조·순서·id) + 마지막 동기화 시각
//     parts/<public_key>/part.json        그 부품의 서버 행 전체
//     parts/<public_key>/image.<ext> · thumbnail.<ext> · datasheets/<파일명>
//     _지운부품/<public_key>/…             서버에서 사라진 부품 (지우지 않고 옮겨만 둔다)
//
// **부품마다 자기 폴더**인 이유: 편집 한 번에 쓰는 양이 부품 수와 무관해진다.
//   예전엔 부품 전체가 든 catalog.json 을 매번 다시 썼는데, 부품이 늘수록 느려지고
//   모든 편집이 가장 중요한 파일 하나를 건드리게 된다.
//
// ── 어떻게 최신을 유지하나 ──────────────────────────────────────────────────
// 편집할 때마다 훅을 손으로 거는 방식은 **반드시 빠뜨린다.**
// 분류 삭제·이름 변경·부품 이동은 SQL 함수 안에서 부품 행이 바뀌므로 JS 는 알 방법이 없다.
// 그래서 서버에 **"마지막 동기화 이후 바뀐 것"** 을 물어본다(`updated_at` 기준).
// 어느 경로로 바뀌었든 서버가 알려주므로 빠뜨릴 수가 없다.
//
// ── 지운 부품 ───────────────────────────────────────────────────────────────
// 서버에 없다고 **로컬에서 지우지 않는다.** 그러면 실수로 지운 것까지 백업이 따라 지운다.
// 백업이 실수를 따라가면 백업이 아니다(동기화와 백업이 갈리는 지점).
// `_지운부품/` 으로 옮겨만 둔다 — 복원은 `parts/` 만 보고, 실수였으면 거기서 꺼낸다.
var WE = window.WE || {};
window.WE = WE;

WE.catalogBackup = (function () {
  "use strict";
  var DB = "we_catalog_backup", STORE = "handles", KEY = "folder";
  var PAGE = 500;          // 한 번에 읽는 부품 수. PostgREST 는 한 번에 주는 행 수에 상한이 있다
  var 지운폴더 = "_지운부품";
  var 판 = 2;

  var 테스트폴더 = null;   // 검사용 이음매 — 아래 _테스트_폴더 참고
  function supported() { return !!테스트폴더 || typeof window.showDirectoryPicker === "function"; }
  function client() { return WE.auth && WE.auth._client ? WE.auth._client() : null; }

  // ---- 폴더 손잡이 보관 (IndexedDB) ----
  // 손잡이는 구조적 복제가 되므로 IndexedDB 에 그대로 넣을 수 있다. localStorage 로는 안 된다.
  function idb() {
    return new Promise(function (ok, no) {
      var req = indexedDB.open(DB, 1);
      req.onupgradeneeded = function () { req.result.createObjectStore(STORE); };
      req.onsuccess = function () { ok(req.result); };
      req.onerror = function () { no(req.error); };
    });
  }
  function idbPut(value) {
    return idb().then(function (db) {
      return new Promise(function (ok, no) {
        var tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put(value, KEY);
        tx.oncomplete = function () { ok(); }; tx.onerror = function () { no(tx.error); };
      });
    });
  }
  function idbGet() {
    return idb().then(function (db) {
      return new Promise(function (ok) {
        var tx = db.transaction(STORE, "readonly");
        var r = tx.objectStore(STORE).get(KEY);
        r.onsuccess = function () { ok(r.result || null); };
        r.onerror = function () { ok(null); };
      });
    }).catch(function () { return null; });
  }

  function ensurePermission(handle, ask) {
    if (!handle || !handle.queryPermission) return Promise.resolve("granted");
    return handle.queryPermission({ mode: "readwrite" }).then(function (state) {
      if (state === "granted" || !ask) return state;
      return handle.requestPermission({ mode: "readwrite" });
    });
  }

  function pickFolder() {
    if (!supported()) return Promise.reject(new Error("이 브라우저는 폴더 저장을 지원하지 않습니다. Chrome 또는 Edge 를 써 주세요."));
    return window.showDirectoryPicker({ mode: "readwrite" }).then(function (handle) {
      return idbPut(handle).then(function () { return handle; });
    });
  }

  // 폴더 상태를 **구분해서** 돌려준다.
  //   none   — 아직 폴더를 안 골랐다 (선택이므로 조용히 넘어가도 된다)
  //   denied — 골랐는데 권한이 풀렸다 (이건 **반드시 알려야 한다.** 조용히 넘어가면 백업이 아니다)
  //   ok     — 쓸 수 있다
  // ⚠ 권한 재요청은 사용자 조작 안에서만 된다. 저장 직후 호출은 비동기라 조작 흐름이 끊겨
  //   물어볼 수가 없다 — 그래서 ask 는 버튼에서만 true 다.
  function folder(ask) {
    if (테스트폴더) return Promise.resolve({ 상태: "ok", handle: 테스트폴더 });
    return idbGet().then(function (handle) {
      if (!handle) return { 상태: "none", handle: null };
      return ensurePermission(handle, ask).then(function (state) {
        return state === "granted" ? { 상태: "ok", handle: handle } : { 상태: "denied", handle: null };
      });
    });
  }
  function savedFolder(ask) { return folder(ask).then(function (r) { return r.handle; }); }
  function forgetFolder() { return idbPut(null); }

  // ---- 폴더 다루기 ----
  function dir(parent, name) { return parent.getDirectoryHandle(name, { create: true }); }
  function dirIfAny(parent, name) {
    return parent.getDirectoryHandle(name, { create: false }).catch(function () { return null; });
  }
  function writeFile(folder, name, blobOrText) {
    return folder.getFileHandle(name, { create: true }).then(function (fh) {
      return fh.createWritable().then(function (w) {
        return w.write(blobOrText).then(function () { return w.close(); });
      });
    });
  }
  function readText(folder, name) {
    return folder.getFileHandle(name, { create: false })
      .then(function (fh) { return fh.getFile(); })
      .then(function (f) { return f.text(); })
      .catch(function () { return null; });
  }
  function listNames(folder) {
    var out = [];
    if (!folder || !folder.values) return Promise.resolve(out);
    var it = folder.values()[Symbol.asyncIterator] ? folder.values() : null;
    if (!it) return Promise.resolve(out);
    function step(iter) {
      return iter.next().then(function (r) {
        if (r.done) return out;
        out.push({ name: r.value.name, kind: r.value.kind });
        return step(iter);
      });
    }
    return step(it[Symbol.asyncIterator]()).catch(function () { return out; });
  }
  function fetchBlob(url) {
    if (!url) return Promise.resolve(null);
    return fetch(url).then(function (r) { return r.ok ? r.blob() : null; }).catch(function () { return null; });
  }
  function extOf(url, blob, fallback) {
    var m = /\.([a-z0-9]{1,5})(?:\?|$)/i.exec(String(url || ""));
    if (m) return m[1].toLowerCase();
    var map = { "image/webp": "webp", "image/png": "png", "image/jpeg": "jpg", "application/pdf": "pdf" };
    return (blob && map[blob.type]) || fallback || "bin";
  }
  function safeName(name, i) {
    return String(name || ("file-" + i)).replace(/[\\/:*?"<>|]+/g, "_").slice(-90);
  }

  // ---- 서버 읽기 ----
  // ⚠ 한 번에 다 달라고 하면 상한(기본 1000)에 잘린다. 끝까지 페이지로 읽는다.
  function pagedSelect(c, cols, tune) {
    var out = [], from = 0;
    function next() {
      var q = c.from("public_components").select(cols).order("public_key", { ascending: true });
      if (tune) q = tune(q);
      return q.range(from, from + PAGE - 1).then(function (res) {
        if (res.error) throw res.error;
        var rows = res.data || [];
        out = out.concat(rows);
        if (rows.length < PAGE) return out;
        from += PAGE;
        return next();
      });
    }
    return next();
  }
  function fetchChanged(c, since) {
    // ⚠ gt 가 아니라 **gte** 다. 같은 시각에 여러 행이 바뀔 수 있어서(SQL 함수가 now() 로
    //   여러 부품을 한꺼번에 갱신한다) gt 로 하면 경계에 걸린 행을 놓친다.
    //   경계 행을 한 번 더 쓰는 편이 놓치는 것보다 낫다 — 다시 써도 결과는 같다.
    return pagedSelect(c, "*", since ? function (q) { return q.gte("updated_at", since); } : null);
  }
  function fetchAllKeys(c) { return pagedSelect(c, "public_key"); }
  function fetchAllCategories(c) {
    return c.from("public_categories").select("*")
      .order("sort_order", { ascending: true }).then(function (res) {
        if (res.error) throw res.error;
        return res.data || [];
      });
  }

  // ---- 부품 하나 쓰기 ----
  // 이미 같은 이미지가 있으면 다시 받지 않는다.
  // 단자만 고쳤을 때 이미지를 매번 다시 내려받는 건 낭비다 — 편집이 잦을수록 크게 차이 난다.
  function writePart(partsDir, row, onSkip) {
    var key = safeName(row.public_key, 0);
    var data = row.part_data || {};
    return dir(partsDir, key).then(function (pd) {
      return readText(pd, "part.json").then(function (oldText) {
        var old = null;
        try { old = oldText ? JSON.parse(oldText) : null; } catch (e) { old = null; }
        var jobs = [];

        function media(url, base, fallbackExt, oldUrl) {
          if (!url) return null;
          if (old && oldUrl === url) { if (onSkip) onSkip(); return null; }   // 그대로면 건너뛴다
          return fetchBlob(url).then(function (b) {
            if (!b) return null;
            return writeFile(pd, base + "." + extOf(url, b, fallbackExt), b);
          });
        }
        var img = media(row.image_url || data.image, "image", "webp", old && (old.image_url || (old.part_data || {}).image));
        if (img) jobs.push(img);
        var th = media(row.thumbnail_url, "thumbnail", "webp", old && old.thumbnail_url);
        if (th) jobs.push(th);

        var sheets = data.datasheets || [];
        var oldSheets = ((old && old.part_data) || {}).datasheets || [];
        if (sheets.length) {
          jobs.push(dir(pd, "datasheets").then(function (dd) {
            return Promise.all(sheets.map(function (d, k) {
              // 링크 데이터시트는 담을 파일이 없다. 주소는 part.json 안에 이미 들어 있다
              if (d.type === "link") { return null; }
              var same = oldSheets.some(function (o) { return o.name === d.name && o.data === d.data; });
              if (same) { if (onSkip) onSkip(); return null; }
              return fetchBlob(d.data).then(function (b) {
                if (!b) return null;
                var nm = safeName(d.name, k);
                if (nm.indexOf(".") < 0) nm += "." + extOf(d.data, b, "pdf");
                return writeFile(dd, nm, b);
              });
            }));
          }));
        }
        // part.json 은 **파일을 다 받은 뒤에** 쓴다.
        // 먼저 쓰면, 중간에 실패했을 때 "이미 최신"으로 보여 다음 동기화가 건너뛴다.
        return Promise.all(jobs).then(function () {
          return writeFile(pd, "part.json", JSON.stringify(row, null, 2));
        });
      });
    });
  }

  // ---- 사라진 부품을 _지운부품/ 으로 옮기기 ----
  // 브라우저에서 폴더 통째 이동은 지원이 고르지 않아, 파일을 옮겨 쓰고 원본을 지운다.
  // 부품 하나 분량이라 부담 없다.
  function movePartFolder(root, partsDir, key) {
    return dirIfAny(partsDir, key).then(function (src) {
      if (!src) return null;
      return dir(root, 지운폴더).then(function (trash) {
        return dir(trash, key).then(function (dst) {
          return copyDir(src, dst).then(function () {
            return partsDir.removeEntry(key, { recursive: true });
          });
        });
      });
    });
  }
  function copyDir(src, dst) {
    return listNames(src).then(function (items) {
      var i = 0;
      function step() {
        if (i >= items.length) return Promise.resolve();
        var it = items[i++];
        var job;
        if (it.kind === "directory") {
          job = src.getDirectoryHandle(it.name).then(function (s) {
            return dir(dst, it.name).then(function (d) { return copyDir(s, d); });
          });
        } else {
          job = src.getFileHandle(it.name).then(function (fh) { return fh.getFile(); })
            .then(function (f) { return writeFile(dst, it.name, f); });
        }
        return job.catch(function () { }).then(step);
      }
      return step();
    });
  }

  // ---- 동기화 ----
  // opts.all    true 면 마지막 동기화 시각을 무시하고 전부 다시 뜬다(= 전체 백업)
  // opts.sweep  true 면 서버에서 사라진 부품을 _지운부품/ 으로 옮긴다
  //             (키 목록을 통째로 받아야 해서, 편집할 때마다 하지는 않는다)
  // opts.ask    true 면 권한이 풀렸을 때 다시 묻는다 — **버튼에서만** true
  function sync(opts) {
    opts = opts || {};
    var onProgress = opts.onProgress;
    var c = client();
    if (!c) return Promise.reject(new Error("서버 연결이 없습니다."));

    var root, partsDir, cats, changed, 이전 = null, 새시각 = null;
    var 실패 = [], 건너뜀 = 0, 지움 = 0;

    return folder(opts.ask).then(function (f) {
      if (f.상태 === "none") return { 상태: "폴더없음", 분류: 0, 부품: 0, 지움: 0, 건너뜀: 0, 실패: [] };
      if (f.상태 === "denied") throw new Error("백업 폴더 권한이 풀렸습니다. [백업 폴더 지정]을 다시 눌러 주세요.");
      root = f.handle;

      return readText(root, "catalog.json").then(function (text) {
        var prev = null;
        try { prev = text ? JSON.parse(text) : null; } catch (e) { prev = null; }
        // 판이 다르면(예전 배치) 처음부터 다시 뜬다 — 섞이면 복원할 때 곤란하다
        if (prev && prev.판 === 판 && !opts.all) 이전 = prev.마지막동기화 || null;
        if (onProgress) onProgress(0, 0, "서버에서 목록을 읽는 중…");
        return Promise.all([fetchAllCategories(c), fetchChanged(c, 이전)]);
      }).then(function (r) {
        cats = r[0]; changed = r[1];
        // 실제로 본 것 중 가장 늦은 시각까지만 전진한다.
        // 지금 시각으로 찍으면 시계 오차만큼 놓칠 수 있다 — 덜 나아가는 편이 안전하다.
        changed.forEach(function (row) {
          if (row.updated_at && (!새시각 || row.updated_at > 새시각)) 새시각 = row.updated_at;
        });
        return dir(root, "parts");
      }).then(function (pd) {
        partsDir = pd;
        var i = 0;
        function step() {
          if (i >= changed.length) return Promise.resolve();
          var row = changed[i];
          if (onProgress) onProgress(i, changed.length, row.name);
          // 부품 하나가 실패해도 멈추지 않는다 — 나머지라도 건지는 것이 백업의 목적이다.
          return writePart(partsDir, row, function () { 건너뜀++; })
            .catch(function (e) { 실패.push(row.name + " (" + ((e && e.message) || "실패") + ")"); })
            .then(function () { i++; return step(); });
        }
        return step();
      }).then(function () {
        if (!opts.sweep) return null;
        if (onProgress) onProgress(changed.length, changed.length, "사라진 부품을 확인하는 중…");
        return fetchAllKeys(c).then(function (rows) {
          var live = {};
          rows.forEach(function (r) { live[safeName(r.public_key, 0)] = true; });
          return listNames(partsDir).then(function (items) {
            var gone = items.filter(function (it) { return it.kind === "directory" && !live[it.name]; });
            var i = 0;
            function step() {
              if (i >= gone.length) return Promise.resolve();
              var nm = gone[i++].name;
              return movePartFolder(root, partsDir, nm)
                .then(function () { 지움++; })
                .catch(function (e) { 실패.push(nm + " (옮기지 못함)"); })
                .then(step);
            }
            return step();
          });
        });
      }).then(function () {
        // catalog.json 은 **분류만** 담는다. 부품 정보가 두 군데 있으면
        // 어느 쪽이 최신인지 다투게 된다 — 부품은 parts/ 가 유일한 정본이다.
        var catalog = {
          형식: "easycable-catalog", 판: 판,
          만든때: new Date().toISOString(),
          마지막동기화: 새시각 || 이전 || null,
          분류: cats
        };
        return writeFile(root, "catalog.json", JSON.stringify(catalog, null, 2));
      }).then(function () {
        if (onProgress) onProgress(changed.length, changed.length, "");
        return { 상태: "완료", 분류: cats.length, 부품: changed.length, 지움: 지움, 건너뜀: 건너뜀, 실패: 실패 };
      });
    });
  }

  // ---- 지금 백업이 어떤 상태인가 ----
  // ⚠ **폴더에서 직접 읽는다.** 어딘가에 "백업했음"이라고 적어 두고 그걸 보여주면,
  //    폴더를 지우거나 다른 PC 로 옮겼을 때 **거짓말을 한다.**
  //    백업이 있다고 말하는데 실제로 없는 것이 가장 나쁜 경우다.
  function status() {
    return folder(false).then(function (f) {
      if (f.상태 !== "ok") return { 상태: f.상태, 폴더: null, 부품: 0, 분류: 0, 마지막: null, 옛배치: false };
      var root = f.handle;
      return readText(root, "catalog.json").then(function (text) {
        var cat = null;
        try { cat = text ? JSON.parse(text) : null; } catch (e) { cat = null; }
        return dirIfAny(root, "parts").then(function (pd) {
          return (pd ? listNames(pd) : Promise.resolve([])).then(function (items) {
            return {
              상태: cat ? "ok" : "빈폴더",
              폴더: root.name,
              부품: items.filter(function (i) { return i.kind === "directory"; }).length,
              분류: cat && cat.분류 ? cat.분류.length : 0,
              마지막: (cat && cat.마지막동기화) || null,
              옛배치: !!(cat && cat.판 !== 판)
            };
          });
        });
      });
    }).catch(function () {
      return { 상태: "읽기실패", 폴더: null, 부품: 0, 분류: 0, 마지막: null, 옛배치: false };
    });
  }

  // 버튼용 — 전부 다시 뜨고, 사라진 부품도 정리한다
  function backupAll(onProgress) {
    return sync({ all: true, sweep: true, ask: true, onProgress: onProgress });
  }
  // 관리자 페이지를 열 때 — 조용히 따라잡고, 사라진 부품도 이때 정리한다
  function syncOnOpen() { return sync({ sweep: true, ask: false }); }
  // 편집·게시 직후 — 바뀐 것만. 키 목록을 안 받아 가볍다
  function syncChanged() { return sync({ ask: false }); }

  // 폴더를 못 쓰는 브라우저용 — 데이터만 파일 하나로 내려받는다.
  // ⚠ 이미지가 빠지므로 완전 복원은 안 된다. 그래서 이름에 '데이터만'을 박는다.
  function downloadJsonOnly() {
    var c = client();
    if (!c) return Promise.reject(new Error("서버 연결이 없습니다."));
    return Promise.all([fetchAllCategories(c), fetchChanged(c, null)]).then(function (r) {
      var catalog = { 형식: "easycable-catalog", 판: 판, 만든때: new Date().toISOString(), 분류: r[0], 부품: r[1] };
      var blob = new Blob([JSON.stringify(catalog, null, 2)], { type: "application/json" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "easycable_catalog_데이터만_" + new Date().toISOString().slice(0, 10) + ".json";
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
      return { 상태: "완료", 분류: r[0].length, 부품: r[1].length, 지움: 0, 건너뜀: 0, 실패: [] };
    });
  }

  return {
    supported: supported,
    pickFolder: pickFolder, savedFolder: savedFolder, folder: folder, forgetFolder: forgetFolder,
    sync: sync, backupAll: backupAll, syncOnOpen: syncOnOpen, syncChanged: syncChanged, status: status,
    downloadJsonOnly: downloadJsonOnly,
    // 검사용 이음매 — 폴더 고르기 창은 사람이 눌러야 떠서 자동 검사로는 열 수 없다.
    // 가짜 폴더를 물려 동기화 로직만 잰다. 앱 코드에서는 쓰지 않는다.
    // (auth.js 의 _테스트_상태, categories.js 의 _테스트_주입 과 같은 목적)
    _테스트_폴더: function (h) { 테스트폴더 = h || null; }
  };
})();
