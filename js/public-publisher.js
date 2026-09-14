// 관리자 전용 공용 부품 게시. 화면 노출과 DB 쓰기 권한을 각각 확인한다.
var WE = window.WE || {};
window.WE = WE;

WE.publicPublisher = (function () {
  "use strict";
  var admin = false, callbacks = {}, current = null, done = null, busy = false;

  function client() { return WE.auth && WE.auth._client ? WE.auth._client() : null; }
  function setAdmin(value) {
    admin = !!value;
    if (callbacks.onAdminChange) callbacks.onAdminChange(admin);
  }
  function checkAdmin() {
    var c = client();
    if (!c || !WE.auth.user || !WE.auth.user()) { setAdmin(false); return Promise.resolve(false); }
    return c.rpc("is_easycable_admin").then(function (res) {
      setAdmin(!res.error && res.data === true); return admin;
    }).catch(function () { setAdmin(false); return false; });
  }
  function localPart(cmp) {
    return cmp && cmp.libraryId ? WE.library.get(cmp.libraryId) : null;
  }
  function sourceMeta(cmp) { return localPart(cmp) || cmp.publicSnapshot || {}; }
  function setStatus(text, error) {
    var el = document.getElementById("publicPublishStatus");
    el.textContent = text || ""; el.classList.toggle("error", !!error);
  }
  // 게시한 것도 로컬 백업 폴더에 따라 쓴다.
  // ⚠ 게시 창이 닫히는 걸 **막지 않는다.** 백업이 늦어도 다음 동기화(관리자 페이지를 열 때)가
  //    반드시 줍기 때문이다 — "바뀐 것만 물어보는" 방식이라 놓칠 수가 없다.
  //    다만 실패는 조용히 넘기지 않는다. 조용히 실패하는 백업은 백업이 아니다.
  function backupAfterPublish() {
    if (!WE.catalogBackup || !WE.catalogBackup.supported()) return;
    WE.catalogBackup.syncChanged().then(function (r) {
      if (r.실패 && r.실패.length && WE.app && WE.app.notice) {
        WE.app.notice("로컬 백업 일부 실패", r.실패.length + "개 부품의 파일을 백업 폴더에 담지 못했습니다. 관리자 페이지에서 [전체 백업]을 눌러 주세요.");
      }
    }).catch(function (e) {
      if (WE.app && WE.app.notice) {
        WE.app.notice("로컬 백업 실패", "게시는 끝났지만 로컬 백업 폴더에 쓰지 못했습니다. " + ((e && e.message) || ""));
      }
    });
  }

  function validate(cmp) {
    if (!cmp || !cmp.image) return "부품 이미지가 필요합니다.";
    if (!String(document.getElementById("publicPublishName").value || "").trim()) return "부품 이름을 입력하세요.";
    if (!cmp.terminals || !cmp.terminals.length) return "단자를 하나 이상 배치해야 합니다.";
    // 분류는 반드시 있어야 한다. 대분류에 직접 붙이는 것도 허용한다
    // (소분류를 아직 안 나눈 대분류가 있을 수 있다 — 2026-08-30 확정).
    if (!document.getElementById("publicPublishCategory").value) return "분류를 골라 주세요.";
    for (var i = 0; i < cmp.terminals.length; i++) {
      var t = cmp.terminals[i];
      if (!String(t.name || "").trim()) return "이름이 없는 단자가 있습니다.";
      if (!isFinite(Number(t.rx)) || !isFinite(Number(t.ry))) return "좌표가 없는 단자가 있습니다.";
    }
    return "";
  }
  function blobFrom(src) {
    if (!src) return Promise.reject(new Error("파일 없음"));
    return fetch(src).then(function (r) { if (!r.ok) throw new Error("파일 읽기 실패"); return r.blob(); });
  }
  function extFor(blob, fallback) {
    var map = { "image/webp": "webp", "image/png": "png", "image/jpeg": "jpg", "application/pdf": "pdf" };
    return map[blob.type] || fallback || "bin";
  }
  function thumbnailBlob(src) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () {
        try {
          var maxW = 320, maxH = 240, scale = Math.min(1, maxW / img.naturalWidth, maxH / img.naturalHeight);
          var canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
          canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
          canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
          canvas.toBlob(function (b) { if (b) resolve(b); else reject(new Error("썸네일 생성 실패")); }, "image/webp", 0.82);
        } catch (e) { reject(e); }
      };
      img.onerror = reject; img.src = src;
    });
  }
  function upload(bucket, path, blob) {
    var c = client();
    /* upsert:false — 경로에 매번 새 값이 들어가므로 겹칠 일이 없고,
       그래도 겹쳤다면 그건 버그다. 조용히 덮어쓰면 남의 파일을 지운 것을 아무도 모른다. */
    return c.storage.from(bucket).upload(path, blob, { cacheControl: "31536000", upsert: false, contentType: blob.type })
      .then(function (res) {
        if (res.error) throw res.error;
        return c.storage.from(bucket).getPublicUrl(path).data.publicUrl;
      });
  }
  function safeFileName(name, index) {
    var clean = String(name || ("file-" + index)).replace(/[^a-zA-Z0-9._-]+/g, "_").slice(-80);
    return (index + 1) + "-" + clean;
  }
  function 새키() {
    if (window.crypto && crypto.randomUUID) return "pub_" + crypto.randomUUID();
    return "pub_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 10);
  }
  /* 게시 키 — **부품이 들고 있는 publicId 를 자동으로 쓰지 않는다.**
     그게 2026-09-07 사고의 원인이었다: 카탈로그 부품을 가져다 고쳐 다른 부품을 만들면
     publicId 가 남아 있어 원본을 덮어썼다.
     이제는 게시 창에서 고른 것(갱신/새 부품)만 따른다. 고르지 않았으면 새 부품이다 —
     모르는 채로 남의 항목을 덮어쓰는 것보다 항목이 하나 더 생기는 편이 낫다. */
  function makeKey(cmp) {
    var 갱신 = document.getElementById("publicPublishModeUpdate");
    if (갱신 && 갱신.checked && !갱신.disabled &&
        cmp.publicId && !/^sample:/.test(cmp.publicId)) return cmp.publicId;
    return 새키();
  }
  /* BOM 에 나가는 단가 — library.js 의 bomPrice 와 같은 규칙.
     에디터에서는 WE.library 가 있으니 그걸 쓰고, 관리자 페이지(library.js 를 안 싣는다)에서는
     같은 규칙을 여기서 계산한다. 규칙이 바뀌면 library.js 쪽을 고치고 여기도 맞출 것. */
  function bomPriceOf(p) {
    if (WE.library && WE.library.bomPrice) return WE.library.bomPrice(p);
    if (!p) return "";
    var kr = p.priceKr, global = p.price;
    function has(v) { return v != null && String(v).trim() !== ""; }
    if (p.linkPref !== "kr" && p.linkPref !== "global") return has(global) ? global : (has(kr) ? kr : "");
    var v = p.linkPref === "kr" ? kr : global;
    return has(v) ? v : "";
  }

  /* ---- 게시 파이프라인 — 화면과 무관한 순수 함수 (2026-09-14) ----
     부품 객체 하나를 카탈로그에 올린다. 에디터의 게시 창(publish)과 관리자 페이지의
     일괄 등록(js/admin-batch.js)이 **같은 함수**를 부른다. 운영규칙(경로 재사용 금지·
     새 키·썸네일·데이터시트 업로드, _ai/공용부품_운영규칙.md)이 두 벌이 되면 한쪽만 고쳐진다.

     part = { key?, existingVersion?, name, spec, categoryId, image(dataURL 또는 URL), width, height,
              terminals[], datasheets[], link, linkKr, linkPref, price, priceKr,
              role, volt, current, power, capacityAh, dod, minPerHour, efficiency,
              terminalPlacementQueue, terminalPlacementQueueVersion }
     onStatus(문구) — 진행 상황을 화면에 알릴 때. 없어도 된다.
     돌려주는 것: Promise<{ publicId, publicVersion }>. 실패하면 reject(Error). */
  function publishPart(part, onStatus) {
    var c = client(), user = WE.auth.user && WE.auth.user();
    if (!c || !user) return Promise.reject(new Error("관리자 로그인이 필요합니다."));
    var say = typeof onStatus === "function" ? onStatus : function () {};
    var key = part.key || 새키();
    say("게시용 파일을 준비하는 중입니다.");
    var existingVersion = Number(part.existingVersion || 0);
    var existing = c.from("public_components").select("version").eq("public_key", key).maybeSingle();
    return existing.then(function (res) {
      if (res.error) throw res.error;
      var version = Math.max(existingVersion, res.data ? Number(res.data.version || 0) : 0) + 1;
      /* 파일 경로에 매번 새 값을 섞는다 — **경로는 절대 재사용하지 않는다.**
         업로드는 cacheControl 1년이라, 같은 경로에 다시 올리면 사람마다 새 그림과 옛 그림이
         섞여 보인다(CDN·브라우저 캐시가 제각각 만료된다).
         v 번호만으로는 부족하다 — 행을 지웠다 다시 올리거나, 탭 두 개가 같은 현재 버전을
         읽으면 같은 v 를 계산해 같은 경로로 간다. (2026-09-08, 코덱스 지적)
         v 번호는 사람이 읽는 표시로만 남기고, 파일 신원은 이 무작위 값이 맡는다. */
      var 회차 = (window.crypto && crypto.randomUUID) ? crypto.randomUUID().slice(0, 8)
                 : Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      var base = key + "/v" + version + "-" + 회차 + "/";
      return Promise.all([blobFrom(part.image), thumbnailBlob(part.image).catch(function () { return blobFrom(part.image); })])
        .then(function (blobs) {
          return Promise.all([
            upload("public-components", base + "image." + extFor(blobs[0], "webp"), blobs[0]),
            upload("public-components", base + "thumbnail." + extFor(blobs[1], "webp"), blobs[1])
          ]).then(function (urls) { return { version: version, base: base, image: urls[0], thumb: urls[1] }; });
        });
    }).then(function (files) {
      say("데이터시트를 업로드하는 중입니다.");
      var sheets = part.datasheets || [];
      return Promise.all(sheets.map(function (d, i) {
        // 링크 데이터시트는 올릴 파일이 없다. 주소를 그대로 실어 보낸다 —
        // 여기서 fetch 하면 남의 사이트라 CORS 로 막히고, 게시가 통째로 실패한다.
        if (d.type === "link") {
          return Promise.resolve({ id: d.id || ("ds" + i), name: d.name || ("데이터시트 " + (i + 1)),
                                   type: "link", data: d.data });
        }
        return blobFrom(d.data).then(function (blob) {
          var path = files.base + "datasheets/" + safeFileName(d.name, i);
          if (path.indexOf(".") < 0) path += "." + extFor(blob, "bin");
          return upload("public-components", path, blob).then(function (url) {
            return { id: d.id || ("ds" + i), name: d.name || ("데이터시트 " + (i + 1)), type: d.type || blob.type, data: url };
          });
        });
      })).then(function (datasheets) { files.datasheets = datasheets; return files; });
    }).then(function (files) {
      say("카탈로그에 기록하는 중입니다.");
      var name = String(part.name || "").trim();
      var spec = String(part.spec || "").trim();
      // 분류는 소분류 id 로 저장한다. 이름(category)도 같이 넣어 두는 이유는
      // 예전 버전이 그 칸을 읽기 때문이다(04_category_tree.sql 참고).
      var categoryId = part.categoryId || null;
      var categoryNode = categoryId ? WE.categories.get(categoryId) : null;
      var category = categoryNode ? categoryNode.name : "";
      var terminals = (part.terminals || []).map(function (t) {
        var out = { name: t.name, color: t.color, rx: t.rx, ry: t.ry };
        if (t.visible === false) out.visible = false;
        if (t.labelSide) out.labelSide = t.labelSide;
        if (t.labelPos) out.labelPos = { x: t.labelPos.x, y: t.labelPos.y };
        return out;
      });
      var data = {
        publicId: key, publicVersion: files.version, name: name, spec: spec,
        category: category, categoryId: categoryId,
        image: files.image, defaultWidth: part.width, defaultHeight: part.height, terminals: terminals,
        link: part.link || "", linkKr: part.linkKr || "",
        linkPref: part.linkPref === "kr" ? "kr" : "global",
        // 단가도 해외(price)·국내(priceKr) 두 벌. part_data jsonb 안이라 DB 스키마는 그대로다.
        price: part.price || "", priceKr: part.priceKr || "", datasheets: files.datasheets,
        role: part.role || "load", volt: part.volt || "", current: part.current || "", power: part.power || "",
        capacityAh: part.capacityAh || "", dod: part.dod || "", minPerHour: part.minPerHour || "", efficiency: part.efficiency || "",
        terminalPlacementQueue: part.terminalPlacementQueue || [],
        terminalPlacementQueueVersion: part.terminalPlacementQueueVersion
      };
      var search = [name, spec, category, categoryNode ? WE.categories.pathOf(categoryId) : ""].concat(terminals.map(function (t) { return t.name; })).join(" ").toLowerCase();
      return c.from("public_components").upsert({
        public_key: key, version: files.version, status: "published", name: name, spec: spec,
        category: category, category_id: categoryId,
        search_text: search, thumbnail_url: files.thumb, image_url: files.image, terminal_count: terminals.length,
        // 목록에 보이는 단가는 **BOM 에 나가는 쪽**과 같아야 한다 — 어긋나면 사용자가 헷갈린다
        price: Number(bomPriceOf(part)) || null, has_datasheet: files.datasheets.length > 0, part_data: data,
        created_by: user.id, updated_by: user.id, updated_at: new Date().toISOString(), published_at: new Date().toISOString()
      }, { onConflict: "public_key" }).select("public_key,version").single().then(function (res) {
        if (res.error) throw res.error; return { publicId: res.data.public_key, publicVersion: res.data.version };
      });
    });
  }

  /* 게시 창의 [게시] — 창의 칸과 캔버스 부품(current)·라이브러리 정보(meta)에서 부품 객체를 만들어
     publishPart 에 넘긴다. 실제 업로드·기록은 전부 저 함수 안이다. */
  function publish() {
    if (busy || !admin || !current) return;
    var error = validate(current); if (error) { setStatus(error, true); return; }
    var meta = sourceMeta(current), key = makeKey(current);
    if (!client() || !WE.auth.user()) { setStatus("관리자 로그인이 필요합니다.", true); return; }
    busy = true; document.getElementById("publicPublishSubmit").disabled = true;
    var part = {
      key: key, existingVersion: Number(current.publicVersion || 0),
      name: document.getElementById("publicPublishName").value,
      spec: document.getElementById("publicPublishSpec").value,
      categoryId: document.getElementById("publicPublishCategory").value || null,
      image: current.image, width: current.width, height: current.height,
      terminals: current.terminals, datasheets: meta.datasheets || [],
      link: meta.link, linkKr: meta.linkKr, linkPref: meta.linkPref, price: meta.price, priceKr: meta.priceKr,
      role: meta.role, volt: meta.volt, current: meta.current, power: meta.power,
      capacityAh: meta.capacityAh, dod: meta.dod, minPerHour: meta.minPerHour, efficiency: meta.efficiency,
      terminalPlacementQueue: current.terminalPlacementQueue || [],
      terminalPlacementQueueVersion: current.terminalPlacementQueueVersion
    };
    publishPart(part, function (t) { setStatus(t); }).then(function (result) {
      setStatus("공용 부품으로 게시했습니다.");
      if (done) done(result);
      backupAfterPublish();
      setTimeout(close, 450);
    }).catch(function (e) {
      setStatus("게시하지 못했습니다. 관리자 권한과 Supabase 설정을 확인하세요. " + (e.message || ""), true);
    }).then(function () {
      busy = false; document.getElementById("publicPublishSubmit").disabled = false;
    });
  }
  // 분류 두 칸 채우기 — 대분류를 고르면 두 번째 칸에 "그 대분류에 직접" + 하위 소분류가 들어간다.
  // 소분류를 아직 안 나눈 대분류가 있을 수 있어서 대분류 직접 붙이기를 항상 열어 둔다.
  function fillCategorySelects(selectedChildId) {
    var rootSel = document.getElementById("publicPublishCategoryRoot");
    var childSel = document.getElementById("publicPublishCategory");
    if (!rootSel || !childSel) return;
    var child = selectedChildId ? WE.categories.get(selectedChildId) : null;
    var wantRoot = child ? child.parentId : null;

    rootSel.innerHTML = "";
    var roots = WE.categories.roots();
    if (!roots.length) {
      rootSel.innerHTML = '<option value="">분류 없음</option>';
      childSel.innerHTML = '<option value="">관리자 페이지에서 분류를 먼저 만드세요</option>';
      return;
    }
    roots.forEach(function (r) {
      var o = document.createElement("option");
      o.value = r.id; o.textContent = r.name;
      if (r.id === wantRoot) o.selected = true;
      rootSel.appendChild(o);
    });
    fillChildSelect(selectedChildId);
  }
  function fillChildSelect(selectedChildId) {
    var rootSel = document.getElementById("publicPublishCategoryRoot");
    var childSel = document.getElementById("publicPublishCategory");
    var rootId = rootSel.value;
    var root = rootId ? WE.categories.get(rootId) : null;
    var kids = WE.categories.childrenOf(rootId);
    childSel.innerHTML = "";
    if (!root) { childSel.innerHTML = '<option value="">분류 없음</option>'; return; }
    // 맨 위는 항상 "대분류에 직접". 소분류가 없어도 게시할 수 있어야 한다.
    var direct = document.createElement("option");
    direct.value = root.id;
    direct.textContent = "「" + root.name + "」에 직접";
    if (selectedChildId === root.id || !kids.length) direct.selected = true;
    childSel.appendChild(direct);
    kids.forEach(function (k) {
      var o = document.createElement("option");
      o.value = k.id; o.textContent = k.name;
      if (k.id === selectedChildId) o.selected = true;
      childSel.appendChild(o);
    });
  }

  function open(cmp, cb) {
    if (!admin) return;
    current = cmp; done = cb || null;
    // 관리자가 방금 분류를 바꿨을 수 있으므로 열 때마다 다시 읽는다(실패해도 폴백이라 안전)
    WE.categories.load(true).then(function () { fillCategorySelects(sourceMeta(cmp).categoryId || null); });
    var meta = sourceMeta(cmp), existing = !!(cmp.publicId && !/^sample:/.test(cmp.publicId));
    document.getElementById("publicPublishName").value = cmp.name || meta.name || "";
    document.getElementById("publicPublishSpec").value = meta.spec || "";
    document.getElementById("publicPublishSummary").textContent = "단자 " + (cmp.terminals || []).length + "개";
    document.getElementById("publicPublishSubmit").textContent = "게시";
    document.getElementById("publicPublishPreview").src = cmp.image || "";
    설정_게시대상(cmp, existing);
    setStatus(""); document.getElementById("publicPublishModal").hidden = false;
    document.getElementById("publicPublishName").focus();
  }

  /* 이 부품이 카탈로그의 어떤 항목과 이어져 있는지 **실제로 물어보고** 보여준다.

     ⚠ 스냅샷에 적힌 이름을 믿지 않고 카탈로그에 조회하는 이유:
        그 사이 그 항목이 지워졌거나 이름이 바뀌었을 수 있다. 덮어쓸 대상을 틀리게
        보여주면 이 화면을 만든 의미가 없다.

     세 갈래로 나뉜다 —
       ① 카탈로그에 있다      → 갱신·새 부품 둘 다 고를 수 있다.
                                이름을 바꿨으면 '새 부품' 이 기본(다른 부품일 가능성이 높다).
       ② 카탈로그에 없다      → 덮어쓸 대상이 없다. 새 부품으로 고정한다.
                                (관리자는 내려둔 항목도 볼 수 있으므로, 안 보이면 정말 없는 것이다)
       ③ 통신이 안 된다      → 무엇을 덮어쓰는지 알 수 없으므로 **갱신을 잠근다.**
                                모르는 채로 덮어쓰는 것이 바로 이 사고의 본질이었다. */
  function 설정_게시대상(cmp, existing) {
    var box = document.getElementById("publicPublishTarget");
    var 갱신 = document.getElementById("publicPublishModeUpdate");
    var 새것 = document.getElementById("publicPublishModeNew");
    var head = document.getElementById("publicPublishTargetHead");
    var note = document.getElementById("publicPublishTargetNote");
    var 갱신글 = document.getElementById("publicPublishModeUpdateText");

    if (!existing) { box.hidden = true; 갱신.checked = false; 새것.checked = true; return; }

    box.hidden = false;
    갱신.disabled = true; 새것.checked = true;
    head.textContent = "이 부품은 공용 카탈로그의 항목과 이어져 있습니다";
    갱신글.textContent = "기존 항목 갱신";
    note.textContent = "카탈로그에서 확인하는 중입니다…";

    var c = client();
    if (!c) { note.textContent = "카탈로그에 연결할 수 없어 새 부품으로만 게시할 수 있습니다."; return; }
    c.from("public_components").select("name,version,status").eq("public_key", cmp.publicId).maybeSingle()
      .then(function (res) {
        if (res.error) throw res.error;
        if (!res.data) {          // ② 지워졌거나 애초에 없다
          note.textContent = "이어져 있던 항목이 카탈로그에 없습니다(지워졌을 수 있습니다). 새 부품으로 게시합니다.";
          return;
        }
        var r = res.data;
        var 지금이름 = (document.getElementById("publicPublishName").value || "").trim();
        var 같은이름 = 지금이름 === String(r.name || "").trim();
        갱신.disabled = false;
        갱신글.textContent = "「" + r.name + "」 갱신 (v" + r.version + " → v" + (Number(r.version) + 1) + ")";
        // 이름을 바꿨다면 다른 부품일 가능성이 높다 — 그때는 '새 부품' 을 기본으로 둔다
        갱신.checked = 같은이름; 새것.checked = !같은이름;
        note.textContent = 같은이름
          ? (r.status === "published" ? "같은 이름이라 개정으로 봅니다."
                                      : "이 항목은 지금 내려둔 상태입니다. 갱신하면 다시 게시됩니다.")
          : "이름이 「" + r.name + "」 에서 바뀌었습니다. 다른 부품으로 보고 새 부품을 기본으로 골랐습니다.";
      })
      .catch(function () {        // ③ 통신 실패 — 모르는 채로 덮어쓰지 않는다
        갱신.disabled = true; 새것.checked = true;
        note.textContent = "카탈로그를 확인하지 못했습니다. 무엇을 덮어쓸지 알 수 없어 새 부품으로만 게시합니다.";
      });
  }
  function close() {
    if (busy) return;
    document.getElementById("publicPublishModal").hidden = true; current = null; done = null;
  }
  function init(opts) {
    callbacks = opts || {}; checkAdmin();
    if (WE.auth && WE.auth.onChange) WE.auth.onChange(checkAdmin);
    document.getElementById("publicPublishCategoryRoot").addEventListener("change", function () { fillChildSelect(null); });
    document.getElementById("publicPublishCancel").addEventListener("click", close);
    document.getElementById("publicPublishClose").addEventListener("click", close);
    document.getElementById("publicPublishSubmit").addEventListener("click", publish);
    document.getElementById("publicPublishModal").addEventListener("click", function (e) { if (e.target === e.currentTarget) close(); });
    document.getElementById("publicPublishModal").addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });
  }
  return { init: init, open: open, isAdmin: function () { return admin; }, refresh: checkAdmin,
           publishPart: publishPart };
})();
