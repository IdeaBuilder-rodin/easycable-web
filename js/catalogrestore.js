// catalogrestore.js — 로컬 백업 폴더를 읽어 **서버로 되돌린다.**
//
// 왜: 백업은 복원해 봐야 백업이다. 업계 규칙(3-2-1-1-0)의 마지막 0 이
//     "검증되지 않은 복원은 0건" 이다 — 떠 놓기만 하고 되돌려 본 적이 없으면
//     정작 사고 났을 때 되는지 아무도 모른다.
//
// ── 안전장치 ────────────────────────────────────────────────────────────────
// ① **미리보기 먼저.** 무엇이 몇 개 추가/덮어쓰기/건너뜀 되는지 보여주고 확인받는다.
// ② **기본은 「없는 것만 추가」.** 서버에 있는 것은 손대지 않는다 — 이 모드에서는
//    잃을 것이 아예 없다.
// ③ **덮어쓰기 전에 현재 서버 상태를 파일로 남긴다.**
//
// ⚠ ③ 을 catalogBackup.sync 로 하면 **안 된다.** 서버가 비어 있는 상태(=복원이 필요한
//    바로 그 상황)에서 같은 폴더에 동기화를 돌리면 sweep 이 부품 전체를 _지운부품/ 으로
//    옮겨 **복원 원본을 파괴한다.** 그래서 서버 행만 JSON 한 장으로 따로 떨군다.
//    덮어쓰기로 잃는 것은 DB 행이고, 이미지는 Storage 에 버전별 경로로 남아 있어
//    (업로드가 항상 새 경로로 간다) 행만 되살리면 원래대로 돌아간다.
//
// ── 왜 분류를 id 째로 넣나 ──────────────────────────────────────────────────
// 부품은 분류를 uuid 로 가리킨다. 분류를 새 id 로 만들면 **모든 부품의 분류 연결이
// 끊긴다.** 그래서 백업에 담아 둔 id 를 그대로 다시 넣는다.
var WE = window.WE || {};
window.WE = WE;

WE.catalogRestore = (function () {
  "use strict";
  var BUCKET = "public-components";

  function client() { return WE.auth && WE.auth._client ? WE.auth._client() : null; }
  function 폴더() {
    if (!WE.catalogBackup) return Promise.resolve({ 상태: "none", handle: null });
    return WE.catalogBackup.folder(false);
  }

  // ---- 폴더 읽기 ----
  function listNames(dir) {
    var out = [];
    if (!dir || !dir.values) return Promise.resolve(out);
    var it = dir.values();
    var iter = it[Symbol.asyncIterator] ? it[Symbol.asyncIterator]() : it;
    function step() {
      return iter.next().then(function (r) {
        if (r.done) return out;
        out.push({ name: r.value.name, kind: r.value.kind });
        return step();
      });
    }
    return step().catch(function () { return out; });
  }
  function readText(dir, name) {
    return dir.getFileHandle(name, { create: false })
      .then(function (fh) { return fh.getFile(); })
      .then(function (f) { return f.text(); })
      .catch(function () { return null; });
  }
  function readBlob(dir, name) {
    return dir.getFileHandle(name, { create: false })
      .then(function (fh) { return fh.getFile(); })
      .catch(function () { return null; });
  }
  function subdir(dir, name) {
    return dir.getDirectoryHandle(name, { create: false }).catch(function () { return null; });
  }

  // 백업 폴더의 내용을 읽어 온다. 서버에는 손대지 않는다.
  function readBackup() {
    return 폴더().then(function (f) {
      if (f.상태 !== "ok") throw new Error(
        f.상태 === "denied" ? "백업 폴더 권한이 풀렸습니다. [백업 폴더 지정]을 다시 눌러 주세요."
          : "백업 폴더가 지정되지 않았습니다.");
      var root = f.handle;
      return readText(root, "catalog.json").then(function (text) {
        var cat = null;
        try { cat = text ? JSON.parse(text) : null; } catch (e) { cat = null; }
        if (!cat) throw new Error("백업 폴더에서 catalog.json 을 읽지 못했습니다.");
        if (cat.판 !== 2) throw new Error("옛 배치의 백업입니다. [⤓ 전체 백업]을 한 번 눌러 새 배치로 만든 뒤 복원해 주세요.");
        return subdir(root, "parts").then(function (pd) {
          if (!pd) throw new Error("백업 폴더에 parts 폴더가 없습니다.");
          return listNames(pd).then(function (items) {
            var keys = items.filter(function (i) { return i.kind === "directory"; }).map(function (i) { return i.name; });
            var 부품 = [], 못읽음 = [];
            var i = 0;
            function step() {
              if (i >= keys.length) return Promise.resolve();
              var k = keys[i++];
              return pd.getDirectoryHandle(k).then(function (부품폴더) {
                return readText(부품폴더, "part.json").then(function (t) {
                  var row = null;
                  try { row = t ? JSON.parse(t) : null; } catch (e) { row = null; }
                  if (row && row.public_key) 부품.push({ 키: k, 행: row, 폴더: 부품폴더 });
                  else 못읽음.push(k);
                });
              }).catch(function () { 못읽음.push(k); }).then(step);
            }
            // ⚠ _지운부품/ 은 읽지 않는다. 서버에서 지운 것을 복원이 되살리면 안 된다.
            //    필요하면 사람이 그 폴더에서 꺼내 parts/ 로 옮긴다.
            return step().then(function () {
              return { root: root, 분류: cat.분류 || [], 부품: 부품, 못읽음: 못읽음, 만든때: cat.만든때 };
            });
          });
        });
      });
    });
  }

  // ---- 서버 현재 상태 ----
  function serverState(c) {
    return Promise.all([
      c.from("public_categories").select("id,name").then(function (r) {
        if (r.error) throw r.error; return r.data || [];
      }),
      c.from("public_components").select("public_key,name").order("public_key", { ascending: true })
        .range(0, 999).then(function (r) {
          if (r.error) throw r.error; return r.data || [];
        })
    ]).then(function (r) { return { 분류: r[0], 부품: r[1] }; });
  }

  // ---- 미리보기 ----
  // 무엇이 몇 개 바뀌는지 **먼저 보여준다.** 확인 없이 서버를 건드리지 않는다.
  function preview() {
    var c = client();
    if (!c) return Promise.reject(new Error("서버 연결이 없습니다."));
    return readBackup().then(function (백업) {
      return serverState(c).then(function (서버) {
        var 있는분류 = {}, 있는부품 = {};
        서버.분류.forEach(function (x) { 있는분류[x.id] = true; });
        서버.부품.forEach(function (x) { 있는부품[x.public_key] = true; });
        var 분류새로 = 백업.분류.filter(function (x) { return !있는분류[x.id]; });
        var 부품새로 = 백업.부품.filter(function (p) { return !있는부품[p.행.public_key]; });
        var 부품겹침 = 백업.부품.filter(function (p) { return 있는부품[p.행.public_key]; });
        return {
          만든때: 백업.만든때,
          분류: { 백업: 백업.분류.length, 새로: 분류새로.length, 겹침: 백업.분류.length - 분류새로.length },
          부품: { 백업: 백업.부품.length, 새로: 부품새로.length, 겹침: 부품겹침.length },
          서버: { 분류: 서버.분류.length, 부품: 서버.부품.length },
          못읽음: 백업.못읽음
        };
      });
    });
  }

  // ---- 올리기 도우미 ----
  function extFor(blob, name, fallback) {
    var m = /\.([a-z0-9]{1,5})$/i.exec(String(name || ""));
    if (m) return m[1].toLowerCase();
    var map = { "image/webp": "webp", "image/png": "png", "image/jpeg": "jpg", "application/pdf": "pdf" };
    return (blob && map[blob.type]) || fallback || "bin";
  }
  function upload(c, path, blob) {
    return c.storage.from(BUCKET).upload(path, blob, { cacheControl: "31536000", upsert: true, contentType: blob.type || "application/octet-stream" })
      .then(function (res) {
        if (res.error) throw res.error;
        return c.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
      });
  }
  // 백업이 파일을 어떤 이름으로 썼는지 되짚는다 — catalogbackup.js 의 safeName 과 **같아야** 한다.
  // 순번으로 짝지으면 링크가 섞이거나 못 받은 파일이 있을 때 통째로 어긋난다.
  function backupName(name, i) {
    return String(name || ("file-" + i)).replace(/[\\/:*?"<>|]+/g, "_").slice(-90);
  }
  function safeFileName(name, i) {
    var clean = String(name || ("file-" + i)).replace(/[^a-zA-Z0-9._-]+/g, "_").slice(-80);
    return (i + 1) + "-" + clean;
  }
  // 부품 폴더에서 image.* / thumbnail.* 을 찾는다 (확장자가 다를 수 있다)
  function findFile(items, base) {
    var hit = items.filter(function (i) { return i.kind === "file" && i.name.indexOf(base + ".") === 0; })[0];
    return hit ? hit.name : null;
  }

  // 부품 하나를 서버로 올린다. 이미지는 **로컬 파일에서** 올린다 —
  // 복원이 필요한 상황이면 원래 Storage URL 은 이미 죽어 있다.
  function restorePart(c, user, p) {
    var key = p.행.public_key;
    var base = key + "/restore/" + Date.now() + "/";
    return listNames(p.폴더).then(function (items) {
      var 이미지 = findFile(items, "image"), 썸 = findFile(items, "thumbnail");
      return Promise.all([
        이미지 ? readBlob(p.폴더, 이미지) : null,
        썸 ? readBlob(p.폴더, 썸) : null,
        subdir(p.폴더, "datasheets")
      ]).then(function (r) {
        var 잡 = [];
        잡.push(r[0] ? upload(c, base + "image." + extFor(r[0], 이미지, "webp"), r[0]) : Promise.resolve(null));
        잡.push(r[1] ? upload(c, base + "thumbnail." + extFor(r[1], 썸, "webp"), r[1]) : Promise.resolve(null));
        var dsDir = r[2];
        var 원래시트 = (p.행.part_data || {}).datasheets || [];
        // 데이터시트는 **part.json 을 기준으로** 돌린다. 폴더 파일을 순서대로 집으면
        // 링크가 섞이거나 백업 때 못 받은 파일이 있을 때 이름·형식이 통째로 밀린다.
        잡.push(!원래시트.length ? Promise.resolve([]) :
          (dsDir ? listNames(dsDir) : Promise.resolve([])).then(function (items) {
            var 파일들 = items.filter(function (it) { return it.kind === "file"; });
            return Promise.all(원래시트.map(function (d, i) {
              // 링크는 올릴 파일이 없다. 주소를 그대로 살린다
              if (d.type === "link") {
                return { id: d.id || ("ds" + i), name: d.name, type: "link", data: d.data };
              }
              var want = backupName(d.name, i);
              var hit = 파일들.filter(function (f) {
                return f.name === want || f.name.indexOf(want + ".") === 0;
              })[0];
              // 백업에 파일이 없으면(그때 못 받았던 것) **버리지 않고 원래 항목을 그대로 둔다.**
              // 옛 주소가 아직 살아 있으면 그걸로라도 열린다 — 버리면 그 정보까지 사라진다
              if (!hit) return d;
              return readBlob(dsDir, hit.name).then(function (b) {
                if (!b) return d;
                return upload(c, base + "datasheets/" + safeFileName(hit.name, i), b).then(function (url) {
                  return { id: d.id || ("ds" + i), name: d.name, type: d.type, data: url };
                });
              });
            })).then(function (list) { return list.filter(Boolean); });
          }));
        return Promise.all(잡);
      }).then(function (r) {
        var 이미지url = r[0], 썸url = r[1], 시트 = r[2];
        var row = JSON.parse(JSON.stringify(p.행));
        var data = row.part_data || {};
        if (이미지url) { data.image = 이미지url; row.image_url = 이미지url; }
        if (썸url) row.thumbnail_url = 썸url;
        if (시트 && 시트.length) data.datasheets = 시트;
        row.part_data = data;
        row.updated_at = new Date().toISOString();
        row.updated_by = user.id;
        if (!row.created_by) row.created_by = user.id;
        return c.from("public_components").upsert(row, { onConflict: "public_key" }).then(function (res) {
          if (res.error) throw res.error;
          return true;
        });
      });
    });
  }

  // ---- 적용 ----
  // mode: "add"(기본, 없는 것만) | "overwrite"(전부 덮어쓰기)
  function apply(opts, onProgress) {
    opts = opts || {};
    var mode = opts.mode === "overwrite" ? "overwrite" : "add";
    var c = client();
    var user = WE.auth && WE.auth.user && WE.auth.user();
    if (!c) return Promise.reject(new Error("서버 연결이 없습니다."));
    if (!user) return Promise.reject(new Error("로그인이 필요합니다."));

    var 백업, 실패 = [], 분류추가 = 0, 부품추가 = 0, 부품덮음 = 0, 건너뜀 = 0, 남긴파일 = null;

    return readBackup().then(function (b) {
      백업 = b;
      return serverState(c);
    }).then(function (서버) {
      // ── 덮어쓰기라면 현재 서버 상태를 먼저 파일로 남긴다 ──
      // ⚠ catalogBackup.sync 로 하면 안 된다 — 서버가 빈 상태에서 돌리면
      //    sweep 이 복원 원본을 _지운부품/ 으로 옮겨 버린다.
      if (mode !== "overwrite") return null;
      if (onProgress) onProgress(0, 0, "복원 전 서버 상태를 남기는 중…");
      return c.from("public_components").select("*").order("public_key", { ascending: true }).range(0, 999)
        .then(function (res) {
          if (res.error) throw res.error;
          var 이름 = "_복원전_서버상태_" + new Date().toISOString().replace(/[:.]/g, "-") + ".json";
          var 내용 = JSON.stringify({
            형식: "easycable-복원전-스냅샷", 만든때: new Date().toISOString(),
            분류: 서버.분류, 부품: res.data || []
          }, null, 2);
          return 백업.root.getFileHandle(이름, { create: true }).then(function (fh) {
            return fh.createWritable().then(function (w) {
              return w.write(내용).then(function () { return w.close(); });
            });
          }).then(function () { 남긴파일 = 이름; });
        });
    }).then(function () {
      // ── 분류 먼저 (부품이 분류 id 를 가리키므로 순서가 중요하다) ──
      if (onProgress) onProgress(0, 0, "분류를 되돌리는 중…");
      var 있는분류 = {};
      return c.from("public_categories").select("id").then(function (r) {
        if (r.error) throw r.error;
        (r.data || []).forEach(function (x) { 있는분류[x.id] = true; });
        var 넣을것 = 백업.분류.filter(function (x) { return mode === "overwrite" || !있는분류[x.id]; });
        if (!넣을것.length) return null;
        // id 를 그대로 넣는다 — 새 id 를 만들면 부품과의 연결이 전부 끊긴다
        return c.from("public_categories").upsert(넣을것, { onConflict: "id" }).then(function (res) {
          if (res.error) { 실패.push("분류 (" + (res.error.message || "실패") + ")"); return; }
          분류추가 = 넣을것.filter(function (x) { return !있는분류[x.id]; }).length;
        });
      });
    }).then(function () {
      // ── 부품 ──
      return serverState(c).then(function (서버) {
        var 있는부품 = {};
        서버.부품.forEach(function (x) { 있는부품[x.public_key] = true; });
        var 대상 = 백업.부품.filter(function (p) {
          if (있는부품[p.행.public_key] && mode === "add") { 건너뜀++; return false; }
          return true;
        });
        var i = 0;
        function step() {
          if (i >= 대상.length) return Promise.resolve();
          var p = 대상[i];
          if (onProgress) onProgress(i, 대상.length, p.행.name || p.키);
          var 겹침 = !!있는부품[p.행.public_key];
          // 부품 하나가 실패해도 멈추지 않는다 — 나머지라도 되살리는 것이 복원의 목적이다
          return restorePart(c, user, p).then(function () {
            if (겹침) 부품덮음++; else 부품추가++;
          }).catch(function (e) {
            실패.push((p.행.name || p.키) + " (" + ((e && e.message) || "실패") + ")");
          }).then(function () { i++; return step(); });
        }
        return step();
      });
    }).then(function () {
      if (onProgress) onProgress(1, 1, "");
      if (WE.categories && WE.categories.invalidate) WE.categories.invalidate();
      return {
        분류추가: 분류추가, 부품추가: 부품추가, 부품덮음: 부품덮음,
        건너뜀: 건너뜀, 실패: 실패, 남긴파일: 남긴파일, 못읽음: 백업.못읽음
      };
    });
  }

  return { preview: preview, apply: apply, _테스트_읽기: readBackup };
})();
