// 공용 부품 검색. 운영은 Supabase에서 30개씩, 로컬은 sample.ezc로 미리본다.
var WE = window.WE || {};
window.WE = WE;

WE.publicLibrary = (function () {
  "use strict";
  var PAGE_SIZE = 30;
  // 분류 목록은 js/categories.js 가 DB(public_categories)에서 읽어 온다.
  // 관리자 페이지에서 분류를 바꾸면 배포 없이 여기에 바로 반영된다.
  // DB를 못 읽으면 categories.js 가 예전 6개 상수로 폴백하므로 이 창은 비지 않는다.
  // 분류는 2단계 트리다. 대분류를 고르면 그 아래 소분류의 부품까지 모두 보여준다.
  // 걸러내기는 이름이 아니라 id 로 한다 — 「센서모듈」이 여러 대분류 밑에 있을 수 있다.
  var rows = [], samples = [], details = {}, selectedId = null;
  var categoryId = null;   // null = 전체
  /* 펼쳐 둔 대분류. **기본은 전부 접힘.** (2026-09-02)
     예전에는 대분류와 소분류를 한 번에 다 펼쳐 놨는데, 분류가 늘수록 목록이 길어져
     정작 무엇이 있는지 한눈에 안 들어왔다. EasyEDA 처럼 대분류만 보이고
     누르면 그 아래가 열리는 편이 훑기 쉽다. (고원빈 요청) */
  var 펼침 = {};
  var page = 0, total = 0, provider = "unknown";
  var callbacks = {}, timer = null, requestSeq = 0;

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function inferCategory(p) {
    var s = ((p.name || "") + " " + (p.spec || "")).toLowerCase();
    if (/esp|arduino|mcu|stm|라즈베리/.test(s)) return "MCU";
    if (/배터리|전원|step|스텝|dc|converter|컨버터/.test(s)) return "전원";
    if (/sensor|센서/.test(s)) return "센서";
    if (/relay|릴레이/.test(s)) return "릴레이";
    if (/sd|통신|uart|i2c|spi|can|wifi|bluetooth/.test(s)) return "통신";
    return "기타";
  }
  function normalize(row, index, source) {
    var p = row.part_data || row;
    var id = row.public_key || p.publicId || row.id || (source + ":" + index);
    return {
      id: id, publicId: id,
      version: Number(row.version || p.publicVersion || 1), publicVersion: Number(row.version || p.publicVersion || 1),
      name: row.name || p.name || WE.i18n.t("이름 없는 부품"), spec: row.spec || p.spec || "",
      category: row.category || p.category || inferCategory(p),
      categoryId: row.category_id || p.categoryId || null,
      thumbnail: row.thumbnail_url || p.thumbnail || p.image || "", image: p.image || row.image_url || "",
      // 구매 링크는 해외(link)·국내(linkKr) 두 개. part_data jsonb 안에 들어가므로 DB 스키마는 그대로다.
      link: p.link || "", linkKr: p.linkKr || "",
      /* 어느 쪽을 쓸지는 **실제로 들어 있는 링크**가 정한다 — 해외 우선, 해외가 비면 국내.
         (고원빈 확정 2026-09-03. 알리 제휴 링크가 해외 칸에 들어가므로 해외가 기본이다)

         ⚠ 예전에는 무조건 "global" 을 박았다. 그러면 bomLink 가 「고른 쪽만」 경로를 타서,
            해외 칸이 빈 부품은 국내 링크가 멀쩡히 있어도 BOM·상세에 「없음」으로 나왔다.
         ⚠ 비워 두는 방법도 있지만(그러면 bomLink 가 알아서 폴백한다) 그건 안 된다 —
            부품 정보 창의 체크가 legacyPref() 규칙으로 「국내」에 찍혀서, 사용자가 한 번
            저장하면 해외 링크가 BOM 에서 사라진다. 화면 표시와 실제 값을 맞춰 둔다.
         ⚠ 단가도 같은 값을 따라간다(bomPrice) — 링크는 해외인데 단가만 국내면 앞뒤가 안 맞는다. */
      linkPref: (String(p.link || "").trim() ? "global"
                 : (String(p.linkKr || "").trim() ? "kr" : "global")),
      // 단가도 링크처럼 두 벌 (해외 price · 국내 priceKr). 한쪽만 가져오면 담는 순간 값이 사라진다
      price: p.price != null ? p.price : "", priceKr: p.priceKr != null ? p.priceKr : "",
      datasheets: p.datasheets || [],
      terminals: p.terminals || [],
      terminalCount: Number(row.terminal_count != null ? row.terminal_count : (p.terminals || []).length),
      defaultWidth: p.defaultWidth || 160, defaultHeight: p.defaultHeight || 120,
      role: p.role || "load", volt: p.volt || "", current: p.current || "", power: p.power || "",
      capacityAh: p.capacityAh || "", dod: p.dod || "", minPerHour: p.minPerHour || "", efficiency: p.efficiency || "",
      terminalPlacementQueue: p.terminalPlacementQueue,
      terminalPlacementQueueVersion: p.terminalPlacementQueueVersion,
      full: !!(p.image && Array.isArray(p.terminals))
    };
  }
  function client() { return WE.auth && WE.auth._client ? WE.auth._client() : null; }
  function queryText() { return document.getElementById("publicLibrarySearch").value.trim(); }
  function setStatus(s, retry) {
    document.getElementById("publicLibraryStatus").textContent = s || "";
    var button = document.getElementById("publicLibraryRetry");
    if (button) button.hidden = !retry;
  }
  function setBadge(s) { document.querySelector("#publicLibraryModal .public-library-badge").textContent = s; }

  function loadSamples() {
    if (samples.length) return Promise.resolve(samples);
    return fetch("sample.ezc", { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error("sample"); return r.json();
    }).then(function (data) {
      samples = (data.libraryParts || []).map(function (p, i) { return normalize(p, i, "sample"); });
      samples.forEach(function (p) { details[p.id] = p; });
      return samples;
    });
  }
  function queryServer(reset) {
    var c = client(); if (!c) return Promise.reject(new Error("client"));
    // 실패하면 직전에 보던 목록을 유지할 수 있도록 성공하기 전에는 rows를 비우지 않는다.
    if (reset) page = 0;
    var from = page * PAGE_SIZE;
    var q = c.from("public_components")
      .select("public_key,version,name,spec,category,category_id,thumbnail_url,image_url,terminal_count,price,has_datasheet", { count: "exact" })
      .eq("status", "published").order("name", { ascending: true }).range(from, from + PAGE_SIZE - 1);
    var ids = WE.categories.idsFor(categoryId);
    if (ids) q = q.in("category_id", ids);
    var text = queryText().replace(/[%_]/g, "");
    if (text) q = q.ilike("search_text", "%" + text + "%");
    return q.then(function (res) {
      if (res.error) throw res.error;
      var next = (res.data || []).map(function (p, i) { return normalize(p, from + i, "server"); });
      rows = reset ? next : rows.concat(next); total = Number(res.count || 0); provider = "server";
      setBadge(WE.i18n.t("공식 카탈로그")); return rows;
    });
  }
  function querySamples(reset) {
    return loadSamples().then(function (all) {
      var text = queryText().toLowerCase();
      var found = all.filter(function (p) {
        if (categoryId) {
          // 샘플 카탈로그에는 category_id 가 없다. 고른 분류(와 그 하위)의 '이름'으로 맞춘다.
          var names = (WE.categories.idsFor(categoryId) || []).map(function (id) {
            var c = WE.categories.get(id); return c ? c.name : "";
          });
          if (names.indexOf(p.category) < 0) return false;
        }
        var pins = p.terminals.map(function (t) { return t.name || ""; }).join(" ");
        return !text || ((p.name || "") + " " + (p.spec || "") + " " + pins).toLowerCase().indexOf(text) >= 0;
      });
      if (reset) { page = 0; rows = []; }
      total = found.length; rows = found.slice(0, (page + 1) * PAGE_SIZE); provider = "sample";
      setBadge(WE.i18n.t("샘플 카탈로그")); return rows;
    });
  }
  function search(reset) {
    var seq = ++requestSeq; setStatus(WE.i18n.t("공용 부품을 검색하는 중입니다."));
    var localPreview = location.protocol === "file:" || location.hostname === "127.0.0.1" || location.hostname === "localhost";
    var request = queryServer(reset);
    // sample.ezc는 서버 설정 전의 로컬 화면 점검용이다. 운영 장애를 샘플 목록으로 감추지 않는다.
    if (localPreview) request = request.catch(function () { return querySamples(reset); });
    return request.then(function () {
      if (seq !== requestSeq) return;
      if (!rows.some(function (p) { return p.id === selectedId; })) selectedId = rows.length ? rows[0].id : null;
      render();
      /* 제휴 고지는 app.html 의 공용 부품 창 footer 에 상시로 박혀 있다.
         (BOM 하단과 **같은 마크업** — 법정 고지가 두 벌로 갈라지면 한쪽만 고쳐진다)
         여기 상태줄은 샘플 모드 경고 전용으로만 남긴다. 운영 중에는 비운다 —
         예전의 「검색 결과는 30개씩…」 안내는 없앴다(고원빈 확정 2026-09-03). */
      setStatus(provider === "server" ? "" : WE.i18n.t("서버 스키마 적용 전이라 샘플 카탈로그를 표시합니다."));
      if (selectedId) loadDetail(selectedId);
    }).catch(function () {
      if (seq !== requestSeq) return;
      render();
      setStatus(rows.length
        ? WE.i18n.t("공용 카탈로그에 연결하지 못해 이전 검색 결과를 유지합니다.")
        : WE.i18n.t("공용 카탈로그를 불러오지 못했습니다. 인터넷 연결을 확인해 주세요."), true);
    });
  }
  function selectedRow() { return rows.filter(function (p) { return p.id === selectedId; })[0] || null; }
  function loadDetail(id) {
    if (!id) return Promise.resolve(null);
    if (details[id]) { renderDetail(details[id]); return Promise.resolve(details[id]); }
    var c = client(); if (!c || provider !== "server") return Promise.resolve(selectedRow());
    var current = id; renderDetail(null, true);
    return c.from("public_components").select("public_key,version,name,spec,category,part_data")
      .eq("public_key", id).eq("status", "published").single().then(function (res) {
        if (res.error) throw res.error;
        var p = normalize(res.data, 0, "server"); details[id] = p;
        if (selectedId === current) renderDetail(p); return p;
      }).catch(function () {
        if (selectedId === current) {
          var box = document.getElementById("publicLibraryDetail");
          document.getElementById("publicLibraryAdd").disabled = true;
          document.getElementById("publicLibraryPlace").disabled = true;
          box.innerHTML = '<div class="public-library-detail-empty">' + WE.i18n.t("부품 상세 정보를 불러오지 못했습니다.") + '</div>';
          setStatus(WE.i18n.t("부품 상세 정보를 불러오지 못했습니다. 다시 시도해 주세요."), true);
        }
        return null;
      });
  }
  function findLocal(p) {
    return WE.library.getAll().filter(function (x) { return x.publicId === p.id; })[0] || null;
  }
  function addPart(p) {
    if (!p) return null;
    var old = findLocal(p); if (old) return old;
    var part = WE.library.addPart({
      name: p.name, spec: p.spec, image: p.image,
      link: p.link, linkKr: p.linkKr, linkPref: p.linkPref, price: p.price, priceKr: p.priceKr,
      datasheets: p.datasheets, terminals: p.terminals, defaultWidth: p.defaultWidth, defaultHeight: p.defaultHeight,
      role: p.role, volt: p.volt, current: p.current, power: p.power, capacityAh: p.capacityAh,
      dod: p.dod, minPerHour: p.minPerHour, efficiency: p.efficiency,
      terminalPlacementQueue: p.terminalPlacementQueue, terminalPlacementQueueVersion: p.terminalPlacementQueueVersion,
      publicId: p.id, publicVersion: p.version
    });
    if (callbacks.renderLibrary) callbacks.renderLibrary();
    setStatus(WE.i18n.t("내 라이브러리에 추가했습니다: ") + p.name); render(); return part;
  }
  /* 그림을 받아 data: 로 바꾼다.
     ⚠ 다른 출처(Supabase Storage)라 <img> 로 캔버스에 그리면 캔버스가 오염돼 못 읽는다.
        fetch 로 받아야 한다 — admin.js 의 toDataUrl 과 같은 이유·같은 방법이다. */
  function 그림받기(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error("이미지를 불러오지 못했습니다");
      return r.blob();
    }).then(function (blob) {
      return new Promise(function (ok, no) {
        var fr = new FileReader();
        fr.onload = function () { ok(fr.result); };
        fr.onerror = function () { no(new Error("이미지를 읽지 못했습니다")); };
        fr.readAsDataURL(blob);
      });
    });
  }

  /* 공용 부품을 **완전한 내 부품**으로 만든다 — 그림을 주소가 아니라 실물로 들고 온다.

     ⚠ 실패해도 가져오기를 막지는 않는다. 그림을 못 받는 이유는 대개 일시적인
        통신 문제인데, 그것 때문에 부품을 못 쓰게 하면 손해가 더 크다.
        예전 방식(주소 참조)으로라도 쓰이게 두고, 그 사실만 알린다. */
  function 내것으로(p) {
    if (!p || !/^https?:/i.test(String(p.image || ""))) return Promise.resolve(p);
    return 그림받기(p.image).then(function (dataUrl) {
      var 복사 = {};
      for (var k in p) if (Object.prototype.hasOwnProperty.call(p, k)) 복사[k] = p[k];
      복사.image = dataUrl;
      return 복사;
    }).catch(function () {
      setStatus(WE.i18n.t("그림을 내려받지 못해 원본 주소로 연결했습니다. 인터넷 연결을 확인해 주세요."));
      return p;
    });
  }

  function withFull(done) {
    if (!selectedId) return;
    loadDetail(selectedId).then(function (p) {
      if (!p || !p.image) { setStatus(WE.i18n.t("부품 원본을 불러오지 못했습니다.")); return; }
      setStatus(WE.i18n.t("부품을 가져오는 중입니다…"));
      return 내것으로(p).then(function (내p) { done(내p); });
    });
  }

  function renderCategories() {
    var box = document.getElementById("publicLibraryCategories"); box.innerHTML = "";
    /* 지금 고른 분류가 소분류면 그 부모는 펼쳐 둔다 —
       안 그러면 고른 것이 화면에서 사라져 어디를 보고 있는지 알 수 없다. */
    if (categoryId) {
      WE.categories.tree().forEach(function (root) {
        if ((root.children || []).some(function (k) { return k.id === categoryId; })) 펼침[root.id] = true;
      });
    }
    function btn(node, depth, 자식있음) {
      var b = document.createElement("button"); b.type = "button";
      b.className = "public-library-category" + (node.id === categoryId ? " active" : "") + (depth ? " sub" : "");
      b.dataset.categoryId = node.id;
      // 화살표는 '자식이 있는 대분류' 에만. 없는 대분류에 빈 자리를 두면 줄이 어긋나 보인다.
      var 화살 = 자식있음
        ? '<span class="public-library-caret' + (펼침[node.id] ? " open" : "") + '" aria-hidden="true"></span>'
        : "";
      b.innerHTML = 화살 + '<span class="public-library-category-name">' + esc(WE.i18n.t(node.name)) + "</span>";
      if (자식있음) b.setAttribute("aria-expanded", 펼침[node.id] ? "true" : "false");
      box.appendChild(b);
    }
    var allBtn = document.createElement("button"); allBtn.type = "button";
    allBtn.className = "public-library-category" + (categoryId ? "" : " active");
    allBtn.dataset.categoryId = "";
    allBtn.innerHTML = '<span class="public-library-category-name">' + esc(WE.i18n.t(WE.categories.ALL)) + "</span>";
    box.appendChild(allBtn);
    // 대분류 한 줄씩. **펼친 것만** 그 아래 소분류를 들여쓰기(.sub)로 이어 그린다.
    WE.categories.tree().forEach(function (root) {
      var kids = root.children || [];
      btn(root, 0, kids.length > 0);
      if (펼침[root.id]) kids.forEach(function (kid) { btn(kid, 1, false); });
    });
  }
  function renderResults() {
    var list = document.getElementById("publicLibraryResultList");
    document.getElementById("publicLibraryResultCount").textContent = total.toLocaleString("ko-KR") + WE.i18n.t("개"); list.innerHTML = "";
    if (!rows.length) { list.innerHTML = '<div class="public-library-empty">' + WE.i18n.t("조건에 맞는 공용 부품이 없습니다.") + '</div>'; return; }
    rows.forEach(function (p) {
      var b = document.createElement("button"); b.type = "button";
      b.className = "public-library-result" + (p.id === selectedId ? " active" : ""); b.dataset.publicId = p.id;
      b.innerHTML = '<img loading="lazy" src="' + esc(p.thumbnail || p.image) + '" alt="" />' +
        '<span class="public-library-result-info"><span class="public-library-result-name">' + esc(p.name) + '</span>' +
        '<span class="public-library-result-meta">' + esc(p.spec || WE.i18n.t(p.category)) + WE.i18n.t(" · 단자 ") + p.terminalCount + WE.i18n.t("개") + '</span></span>' +
        (findLocal(p) ? '<span class="public-library-added">' + WE.i18n.t("추가됨") + '</span>' : "");
      list.appendChild(b);
    });
    if (rows.length < total) {
      var more = document.createElement("button"); more.type = "button"; more.className = "btn public-library-more"; more.dataset.more = "1";
      more.textContent = WE.i18n.t("더 보기 (") + rows.length + " / " + total + ")"; list.appendChild(more);
    }
  }
  function renderDetail(p, loading) {
    var box = document.getElementById("publicLibraryDetail"), add = document.getElementById("publicLibraryAdd"), place = document.getElementById("publicLibraryPlace");
    if (loading) { add.disabled = place.disabled = true; box.innerHTML = '<div class="public-library-detail-empty">' + WE.i18n.t("상세 정보를 불러오는 중입니다.") + '</div>'; return; }
    p = p || (selectedId && details[selectedId]) || selectedRow();
    add.disabled = !p || !p.full || !!findLocal(p); place.disabled = !p || !p.full;
    add.textContent = p && findLocal(p) ? WE.i18n.t("내 라이브러리에 추가됨") : WE.i18n.t("내 라이브러리에 추가");
    if (!p) { box.innerHTML = '<div class="public-library-detail-empty">' + WE.i18n.t("검색 결과에서 부품을 선택하세요.") + '</div>'; return; }
    if (!p.full) { box.innerHTML = '<div class="public-library-detail-empty">' + WE.i18n.t("상세 정보를 불러오는 중입니다.") + '</div>'; return; }
    // 미리보기 단가도 **BOM 에 나가는 쪽**을 보여준다(WE.library.bomPrice 와 같은 규칙)
    var shownPrice = WE.library.bomPrice(p);
    var price = (shownPrice === "" || shownPrice == null) ? WE.i18n.t("미입력") : (WE.i18n.lang() === "ko" ? Number(shownPrice).toLocaleString("ko-KR") + "원" : "₩" + Number(shownPrice).toLocaleString("en-US"));
    // BOM 에 실제로 나갈 링크 하나를 그대로 보여준다 — 상세와 BOM 이 어긋나면 안 된다.
    // 해외 링크가 있으면 해외, 없으면 국내가 나온다(위 linkPref 참고).
    var linkUrl = WE.library.bomLink(p);
    var link = linkUrl ? '<a class="public-library-link" href="' + esc(linkUrl) + '" target="_blank" rel="noopener">' + WE.i18n.t("구매처 열기") + '</a>' : WE.i18n.t("없음");
    box.innerHTML = '<img class="public-library-detail-image" src="' + esc(p.image) + '" alt="' + esc(p.name) + '" />' +
      '<h4>' + esc(p.name) + '</h4><p class="public-library-detail-spec">' + esc(p.spec || WE.i18n.t("상세 모델명 미입력")) + '</p>' +
      '<dl class="public-library-detail-grid"><dt>' + WE.i18n.t("분류") + '</dt><dd>' + esc(p.categoryId ? WE.categories.pathOf(p.categoryId) : WE.i18n.t(p.category || "미분류")) + '</dd>' +
      '<dt>' + WE.i18n.t("단가") + '</dt><dd>' + price + '</dd><dt>' + WE.i18n.t("구매 링크") + '</dt><dd>' + link + '</dd><dt>' + WE.i18n.t("데이터시트") + '</dt><dd>' + p.datasheets.length +
      WE.i18n.t("개") + '</dd></dl>';
  }
  function render() { renderCategories(); renderResults(); renderDetail(); }
  function open() {
    document.getElementById("publicLibraryModal").hidden = false;
    rows = []; selectedId = null; page = 0;
    render(); search(true);
    // 분류는 관리자 페이지에서 바뀔 수 있으므로 열 때마다 다시 읽는다(실패해도 폴백이라 안전).
    // 고른 분류가 사라졌으면 '전체'로 되돌린다 — 없는 분류로 검색하면 결과가 늘 0이다.
    WE.categories.load(true).then(function () {
      // 고른 분류가 사라졌으면 전체로 되돌린다 — 없는 분류로 검색하면 결과가 늘 0이다
      if (categoryId && !WE.categories.get(categoryId)) { categoryId = null; search(true); }
      renderCategories();
    });
  }
  function close() { document.getElementById("publicLibraryModal").hidden = true; }
  function place() {
    withFull(function (p) {
      // 배치한 공용 부품은 다음에도 바로 찾을 수 있도록 내 라이브러리에 한 번만 저장한다.
      // publicId로 중복을 막으므로 같은 부품을 여러 번 배치해도 라이브러리 항목은 하나다.
      var local = addPart(p);
      if (local && callbacks.placePart) callbacks.placePart(local);
      close();
    });
  }
  function init(opts) {
    callbacks = opts || {};
    document.getElementById("btnPublicLibrary").addEventListener("click", open);
    document.getElementById("publicLibraryClose").addEventListener("click", close);
    document.getElementById("publicLibraryCancel").addEventListener("click", close);
    document.getElementById("publicLibraryModal").addEventListener("click", function (e) { if (e.target === e.currentTarget) close(); });
    document.getElementById("publicLibraryModal").addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });
    document.getElementById("publicLibrarySearchForm").addEventListener("submit", function (e) { e.preventDefault(); search(true); });
    document.getElementById("publicLibraryRetry").addEventListener("click", function () { search(true); });
    document.getElementById("publicLibrarySearch").addEventListener("input", function () { clearTimeout(timer); timer = setTimeout(function () { search(true); }, 250); });
    document.getElementById("publicLibraryCategories").addEventListener("click", function (e) {
      var b = e.target.closest("button[data-category-id]"); if (!b) return;
      var id = b.dataset.categoryId || null;
      /* 대분류를 누르면 **고르면서 동시에 펼친다.** 두 번 누르는 수고를 만들지 않는다.
         이미 고른 대분류를 다시 누르면 접는다 — 접기 전용 화살표를 따로 두면
         한 줄에 누를 곳이 둘이 되어 어디를 눌러야 하는지 헷갈린다. */
      var 자식있음 = id && WE.categories.tree().some(function (r) {
        return r.id === id && (r.children || []).length > 0;
      });
      if (자식있음) 펼침[id] = (id === categoryId) ? !펼침[id] : true;
      categoryId = id;
      renderCategories(); search(true);
    });
    document.getElementById("publicLibraryResultList").addEventListener("click", function (e) {
      if (e.target.closest("button[data-more]")) { page++; (provider === "server" ? queryServer(false) : querySamples(false)).then(render); return; }
      var b = e.target.closest("button[data-public-id]"); if (!b) return; selectedId = b.dataset.publicId; renderResults(); loadDetail(selectedId);
    });
    document.getElementById("publicLibraryResultList").addEventListener("dblclick", function (e) { if (e.target.closest("button[data-public-id]")) place(); });
    document.getElementById("publicLibraryAdd").addEventListener("click", function () { withFull(addPart); });
    document.getElementById("publicLibraryPlace").addEventListener("click", place);
    if (new URLSearchParams(location.search).get("publicLibrary") === "1") setTimeout(open, 0);
  }
  return { init: init, open: open, close: close };
})();
