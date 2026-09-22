// admin.js — 관리자 페이지(admin.html). 공용 부품 분류 관리 + 게시 부품 확인.
//
// 화면은 공용 부품 창과 **같은 구성**이다 — 검색 + 3열(분류 · 검색 결과 · 상세).
// 사용자가 보는 화면과 같아야 "이렇게 보이겠구나"가 바로 오고 실수가 준다.
// 그 위에 관리 기능만 얹었다: 분류 편집·추가·순서변경·삭제, 부품의 분류 옮기기.
//
// ⚠ 여기 권한 확인은 '안내'다. 보안이 아니다.
//    admin.html 은 정적 파일이라 주소를 아는 사람은 열 수 있고, anon key 는 원래 공개다.
//    실제 방어선은 DB 의 RLS 로, 관리자가 아니면 추가·수정·삭제가 서버에서 거부된다.
//
// ⚠ 이 화면은 **DB 만 본다.** 공용 부품 창처럼 sample.ezc 로 넘어가지 않는다 —
//    관리 화면이 샘플을 보여주면 "게시했는데 왜 없지"를 영원히 못 찾는다.
//    실제로 2026-08-30 에 공용 부품 창의 '4개'가 샘플이라 관리자 화면(0개)과 어긋나 보였다.
(function () {
  "use strict";
  var WE = window.WE || {};
  var UNFILED = "__unfiled__";   // 분류가 없는 부품을 모아 보는 가짜 항목(DB 에는 없다)

  var counts = {};        // { 분류id: 부품수 } · UNFILED 도 센다
  var rows = [];          // 지금 목록에 보이는 부품
  var selected = null;    // 고른 분류 id (UNFILED, 또는 null = 전체)
  /* 대분류를 접었는지. 공용 부품 창(public-library.js 의 펼침)과 같은 개념이지만
     여기는 기본값이 반대다 — 지금까지 늘 다 펼쳐서 보여줬으므로, 새로 켠 접기 기능 때문에
     화면이 갑자기 소분류 없이 휑해지면 안 된다. 그래서 '명시적으로 false 를 넣은 것만' 접힌
     것으로 본다(id 가 없으면 펼침). (2026-09-03) */
  var expanded = {};
  var selectedPart = null;
  var detailCache = {};   // { public_key: part_data } — 단자 좌표는 여기 있다(목록 조회에는 안 담긴다)
  var showPins = true;    // 단자를 이미지 위에 겹쳐 보일지
  var partsError = "";    // 부품을 못 읽었을 때의 이유
  var countsExact = true; // 분류별 개수가 정확한가(RPC 를 못 쓰면 잘릴 수 있다)
  var PAGE = 60;          // 한 번에 불러오는 부품 수
  var page = 0, total = 0;
  var busy = false, seq = 0;

  // ── 단자 편집기를 이 페이지에서 쓰기 위한 껍데기 ──────────────────────────
  // termeditor.js 는 에디터용이라 WE.render / WE.app 을 부른다.
  // 여기엔 캔버스도 속성창도 없으므로 실제로 필요한 것(저장 훅)만 남기고 나머지는 빈 함수로 둔다.
  // 이렇게 하면 편집기를 **두 벌로 만들지 않고** 그대로 재사용할 수 있다.
  WE.render = WE.render || { renderAll: function () {} };
  WE.app = WE.app || {};
  if (!WE.app.setHint) WE.app.setHint = function (t) { msg(t || ""); };
  if (!WE.app.refreshProps) WE.app.refreshProps = function () {};
  // 프리셋 관리는 에디터와 **같은 모듈**을 쓴다(js/presetmodal.js).
  // 예전엔 여기서 "에디터에서 관리하세요" 라고 막아 뒀는데,
  // 관리자 페이지에서 단자를 손보려면 빠른 배치·세트가 그대로 필요하다.
  if (!WE.app.openPresetModal) WE.app.openPresetModal = function () {
    if (WE.presetModal) WE.presetModal.open();
    else msg("프리셋 관리 화면을 불러오지 못했습니다.", "err");
  };
  if (!WE.app.notice) WE.app.notice = function (t) { msg(t || "", "err"); };   // bgremove 가 쓴다
  // ⚠ 에디터에서 가져온 모듈 중 **init() 이 필요한 것**을 여기서 챙긴다.
  //    app.js 는 시작할 때 이것들을 부르는데 관리자 페이지엔 app.js 가 없다.
  //    빠뜨리면 "화면은 멀쩡한데 아무 반응이 없다"가 된다 —
  //    bgremove(이미지 편집 무반응) · presets(공용 단자 목록이 빔) 둘 다 실제로 그랬다.
  //    termeditor 는 open() 안에서 스스로 DOM 을 잡아 init 이 없어도 돌아서 더 헷갈렸다.
  if (WE.presets && WE.presets.init) WE.presets.init();
  if (WE.bgremove && WE.bgremove.init) WE.bgremove.init();
  // 편집기를 닫을 때 호출된다 = 저장 시점
  WE.app.afterTerminalEdit = function (cmp) { savePartTerminals(cmp); };

  function $(id) { return document.getElementById(id); }
  function client() { return WE.auth && WE.auth._client ? WE.auth._client() : null; }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function msg(text, kind) {
    var el = $("admMsg");
    el.textContent = text || "";
    el.className = kind === "err" ? "error" : "muted";
  }
  function show(which, why) {
    $("admLoading").hidden = which !== "loading";
    $("admDenied").hidden = which !== "denied";
    $("admBody").hidden = which !== "body";
    $("admSearchForm").hidden = which !== "body";
    // 화면 전환 버튼(게시된 부품 / 일괄 등록)은 권한 확인이 끝난 뒤에만 보인다.
    // 일괄 등록 화면 자체는 js/admin-batch.js 가 이 버튼으로 켜고 끈다.
    if ($("admMode")) $("admMode").hidden = which !== "body";
    if (which !== "body" && $("admBatch")) $("admBatch").hidden = true;
    if (which !== "body" && $("admCollect")) $("admCollect").hidden = true;
    if (which !== "body" && $("admMembers")) $("admMembers").hidden = true;   // 회원·결제 (2026-09-22)
    /* 아래 백업·복원 단추도 권한이 확인된 뒤에만. 눌러도 서버(RLS)가 막지만, "권한이 없습니다" 화면에
       관리 단추가 같이 보이면 뚫린 것처럼 보인다(2026-09-15 고원빈 스크린샷). */
    if ($("admFooter")) $("admFooter").hidden = which !== "body";
    if (why) $("admDeniedWhy").textContent = why;
  }

  // ── 분류 ────────────────────────────────────────────────────────────────
  // 분류별 개수 — DB 가 센다(public_category_counts).
  // ⚠ 예전엔 부품 행을 전부 내려받아 JS 에서 셌는데, PostgREST 는 한 번에 주는 행 수에
  //    상한(기본 1000)이 있어 부품이 1000개를 넘으면 **개수가 조용히 잘렸다.**
  //    느린 것보다 '틀린 숫자가 멀쩡히 떠 있는 것'이 더 나쁘다.
  //    RPC 가 없으면(05_admin_scale.sql 미실행) 예전 방식으로 물러나되 잘릴 수 있음을 알린다.
  function loadCounts() {
    var c = client();
    if (!c) return Promise.resolve({});
    return c.rpc("public_category_counts").then(function (res) {
      if (res.error || !res.data) throw res.error || new Error("no data");
      var n = {};
      res.data.forEach(function (r) { n[r.category_id || UNFILED] = Number(r.n) || 0; });
      countsExact = true;
      return n;
    }).catch(function () {
      return c.from("public_components").select("category_id").limit(1000).then(function (res) {
        if (res.error || !res.data) return {};
        var n = {};
        res.data.forEach(function (r) { var k = r.category_id || UNFILED; n[k] = (n[k] || 0) + 1; });
        countsExact = res.data.length < 1000;   // 1000 에 닿았으면 잘렸을 수 있다
        return n;
      }).catch(function () { return {}; });
    });
  }
  function countFor(node) {
    if (node.id === UNFILED) return counts[UNFILED] || 0;
    // 대분류는 자기에게 직접 붙은 것 + 하위 소분류의 합
    var own = counts[node.id] || 0;
    if (node.parentId) return own;
    return WE.categories.childrenOf(node.id).reduce(function (s, k) { return s + (counts[k.id] || 0); }, own);
  }

  function refresh() {
    return Promise.all([WE.categories.load(true), loadCounts()]).then(function (r) {
      counts = r[1];
      if (selected && selected !== UNFILED && !WE.categories.get(selected)) selected = null;
      renderCats(); renderParentSelect(); renderSetupWarning();
      checkStuckPayments();          // 놓친 결제가 있으면 알린다 (기다리지 않는다)
      return loadParts();
    });
  }

  // ── 놓친 결제 알림 ───────────────────────────────────────────────────────
  // 결제창에서 돌아오는 길이 끊기면 주문이 pending 에 남는다.
  // 자동 복구(js/payrecover.js)가 대부분 되살리고, 웹훅이 그다음을 맡는다.
  // **그래도 남는 것이 있을 때, 우리가 그 사실을 모르는 것**이 진짜 문제다 —
  // 손님이 문의해야 알게 되고, 그 전까지 돈은 받고 이용권은 안 준 상태로 남는다.
  //
  // ⚠ 갓 만들어진 pending 은 세지 않는다. 지금 결제창을 띄워 둔 사람의 주문이라
  //    그건 정상이다. 하루가 지난 것만 본다 — 그 시간이면 복구가 다 끝났어야 한다.
  var 놓침기준 = 24 * 60 * 60 * 1000;
  function checkStuckPayments() {
    var c = client(); if (!c) return;
    var 기준 = new Date(Date.now() - 놓침기준).toISOString();
    c.from("orders").select("id, buyer_email, amount, created_at")
      .eq("status", "pending")
      .lt("created_at", 기준)
      .order("created_at", { ascending: false })
      .limit(20)
      .then(function (res) {
        var box = $("admStuck"); if (!box) return;
        var 목록 = (res && res.data) || [];
        box.hidden = !목록.length;
        if (!목록.length) return;
        $("admStuckWhat").textContent =
          "⚠ 하루가 지난 미완료 주문이 " + 목록.length + "건 있습니다";
        // 주문번호를 그대로 보여 준다 — 포트원에서 찾으려면 이 값이 필요하다
        $("admStuckList").textContent = 목록.map(function (o) {
          return o.id + " (" + (o.buyer_email || "?") + " · " + o.amount + "원)";
        }).join(" / ");
      })
      .catch(function () { /* 조용히 넘어간다 — 이건 알림이지 기능이 아니다 */ });
  }

  // 분류 표를 못 읽어 폴백을 보고 있으면 크게 알린다.
  // 이게 없으면 화면이 멀쩡해 보이는데 추가·수정만 조용히 실패한다 —
  // 2026-08-30 에 실제로 "대분류 추가가 안 된다"로 막혔다.
  function isBroken() { return !!(WE.categories.usingFallback && WE.categories.usingFallback()); }
  function renderSetupWarning() {
    var broken = isBroken();
    var box = $("admSetup");
    if (box) {
      box.hidden = !broken;
      $("admSetupWhy").textContent = (WE.categories.lastError && WE.categories.lastError()) || "알 수 없음";
    }
    ["admNewName", "admNewParent"].forEach(function (id) { var el = $(id); if (el) el.disabled = broken; });
    var btn = document.querySelector("#admAddForm button");
    if (btn) btn.disabled = broken;
  }

  function catButton(node, kind) {
    var fixed = kind === "unfiled" || kind === "all";
    var row = document.createElement("div");
    row.className = "adm-cat " + kind + (node.id === (selected || "") ? " active" : "");
    row.dataset.id = node.id;

    // 대분류이면서 소분류가 있을 때만 접기 화살표. 공용 부품 창과 같은 모양(.public-library-caret)을
    // 그대로 쓴다 — 새 CSS를 안 만들어도 된다.
    var 자식있음 = kind === "root" && WE.categories.childrenOf(node.id).length > 0;
    if (자식있음) {
      var caret = document.createElement("span");
      caret.className = "public-library-caret" + (expanded[node.id] === false ? "" : " open");
      caret.setAttribute("aria-hidden", "true");
      row.appendChild(caret);
      row.setAttribute("aria-expanded", expanded[node.id] === false ? "false" : "true");
    }

    var grip = document.createElement("span");
    grip.className = "adm-grip";
    grip.textContent = fixed ? "" : "⠿";
    grip.draggable = !fixed && !isBroken();
    grip.title = "드래그해서 순서 변경";

    // 이름칸은 **항상 읽기전용으로 시작**한다. 한 번 클릭 = 분류 선택, 더블클릭 = 이름 편집.
    // 예전엔 늘 편집 가능해서, 분류를 고르려고 누르면 편집 상태가 되어 선택이 안 됐다.
    var name = document.createElement("input");
    name.type = "text"; name.className = "adm-name"; name.value = node.name;
    name.maxLength = 30; name.dataset.before = node.name;
    name.readOnly = true;
    var editable = !fixed && !isBroken();
    name.title = editable ? "더블클릭하면 이름을 고칠 수 있습니다"
      : (isBroken() ? "분류 표를 읽지 못해 임시 목록을 보고 있습니다. 위 안내를 확인해 주세요." : "");

    // 더블클릭 힌트(연필) — 마우스를 올렸을 때만 보인다. 눌러도 편집이 열린다.
    var hint = document.createElement("span");
    hint.className = "adm-edit-hint"; hint.textContent = editable ? "✎" : "";
    hint.title = "이름 고치기";

    var count = document.createElement("span");
    count.className = "adm-count";
    var n = kind === "all"
      ? Object.keys(counts).reduce(function (s, k) { return s + counts[k]; }, 0)
      : countFor(node);
    count.textContent = n ? n : "—";

    var del = document.createElement("button");
    del.type = "button"; del.className = "adm-del"; del.textContent = "×";
    if (fixed || isBroken()) del.disabled = true;
    else if (!node.parentId && WE.categories.childrenOf(node.id).length) {
      del.disabled = true; del.title = "하위 분류를 먼저 정리해 주세요";
    } else del.title = n ? "삭제 (부품 " + n + "개는 미분류로 갑니다)" : "삭제";

    row.appendChild(grip); row.appendChild(name); row.appendChild(hint);
    row.appendChild(count); row.appendChild(del);
    return row;
  }

  function renderCats() {
    var box = $("admList");
    box.innerHTML = "";
    // 지금 고른 분류가 소분류면 그 부모는 접혀 있어도 펼친다 —
    // 안 그러면 고른 것이 화면에서 사라져 어디를 보고 있는지 알 수 없다(공용 부품 창과 같은 규칙).
    if (selected) {
      WE.categories.tree().forEach(function (root) {
        if ((root.children || []).some(function (k) { return k.id === selected; })) expanded[root.id] = true;
      });
    }
    box.appendChild(catButton({ id: "", name: WE.categories.ALL, parentId: null }, "all"));
    WE.categories.tree().forEach(function (root) {
      box.appendChild(catButton(root, "root"));
      if (expanded[root.id] !== false) (root.children || []).forEach(function (kid) { box.appendChild(catButton(kid, "sub")); });
    });
    // 분류가 없는 부품이 있으면 맨 아래에 모아 보여준다 — 갇힌 부품을 놓치지 않게
    if (counts[UNFILED]) box.appendChild(catButton({ id: UNFILED, name: "미분류", parentId: null }, "unfiled"));
    // 개수를 서버가 못 세어 줬으면(05_admin_scale.sql 미실행) 숫자를 믿으면 안 된다고 알린다
    if (!countsExact) {
      var warn = document.createElement("div");
      warn.className = "adm-count-warn";
      warn.textContent = "※ 개수가 정확하지 않을 수 있습니다 (05_admin_scale.sql 실행 필요)";
      box.appendChild(warn);
    }
  }

  /* ── 공용 부품 삭제 ──────────────────────────────────────────────────────
     목록의 × → 확인 모달 → 삭제. 바로 지우지 않는 이유는 되돌릴 방법이 없기 때문이다
     (분류 삭제는 부품이 '미분류'로 살아남지만, 부품 삭제는 그걸로 끝이다).

     ⚠ 지우는 것은 **카탈로그 등록뿐**이다. 이미 자기 라이브러리에 담아 둔 사용자의 부품과
        그 부품이 놓인 배선도는 그대로 남는다(로컬 복사본이라 서버를 안 본다).
     ⚠ 저장소 파일은 '되는 만큼' 지운다. 파일이 남아도 카탈로그에는 안 보이므로 기능은 멀쩡하고,
        파일 정리에 실패했다고 삭제 자체를 되돌리면 오히려 상태가 어정쩡해진다. */
  var delKey = null;
  var delRestore = false;   // 이 창이 '내리기' 인가 '다시 게시' 인가
  function openDeleteModal(key) {
    var p = rows.filter(function (r) { return r.public_key === key; })[0];
    if (!p) return;
    delKey = key;
    $("admDelThumb").src = p.thumbnail_url || "";
    $("admDelName").textContent = p.name + (p.spec ? " (" + p.spec + ")" : "");
    $("admDelMeta").textContent =
      (p.category || "미분류") + " · 단자 " + Number(p.terminal_count || 0) + "개" +
      (p.status !== "published" ? " · " + p.status : "");
    /* 이미 내려 둔 부품이면 같은 창이 '다시 게시' 로 바뀐다.
       내리기와 되돌리기가 한 자리에 있어야 "되돌릴 수 있다" 가 실제로 쓰인다. */
    delRestore = p.status !== "published";
    $("admDelTitle").textContent = delRestore ? "공용 부품 다시 게시" : "공용 부품 내리기";
    $("admDelWarn").innerHTML = delRestore
      ? '내려 둔 이 부품을 <b>다시 게시합니다.</b>'
      : '이 부품을 공용 카탈로그에서 <b>내립니다.</b>';
    $("admDelNote").innerHTML = delRestore
      ? '손님의 공용 부품 검색에 다시 나옵니다.'
      : '손님의 공용 부품 검색에서 바로 사라집니다. ' +
        '이미 라이브러리에 담아 두었거나 도면에 놓인 부품은 <b>그대로 동작합니다</b> — ' +
        '자료를 지우는 것이 아니라 목록에서 감추는 것이라, 언제든 다시 게시할 수 있습니다.';
    $("admDelGo").textContent = delRestore ? "다시 게시" : "내리기";
    $("admDelGo").classList.toggle("danger", !delRestore);
    $("admDelStatus").textContent = "";
    $("admDelGo").disabled = false;
    lock완전삭제();                 // 열 때마다 다시 잠근다
    $("admDelModal").hidden = false;
    $("admDelGo").focus();
  }
  function closeDeleteModal() { $("admDelModal").hidden = true; delKey = null; lock완전삭제(); }

  /* 완전 삭제를 다시 잠근다. 창을 열 때·닫을 때마다 부른다 —
     **잠금이 풀린 채로 남으면 잠금장치가 아니다.** (백업 복원의 lockOverwrite 와 같은 규칙) */
  function lock완전삭제() {
    var b = $("admDelPurge"); if (!b) return;
    b.disabled = true;
    $("admPurgeLockRow").classList.remove("on");
    $("admPurgeLockText").textContent = "🔒 완전 삭제는 잠겨 있습니다";
    $("admPurgeUnlock").hidden = false;
  }
  function unlock완전삭제() {
    $("admDelPurge").disabled = false;
    $("admPurgeLockRow").classList.add("on");
    $("admPurgeLockText").textContent = "🔓 완전 삭제 잠금이 풀렸습니다";
    $("admPurgeUnlock").hidden = true;
  }

  /* 완전 삭제 — 카탈로그 행을 지운다. **스토리지 파일은 건드리지 않는다.**

     ⚠ 파일을 남기는 것이 핵심이다. 카탈로그 그림은 도면에 복사되지 않고 URL 로
        참조되던 때가 있어서, 파일을 지우면 그 부품을 쓴 도면의 그림이 깨진다.
        행만 지우면 "카탈로그에서 없앤다" 는 목적은 그대로 이루면서 아무것도 안 깨진다.
        아무도 안 쓰는 파일이 남지만, 그 정리는 백업·참조 확인을 갖춘 별도 작업이다. */
  function runPurge() {
    var key = delKey, c = client();
    if (!key) return;
    if (!c) { $("admDelStatus").textContent = "연결이 없습니다"; return; }
    var p = rows.filter(function (r) { return r.public_key === key; })[0];
    var 이름 = p ? p.name : key;
    // 화면만 믿지 않는다 — 잠긴 상태로 실행이 넘어와도 여기서 막는다
    if ($("admDelPurge").disabled) return;
    $("admDelPurge").disabled = true; $("admDelGo").disabled = true;
    $("admDelStatus").textContent = "지우는 중입니다…";
    c.from("public_components").delete().eq("public_key", key).then(function (res) {
      if (res && res.error) throw res.error;
      closeDeleteModal();
      if (selectedPart && selectedPart.public_key === key) selectedPart = null;
      msg("「" + 이름 + "」를 카탈로그에서 완전히 지웠습니다. 이미 쓰인 도면은 그대로 동작합니다.");
      return refresh();
    }).catch(function (e) {
      $("admDelPurge").disabled = false; $("admDelGo").disabled = false;
      $("admDelStatus").textContent = (e && e.message) || "지우지 못했습니다";
    });
  }

  /* ⚠ 예전에 여기 removeStorage() 가 있었다 — <public_key>/ 아래 파일을 전부 지웠다.
     2026-09-08 에 통째로 뺐다. 카탈로그 이미지는 도면에 복사되지 않고 URL 로 참조되므로,
     파일을 지우면 그 부품을 쓴 **모든 도면의 이미지가 깨진다.**
     영구 삭제가 정말 필요하면(법적 사유 등) 백업·영향 목록 확인을 갖춘 별도 절차로 만들 것.
     일상 버튼으로 되돌릴 수 없는 조치를 두지 않는다. */

  function runDelete() {
    var key = delKey, c = client(), 되살리기 = delRestore;
    if (!key) return;
    if (!c) { $("admDelStatus").textContent = "연결이 없습니다"; return; }
    var p = rows.filter(function (r) { return r.public_key === key; })[0];
    var 이름 = p ? p.name : key;
    var user = WE.auth.user && WE.auth.user();
    $("admDelGo").disabled = true;
    $("admDelStatus").textContent = 되살리기 ? "다시 게시하는 중입니다…" : "내리는 중입니다…";
    var 바꿀것 = { status: 되살리기 ? "published" : "unpublished",
                   updated_at: new Date().toISOString() };
    if (user) 바꿀것.updated_by = user.id;
    c.from("public_components").update(바꿀것).eq("public_key", key).then(function (res) {
      if (res && res.error) throw res.error;
      closeDeleteModal();
      if (selectedPart && selectedPart.public_key === key) selectedPart = null;
      msg(되살리기 ? "「" + 이름 + "」를 다시 게시했습니다."
                   : "「" + 이름 + "」를 카탈로그에서 내렸습니다. 자료는 그대로 있어 언제든 되돌릴 수 있습니다.");
      return refresh();
    }).catch(function (e) {
      $("admDelGo").disabled = false;
      $("admDelStatus").textContent = (e && e.message) || (되살리기 ? "다시 게시하지 못했습니다" : "내리지 못했습니다");
    });
  }

  // 대분류 전체 접기/펼치기 (Shift+C) — 에디터의 '라이브러리 폴더 전체 접기/펼치기'와 같은 규칙.
  // 하나라도 펼쳐져 있으면 전부 접고, 이미 다 접혀 있으면 전부 펼친다(같은 키로 되돌릴 수 있게).
  function allCatsCollapsed() {
    var 대상 = WE.categories.tree().filter(function (r) { return (r.children || []).length > 0; });
    if (!대상.length) return false;   // 접을 대분류가 하나도 없으면 '이미 접힘'으로 안 친다
    return 대상.every(function (r) { return expanded[r.id] === false; });
  }
  function toggleAllCats() {
    var collapse = !allCatsCollapsed();
    WE.categories.tree().forEach(function (r) {
      if ((r.children || []).length > 0) expanded[r.id] = !collapse;
    });
    renderCats();
    msg(collapse ? "대분류를 모두 접었습니다." : "대분류를 모두 펼쳤습니다.");
  }

  function renderParentSelect() {
    var sel = $("admNewParent"), keep = sel.value;
    sel.innerHTML = "";
    var top = document.createElement("option");
    top.value = ""; top.textContent = "＋ 대분류로 추가";
    sel.appendChild(top);
    WE.categories.roots().forEach(function (r) {
      var o = document.createElement("option");
      o.value = r.id; o.textContent = "└ " + r.name + " 아래로";
      sel.appendChild(o);
    });
    if (keep && sel.querySelector('option[value="' + keep + '"]')) sel.value = keep;
    else {
      var cur = selected && selected !== UNFILED ? WE.categories.get(selected) : null;
      var parent = cur ? (cur.parentId || cur.id) : null;
      if (parent && sel.querySelector('option[value="' + parent + '"]')) sel.value = parent;
    }
  }

  // ── 부품 ────────────────────────────────────────────────────────────────
  // 이 화면은 DB 만 본다. 못 읽으면 그 사실을 그대로 보여준다(샘플로 넘어가지 않는다).
  // 부품 목록. **한 번에 다 가져오지 않는다** — 부품이 수천 개가 되면 그게 그대로 렉이 된다.
  // PAGE 개씩 끊어 읽고 '더 보기'로 잇는다. 총 개수는 서버가 세어 준다(count: exact).
  function loadParts(more) {
    var mine = ++seq;
    var c = client();
    partsError = "";
    if (!more) { page = 0; rows = []; }
    if (!c) { rows = []; partsError = "연결이 없습니다"; renderParts(); return Promise.resolve([]); }
    if (!more) renderParts(true);
    var from = page * PAGE;
    var q = c.from("public_components")
      .select("public_key,name,spec,category,category_id,thumbnail_url,terminal_count,status,price", { count: "exact" })
      .order("name", { ascending: true }).range(from, from + PAGE - 1);
    if (selected === UNFILED) q = q.is("category_id", null);
    else if (selected) {
      var ids = WE.categories.idsFor(selected);   // 대분류면 하위까지 포함
      if (ids) q = q.in("category_id", ids);
    }
    // search_text 는 이름·모델명·단자명을 합쳐 둔 칸이고 trgm 색인이 걸려 있다(02_public_components.sql).
    // name 만 훑으면 부품이 많아질수록 전체 훑기가 된다.
    var text = $("admSearch").value.trim().replace(/[%_]/g, "").toLowerCase();
    if (text) q = q.ilike("search_text", "%" + text + "%");
    return q.then(function (res) {
      if (mine !== seq) return rows;
      if (res.error) throw res.error;
      total = Number(res.count || 0);
      rows = more ? rows.concat(res.data || []) : (res.data || []);
      if (!rows.some(function (p) { return selectedPart && p.public_key === selectedPart.public_key; })) {
        selectedPart = rows[0] || null;
      }
      renderParts();
      return rows;
    }).catch(function (e) {
      if (mine !== seq) return rows;
      rows = []; selectedPart = null;
      partsError = (e && e.message) || "부품 목록을 읽지 못했습니다";
      renderParts();
      return [];
    });
  }

  function renderParts(loading) {
    var title = selected === UNFILED ? "미분류 부품"
      : (selected ? "「" + WE.categories.pathOf(selected) + "」의 부품" : "게시된 부품");
    $("admPartsTitle").textContent = title;
    var box = $("admParts"), count = $("admPartsCount");
    if (loading) { count.textContent = ""; box.innerHTML = '<div class="public-library-empty">불러오는 중입니다…</div>'; return; }
    count.textContent = total > rows.length ? rows.length + " / " + total + "개" : rows.length + "개";
    if (partsError) {
      // 왜 비었는지 반드시 말한다. "게시했는데 왜 없지"를 못 찾게 두면 안 된다.
      box.innerHTML = '<div class="public-library-empty">부품 목록을 읽지 못했습니다.<br />' + esc(partsError) + "</div>";
      renderDetail(); return;
    }
    if (!rows.length) {
      box.innerHTML = '<div class="public-library-empty">' +
        (selected === UNFILED ? "분류가 없는 부품이 없습니다."
          : "게시된 부품이 없습니다.<br />에디터에서 부품 ⋯ → 공용 부품으로 게시… 로 올립니다.") + "</div>";
      renderDetail(); return;
    }
    box.innerHTML = "";
    rows.forEach(function (p) {
      var row = document.createElement("div");
      row.className = "public-library-result" + (selectedPart && p.public_key === selectedPart.public_key ? " active" : "");
      row.dataset.key = p.public_key;
      row.innerHTML =
        // 화면에 들어올 때만 내려받는다 — 목록이 길어질수록 이게 로딩 시간을 좌우한다
        '<img loading="lazy" decoding="async" src="' + esc(p.thumbnail_url || "") + '" alt="" />' +
        '<span class="public-library-result-info">' +
          '<span class="public-library-result-name">' + esc(p.name) + '</span>' +
          '<span class="public-library-result-meta">' +
            esc(p.category || "미분류") + ' · 단자 ' + Number(p.terminal_count || 0) + '개' +
            (p.status !== "published" ? ' · ' + esc(p.status) : '') + '</span>' +
        '</span>' +
        // 삭제(×) — 누르면 바로 지우지 않고 확인 모달을 띄운다
        '<button type="button" class="adm-part-del" data-del-key="' + esc(p.public_key) + '" title="공용 카탈로그에서 삭제">×</button>';
      box.appendChild(row);
    });
    // 남은 것이 있으면 이어 읽는다. 한 번에 다 그리면 부품이 수천 개일 때 그 자체가 렉이다.
    if (rows.length < total) {
      var more = document.createElement("button");
      more.type = "button"; more.className = "adm-more"; more.id = "admMore";
      more.textContent = "더 보기 (" + (total - rows.length) + "개 남음)";
      box.appendChild(more);
    }
    renderDetail();
  }

  function renderDetail() {
    var box = $("admDetail");
    var p = selectedPart;
    if (!p) { box.innerHTML = '<div class="public-library-detail-empty">목록에서 부품을 선택하세요.</div>'; return; }
    var price = (p.price == null || p.price === "") ? "미입력" : Number(p.price).toLocaleString("ko-KR") + "원";
    var full = detailCache[p.public_key];
    var pins = (full && full.terminals) || null;
    box.innerHTML =
      // 편집 버튼은 **상세 칸 맨 위 오른쪽**. 이미지 위에 얹으면 부품 그림을 가리고,
      // 아래에 두면 이미지가 클 때 화면 밖으로 밀려 잘렸다.
      '<div class="adm-detail-tools">' +
        '<button type="button" class="adm-edit-btn" id="admEditPins">✎ 단자 편집</button>' +
        '<button type="button" class="adm-edit-btn" id="admEditImage">🖼 이미지 편집</button>' +
      '</div>' +
      '<div class="adm-preview" id="admPreview">' +
        '<img src="' + esc((full && full.image) || p.thumbnail_url || "") + '" alt="' + esc(p.name) + '" />' +
      '</div>' +
      '<p class="adm-preview-note">' +
        (pins ? "단자 " + pins.length + "개" : "단자 좌표를 불러오는 중…") +
        '<button type="button" class="adm-preview-toggle" id="admPinToggle" aria-pressed="' + (showPins ? "true" : "false") + '">단자 표시</button>' +
      '</p>' +
      '<h4>' + esc(p.name) + '</h4>' +
      '<p class="public-library-detail-spec">' + esc(p.spec || "상세 모델명 미입력") + '</p>' +
      '<dl class="public-library-detail-grid">' +
        '<dt>분류</dt><dd>' + esc(p.category_id ? WE.categories.pathOf(p.category_id) : "미분류") + '</dd>' +
        '<dt>단자</dt><dd>' + Number(p.terminal_count || 0) + '개</dd>' +
        '<dt>단가</dt><dd>' + price + '</dd>' +
        '<dt>상태</dt><dd>' + esc(p.status || "") + '</dd>' +
        '<dt>부품 ID</dt><dd class="adm-part-id"><code title="' + esc(p.public_key) + '">' + esc(p.public_key) + '</code>' +
          '<button type="button" class="adm-copy-id" id="admCopyId">복사</button></dd>' +
      '</dl>' +
      '<div class="adm-detail-actions">' +
        '<label for="admMove">분류 옮기기</label>' +
        '<select id="admMove"></select>' +
      '</div>';
    if (pins) drawPins(pins);
    else loadDetailData(p.public_key);
    // 분류 옮기기 — 대분류에 직접 넣는 것도 고를 수 있다
    // (소분류를 아직 안 나눈 대분류가 있을 수 있다 — 2026-08-30 확정).
    var move = $("admMove");
    var none = document.createElement("option");
    none.value = ""; none.textContent = "미분류";
    if (!p.category_id) none.selected = true;
    move.appendChild(none);
    WE.categories.roots().forEach(function (r) {
      var g = document.createElement("optgroup"); g.label = r.name;
      var direct = document.createElement("option");
      direct.value = r.id; direct.textContent = "「" + r.name + "」에 직접";
      if (r.id === p.category_id) direct.selected = true;
      g.appendChild(direct);
      WE.categories.childrenOf(r.id).forEach(function (k) {
        var o = document.createElement("option");
        o.value = k.id; o.textContent = k.name;
        if (k.id === p.category_id) o.selected = true;
        g.appendChild(o);
      });
      move.appendChild(g);
    });
    move.disabled = isBroken();
  }

  // 단자 좌표는 part_data(jsonb) 안에 있다. 목록 조회에는 안 담으므로 고를 때만 따로 읽는다.
  function loadDetailData(key) {
    var c = client(); if (!c || detailCache[key]) return;
    c.from("public_components").select("public_key,part_data").eq("public_key", key).single()
      .then(function (res) {
        if (res.error || !res.data) return;
        detailCache[key] = res.data.part_data || {};
        if (selectedPart && selectedPart.public_key === key) renderDetail();
      }).catch(function () { /* 못 읽으면 이미지만 보여준다 */ });
  }

  // 이미지 위에 단자를 겹쳐 그린다.
  // rx/ry 는 부품 크기에 대한 '비율'이라 이미지가 어떤 크기로 눕든 같은 자리에 찍힌다.
  // ⚠ object-fit: contain 이라 이미지가 상자보다 작게 들어간다. 그 여백을 빼고 계산해야
  //    단자가 실제 부품 위에 얹힌다(안 그러면 전부 어긋나 보인다).
  function drawPins(pins) {
    var wrap = $("admPreview"); if (!wrap) return;
    var img = wrap.querySelector("img"); if (!img) return;
    function paint() {
      var old = wrap.querySelector("svg"); if (old) old.remove();
      if (!showPins || !pins.length) return;
      var bw = wrap.clientWidth, bh = wrap.clientHeight;
      var iw = img.naturalWidth || 1, ih = img.naturalHeight || 1;
      var scale = Math.min(bw / iw, bh / ih);            // contain
      var dw = iw * scale, dh = ih * scale;
      var ox = (bw - dw) / 2, oy = (bh - dh) / 2;        // 가운데 정렬 여백
      var ns = "http://www.w3.org/2000/svg";
      var svg = document.createElementNS(ns, "svg");
      svg.setAttribute("viewBox", "0 0 " + bw + " " + bh);
      pins.forEach(function (t) {
        var x = ox + Number(t.rx || 0) * dw, y = oy + Number(t.ry || 0) * dh;
        var c1 = document.createElementNS(ns, "circle");
        c1.setAttribute("cx", x); c1.setAttribute("cy", y); c1.setAttribute("r", 5);
        c1.setAttribute("fill", t.color || "#1e88e5");
        c1.setAttribute("stroke", "#fff"); c1.setAttribute("stroke-width", "2");
        svg.appendChild(c1);
        var label = document.createElementNS(ns, "text");
        // 이름이 상자 밖으로 나가면 잘린다. 위가 모자라면 점 아래에 쓴다.
        var ly = y - 8 < 10 ? y + 14 : y - 8;
        label.setAttribute("x", Math.max(14, Math.min(bw - 14, x)));
        label.setAttribute("y", ly);
        label.setAttribute("text-anchor", "middle");
        label.setAttribute("font-size", "10");
        label.setAttribute("fill", "#222");
        label.setAttribute("stroke", "#fff");
        label.setAttribute("stroke-width", "3");
        label.setAttribute("paint-order", "stroke");
        label.textContent = t.name || "";
        svg.appendChild(label);
      });
      wrap.appendChild(svg);
    }
    if (img.complete && img.naturalWidth) paint();
    else img.addEventListener("load", paint, { once: true });
  }

  // 편집 대상으로 쓸 임시 부품을 만든다.
  // termeditor 는 컴포넌트 객체 하나만 받으므로 모델에 넣을 필요가 없다.
  var editingKey = null;
  function openTerminalEditor() {
    var p = selectedPart; if (!p) return;
    var full = detailCache[p.public_key];
    if (!full || !full.image) { msg("부품 원본을 아직 불러오지 못했습니다. 잠시 후 다시 눌러 주세요.", "err"); return; }
    editingKey = p.public_key;
    var cmp = {
      id: "adm_" + p.public_key,
      name: p.name,
      image: full.image,
      width: Number(full.defaultWidth) || 160,
      height: Number(full.defaultHeight) || 120,
      terminals: (full.terminals || []).map(function (t) {
        return {
          id: WE.model.nextId("t"), name: t.name, color: t.color, rx: t.rx, ry: t.ry,
          visible: t.visible, labelSide: t.labelSide,
          labelPos: t.labelPos ? { x: t.labelPos.x, y: t.labelPos.y } : undefined
        };
      }),
      terminalPlacementQueue: full.terminalPlacementQueue || [],
      terminalPlacementQueueVersion: full.terminalPlacementQueueVersion
    };
    WE.termeditor.open(cmp);
  }

  // 백업 상태를 **늘 보이게** 한다.
  // 예전엔 결과가 잠깐 스쳐 지나가는 한 줄뿐이라, 나중에 보면 백업이 됐는지 알 수가 없었다
  // (고원빈 지적, 2026-08-30). 게다가 백업은 "됐겠지" 하고 넘어가면 그걸로 끝이라
  // **언제 무엇이 담겼는지가 항상 보여야** 한다.
  // ⚠ 폴더에서 직접 읽는다 — 어딘가 적어 둔 값을 보여주면 폴더를 지웠을 때 거짓말을 한다.
  function 언제(iso) {
    if (!iso) return null;
    var d = new Date(iso); if (isNaN(d)) return null;
    var 지금 = Date.now(), 초 = (지금 - d.getTime()) / 1000;
    var 시각 = (d.getMonth() + 1) + "/" + d.getDate() + " " +
      String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
    var 전 = 초 < 90 ? "방금" : 초 < 3600 ? Math.round(초 / 60) + "분 전"
      : 초 < 86400 ? Math.round(초 / 3600) + "시간 전" : Math.round(초 / 86400) + "일 전";
    return { 글: 시각 + " (" + 전 + ")", 오래됨: 초 > 7 * 86400 };
  }
  function showBackupWhere() {
    var el = $("admBackupWhere"); if (!el) return;
    if (!WE.catalogBackup.supported()) {
      el.textContent = "이 브라우저는 폴더 저장을 지원하지 않습니다 (데이터만 내려받습니다)";
      el.className = "adm-backup-where warn";
      $("admPickFolder").disabled = true;
      return;
    }
    WE.catalogBackup.status().then(function (st) {
      el.className = "adm-backup-where";
      if (st.상태 === "none") { el.textContent = el.title = "⚠ 백업 폴더가 지정되지 않았습니다 — 사본이 서버 한 벌뿐입니다"; el.className += " warn"; return; }
      if (st.상태 === "denied") { el.textContent = el.title = "⚠ 백업 폴더 권한이 풀렸습니다 — [백업 폴더 지정]을 다시 눌러 주세요"; el.className += " warn"; return; }
      if (st.상태 === "읽기실패") { el.textContent = "⚠ 백업 폴더를 읽지 못했습니다"; el.className += " warn"; return; }
      if (st.상태 === "빈폴더") { el.textContent = el.title = "📁 " + st.폴더 + " · 아직 백업한 적이 없습니다 — [⤓ 전체 백업]을 눌러 주세요"; el.className += " warn"; return; }
      var 때 = 언제(st.마지막);
      var 글 = "📁 " + st.폴더 + " · 부품 " + st.부품 + "개 · 분류 " + st.분류 + "개";
      글 += 때 ? " · 마지막 백업 " + 때.글 : " · 마지막 백업 시각 없음";
      if (st.옛배치) { 글 += " · ⚠ 옛 배치입니다. [⤓ 전체 백업]을 한 번 눌러 주세요"; el.className += " warn"; }
      else if (때 && 때.오래됨) { 글 += " · ⚠ 오래됐습니다"; el.className += " warn"; }
      el.textContent = 글;
    });
  }

  // ── 복원(가져오기) ───────────────────────────────────────────────────────
  // 서버에 쓰는 기능이라 **미리보기 → 확인 → 실행** 순서를 강제한다.
  // 미리보기가 끝나기 전에는 [복원 실행] 이 눌리지 않는다(disabled).
  var 복원중 = false;
  var 덮어쓰기말 = "덮어쓰기";   // 잠금 해제에 입력해야 하는 문구

  // 덮어쓰기를 다시 잠근다. 창을 열 때·닫을 때마다 부른다 —
  // **잠금이 풀린 채로 남으면 잠금장치가 아니다.**
  function lockOverwrite() {
    var radio = $("restoreOverRadio"); if (!radio) return;
    radio.disabled = true;
    radio.checked = false;
    var add = document.querySelector('input[name="restoreMode"][value="add"]');
    if (add) add.checked = true;
    $("restoreOverLabel").classList.add("locked");
    $("restoreLockRow").hidden = false;
    $("restoreLockRow").classList.remove("on");
    $("restoreLockText").textContent = "🔒 덮어쓰기는 잠겨 있습니다";
    $("restoreUnlock").hidden = false;
    $("restoreTypeRow").hidden = true;
    $("restoreConfirmText").value = "";
    syncGoLabel();
  }
  function unlockOverwrite() {
    $("restoreOverRadio").disabled = false;
    $("restoreOverLabel").classList.remove("locked");
    $("restoreLockRow").classList.add("on");
    $("restoreLockText").textContent = "🔓 덮어쓰기 잠금이 풀렸습니다";
    $("restoreUnlock").hidden = true;
    $("restoreTypeRow").hidden = true;
  }
  // 실행 버튼이 **무슨 일이 일어나는지** 말하게 한다.
  // "복원 실행" 만 적혀 있으면 덮어쓰기인지 추가인지 구분이 안 된다.
  function syncGoLabel() {
    var btn = $("restoreGo"); if (!btn) return;
    var over = ($("restoreOverRadio") || {}).checked;
    btn.textContent = over ? "덮어쓰기 실행" : "복원 실행";
    btn.classList.toggle("danger", !!over);
  }

  function openRestore() {
    if (!WE.catalogRestore) { msg("복원 기능을 불러오지 못했습니다.", "err"); return; }
    var box = $("restoreModal"); if (!box) return;
    box.hidden = false;
    $("restoreTable").hidden = true;
    $("restoreMode").hidden = true;
    $("restoreWarn").hidden = true;
    $("restoreGo").disabled = true;
    lockOverwrite();                    // 열 때마다 잠근 상태에서 시작한다
    $("restoreStatus").textContent = "";
    $("restoreStatus").className = "muted";
    $("restoreSummary").textContent = "백업 폴더를 읽는 중입니다…";
    $("restoreSummary").className = "muted";

    WE.catalogRestore.preview().then(function (p) {
      var 때 = p.만든때 ? new Date(p.만든때) : null;
      $("restoreSummary").textContent =
        "백업" + (때 && !isNaN(때) ? " (" + (때.getMonth() + 1) + "/" + 때.getDate() + " 기준)" : "") +
        " 에 분류 " + p.분류.백업 + "개 · 부품 " + p.부품.백업 + "개가 들어 있습니다. " +
        "지금 서버에는 분류 " + p.서버.분류 + "개 · 부품 " + p.서버.부품 + "개가 있습니다.";
      $("rcBak").textContent = p.분류.백업; $("rcNew").textContent = p.분류.새로; $("rcDup").textContent = p.분류.겹침;
      $("rpBak").textContent = p.부품.백업; $("rpNew").textContent = p.부품.새로; $("rpDup").textContent = p.부품.겹침;
      $("restoreTable").hidden = false;
      $("restoreMode").hidden = false;
      // 못 읽은 부품이 있으면 조용히 넘어가지 않는다 — 그만큼 덜 복원된다
      if (p.못읽음 && p.못읽음.length) {
        $("restoreWarn").textContent = "⚠ " + p.못읽음.length + "개 부품 폴더를 읽지 못했습니다(" +
          p.못읽음.slice(0, 3).join(", ") + "). 그만큼은 복원되지 않습니다.";
        $("restoreWarn").hidden = false;
      }
      $("restoreGo").disabled = (p.분류.백업 + p.부품.백업) === 0;
    }).catch(function (e) {
      $("restoreSummary").textContent = (e && e.message) || "백업을 읽지 못했습니다.";
      $("restoreSummary").className = "error";
    });
  }
  function closeRestore() { var b = $("restoreModal"); if (b) b.hidden = true; lockOverwrite(); }
  function runRestore() {
    if (복원중) return;
    var mode = (document.querySelector('input[name="restoreMode"]:checked') || {}).value || "add";
    // ⚠ 확인 창(confirm)을 쓰지 않는다. 반사적으로 눌러 버려 방어가 안 된다.
    //    대신 잠금 해제에 문구를 직접 입력하게 했다(위 unlockOverwrite).
    //    잠긴 상태에서 덮어쓰기가 넘어오면 코드 쪽에서도 막는다 — 화면만 믿지 않는다.
    if (mode === "overwrite" && $("restoreOverRadio").disabled) {
      $("restoreStatus").textContent = "덮어쓰기가 잠겨 있습니다.";
      $("restoreStatus").className = "error";
      return;
    }
    복원중 = true;
    $("restoreGo").disabled = true;
    WE.catalogRestore.apply({ mode: mode }, function (done, total, name) {
      $("restoreStatus").textContent = total ? "복원 중… " + done + "/" + total + (name ? " · " + name : "") : name;
    }).then(function (r) {
      var 줄 = "복원 완료 — 분류 " + r.분류추가 + "개 · 부품 " + r.부품추가 + "개 추가";
      if (r.부품덮음) 줄 += " · " + r.부품덮음 + "개 덮어씀";
      if (r.건너뜀) 줄 += " · " + r.건너뜀 + "개는 이미 있어 건드리지 않음";
      if (r.남긴파일) 줄 += " · 복원 전 상태를 " + r.남긴파일 + " 로 남겼습니다";
      if (r.실패 && r.실패.length) {
        msg(줄 + " · ⚠ " + r.실패.length + "개 실패: " + r.실패.slice(0, 2).join(", "), "err");
      } else msg(줄);
      closeRestore();
      refresh();                 // 화면을 서버 기준으로 다시 그린다
      showBackupWhere();
    }).catch(function (e) {
      $("restoreStatus").textContent = (e && e.message) || "복원하지 못했습니다.";
      $("restoreStatus").className = "error";
    }).then(function () { 복원중 = false; $("restoreGo").disabled = false; });
  }

  // ── 로컬 자동 백업 ────────────────────────────────────────────────────────
  // 서버에 저장한 **뒤에** 로컬에도 따라 쓴다. 세 가지를 지킨다:
  //  ① 로컬이 실패해도 **서버 저장을 되돌리지 않는다** — 이미 성공한 걸 취소하면 오히려 손해다
  //  ② **조용히 넘어가지 않는다** — 실패는 반드시 화면에 말한다. 조용히 실패하면 백업이 아니다
  //  ③ 권한을 다시 묻지 않는다 — 저장 직후는 비동기라 사용자 조작 흐름이 끊겨 물을 수가 없다
  //     (폴더를 아예 안 골랐으면 그건 선택이므로 조용히 넘어간다)
  function autoBackup(본문) {
    if (!WE.catalogBackup || !WE.catalogBackup.supported()) { msg(본문); return; }
    msg(본문 + " · 로컬 백업 중…");
    WE.catalogBackup.syncChanged().then(function (r) {
      if (r.상태 === "폴더없음") { msg(본문); return; }
      if (r.실패 && r.실패.length) {
        msg(본문 + " · ⚠ 로컬 백업에서 " + r.실패.length + "개를 못 담았습니다: " + r.실패.slice(0, 2).join(", "), "err");
      } else msg(본문 + " · 로컬 백업 완료");
      showBackupWhere();
    }).catch(function (e) {
      msg(본문 + " · ⚠ 로컬 백업 실패: " + ((e && e.message) || "알 수 없는 오류"), "err");
    });
  }

  // 편집기를 닫으면 그 자리에서 DB 에 저장한다(새 버전이 아니라 같은 부품을 갱신).
  // ⚠ RLS 의 update 정책이 updated_by = auth.uid() 를 요구하므로 반드시 같이 넣는다.
  function savePartTerminals(cmp) {
    var key = editingKey; editingKey = null;
    if (!key || !cmp) return;
    var c = client(), user = WE.auth.user && WE.auth.user();
    if (!c || !user) { msg("로그인이 필요합니다.", "err"); return; }
    var full = detailCache[key] || {};
    var terminals = (cmp.terminals || []).map(function (t) {
      var out = { name: t.name, color: t.color, rx: t.rx, ry: t.ry };
      if (t.visible === false) out.visible = false;
      if (t.labelSide) out.labelSide = t.labelSide;
      if (t.labelPos) out.labelPos = { x: t.labelPos.x, y: t.labelPos.y };
      return out;
    });
    var next = JSON.parse(JSON.stringify(full));
    next.terminals = terminals;
    next.terminalPlacementQueue = cmp.terminalPlacementQueue || [];
    next.terminalPlacementQueueVersion = cmp.terminalPlacementQueueVersion;
    msg("단자를 저장하는 중입니다…");
    c.from("public_components").update({
      part_data: next, terminal_count: terminals.length,
      updated_at: new Date().toISOString(), updated_by: user.id
    }).eq("public_key", key).then(function (res) {
      if (res.error) { msg(res.error.message || "저장하지 못했습니다.", "err"); return; }
      detailCache[key] = next;
      loadParts();
      autoBackup("단자 " + terminals.length + "개를 저장했습니다.");
    }).catch(function (e) { msg((e && e.message) || "저장하지 못했습니다.", "err"); });
  }

  // ── 이미지 편집 ──────────────────────────────────────────────────────────
  // ⚠ 부품 이미지는 Supabase Storage 의 **다른 출처** URL 이다.
  //    그대로 <img> 에 물려 캔버스에 그리면 캔버스가 오염돼(tainted) toDataURL() 이 막힌다.
  //    그래서 먼저 fetch 로 받아 data URL 로 바꾼 뒤 편집기에 넘긴다.
  function toDataUrl(url) {
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
  function openImageEditor() {
    var p = selectedPart; if (!p) return;
    var full = detailCache[p.public_key];
    if (!full || !full.image) { msg("부품 원본을 아직 불러오지 못했습니다. 잠시 후 다시 눌러 주세요.", "err"); return; }
    if (!WE.bgremove) { msg("이미지 편집기를 불러오지 못했습니다.", "err"); return; }
    editingKey = p.public_key;
    msg("이미지를 불러오는 중입니다…");
    toDataUrl(full.image).then(function (dataUrl) {
      msg("");
      WE.bgremove.open(dataUrl, function (url, tf, size) { savePartImage(url, size); },
        { width: Number(full.defaultWidth) || 160, height: Number(full.defaultHeight) || 120 });
    }).catch(function (e) { msg((e && e.message) || "이미지를 불러오지 못했습니다.", "err"); });
  }

  // 편집한 이미지를 스토리지에 올리고 부품을 갱신한다.
  // 경로에 시간을 넣는 이유: 같은 경로로 덮어쓰면 CDN 이 옛 이미지를 계속 준다.
  function thumbBlob(dataUrl) {
    return new Promise(function (ok, no) {
      var img = new Image();
      img.onload = function () {
        try {
          var scale = Math.min(1, 320 / img.naturalWidth, 240 / img.naturalHeight);
          var cv = document.createElement("canvas");
          cv.width = Math.max(1, Math.round(img.naturalWidth * scale));
          cv.height = Math.max(1, Math.round(img.naturalHeight * scale));
          cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
          cv.toBlob(function (b) { b ? ok(b) : no(new Error("썸네일 생성 실패")); }, "image/webp", 0.82);
        } catch (e) { no(e); }
      };
      img.onerror = function () { no(new Error("썸네일 생성 실패")); };
      img.src = dataUrl;
    });
  }
  function savePartImage(dataUrl, size) {
    var key = editingKey; editingKey = null;
    if (!key || !dataUrl) return;
    var c = client(), user = WE.auth.user && WE.auth.user();
    if (!c || !user) { msg("로그인이 필요합니다.", "err"); return; }
    var full = detailCache[key] || {};
    var base = key + "/edit/" + Date.now() + "/";
    msg("이미지를 올리는 중입니다…");
    Promise.all([
      fetch(dataUrl).then(function (r) { return r.blob(); }),
      thumbBlob(dataUrl)
    ]).then(function (blobs) {
      function up(path, blob) {
        return c.storage.from("public-components")
          .upload(path, blob, { cacheControl: "31536000", upsert: true, contentType: blob.type })
          .then(function (res) {
            if (res.error) throw res.error;
            return c.storage.from("public-components").getPublicUrl(path).data.publicUrl;
          });
      }
      return Promise.all([up(base + "image.webp", blobs[0]), up(base + "thumbnail.webp", blobs[1])]);
    }).then(function (urls) {
      var next = JSON.parse(JSON.stringify(full));
      next.image = urls[0];
      if (size && size.width > 0) { next.defaultWidth = size.width; next.defaultHeight = size.height; }
      return c.from("public_components").update({
        part_data: next, image_url: urls[0], thumbnail_url: urls[1],
        updated_at: new Date().toISOString(), updated_by: user.id
      }).eq("public_key", key).then(function (res) {
        if (res.error) throw res.error;
        detailCache[key] = next;
        loadParts();
        autoBackup("이미지를 저장했습니다.");
      });
    }).catch(function (e) { msg((e && e.message) || "이미지를 저장하지 못했습니다.", "err"); });
  }

  function withBusy(p, okText) {
    if (busy) return Promise.resolve();
    busy = true; msg("저장하는 중입니다…");
    return p.then(function (extra) {
      return refresh().then(function () { msg(typeof extra === "string" ? extra : (okText || "저장했습니다.")); });
    }).catch(function (e) {
      msg((e && e.message) || "저장하지 못했습니다.", "err");
      return refresh();
    }).then(function () { busy = false; });
  }

  // 이름 편집 열기/닫기. 편집 중에는 드래그를 막는다 —
  // 글자를 고르려고 끌면 순서 변경이 시작돼 버린다.
  function beginEdit(input) {
    if (!input || isBroken()) return;
    var row = input.closest(".adm-cat");
    if (row.classList.contains("all") || row.classList.contains("unfiled")) return;
    input.readOnly = false;
    input.classList.add("editing");
    row.classList.add("editing");
    var grip = row.querySelector(".adm-grip"); if (grip) grip.draggable = false;
    input.focus(); input.select();
  }
  function endEdit(input) {
    if (!input) return;
    input.readOnly = true;
    input.classList.remove("editing");
    var row = input.closest(".adm-cat");
    if (row) {
      row.classList.remove("editing");
      var grip = row.querySelector(".adm-grip"); if (grip) grip.draggable = !isBroken();
    }
  }

  // ── 조작 연결 ────────────────────────────────────────────────────────────
  function bind() {
    // Shift+C → 대분류 전체 접기/펼치기. 에디터의 같은 단축키(interactions.js)와 규칙을 맞춘다.
    // 이름칸 편집 중(INPUT/TEXTAREA 포커스)에는 'C' 입력으로 취급 — 접기가 끼어들면 안 된다.
    document.addEventListener("keydown", function (e) {
      if (!e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || e.key.toLowerCase() !== "c") return;
      var tag = (document.activeElement && document.activeElement.tagName) || "";
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      toggleAllCats();
      e.preventDefault();
    });

    $("admSearchForm").addEventListener("submit", function (e) { e.preventDefault(); loadParts(); });
    var timer = null;
    $("admSearch").addEventListener("input", function () {
      clearTimeout(timer); timer = setTimeout(loadParts, 250);
    });

    $("admAddForm").addEventListener("submit", function (e) {
      e.preventDefault();
      var input = $("admNewName"), name = input.value.trim();
      var parentId = $("admNewParent").value || null;
      if (!name) { input.focus(); return; }
      var siblings = parentId ? WE.categories.childrenOf(parentId) : WE.categories.roots();
      if (siblings.some(function (x) { return x.name === name; })) {
        msg("같은 자리에 이미 있는 이름입니다: " + name, "err"); input.select(); return;
      }
      withBusy(WE.categories.add(name, (siblings.length + 1) * 10, parentId),
        parentId ? "추가했습니다: " + WE.categories.get(parentId).name + " › " + name : "대분류를 추가했습니다: " + name)
        .then(function () { input.value = ""; input.focus(); });
    });

    var box = $("admList");
    box.addEventListener("click", function (e) {
      var del = e.target.closest(".adm-del");
      if (del) {
        if (del.disabled) return;
        var id = del.closest(".adm-cat").dataset.id;
        var node = WE.categories.get(id); if (!node) return;
        var n = countFor(node);
        var warn = n
          ? "「" + WE.categories.pathOf(id) + "」를 지웁니다.\n\n부품 " + n +
            "개는 삭제되지 않고 「미분류」로 갑니다.\n미분류 목록에서 다시 분류를 지정할 수 있습니다."
          : "「" + WE.categories.pathOf(id) + "」를 지웁니다.";
        if (!confirm(warn)) return;
        if (selected === id) selected = null;
        withBusy(WE.categories.remove(id).then(function (moved) {
          return moved ? "「" + node.name + "」를 지우고 부품 " + moved + "개를 미분류로 옮겼습니다."
                       : "「" + node.name + "」를 지웠습니다.";
        }));
        return;
      }
      // 연필(✎)을 누르면 바로 편집으로 들어간다 — 더블클릭을 모르는 사람을 위한 길
      var hint = e.target.closest(".adm-edit-hint");
      if (hint) { beginEdit(hint.closest(".adm-cat").querySelector(".adm-name")); return; }
      // 편집 중인 이름칸을 누른 것이면 그대로 둔다(커서 옮기기)
      if (e.target.classList.contains("adm-name") && !e.target.readOnly) return;
      var row = e.target.closest(".adm-cat"); if (!row) return;
      var next = row.dataset.id || null;
      var wasSelected = next === selected;
      /* 대분류(소분류가 있는)를 누르면 고르면서 동시에 펼친다. 이미 고른 대분류를
         다시 누르면 접는다 — 공용 부품 창과 같은 규칙이다(펼침·접힘 전용 화살표를
         따로 두면 한 줄에 누를 곳이 둘이 되어 헷갈린다). */
      var 자식있음 = row.classList.contains("root") && next && WE.categories.childrenOf(next).length > 0;
      var 접힘바뀜 = false;
      if (자식있음) {
        var 새값 = wasSelected ? (expanded[next] === false) : true;
        접힘바뀜 = 새값 !== (expanded[next] !== false);
        expanded[next] = 새값;
      }
      // 분류 선택도 안 바뀌고 접힘 상태도 안 바뀌면 다시 그리지 않는다.
      // 다시 그리면 방금 누른 줄이 새 노드로 바뀌어 더블클릭이 끊기고 화면도 깜빡인다.
      if (wasSelected && !접힘바뀜) return;
      selected = next;
      renderCats(); renderParentSelect();
      if (!wasSelected) loadParts();   // 접기/펼치기만으로는 부품 목록을 다시 안 불러온다
      msg("");
    });

    // 더블클릭 = 이름 편집 시작
    box.addEventListener("dblclick", function (e) {
      if (!e.target.classList.contains("adm-name")) return;
      beginEdit(e.target);
    });

    box.addEventListener("focusout", function (e) {
      if (!e.target.classList.contains("adm-name") || e.target.readOnly) return;
      endEdit(e.target);
      var before = e.target.dataset.before, after = e.target.value.trim();
      if (!after) { e.target.value = before; return; }
      if (after === before) return;
      var id = e.target.closest(".adm-cat").dataset.id;
      var node = WE.categories.get(id); if (!node) return;
      var siblings = node.parentId ? WE.categories.childrenOf(node.parentId) : WE.categories.roots();
      if (siblings.some(function (x) { return x.id !== id && x.name === after; })) {
        msg("같은 자리에 이미 있는 이름입니다: " + after, "err"); e.target.value = before; return;
      }
      withBusy(WE.categories.rename(id, after), "「" + before + "」를 「" + after + "」로 바꿨습니다.");
    });
    box.addEventListener("keydown", function (e) {
      if (!e.target.classList.contains("adm-name") || e.target.readOnly) return;
      if (e.key === "Enter") { e.preventDefault(); e.target.blur(); }
      else if (e.key === "Escape") { e.target.value = e.target.dataset.before; endEdit(e.target); e.target.blur(); }
    });

    // 순서 바꾸기 — 같은 부모 안에서만 옮긴다
    var dragId = null;
    function sameParent(a, b) {
      var x = WE.categories.get(a), y = WE.categories.get(b);
      return !!x && !!y && (x.parentId || null) === (y.parentId || null);
    }
    box.addEventListener("dragstart", function (e) {
      var grip = e.target.closest(".adm-grip"); if (!grip || !grip.draggable) return;
      var row = grip.closest(".adm-cat");
      dragId = row.dataset.id; row.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", dragId);
    });
    box.addEventListener("dragend", function () {
      dragId = null;
      box.querySelectorAll(".dragging,.drop-before,.drop-after").forEach(function (el) {
        el.classList.remove("dragging", "drop-before", "drop-after");
      });
    });
    box.addEventListener("dragover", function (e) {
      if (!dragId) return;
      var row = e.target.closest(".adm-cat");
      if (!row || row.dataset.id === dragId || !sameParent(dragId, row.dataset.id)) return;
      e.preventDefault();
      box.querySelectorAll(".drop-before,.drop-after").forEach(function (el) { el.classList.remove("drop-before", "drop-after"); });
      row.classList.add(e.clientY > row.getBoundingClientRect().top + row.offsetHeight / 2 ? "drop-after" : "drop-before");
    });
    box.addEventListener("drop", function (e) {
      if (!dragId) return;
      var row = e.target.closest(".adm-cat");
      if (!row || row.dataset.id === dragId || !sameParent(dragId, row.dataset.id)) return;
      e.preventDefault();
      var after = e.clientY > row.getBoundingClientRect().top + row.offsetHeight / 2;
      var node = WE.categories.get(dragId);
      var group = node.parentId ? WE.categories.childrenOf(node.parentId) : WE.categories.roots();
      var ids = group.map(function (x) { return x.id; });
      ids.splice(ids.indexOf(dragId), 1);
      ids.splice(ids.indexOf(row.dataset.id) + (after ? 1 : 0), 0, dragId);
      dragId = null;
      withBusy(WE.categories.reorder(ids), "순서를 저장했습니다.");
    });

    // 목록에서 부품 고르기
    $("admParts").addEventListener("click", function (e) {
      if (e.target.id === "admMore") { page++; loadParts(true); return; }
      // × 는 선택보다 먼저 본다 — 지우려고 눌렀는데 선택만 바뀌면 안 된다
      var del = e.target.closest("[data-del-key]");
      if (del) { openDeleteModal(del.getAttribute("data-del-key")); return; }
      var row = e.target.closest(".public-library-result"); if (!row) return;
      selectedPart = rows.filter(function (p) { return p.public_key === row.dataset.key; })[0] || null;
      renderParts();
    });

    // ── 부품 삭제 확인 모달 ──────────────────────────────────────────────
    $("admDelClose").addEventListener("click", closeDeleteModal);
    $("admDelCancel").addEventListener("click", closeDeleteModal);
    $("admDelModal").addEventListener("click", function (e) { if (e.target === e.currentTarget) closeDeleteModal(); });
    $("admDelModal").addEventListener("keydown", function (e) { if (e.key === "Escape") closeDeleteModal(); });
    $("admDelGo").addEventListener("click", runDelete);
    $("admDelPurge").addEventListener("click", runPurge);
    $("admPurgeUnlock").addEventListener("click", unlock완전삭제);

    // 단자 표시 켜고 끄기 — 이미지 자체를 확인하고 싶을 때가 있다
    $("admDetail").addEventListener("click", function (e) {
      if (e.target.id === "admEditPins") { openTerminalEditor(); return; }
      if (e.target.id === "admEditImage") { openImageEditor(); return; }
      if (e.target.id === "admCopyId") {
        var id = selectedPart && selectedPart.public_key;
        if (!id) return;
        var copied = navigator.clipboard && navigator.clipboard.writeText
          ? navigator.clipboard.writeText(id)
          : Promise.reject(new Error("clipboard"));
        copied.then(function () { msg("부품 ID를 복사했습니다."); }).catch(function () {
          // 클립보드 권한이 막힌 환경에서도 복사할 수 있게 브라우저의 예전 복사 경로로 한 번 더 시도한다.
          var input = document.createElement("textarea");
          input.value = id; input.style.position = "fixed"; input.style.opacity = "0";
          document.body.appendChild(input); input.select();
          var ok = false; try { ok = document.execCommand("copy"); } catch (_) {}
          input.remove(); msg(ok ? "부품 ID를 복사했습니다." : "부품 ID를 복사하지 못했습니다.", ok ? "" : "err");
        });
        return;
      }
      if (e.target.id !== "admPinToggle") return;
      showPins = !showPins;
      renderDetail();
    });

    // ── 카탈로그 백업 ────────────────────────────────────────────────────
    // 지정한 폴더에 catalog.json + 이미지·데이터시트를 통째로 떠 둔다.
    // 폴더 저장을 못 하는 브라우저에서는 데이터만 파일 하나로 내려받게 물러난다.
    $("admPickFolder").addEventListener("click", function () {
      WE.catalogBackup.pickFolder().then(function (h) {
        msg("백업 폴더를 지정했습니다: " + h.name);
        showBackupWhere();
      }).catch(function (e) {
        if (e && e.name === "AbortError") return;   // 사용자가 창을 닫은 것 — 오류가 아니다
        msg((e && e.message) || "폴더를 지정하지 못했습니다.", "err");
      });
    });
    $("admRestore").addEventListener("click", openRestore);
    $("restoreClose").addEventListener("click", closeRestore);
    $("restoreCancel").addEventListener("click", closeRestore);
    $("restoreGo").addEventListener("click", runRestore);
    $("restoreUnlock").addEventListener("click", function () {
      $("restoreTypeRow").hidden = false;
      $("restoreConfirmText").focus();
    });
    $("restoreConfirmText").addEventListener("input", function () {
      if (this.value.trim() === 덮어쓰기말) unlockOverwrite();
    });
    $("restoreMode").addEventListener("change", syncGoLabel);
    $("admBackupNow").addEventListener("click", function () {
      var btn = $("admBackupNow");
      if (btn.disabled) return;
      btn.disabled = true;
      var run = WE.catalogBackup.supported()
        ? WE.catalogBackup.backupAll(function (done, total, name) {
            msg(total ? "백업 중… " + done + "/" + total + (name ? " · " + name : "") : name);
          })
        : WE.catalogBackup.downloadJsonOnly();
      run.then(function (r) {
        var 본문 = "백업 완료 — 분류 " + r.분류 + "개 · 부품 " + r.부품 + "개";
        if (r.지움) 본문 += " · 서버에서 사라진 " + r.지움 + "개는 _지운부품 폴더로 옮겼습니다";
        if (r.실패 && r.실패.length) {
          // 조용히 넘어가지 않는다. 무엇이 빠졌는지 알아야 다시 뜰 수 있다
          msg(본문 + " · ⚠ " + r.실패.length + "개는 파일을 못 담았습니다: " + r.실패.slice(0, 3).join(", "), "err");
        } else msg(본문);
        showBackupWhere();
      }).catch(function (e) {
        if (e && e.name === "AbortError") { msg(""); return; }
        msg((e && e.message) || "백업하지 못했습니다.", "err");
      }).then(function () { btn.disabled = false; });
    });
    showBackupWhere();

    // 상세에서 분류 옮기기
    $("admDetail").addEventListener("change", function (e) {
      if (e.target.id !== "admMove" || !selectedPart) return;
      var key = selectedPart.public_key, to = e.target.value || null;
      withBusy(WE.categories.movePart(key, to),
        to ? "「" + WE.categories.pathOf(to) + "」로 옮겼습니다." : "미분류로 뺐습니다.");
    });
  }

  // 관리자 페이지를 열 때 조용히 따라잡는다.
  // 편집 훅만으로는 부족하다 — 분류 삭제·이름 변경·부품 이동은 SQL 함수 안에서
  // 부품 행이 바뀌어 JS 가 알 방법이 없다. 여기서 서버에 물어보면 그것까지 딸려온다.
  // 사라진 부품을 _지운부품 으로 옮기는 것도 이때 한다(키 목록을 받아야 해서 편집마다는 안 한다).
  function catchUp() {
    if (!WE.catalogBackup || !WE.catalogBackup.supported()) return;
    WE.catalogBackup.syncOnOpen().then(function (r) {
      if (r.상태 === "폴더없음") return;                       // 폴더를 안 고른 건 선택이다
      var 할말 = [];
      if (r.부품) 할말.push("부품 " + r.부품 + "개를 로컬 백업에 반영했습니다");
      if (r.지움) 할말.push("사라진 " + r.지움 + "개는 _지운부품 폴더로 옮겼습니다");
      if (r.실패 && r.실패.length) { msg("⚠ 로컬 백업에서 " + r.실패.length + "개를 못 담았습니다.", "err"); return; }
      if (할말.length) msg(할말.join(" · "));
      showBackupWhere();
    }).catch(function (e) {
      // 조용히 넘어가지 않는다 — 권한이 풀린 채로 몇 주가 지나면 백업이 없는 것과 같다
      msg("⚠ 로컬 백업을 갱신하지 못했습니다: " + ((e && e.message) || ""), "err");
    });
  }

  function start() {
    show("loading");
    var c = client();
    if (!c) { show("denied", "로그인 기능을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요."); return; }
    if (!WE.auth.user || !WE.auth.user()) {
      show("denied", "로그인이 필요합니다. 에디터에서 관리자 계정으로 로그인한 뒤 다시 열어 주세요.");
      return;
    }
    c.rpc("is_easycable_admin").then(function (res) {
      if (res.error || res.data !== true) { show("denied", "이 계정에는 관리자 권한이 없습니다."); return; }
      show("body");
      bind();
      return refresh().then(function () { msg(""); catchUp(); });
    }).catch(function () {
      show("denied", "권한을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    });
  }

  // auth 는 세션 복원이 비동기다.
  // ⚠ 반드시 시간 제한을 둔다. 네트워크가 없거나 인증 SDK 를 못 불러오면
  //    ready() 가 영영 true 가 되지 않아 "확인하는 중입니다…" 에서 멈춘 채로 남는다.
  function boot() {
    if (!WE.auth) { show("denied", "로그인 기능을 불러오지 못했습니다."); return; }
    var started = false;
    function go() { if (started) return; started = true; clearTimeout(timeout); start(); }
    var timeout = setTimeout(function () {
      if (started) return;
      started = true;
      show("denied", "로그인 상태를 확인하지 못했습니다. 인터넷 연결을 확인하고 새로고침해 주세요.");
    }, 8000);
    if (WE.auth.ready && WE.auth.ready()) go();
    else if (WE.auth.onChange) WE.auth.onChange(function () { if (WE.auth.ready && WE.auth.ready()) go(); });
    else setTimeout(go, 800);
  }
  /* 「에디터로 돌아가기」 — 이동이 아니라 **이 탭을 닫는다.**
     이 페이지는 에디터가 window.open 으로 열어준 탭이라, 이동해 버리면
     에디터가 하나 더 생긴다. 원래 에디터는 앞 탭에 그대로 있는데도.
     (2026-09-02, "관리자 페이지 갔다 오니 새 에디터가 뜬다")

     주소를 직접 쳐서 들어온 탭은 스스로 닫히지 않는다 — 그때만 에디터로 이동한다.
     닫기가 성공하면 이 페이지는 사라지므로 아래 타이머는 돌지 않는다. */
  function 나가기(e) {
    if (e) e.preventDefault();
    window.close();
    setTimeout(function () { location.href = "app.html"; }, 200);
  }
  function 나가기연결() {
    var 링크 = document.querySelectorAll('a[href="app.html"]');
    for (var i = 0; i < 링크.length; i++) 링크[i].addEventListener("click", 나가기);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", 나가기연결);
  else 나가기연결();

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  // 검사용 이음매 — 로그인·DB 를 흉내 낸 뒤 화면을 다시 그리게 한다.
  // 이게 없으면 검사가 권한 확인에서 막혀 클릭 동작을 잴 수 없다.
  // (auth.js 의 _테스트_상태, categories.js 의 _테스트_주입 과 같은 목적. 앱 코드에서는 쓰지 않는다)
  WE.adminPage = { _테스트_시작: start, _테스트_그리기: function () { renderCats(); bind(); },
    _테스트_전체접기: toggleAllCats,
    // 일괄 등록(js/admin-batch.js)이 게시를 마친 뒤 목록·개수를 다시 읽게 한다
    refresh: function () { return refresh(); },
    // 검사에서 부품 목록을 직접 넣어 그린다(서버·로그인 없이 목록 UI 만 보려는 것)
    _테스트_부품목록: function (list) { rows = list || []; total = rows.length; partsError = ""; renderParts(); } };
})();
