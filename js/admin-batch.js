// admin-batch.js — 관리자 페이지 「일괄 등록」. 부품 하나에 두 줄씩, 채워서 한 번에 게시한다. (2026-09-14)
//
// 왜 (고원빈, 2026-09-13/14):
//   지금은 부품 하나를 올리려면 라이브러리 추가 → 캔버스 배치 → 단자 편집 → 정보 입력 → 게시 창,
//   화면 네 개를 오가며 여섯 단계다. 250개를 그렇게는 못 한다.
//   특히 "이름·스펙만 다르고 나머지는 같은" 부품이 많다(다이오드처럼 그림·크기·단자 자리가 전부 같은 것).
//   그래서 줄마다 **「위 줄과 같음」 체크박스**(이미지·크기 / 단자)를 두어, 체크만 하면 위 줄 것을 그대로 쓴다.
//
// 화면 — 부품 하나 = 두 줄 (3차, 2026-09-14 고원빈 지적 반영: 이름·스펙 폭 축소, 상태 칸·역할·전기값 제거,
//   구매 링크·데이터시트는 에디터의 부품 편집 창(app.html #libEditModal)과 **같은 모양**으로)
//   1줄: # · 이미지 · 이름 · 스펙/설명 · 분류(대/소) · 단자 수 · [복제][삭제][게시]
//        [게시]는 조건이 안 차면 잠기고, 무엇이 빠졌는지는 그 버튼의 툴팁에 적힌다(상태 칸은 뺐다).
//   2줄: 위 줄과 같음(☐이미지·크기 ☐단자) · 이미지[편집][삭제] · 단자[편집] ·
//        구매 링크·단가 — (○)해외 [링크][단가] (○)국내 [링크][단가], 체크한 쪽이 BOM에 (에디터와 같은 라디오) ·
//        데이터시트 — [＋ 파일 추가][＋ 링크 추가] + 목록(열기/보기 · ×) (에디터와 같은 방식)
//   부품 정보는 전부 줄 안에서 바로 친다 — 따로 여는 '부품 정보' 창은 없다.
//   역할·전압·전류·전력은 화면에서 뺐다(일괄 등록에선 안 쓴다). 저장 데이터에는 에디터 기본값(load·빈값)으로 들어간다.
//
// 저장 데이터 모양은 에디터의 라이브러리 부품(js/library.js)·게시 part_data 와 같다 —
//   name·spec·categoryId·image·defaultWidth/Height·terminals·link·linkKr·linkPref·price·priceKr·datasheets(파일은
//   dataURL, 링크는 type:"link")·terminalPlacementQueue. publishPart 가 그대로 받아 올린다.
//
// 만드는 방식:
//   · 게시는 에디터 게시 창과 **같은 함수** WE.publicPublisher.publishPart 를 쓴다.
//     업로드 경로·새 키·썸네일·데이터시트 규칙(_ai/공용부품_운영규칙.md)이 한 곳에만 있어야 한다.
//     이 파일에는 storage 호출이 하나도 없어야 한다(검사가 본다).
//   · 단자 편집기(WE.termeditor)·이미지 편집기(WE.bgremove)는 관리자 페이지가 이미 쓰는 것을 그대로 쓴다.
//     단자 편집기의 저장 훅(WE.app.afterTerminalEdit)은 admin.js 가 먼저 잡아 두었으므로, 여기서는
//     "일괄 등록 줄을 편집 중일 때만" 가로채고 아니면 원래 훅에 넘긴다.
//   · 줄 내용은 IndexedDB 에 자동 저장한다 — 이미지가 붙은 줄이 20개면 localStorage 로는 모자란다.
//   · 이 화면은 **새 부품만** 만든다. 키는 publishPart 가 매번 새로 발급한다(운영규칙 ②).
//
// 「위 줄과 같음」의 뜻:
//   · sameImage — 이미지·너비·높이를 **바로 위 줄**에서 가져온다. 위 줄도 같음이면 그 위로 올라간다(체인).
//   · sameTerminals — 단자(좌표·이름·색)와 배치 큐를 위 줄에서 가져온다.
//   · 체크된 동안은 그 줄의 이미지/단자 편집이 잠긴다(위 줄에서 고치면 같이 바뀐다).
//     체크를 풀면 그 순간의 값을 그 줄에 복사해 독립시킨다 — 보이던 그대로 남는다.
//   · 위 줄을 지우면, 바로 아래 줄이 같음이었을 때 지워지는 줄의 값을 물려받고 독립한다.
//   · 첫 줄은 위가 없으므로 체크할 수 없다.
//
// ⚠ 이미지 드롭은 **바로 등록**한다(배경 제거 창을 띄우지 않는다). 여러 장을 한꺼번에 놓는
//    작업이라 장마다 창이 뜨면 흐름이 끊긴다. 손볼 이미지는 [이미지 편집]으로 배경 제거 창을 연다.
//    크기는 에디터의 새 부품 규칙과 같다 — 긴 변 160px.
var WE = window.WE || {};
window.WE = WE;

WE.adminBatch = (function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var rows = [];             // [{ id, name, spec, categoryId, image, width, height, terminals, sameImage, sameTerminals, ..., status }]
  var selectedId = null;     // 붙여넣기(Ctrl+V)가 들어갈 줄
  var editingId = null;      // 단자 편집기가 열려 있는 줄
  var publishingAll = false;
  var mode = "parts";
  var saveTimer = null, savedAt = "";
  var MAX_IMG_BYTES = 10 * 1024 * 1024;   // 에디터(app.js addImageFileToLibrary)와 같은 상한
  var LOCK_TITLE = "위 줄과 같음 — 위 줄에서 고치면 함께 바뀝니다. 따로 고치려면 체크를 푸세요";

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]; }); }
  function msg(text, kind) {
    var el = $("admMsg"); if (!el) return;
    el.textContent = text || ""; el.className = kind === "err" ? "error" : "muted";   // admin.js 의 msg() 와 같은 클래스
  }
  function byId(id) { for (var i = 0; i < rows.length; i++) if (rows[i].id === id) return rows[i]; return null; }
  function indexOf(r) { return rows.indexOf(r); }
  function newId() { return "b" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  // ── 줄(부품) ─────────────────────────────────────────────────────────────
  function newRow(from) {
    var r = {
      id: newId(), name: "", spec: "", categoryId: null,
      image: "", width: 160, height: 120,
      terminals: [], terminalPlacementQueue: [], terminalPlacementQueueVersion: undefined,
      sameImage: false, sameTerminals: false,
      priceKr: "", price: "", linkKr: "", link: "", linkPref: "kr",   // 기본 국내 — 디바이스마트 목록으로 채우는 작업이라
      datasheets: [],                                                   // [{ id, name, type, data }] 에디터와 같은 모양
      role: "load", volt: "", current: "", power: "",                    // 화면엔 없다 — 에디터 기본값 그대로
      status: "draft", error: "", publicId: "", publicVersion: 0
    };
    if (from) {
      /* 복제 — 이미지·단자·모든 칸을 그대로. 이름·스펙까지 복사한다(대개 한두 글자만 고친다).
         단자 id 는 새로 준다 — 편집기가 id 로 단자를 찾으므로 두 줄이 같은 id 를 들고 있으면 안 된다.
         같음 체크도 그대로 복사한다 — 복제는 바로 아래에 들어가므로 "위 줄" 이 곧 원본이라 뜻이 같다. */
      Object.keys(from).forEach(function (k) { if (k !== "id" && k !== "status" && k !== "error" && k !== "publicId" && k !== "publicVersion") r[k] = from[k]; });
      r.terminals = (from.terminals || []).map(function (t) { var c = cloneTerminal(t); c.id = WE.model.nextId("t"); return c; });
      r.terminalPlacementQueue = JSON.parse(JSON.stringify(from.terminalPlacementQueue || []));
      r.datasheets = (from.datasheets || []).map(function (d) { return { id: WE.model.nextId("ds"), name: d.name, type: d.type, data: d.data }; });
    }
    return r;
  }
  function cloneTerminal(t) {
    var out = { id: t.id, name: t.name, color: t.color, rx: t.rx, ry: t.ry };
    if (t.visible === false) out.visible = false;
    if (t.labelSide) out.labelSide = t.labelSide;
    if (t.labelPos) out.labelPos = { x: t.labelPos.x, y: t.labelPos.y };
    if (t.presetSource) out.presetSource = t.presetSource;
    if (t.presetId) out.presetId = t.presetId;
    return out;
  }
  function addRow(from) {
    var r = newRow(from);
    if (from) { var i = indexOf(from); rows.splice(i + 1, 0, r); } else rows.push(r);
    if (indexOf(r) === 0) { r.sameImage = false; r.sameTerminals = false; }   // 첫 줄은 위가 없다
    selectedId = r.id; render(); scheduleSave();
    return r;
  }
  function removeRow(id) {
    var r = byId(id); if (!r) return;
    var i = indexOf(r), below = rows[i + 1];
    // 바로 아래 줄이 이 줄을 따르고 있었다면, 지워지는 줄의 값을 물려주고 독립시킨다
    if (below) {
      if (below.sameImage) { var im = imageOf(r); below.image = im.image; below.width = im.width; below.height = im.height; below.sameImage = false; }
      if (below.sameTerminals) { var tm = terminalsOf(r); below.terminals = tm.terminals.map(cloneTerminal); below.terminalPlacementQueue = JSON.parse(JSON.stringify(tm.queue)); below.terminalPlacementQueueVersion = tm.queueVersion; below.sameTerminals = false; }
    }
    rows.splice(i, 1);
    if (rows[0]) { rows[0].sameImage = false; rows[0].sameTerminals = false; }
    if (selectedId === id) selectedId = null;
    render(); scheduleSave();
  }
  function clearDone() {
    // 게시된 줄을 치울 때도 아래 줄이 그 값을 잃지 않게 한 줄씩 지운다
    rows.filter(function (r) { return r.status === "done"; }).forEach(function (r) { removeRow(r.id); });
  }

  // ── 「위 줄과 같음」 풀이 — 체인을 따라 올라가 실제 값을 찾는다 ──────────────
  function imageOf(r) {
    var i = indexOf(r), cur = r;
    while (cur && cur.sameImage && i > 0) { i--; cur = rows[i]; }
    return cur ? { image: cur.image || "", width: cur.width || 160, height: cur.height || 120, base: cur } : { image: "", width: 160, height: 120, base: r };
  }
  function terminalsOf(r) {
    var i = indexOf(r), cur = r;
    while (cur && cur.sameTerminals && i > 0) { i--; cur = rows[i]; }
    return cur ? { terminals: cur.terminals || [], queue: cur.terminalPlacementQueue || [], queueVersion: cur.terminalPlacementQueueVersion, base: cur }
               : { terminals: [], queue: [], queueVersion: undefined, base: r };
  }
  function setSame(r, which, on) {
    if (indexOf(r) === 0) return;   // 첫 줄은 위가 없다
    if (which === "image") {
      if (!on && r.sameImage) { var im = imageOf(r); r.image = im.image; r.width = im.width; r.height = im.height; }   // 풀면 보이던 값을 복사해 독립
      r.sameImage = !!on;
    } else {
      if (!on && r.sameTerminals) { var tm = terminalsOf(r); r.terminals = tm.terminals.map(function (t) { var c = cloneTerminal(t); c.id = WE.model.nextId("t"); return c; }); r.terminalPlacementQueue = JSON.parse(JSON.stringify(tm.queue)); r.terminalPlacementQueueVersion = tm.queueVersion; }
      r.sameTerminals = !!on;
    }
    if (r.status === "error") { r.status = "draft"; r.error = ""; }
    render(); scheduleSave();
  }

  // 게시 조건 — 게시 창의 validate() 와 같다(이미지 · 이름 · 단자 1개 이상 · 분류 · 단자 이름/좌표)
  function problems(r) {
    var p = [], im = imageOf(r), tm = terminalsOf(r).terminals;
    if (!im.image) p.push("이미지");
    if (!String(r.name || "").trim()) p.push("이름");
    if (!r.categoryId) p.push("분류");
    if (!tm.length) p.push("단자");
    else if (tm.some(function (t) { return !String(t.name || "").trim(); })) p.push("이름 없는 단자");
    else if (tm.some(function (t) { return !isFinite(Number(t.rx)) || !isFinite(Number(t.ry)); })) p.push("좌표 없는 단자");
    return p;
  }
  function ready(r) { return r.status !== "done" && r.status !== "publishing" && problems(r).length === 0; }

  // ── 그리기 ───────────────────────────────────────────────────────────────
  // 전체를 다시 그리면 입력 중인 칸이 초점을 잃는다. 그래서 글자 칸은 input 이벤트에서 모델만 고치고
  // 상태 칸만 갱신한다(renderState). 줄 추가·복제·삭제·이미지·단자·같음처럼 구조가 바뀔 때만 render().
  function render() {
    var tb = $("admBatchRows"); if (!tb) return;
    tb.innerHTML = rows.map(rowHtml).join("");
    $("admBatchEmpty").hidden = rows.length > 0;
    rows.forEach(function (r) { fillCategory(r); });
    renderBar();
  }
  function rowHtml(r) {
    var idx = indexOf(r) + 1, first = idx === 1, done = r.status === "done";
    var im = imageOf(r), tm = terminalsOf(r), termN = tm.terminals.length;
    var dis = done ? " disabled" : "";
    var cls = (r.id === selectedId ? " selected" : "") + (done ? " done" : "");
    var imgLocked = r.sameImage, termLocked = r.sameTerminals;
    var miss = problems(r);
    // ── 1줄 ──
    var html =
      '<tr class="adm-batch-r1' + cls + '" data-id="' + r.id + '" data-missing="' + esc(miss.join(" · ")) + '">' +
      '<td class="c-no" rowspan="2">' + idx + '</td>' +
      '<td class="c-img"><div class="adm-batch-img' + (im.image ? " has" : "") + (imgLocked ? " same" : "") + '" data-act="image" title="' +
        (imgLocked ? LOCK_TITLE : (im.image ? "누르면 배경 제거·자르기 편집 · 바꾸려면 새 파일을 끌어다 놓기" : "이미지 파일을 끌어다 놓거나 눌러서 고르기")) + '">' +
        (im.image ? '<img src="' + esc(im.image) + '" alt="" />' : "＋") + (imgLocked ? '<span class="adm-batch-samebadge" title="위 줄과 같음">↑</span>' : "") + '</div></td>' +
      '<td class="c-name"><input type="text" data-k="name" value="' + esc(r.name) + '" placeholder="부품 이름"' + dis + ' /></td>' +
      '<td class="c-spec"><input type="text" data-k="spec" value="' + esc(r.spec) + '" placeholder="예: 2.1채널 D급 앰프"' + dis + ' /></td>' +
      '<td class="c-cat"><div class="c-cat-in"><select data-k="catRoot"' + dis + '></select><select data-k="categoryId"' + dis + '></select></div></td>' +
      '<td class="c-term"><span class="adm-batch-term"><b class="' + (termN ? "" : "zero") + '">' + termN + '개</b>' + (termLocked ? '<span class="adm-batch-samebadge" title="위 줄과 같음">↑</span>' : "") + '</span></td>' +
      '<td class="c-act">' +
        (done ? '<span class="adm-batch-done" title="공용 카탈로그에 올라갔습니다">게시됨 v' + esc(r.publicVersion) + '</span>' : "") +
        '<button type="button" class="adm-batch-btn" data-act="dup" title="이 줄을 복제 (이미지·단자·칸 그대로, 바로 아래에)">복제</button>' +
        '<button type="button" class="adm-batch-btn del" data-act="del" title="줄 삭제">삭제</button>' +
        (done ? "" : '<button type="button" class="adm-batch-btn go" data-act="publish"' + (ready(r) ? "" : " disabled") +
          ' title="' + (r.status === "publishing" ? esc(r.error || "게시 중…") : (miss.length ? esc(miss.join(" · ")) + " 필요" : "공용 카탈로그에 게시")) + '">' +
          (r.status === "publishing" ? "게시 중…" : "게시") + '</button>') +
      '</td></tr>';
    // ── 2줄 ──
    html +=
      '<tr class="adm-batch-r2' + cls + '" data-id="' + r.id + '"><td colspan="6"><div class="adm-batch-r2-in">' +
        '<div class="adm-batch-g adm-batch-same"><span class="adm-batch-g-label">위 줄과 같음</span>' +
          '<label title="' + (first ? "첫 줄은 위가 없습니다" : "이미지·너비·높이를 위 줄에서 가져옵니다") + '"><input type="checkbox" data-k="sameImage"' + (r.sameImage ? " checked" : "") + (first || done ? " disabled" : "") + ' /> 이미지·크기</label>' +
          '<label title="' + (first ? "첫 줄은 위가 없습니다" : "단자 위치·이름·색을 위 줄에서 가져옵니다") + '"><input type="checkbox" data-k="sameTerminals"' + (r.sameTerminals ? " checked" : "") + (first || done ? " disabled" : "") + ' /> 단자</label>' +
        '</div>' +
        '<div class="adm-batch-g"><span class="adm-batch-g-label">이미지</span>' +
          '<button type="button" class="adm-batch-btn" data-act="imgedit"' + (!im.image || imgLocked || done ? " disabled" : "") + ' title="' + (imgLocked ? LOCK_TITLE : "배경 제거·자르기") + '">편집</button>' +
          '<button type="button" class="adm-batch-btn del" data-act="imgdel"' + (!r.image || imgLocked || done ? " disabled" : "") + ' title="' + (imgLocked ? LOCK_TITLE : "이미지 지우기") + '">삭제</button>' +
        '</div>' +
        '<div class="adm-batch-g"><span class="adm-batch-g-label">단자</span>' +
          '<button type="button" class="adm-batch-btn" data-act="terminals"' + (!im.image || termLocked || done ? " disabled" : "") + ' title="' + (termLocked ? LOCK_TITLE : (im.image ? "단자 편집기 열기" : "이미지를 먼저 넣으세요")) + '">편집</button>' +
        '</div>' +
        // 구매 링크·단가 — 에디터의 부품 편집 창(.buy-link-row)과 같은 구성: 체크한 쪽 하나만 BOM에 나간다
        '<div class="adm-batch-g adm-batch-buy"><span class="adm-batch-g-label">구매 링크 · 단가 <em>체크한 쪽이 BOM에</em></span>' +
          '<label class="adm-batch-buy-item"><input type="radio" name="pref_' + r.id + '" data-k="linkPref" value="global"' + (r.linkPref === "global" ? " checked" : "") + dis + ' /><span class="buy-link-tag">해외</span>' +
            '<input type="text" data-k="link" value="' + esc(r.link) + '" placeholder="예: 알리익스프레스 https://..."' + dis + ' /><input type="text" data-k="price" inputmode="numeric" value="' + esc(r.price) + '" placeholder="단가(원)"' + dis + ' /></label>' +
          '<label class="adm-batch-buy-item"><input type="radio" name="pref_' + r.id + '" data-k="linkPref" value="kr"' + (r.linkPref === "kr" ? " checked" : "") + dis + ' /><span class="buy-link-tag">국내</span>' +
            '<input type="text" data-k="linkKr" value="' + esc(r.linkKr) + '" placeholder="https://..."' + dis + ' /><input type="text" data-k="priceKr" inputmode="numeric" value="' + esc(r.priceKr) + '" placeholder="단가(원)"' + dis + ' /></label>' +
        '</div>' +
        // 데이터시트 — 에디터의 .ds-section 과 같은 방식(파일 + 링크), 같은 CSS 클래스(.ds-item)
        '<div class="adm-batch-g adm-batch-ds"><span class="adm-batch-g-label">데이터시트 (PDF·이미지)</span>' +
          '<button type="button" class="adm-batch-btn" data-act="dsadd"' + dis + '>＋ 파일 추가</button>' +
          '<button type="button" class="adm-batch-btn" data-act="dslink"' + dis + '>＋ 링크 추가</button>' +
          '<div class="ds-list adm-batch-ds-list">' + dsListHtml(r, done) + '</div>' +
        '</div>' +
        (r.status === "error" && r.error ? '<div class="adm-batch-err" title="' + esc(r.error) + '">' + esc(r.error) + '</div>' : "") +
      '</div></td></tr>';
    return html;
  }
  // 데이터시트 목록 — 에디터의 renderDsList 와 같은 모양(아이콘 · 이름 · 열기/보기 · ×)
  function dsListHtml(r, done) {
    var list = r.datasheets || [];
    if (!list.length) return '<span class="muted">없음</span>';
    return list.map(function (d, i) {
      var remote = d.type === "link" || /^https?:\/\//i.test(String(d.data || ""));
      var icon = remote ? "🔗" : (d.type === "application/pdf" ? "📄" : "🖼️");
      var tip = remote ? (d.name + " — " + d.data) : d.name;
      return '<div class="ds-item"><span class="ds-name" title="' + esc(tip) + '">' + icon + " " + esc(d.name) + '</span>' +
        '<button type="button" class="ds-item-view" data-act="dsview" data-i="' + i + '">' + (remote ? "열기" : "보기") + '</button>' +
        (done ? "" : '<button type="button" class="ds-item-del" data-act="dsdel" data-i="' + i + '" title="삭제">×</button>') + '</div>';
    }).join("");
  }
  function tr1(r) { return $("admBatchRows").querySelector('tr.adm-batch-r1[data-id="' + r.id + '"]'); }
  // 글자 칸을 치는 동안은 전체를 다시 그리지 않고 [게시] 버튼·툴팁·오류줄만 갱신한다(초점 유지)
  function renderState(r) {
    var tr = tr1(r); if (!tr) return;
    var miss = problems(r);
    tr.dataset.missing = miss.join(" · ");
    var go = tr.querySelector('[data-act="publish"]');
    if (go) {
      go.disabled = !ready(r);
      go.textContent = r.status === "publishing" ? "게시 중…" : "게시";
      go.title = r.status === "publishing" ? (r.error || "게시 중…") : (miss.length ? miss.join(" · ") + " 필요" : "공용 카탈로그에 게시");
    }
    var ib = tr.querySelector(".c-name input"); if (ib) ib.classList.toggle("bad", !String(r.name || "").trim());
    var tr2 = document.querySelector('#admBatchRows tr.adm-batch-r2[data-id="' + r.id + '"]');
    if (tr2) {
      var box = tr2.querySelector(".adm-batch-r2-in"), errEl = tr2.querySelector(".adm-batch-err");
      if (r.status === "error" && r.error) {
        if (!errEl) { errEl = document.createElement("div"); errEl.className = "adm-batch-err"; box.appendChild(errEl); }
        errEl.textContent = r.error; errEl.title = r.error;
      } else if (errEl) errEl.parentNode.removeChild(errEl);
    }
    renderBar();
  }
  function renderBar() {
    var n = rows.filter(ready).length;
    var all = $("admBatchPublishAll");
    all.disabled = publishingAll || n === 0;
    all.textContent = publishingAll ? "게시 중…" : ("전체 게시" + (n ? " (" + n + ")" : ""));
    $("admBatchClearDone").hidden = !rows.some(function (r) { return r.status === "done"; });
    $("admBatchSaved").textContent = savedAt ? ("임시저장 " + savedAt + " · " + rows.length + "줄") : (rows.length ? rows.length + "줄" : "");
  }

  // 분류 두 칸 — 게시 창(public-publisher.js fillCategorySelects)과 같은 규칙:
  // 대분류를 고르면 둘째 칸에 「그 대분류에 직접」 + 소분류. 값은 소분류 id(또는 대분류 id 직접).
  function fillCategory(r) {
    var tr = tr1(r); if (!tr) return;
    var rootSel = tr.querySelector('[data-k="catRoot"]');
    var node = r.categoryId ? WE.categories.get(r.categoryId) : null;
    var rootId = node ? (node.parentId || node.id) : "";
    var roots = WE.categories.roots();
    rootSel.innerHTML = '<option value="">대분류</option>' + roots.map(function (c) {
      return '<option value="' + esc(c.id) + '"' + (c.id === rootId ? " selected" : "") + '>' + esc(c.name) + '</option>';
    }).join("");
    fillChild(r, tr, rootId);
  }
  function fillChild(r, tr, rootId) {
    var childSel = tr.querySelector('[data-k="categoryId"]');
    var root = rootId ? WE.categories.get(rootId) : null;
    if (!root) { childSel.innerHTML = '<option value="">소분류</option>'; return; }
    var kids = WE.categories.childrenOf(rootId);
    childSel.innerHTML = '<option value="' + esc(root.id) + '"' + (r.categoryId === root.id ? " selected" : "") + '>「' + esc(root.name) + '」에 직접</option>' +
      kids.map(function (k) { return '<option value="' + esc(k.id) + '"' + (k.id === r.categoryId ? " selected" : "") + '>' + esc(k.name) + '</option>'; }).join("");
    if (!r.categoryId || (r.categoryId !== root.id && !kids.some(function (k) { return k.id === r.categoryId; }))) {
      // 대분류를 막 골랐고 소분류를 아직 안 골랐다 — 소분류가 없으면 대분류 직접, 있으면 첫 소분류
      r.categoryId = kids.length ? kids[0].id : root.id;
      childSel.value = r.categoryId;
    }
  }

  // ── 이미지 ──────────────────────────────────────────────────────────────
  function readImageFile(file) {
    return new Promise(function (ok, no) {
      if (!file || file.type.indexOf("image/") !== 0) return no(new Error("이미지 파일이 아닙니다."));
      if (file.size > MAX_IMG_BYTES) return no(new Error("이미지가 너무 큽니다 (10MB 이내)."));
      var rd = new FileReader();
      rd.onload = function (ev) { ok(ev.target.result); };
      rd.onerror = function () { no(new Error("파일을 읽지 못했습니다.")); };
      rd.readAsDataURL(file);
    });
  }
  // 에디터의 새 부품 크기 규칙과 같다 — 긴 변 160px, 비율 유지
  function defaultSize(dataUrl) {
    return new Promise(function (ok) {
      var img = new Image();
      img.onload = function () {
        var maxSide = 160, w = img.width, h = img.height, r = w / h;
        if (w >= h) { w = maxSide; h = Math.round(maxSide / r); } else { h = maxSide; w = Math.round(maxSide * r); }
        ok({ width: w || 160, height: h || 120 });
      };
      img.onerror = function () { ok({ width: 160, height: 120 }); };
      img.src = dataUrl;
    });
  }
  function setImage(id, dataUrl, fileName) {
    var r = byId(id); if (!r) return Promise.resolve();
    return defaultSize(dataUrl).then(function (sz) {
      r.image = dataUrl; r.width = sz.width; r.height = sz.height;
      r.sameImage = false;   // 직접 넣었으니 위 줄과 같음은 푼다
      // 이름이 비어 있으면 파일 이름을 넣어 준다 — 에디터도 그렇게 한다(붙여넣기 껍데기 이름은 빼고)
      var base = String(fileName || "").replace(/\.[^.]+$/, "");
      if (!String(r.name || "").trim() && base && !/^(image|clipboard|캡처|screenshot)$/i.test(base)) r.name = base;
      if (r.status === "error") { r.status = "draft"; r.error = ""; }
      render(); scheduleSave();
    });
  }
  function clearImage(id) {
    var r = byId(id); if (!r || r.sameImage) return;
    // 아래 줄이 이 이미지를 따르고 있으면 그 줄에 값을 물려주고 독립시킨다 — 지웠다고 아래까지 비면 안 된다
    var below = rows[indexOf(r) + 1];
    if (below && below.sameImage) { below.image = r.image; below.width = r.width; below.height = r.height; below.sameImage = false; }
    r.image = ""; r.width = 160; r.height = 120;   // 단자는 남긴다 — 같은 종류의 사진으로 바꿀 때 다시 찍지 않게
    if (r.status === "error") { r.status = "draft"; r.error = ""; }
    render(); scheduleSave();
  }
  function filesToRows(files, targetId) {
    var list = Array.prototype.filter.call(files || [], function (f) { return f.type.indexOf("image/") === 0; });
    if (!list.length) return;
    // 특정 줄에 놓았으면 첫 장은 그 줄에, 나머지는 새 줄로. 빈 곳에 놓았으면 전부 새 줄.
    var chain = Promise.resolve();
    list.forEach(function (f, i) {
      chain = chain.then(function () {
        var id = (i === 0 && targetId) ? targetId : addRow().id;
        return readImageFile(f).then(function (url) { return setImage(id, url, f.name); })
          .catch(function (e) { msg(e.message || "이미지를 넣지 못했습니다.", "err"); });
      });
    });
  }
  function editImage(id) {
    var r = byId(id); if (!r || r.sameImage || !r.image || !WE.bgremove) return;
    WE.bgremove.open(r.image, function (url, tf, size) {
      r.image = url;
      if (size && size.width > 0) { r.width = size.width; r.height = size.height; }
      render(); scheduleSave();
    }, { width: r.width, height: r.height });
  }

  // ── 데이터시트 — 에디터(app.js bindLibEdit)와 같은 규칙 ──────────────────────
  //   파일: 20MB 상한, PNG/JPG/BMP 는 WebP 로 줄여 담는다(줄지 않으면 그대로). 링크: type "link", data 에 주소.
  var SHRINK_TYPES = { "image/png": 1, "image/jpeg": 1, "image/jpg": 1, "image/bmp": 1 };
  function shrinkAttachment(dataUrl, type, name, done) {
    if (!SHRINK_TYPES[type]) { done(dataUrl, type, name); return; }
    var im = new Image();
    im.onload = function () {
      var w = im.naturalWidth, h = im.naturalHeight;
      if (!w || !h || w > 8192 || h > 8192) { done(dataUrl, type, name); return; }
      var out;
      try {
        var cv = document.createElement("canvas"); cv.width = w; cv.height = h;
        var cx = cv.getContext("2d"); cx.imageSmoothingQuality = "high"; cx.drawImage(im, 0, 0);
        out = cv.toDataURL("image/webp", 0.85);
      } catch (err) { done(dataUrl, type, name); return; }
      if (out.indexOf("data:image/webp") !== 0 || out.length >= dataUrl.length) { done(dataUrl, type, name); return; }
      done(out, "image/webp", name.replace(/\.[^.]+$/, "") + ".webp");
    };
    im.onerror = function () { done(dataUrl, type, name); };
    im.src = dataUrl;
  }
  function addDatasheetFiles(id, files) {
    var r = byId(id); if (!r) return;
    Array.prototype.slice.call(files || []).forEach(function (f) {
      if (f.size > 20 * 1024 * 1024) { msg("파일이 너무 큽니다(20MB 초과): " + f.name, "err"); return; }
      var reader = new FileReader();
      reader.onload = function () {
        shrinkAttachment(reader.result, f.type || "application/octet-stream", f.name, function (data, type, name) {
          r.datasheets.push({ id: WE.model.nextId("ds"), name: name, type: type, data: data });
          render(); scheduleSave();
        });
      };
      reader.readAsDataURL(f);
    });
  }
  function addDatasheetLink(id) {
    var r = byId(id); if (!r) return;
    var url = (prompt("데이터시트 주소를 붙여넣으세요 (http:// 또는 https://)") || "").trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) { msg("http:// 또는 https:// 로 시작하는 주소만 넣을 수 있습니다.", "err"); return; }
    var guess = "";
    try { guess = decodeURIComponent((url.split("?")[0].split("#")[0].split("/").pop() || "")).slice(0, 60); } catch (_) {}
    var name = (prompt("이 링크의 이름", guess || "데이터시트") || "").trim() || (guess || "데이터시트");
    r.datasheets.push({ id: WE.model.nextId("ds"), name: name, type: "link", data: url });
    render(); scheduleSave();
  }
  function viewDatasheet(id, i) {
    var r = byId(id); var d = r && r.datasheets[i]; if (!d) return;
    // 링크·게시된 파일은 새 탭으로. 로컬 파일(dataURL)은 주소창 이동이 막히므로 Blob 주소로 연다
    if (d.type === "link" || /^https?:\/\//i.test(String(d.data || ""))) { window.open(d.data, "_blank", "noopener"); return; }
    fetch(d.data).then(function (res) { return res.blob(); }).then(function (b) {
      var u = URL.createObjectURL(b); window.open(u, "_blank", "noopener"); setTimeout(function () { URL.revokeObjectURL(u); }, 60000);
    }).catch(function () { msg("파일을 열지 못했습니다.", "err"); });
  }
  function removeDatasheet(id, i) {
    var r = byId(id); if (!r || !r.datasheets[i]) return;
    r.datasheets.splice(i, 1); render(); scheduleSave();
  }

  // ── 단자 편집 — 관리자 페이지의 openTerminalEditor 와 같은 방식 ──────────
  function openTerminals(id) {
    var r = byId(id); if (!r || r.sameTerminals || !WE.termeditor) return;
    var im = imageOf(r); if (!im.image) return;
    editingId = id;
    var cmp = {
      id: "batch_" + r.id, name: r.name || "부품", image: im.image, width: im.width, height: im.height,
      terminals: (r.terminals || []).map(function (t) { var c = cloneTerminal(t); if (!c.id) c.id = WE.model.nextId("t"); return c; }),
      terminalPlacementQueue: JSON.parse(JSON.stringify(r.terminalPlacementQueue || [])),
      terminalPlacementQueueVersion: r.terminalPlacementQueueVersion
    };
    WE.termeditor.open(cmp);
  }
  function onTerminalsSaved(cmp) {
    var r = byId(editingId); editingId = null;
    if (!r || !cmp) return;
    r.terminals = (cmp.terminals || []).map(cloneTerminal);
    r.terminalPlacementQueue = cmp.terminalPlacementQueue || [];
    r.terminalPlacementQueueVersion = cmp.terminalPlacementQueueVersion;
    if (r.status === "error") { r.status = "draft"; r.error = ""; }
    render(); scheduleSave();
  }
  // admin.js 가 먼저 잡아 둔 저장 훅을 감싼다 — 일괄 등록 줄을 편집 중일 때만 가로챈다
  var prevAfter = WE.app && WE.app.afterTerminalEdit;
  WE.app = WE.app || {};
  WE.app.afterTerminalEdit = function (cmp) {
    if (editingId) onTerminalsSaved(cmp);
    else if (prevAfter) prevAfter(cmp);
  };

  // ── 게시 ──────────────────────────────────────────────────────────────────
  function toPart(r) {
    var im = imageOf(r), tm = terminalsOf(r);
    return {
      name: r.name, spec: r.spec, categoryId: r.categoryId,
      image: im.image, width: im.width, height: im.height,
      terminals: tm.terminals,
      datasheets: (r.datasheets || []).map(function (d) { return { id: d.id, name: d.name, type: d.type, data: d.data }; }),
      link: r.link, linkKr: r.linkKr, linkPref: r.linkPref, price: r.price, priceKr: r.priceKr,
      role: r.role || "load", volt: r.volt || "", current: r.current || "", power: r.power || "",
      terminalPlacementQueue: tm.queue,
      terminalPlacementQueueVersion: tm.queueVersion
    };
  }
  function publishRow(id) {
    var r = byId(id);
    if (!r || r.status === "publishing" || r.status === "done") return Promise.resolve(false);
    var p = problems(r);
    if (p.length) { r.status = "error"; r.error = p.join(" · ") + " 필요"; renderState(r); return Promise.resolve(false); }
    if (!WE.publicPublisher || !WE.publicPublisher.publishPart) { msg("게시 기능을 불러오지 못했습니다.", "err"); return Promise.resolve(false); }
    r.status = "publishing"; r.error = "게시 중…"; renderState(r);
    return WE.publicPublisher.publishPart(toPart(r), function (t) { r.error = t; renderState(r); })
      .then(function (res) {
        r.status = "done"; r.publicId = res.publicId; r.publicVersion = res.publicVersion; r.error = "";
        return true;
      })
      .catch(function (e) {
        r.status = "error"; r.error = (e && e.message) || "게시하지 못했습니다.";
        return false;
      })
      .then(function (ok) { render(); scheduleSave(); return ok; });
  }
  /* 전체 게시 — 게시 가능한 줄만, **하나씩 차례로**.
     동시에 올리면 버전 번호를 클라이언트가 계산하는 구조라 겹칠 수 있다(운영규칙 4-㉱). */
  function publishAll() {
    if (publishingAll) return Promise.resolve();
    var targets = rows.filter(ready).map(function (r) { return r.id; });
    if (!targets.length) return Promise.resolve();
    publishingAll = true; renderBar();
    var okCount = 0, chain = Promise.resolve();
    targets.forEach(function (id) { chain = chain.then(function () { return publishRow(id); }).then(function (ok) { if (ok) okCount++; }); });
    return chain.then(function () {
      publishingAll = false; render();
      msg(okCount + "개 게시했습니다" + (okCount < targets.length ? " (" + (targets.length - okCount) + "개 실패 — 줄의 상태를 보세요)" : "."));
      afterPublish();
    });
  }
  function afterPublish() {
    // 게시된 부품 화면의 목록·개수를 새로 읽고, 로컬 백업 폴더가 있으면 바뀐 것만 따라 쓴다
    if (WE.adminPage && WE.adminPage.refresh) { try { WE.adminPage.refresh(); } catch (e) { /* 무시 */ } }
    if (WE.catalogBackup && WE.catalogBackup.supported && WE.catalogBackup.supported()) {
      WE.catalogBackup.syncChanged().catch(function (e) { msg("게시는 끝났지만 로컬 백업에 쓰지 못했습니다. " + ((e && e.message) || ""), "err"); });
    }
  }

  // ── 임시저장 (IndexedDB) ──────────────────────────────────────────────────
  var DB = "easycable-admin-batch", STORE = "draft", KEY = "rows";
  function idb() {
    return new Promise(function (ok, no) {
      if (!window.indexedDB) return no(new Error("no idb"));
      var req = indexedDB.open(DB, 1);
      req.onupgradeneeded = function () { req.result.createObjectStore(STORE); };
      req.onsuccess = function () { ok(req.result); };
      req.onerror = function () { no(req.error); };
    });
  }
  function loadDraft() {
    return idb().then(function (db) {
      return new Promise(function (ok) {
        var g = db.transaction(STORE, "readonly").objectStore(STORE).get(KEY);
        g.onsuccess = function () { ok(g.result || null); };
        g.onerror = function () { ok(null); };
      });
    }).catch(function () { return null; });
  }
  function saveDraft() {
    var snap = { rows: rows, savedAt: Date.now() };
    return idb().then(function (db) {
      return new Promise(function (ok, no) {
        var tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put(snap, KEY);
        tx.oncomplete = function () { ok(true); };
        tx.onerror = function () { no(tx.error); };
      });
    }).then(function () {
      var d = new Date(); savedAt = (d.getHours() < 10 ? "0" : "") + d.getHours() + ":" + (d.getMinutes() < 10 ? "0" : "") + d.getMinutes();
      renderBar();
    }).catch(function () { /* 저장 못 해도 화면은 계속 — 다음 변경에서 다시 시도한다 */ });
  }
  function scheduleSave() { clearTimeout(saveTimer); saveTimer = setTimeout(saveDraft, 400); }

  // ── 화면 전환 ─────────────────────────────────────────────────────────────
  function setMode(next) {
    mode = next === "batch" ? "batch" : next === "collect" ? "collect"
         : next === "members" ? "members" : "parts";
    var body = $("admBody"), search = $("admSearchForm"), batch = $("admBatch"),
        collect = $("admCollect"), members = $("admMembers");
    if (body) body.hidden = mode !== "parts";
    if (search) search.hidden = mode !== "parts";
    if (batch) batch.hidden = mode !== "batch";
    if (collect) collect.hidden = mode !== "collect";
    if (members) members.hidden = mode !== "members";
    // 사용자 부품 탭 — 들어갈 때 읽는다 (admin-collect.js). 없어도(옛 배포) 조용히 넘어간다
    if (mode === "collect" && WE.adminCollect && WE.adminCollect.enter) { try { WE.adminCollect.enter(); } catch (e) { /* 무시 */ } }
    // 회원·결제 탭도 같은 방식 — 들어갈 때 읽는다 (admin-members.js, 2026-09-22)
    if (mode === "members" && WE.adminMembers && WE.adminMembers.enter) { try { WE.adminMembers.enter(); } catch (e) { /* 무시 */ } }
    Array.prototype.forEach.call(document.querySelectorAll("#admMode .adm-mode-btn"), function (b) {
      b.classList.toggle("on", b.dataset.mode === mode);
    });
    if (mode === "batch") {
      // 분류는 관리자가 방금 바꿨을 수 있으므로 들어올 때마다 다시 읽는다(실패해도 폴백)
      WE.categories.load(true).then(function () { render(); });
    }
  }

  // ── 이벤트 ────────────────────────────────────────────────────────────────
  function bind() {
    var tb = $("admBatchRows"); if (!tb) return;
    var modeBox = $("admMode");
    if (modeBox) modeBox.addEventListener("click", function (e) {
      var b = e.target.closest(".adm-mode-btn"); if (b) setMode(b.dataset.mode);
    });
    $("admBatchAdd").addEventListener("click", function () { addRow(); focusName(rows[rows.length - 1]); });
    $("admBatchPublishAll").addEventListener("click", publishAll);
    $("admBatchClearDone").addEventListener("click", clearDone);

    // 글자 칸 — 모델만 고치고 상태 칸만 갱신(초점 유지)
    tb.addEventListener("input", function (e) {
      var k = e.target.dataset.k; if (!k || e.target.type === "checkbox" || e.target.type === "radio") return;
      var r = byId(e.target.closest("tr").dataset.id); if (!r) return;
      if (k === "catRoot") return;
      r[k] = e.target.value;
      if (r.status === "error") { r.status = "draft"; r.error = ""; }
      renderState(r); scheduleSave();
    });
    tb.addEventListener("change", function (e) {
      var k = e.target.dataset.k; if (!k) return;
      var tr = e.target.closest("tr"), r = byId(tr.dataset.id); if (!r) return;
      if (k === "sameImage") { setSame(r, "image", e.target.checked); return; }
      if (k === "sameTerminals") { setSame(r, "terminals", e.target.checked); return; }
      if (k === "catRoot") { r.categoryId = null; fillChild(r, tr1(r), e.target.value); }
      else if (k === "linkPref") { if (e.target.checked) r.linkPref = e.target.value; }   // 라디오 — 체크된 쪽이 BOM 기준
      else r[k] = e.target.value;
      if (r.status === "error") { r.status = "draft"; r.error = ""; }
      renderState(r); scheduleSave();
    });
    tb.addEventListener("click", function (e) {
      var tr = e.target.closest("tr"); if (!tr) return;
      var r = byId(tr.dataset.id); if (!r) return;
      if (selectedId !== r.id) { selectedId = r.id; markSelected(); }
      var act = e.target.closest("[data-act]"); if (!act) return;
      if (act.disabled) return;
      var a = act.dataset.act;
      if (a === "image") {
        if (r.sameImage) return;                                                       // 위 줄과 같음 — 위 줄에서
        if (r.image && e.target.tagName === "IMG") { editImage(r.id); return; }        // 그림을 누르면 편집, 빈 칸을 누르면 파일 고르기
        var fi = $("admBatchFile"); fi.dataset.row = r.id; fi.value = ""; fi.click();
      }
      else if (a === "imgedit") editImage(r.id);
      else if (a === "imgdel") clearImage(r.id);
      else if (a === "dsadd") { var di = $("admBatchDsFile"); di.dataset.row = r.id; di.value = ""; di.click(); }
      else if (a === "dslink") addDatasheetLink(r.id);
      else if (a === "dsview") viewDatasheet(r.id, +act.dataset.i);
      else if (a === "dsdel") removeDatasheet(r.id, +act.dataset.i);
      else if (a === "terminals") openTerminals(r.id);
      else if (a === "dup") { var d = addRow(r); focusName(d); }
      else if (a === "del") removeRow(r.id);
      else if (a === "publish") publishRow(r.id);
    });
    $("admBatchDsFile").addEventListener("change", function (e) {
      var id = e.target.dataset.row; if (!e.target.files || !e.target.files.length) return;
      addDatasheetFiles(id, e.target.files);
      e.target.value = "";
    });
    $("admBatchFile").addEventListener("change", function (e) {
      var id = e.target.dataset.row, f = e.target.files && e.target.files[0]; if (!f) return;
      readImageFile(f).then(function (url) { return setImage(id, url, f.name); })
        .catch(function (err) { msg(err.message || "이미지를 넣지 못했습니다.", "err"); });
      e.target.value = "";
    });

    // 끌어다 놓기 — 줄의 이미지 칸이면 그 줄에, 표 밖 빈 곳이면 새 줄로(여러 장이면 여러 줄)
    var area = document.querySelector(".adm-batch-wrap");
    area.addEventListener("dragover", function (e) {
      if (!(e.dataTransfer && e.dataTransfer.types && Array.prototype.indexOf.call(e.dataTransfer.types, "Files") >= 0)) return;
      e.preventDefault(); e.dataTransfer.dropEffect = "copy";
      var cell = e.target.closest(".adm-batch-img");
      area.classList.toggle("dragover", !cell);
      Array.prototype.forEach.call(area.querySelectorAll(".adm-batch-img.dragover"), function (c) { if (c !== cell) c.classList.remove("dragover"); });
      if (cell) cell.classList.add("dragover");
    });
    area.addEventListener("dragleave", function (e) {
      if (e.target === area) area.classList.remove("dragover");
      var cell = e.target.closest && e.target.closest(".adm-batch-img"); if (cell) cell.classList.remove("dragover");
    });
    area.addEventListener("drop", function (e) {
      area.classList.remove("dragover");
      Array.prototype.forEach.call(area.querySelectorAll(".adm-batch-img.dragover"), function (c) { c.classList.remove("dragover"); });
      var files = e.dataTransfer && e.dataTransfer.files; if (!files || !files.length) return;
      e.preventDefault();
      var cell = e.target.closest(".adm-batch-img");
      var tr = cell ? cell.closest("tr") : null;
      filesToRows(files, tr ? tr.dataset.id : null);
    });
    // 붙여넣기 — 일괄 등록 화면이 열려 있을 때, 선택한 줄에(없으면 새 줄에)
    document.addEventListener("paste", function (e) {
      if (mode !== "batch") return;
      if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;   // 글자 칸에 붙여넣는 중이면 그대로
      var items = e.clipboardData && e.clipboardData.items; if (!items) return;
      for (var i = 0; i < items.length; i++) {
        if (items[i].type.indexOf("image/") === 0) {
          var f = items[i].getAsFile(); if (!f) continue;
          e.preventDefault();
          var r = byId(selectedId) || addRow();
          readImageFile(f).then(function (url) { return setImage(r.id, url, ""); })
            .catch(function (err) { msg(err.message || "이미지를 넣지 못했습니다.", "err"); });
          return;
        }
      }
    });
  }
  function markSelected() {
    Array.prototype.forEach.call($("admBatchRows").querySelectorAll("tr"), function (tr) { tr.classList.toggle("selected", tr.dataset.id === selectedId); });
  }
  function focusName(r) {
    if (!r) return;
    var tr = tr1(r);
    var ib = tr && tr.querySelector(".c-name input"); if (ib) { ib.focus(); ib.select(); }
  }

  function init() {
    if (!$("admBatch")) return;
    bind();
    // 새로고침 전에 하던 줄을 되살린다. 게시 중이던 줄은 결과를 모르므로 '게시 전' 으로 되돌린다.
    loadDraft().then(function (d) {
      if (d && Array.isArray(d.rows)) {
        rows = d.rows.map(function (r) { if (r.status === "publishing") { r.status = "draft"; r.error = ""; } return r; });
        if (d.savedAt) { var t = new Date(d.savedAt); savedAt = (t.getHours() < 10 ? "0" : "") + t.getHours() + ":" + (t.getMinutes() < 10 ? "0" : "") + t.getMinutes(); }
      }
      if (mode === "batch") render(); else renderBar();
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  /* 밖에서 줄을 넣는다 — 「사용자 부품」 탭의 [일괄 등록으로 보내기](admin-collect.js).
     parts: [{ name, spec, image(data:), width, height, terminals, terminalPlacementQueue, terminalPlacementQueueVersion,
               link, linkKr, linkPref, price, priceKr, datasheets(링크형) }]. 넣은 줄 수를 돌려준다. */
  function addFromParts(parts) {
    var n = 0;
    (parts || []).forEach(function (p) {
      var r = addRow();
      r.name = p.name || ""; r.spec = p.spec || "";
      r.link = p.link || ""; r.linkKr = p.linkKr || ""; r.linkPref = p.linkPref === "global" ? "global" : "kr";
      r.price = p.price != null ? String(p.price) : ""; r.priceKr = p.priceKr != null ? String(p.priceKr) : "";
      r.datasheets = (p.datasheets || []).filter(function (d) { return d && d.type === "link"; })
        .map(function (d) { return { id: WE.model.nextId("ds"), name: d.name || "데이터시트", type: "link", data: d.data }; });
      if (p.role) r.role = p.role; if (p.volt) r.volt = p.volt; if (p.current) r.current = p.current; if (p.power) r.power = p.power;
      if (p.image) { r.image = p.image; r.width = p.width || 0; r.height = p.height || 0; r.sameImage = false; }
      if (p.terminals && p.terminals.length) {
        r.terminals = p.terminals.map(cloneTerminal); r.sameTerminals = false;
        r.terminalPlacementQueue = JSON.parse(JSON.stringify(p.terminalPlacementQueue || []));
        r.terminalPlacementQueueVersion = p.terminalPlacementQueueVersion;
      }
      n++;
    });
    render(); scheduleSave();
    return n;
  }

  return {
    setMode: setMode,
    addFromParts: addFromParts,
    // 검사용 이음매 — 브라우저 검사가 파일 드롭 없이 줄을 만들고 게시 흐름을 재기 위한 것. 앱 코드에서는 쓰지 않는다.
    _테스트_행: function () { return rows; },
    _테스트_행추가: function (from) { return addRow(from); },
    _테스트_이미지: setImage,
    _테스트_단자: function (id, list) { var r = byId(id); if (r) { r.terminals = (list || []).map(cloneTerminal); render(); scheduleSave(); } },
    _테스트_같음: setSame,
    _테스트_데이터시트: function (id, d) { var r = byId(id); if (r) { r.datasheets.push({ id: WE.model.nextId("ds"), name: d.name, type: d.type, data: d.data }); render(); scheduleSave(); } },
    _테스트_풀이: function (id) { var r = byId(id); return r ? { image: imageOf(r), terminals: terminalsOf(r).terminals } : null; },
    _테스트_전체게시: publishAll,
    _테스트_초안: loadDraft,
    _테스트_저장: saveDraft
  };
})();
