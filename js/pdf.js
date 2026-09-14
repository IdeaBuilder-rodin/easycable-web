// pdf.js — PDF 내보내기 (브라우저 인쇄 방식, 의존성 0)
var WE = window.WE || {};
window.WE = WE;

WE.pdf = (function () {
  var _savedTitle = null;
  function init() {
    document.getElementById("btnPdf").addEventListener("click", exportPrint);
    // Ctrl+P 직접 인쇄에도 제목 채우기 + 저장 파일명(document.title)을 프로젝트 이름으로 지정
    window.addEventListener("beforeprint", function () {
      populate();
      _savedTitle = document.title;
      var name = (WE.model.project.meta.name || "").trim() || WE.i18n.t("배선도");
      document.title = name;   // 브라우저 인쇄 대화상자의 기본 PDF 파일명이 이 값이 됨
    });
    // 인쇄 종료 후 원래 탭 제목으로 복원
    window.addEventListener("afterprint", function () {
      if (_savedTitle !== null) { document.title = _savedTitle; _savedTitle = null; }
      // 인쇄(내보내기) 마친 뒤 = 가치를 준 순간 → 출시 알림 슬쩍 제안(세션 1회, 구독자 제외)
      if (WE.app && WE.app.offerNotifyAfterValue) WE.app.offerNotifyAfterValue();
    });
  }

  function exportPrint() {
    // 선택/러버밴드 등 편집 표시 제거 (인쇄에 안 나오게)
    WE.model.clearSelection();
    WE.render.clearWirePreview();
    WE.render.renderOverlay();
    populate();
    if (WE.app && WE.app.track) WE.app.track("export", { method: "pdf" });
    window.print();
  }

  // 화면 작성일 칸과 같은 표기(YYYY.MM.DD)를 쓴다
  function ymd(t) {
    var d = (t instanceof Date) ? t : new Date(t);
    function p2(n) { return (n < 10 ? "0" : "") + n; }
    return d.getFullYear() + "." + p2(d.getMonth() + 1) + "." + p2(d.getDate());
  }

  // 도면 작성일 — 사용자가 지정했으면 그 값, 아니면 마지막으로 내용이 바뀐 시각
  function drawnDate() {
    var m = WE.model.project.meta || {};
    if (m.drawnAt) return m.drawnAt;
    var t = WE.store && WE.store.lastSavedAt ? WE.store.lastSavedAt() : 0;
    return ymd(t || Date.now());
  }

  /* 하단 밴드 — 비고(좌) + 배선 범례(우).
     좌우로 나눈 덕에 두 칸이 높이를 '공유'해서, 비고 4줄까지 도면을 줄이지 않고 들어간다.

     ⚠ 비고가 비어도 칸은 그대로 둔다. 예전에는 비면 칸을 없애고 범례를 전폭으로 폈는데,
        비고를 적은 시트(1장)와 안 적은 시트(2장)의 밑단 모양이 서로 달라졌다 —
        같은 도면인데 장마다 양식이 바뀌어 보인다. 양식은 장마다 같아야 한다.
        (2026-09-03 고원빈 지적) */
  var BAND_MAX_LINES = 4;   // 이 이상은 도면을 밀기 시작한다 (세로 예산 21mm)

  function fillFooter() {
    var note = String(WE.model.getSheetNote ? WE.model.getSheetNote() : "").trim();
    var foot = document.getElementById("printFooter");
    document.getElementById("printNoteBody").textContent = note;

    /* 밴드 높이는 **언제나 4줄**이다. (2026-09-10 고원빈 확정)

       예전에는 max(비고 줄 수, 범례 개수)만큼만 키웠다. 그러면 비고를 안 적은 도면에서
       한 줄짜리 납작한 칸이 찍힌다. 그런데 **사용자는 인쇄물에 손으로 적는다** —
       적을 자리가 없으면 칸이 있어도 쓸모가 없다. 비고는 최대 4줄까지 쓸 수 있으니
       처음부터 4줄 자리를 준다. 장마다 밑단 높이가 같아지는 이점도 따라온다.

       ⚠ 지면을 그만큼 더 먹는다. 도면 크기 계산(applyCanvasSize)이 제목+밴드 몫으로
          잡아 둔 35mm 안에 들어가야 한다 — 넘으면 밴드가 통째로 2쪽으로 밀린다
          (page-break-inside:avoid). 실측으로 확인했다: 가로 191.4/194 · 세로 279.3/281mm.
          ⚠ 여유가 세로에서 1.7mm 뿐이다. 제목줄이나 밴드 안쪽 여백을 키우면 바로 넘친다. */
    var noteLines = note ? note.split("\n").length : 0;
    var legendCount = (WE.app.legendItems ? WE.app.legendItems() : []).length;
    var lines = BAND_MAX_LINES;
    foot.style.setProperty("--pf-lines", String(lines));

    fillLegend();
    /* 밴드는 **언제나 나온다.** 비고 칸도 범례 칸도 도면의 기본 틀이다. (2026-09-10 고원빈 확정)

       ⚠ 예전에는 '비고도 범례도 없으면 밴드째 감춘다' 였다. 그런데 범례는 **실제로 쓰인
          배선 색**에서 나오므로(app.js legendItems), 배선을 아직 안 그은 장에서는 늘 비었다.
          그래서 배선 있는 장에는 밑단이 있고 없는 장에는 없어서, 여러 장을 뽑으면
          장마다 양식이 달라졌다 — 2026-09-03 에 비고 칸을 두고 정한 원칙
          「양식은 장마다 같아야 한다」와 어긋나 있었다. 그 원칙을 범례까지 넓힌다.

       ⚠ 빈 값을 지우는 것이 아니라 **빈 칸을 남기는** 것이 도면 양식이다.
          현장에서 인쇄물에 손으로 적어 넣기도 한다.

       ⚠ style.display 는 인라인이라 한 번 "none" 이 박히면 남는다. 반드시 빈 문자열로
          되돌린다 — 안 그러면 앞 시트에서 감춘 상태가 다음 시트까지 따라간다. */
    foot.style.display = "";
  }

  // 배선 범례 — 도면에 실제로 쓰인 색만 넣는다(목록은 app.legendItems가 정한다).
  // 팔레트 전체를 넣으면 안 쓴 색까지 나와 길어지고, 하단 블록을 넘길 수 있다.
  function fillLegend() {
    var items = WE.app.legendItems ? WE.app.legendItems() : [];
    var box = document.getElementById("printLegendItems");
    box.innerHTML = "";
    items.forEach(function (p) {
      var el = document.createElement("span");
      el.className = "pf-lg";
      var sw = document.createElement("i");
      // 흰색 계열은 종이에서 안 보이므로 테두리 있는 견본으로
      var c = String(p.color).toLowerCase();
      if (c === "#fff" || c === "#ffffff" || c === "white") {
        sw.className = "pf-sw"; sw.style.background = "#fff";
      } else {
        sw.style.color = p.color;
      }
      el.appendChild(sw);
      el.appendChild(document.createTextNode(p.label));
      box.appendChild(el);
    });
    /* 범례 칸도 **언제나 나온다** — 쓰인 색이 없어도 빈 칸으로 남긴다. (2026-09-10)
       예전에는 색이 없으면 칸을 숨기고 비고가 전폭을 쓰게 했는데, 그러면 배선을 긋기 전과
       그은 뒤의 밑단 모양이 달라진다. 비고 칸을 비어도 남기기로 한 것과 같은 이유다.

       ⚠ 여기도 인라인 style 이라 이전 시트에서 박힌 "none" 을 반드시 되돌린다. */
    document.getElementById("printLegend").style.display = "";
    document.getElementById("printNote").style.borderRight = "";
  }

  // 섹션 머리글(BOM·배선 리스트 등) — 1페이지 도면 제목줄과 같은 모양으로
  function sectionTitle(text, newPage) {
    var d = document.createElement("div");
    d.className = "bom-title" + (newPage ? " pdf-page-break" : "");
    var t = document.createElement("span"); t.textContent = text;
    var dt = document.createElement("span"); dt.className = "bt-date"; dt.textContent = drawnDate();
    d.appendChild(t); d.appendChild(dt);
    return d;
  }

  // ---- 배선도가 여러 장일 때: 시트마다 한 페이지씩 ----
  // 출력 순서 = 1번 배선도 → 2번 배선도 → … → BOM (사용자 확정 2026-08-10).
  //
  // 만드는 방법: 시트를 하나씩 활성으로 바꿔 화면을 그린 뒤, 그때의
  // [#printTitle + #canvas + #printFooter] 를 통째로 복제해 한 세트로 담는다.
  // 새로 그리지 않고 '지금 쓰는 인쇄물을 그대로 복제'하는 이유 —
  // 한 장짜리 인쇄 레이아웃(도면 161mm 상한, 하단 밴드 높이 계산 등)은 수십 번 다듬어 확정한 것이라
  // 다시 만들면 어딘가 어긋난다. 복제하면 모양이 정확히 같다는 게 구조적으로 보장된다.
  //
  // 복제본은 id를 그대로 갖고 있다(CSS가 id 선택자로 잡혀 있어 지우면 스타일이 통째로 빠진다).
  // 같은 id가 여럿이어도 CSS는 전부에 적용되고, getElementById는 문서 순서상 '먼저 나오는' 원본을
  // 돌려준다 — 그래서 #printSheets 는 반드시 원본들보다 뒤에 둔다(app.html 참고).
  function buildSheetPages() {
    var box = document.getElementById("printSheets");
    if (!box) return;
    box.innerHTML = "";
    var sheets = (WE.model.project.sheets || []);
    var multi = sheets.length > 1;
    document.body.classList.toggle("pr-multi", multi);
    /* 첫 장의 방향을 몸통에도 알린다 — styles.css 참고.
       쪽 이름이 바뀌는 자리에서 브라우저가 쪽을 넘기므로, 문서 처음과 첫 장의 이름이
       다르면 앞에 빈 쪽이 한 장 생긴다. */
    var 첫크기 = multi ? WE.model.sheetSize(sheets[0]) : null;
    document.body.classList.toggle("pr-first-tall",
      !!(첫크기 && 첫크기.height > 첫크기.width));
    if (!multi) return;   // 한 장이면 예전 경로 그대로 — 손대지 않는다

    var keep = WE.model.getActiveSheetId();
    var titleEl = document.getElementById("printTitle");
    var footEl = document.getElementById("printFooter");
    var projName = (WE.model.project.meta || {}).name || "";
    sheets.forEach(function (s, i) {
      WE.model.setActiveSheet(s.id);
      // ⚠ 시트마다 용지가 다를 수 있다(2026-09-08). 이걸 안 부르면 복제본이
      //    앞 시트의 viewBox·인쇄 크기를 그대로 들고 가서 도면이 찌그러진다.
      if (WE.app.applyCanvasSize) WE.app.applyCanvasSize();
      WE.render.renderAll();
      // 장마다 제목은 "프로젝트 이름 — 시트 이름". 어느 도면인지 종이만 봐도 알아야 한다.
      document.getElementById("printTitleName").textContent =
        projName ? (projName + " — " + s.name) : s.name;
      document.getElementById("printTitleDate").textContent = drawnDate();
      fillFooter();   // 범례는 그 시트의 배선 기준으로 다시 채워진다

      var sec = document.createElement("section");
      /* 이 장의 용지 방향을 쪽에 알린다 — 가로 도면은 가로 A4, 세로 도면은 세로 A4.
         (styles.css 의 .pr-wide/.pr-tall → @page pr-wide/pr-tall) */
      var 크기 = WE.model.sheetSize(s);
      var 가로냐 = 크기.width >= 크기.height;
      sec.className = "pr-sheet" + (i ? " pr-break" : "") + (가로냐 ? " pr-wide" : " pr-tall");
      // 복제본에서는 '원본 표식'을 뗀다 — 안 떼면 원본을 숨기는 규칙에 복제본도 함께 걸려
      // 제목·작성일·비고·범례가 통째로 사라진다.
      var ttl = titleEl.cloneNode(true); ttl.classList.remove("pr-orig");
      sec.appendChild(ttl);
      var svg = document.getElementById("canvas").cloneNode(true);
      // 화면 전용 레이어는 복제본에서 지운다(인쇄 CSS가 원본에만 걸려 있다)
      ["gridBg", "layerOverlay"].forEach(function (id) {
        var n = svg.querySelector("#" + id); if (n) n.parentNode.removeChild(n);
      });
      sec.appendChild(svg);
      var band = footEl.cloneNode(true); band.classList.remove("pr-orig");
      sec.appendChild(band);
      box.appendChild(sec);
    });
    // 보고 있던 시트로 되돌린다 — 인쇄가 화면 상태를 바꾸면 안 된다
    WE.model.setActiveSheet(keep);
    if (WE.app.applyCanvasSize) WE.app.applyCanvasSize();
    WE.render.renderAll();
    document.getElementById("printTitleName").textContent = projName;
    document.getElementById("printTitleDate").textContent = drawnDate();
    fillFooter();
  }

  function populate() {
    // 제목 + 우측 상단 날짜
    var proj0 = WE.model.project;
    document.getElementById("printTitleName").textContent = (proj0.meta && proj0.meta.name) || "";
    document.getElementById("printTitleDate").textContent = drawnDate();
    fillFooter();
    buildSheetPages();

    // BOM (자재명세서) — 화면에 보이는 그 표(열 구성·순서·너비·행 높이)를 그대로 인쇄
    var bomBox = document.getElementById("printBOM");
    bomBox.innerHTML = "";
    var data = WE.app.bomData ? WE.app.bomData() : { rows: [], total: 0, totalQty: 0 };
    var allCols = WE.app.bomColumns ? WE.app.bomColumns() : [];
    var proj = WE.model.project;

    // 데이터시트 열은 종이에서 뺀다. 화면에선 클릭해 여는 첨부지만 인쇄물엔 "📎 2"만 찍혀
    // 열어볼 수도, 개수를 알아도 쓸 데가 없다. 그 폭을 다른 열에 넘겨 주는 편이 낫다.
    // (구매링크는 실제 하이퍼링크로 나가 PDF에서도 눌리므로 그대로 둔다)
    var dsIdx = -1;
    var cols = allCols.filter(function (c, i) {
      if (c.id === "ds") { dsIdx = i; return false; }
      return true;
    });
    function won(v) { return v ? "₩" + Math.round(v).toLocaleString() : ""; }
    // 텍스트 셀 내용(구매링크·데이터시트는 별도 처리 — 아래 linkTd/ds 분기 참고)
    function cellText(col, r) {
      if (col.kind === "custom") return (r.custom && r.custom[col.colId]) || "";
      switch (col.id) {
        case "name": return r.name;
        case "spec": return r.spec || "";
        case "qty": return r.qty + WE.i18n.t("개");
        case "price": return r.price ? Math.round(Number(r.price)).toLocaleString() : "";
        case "sum": return won(r.sum);
      }
      return "";
    }
    // 열 폭은 지정하지 않는다 — 내용만큼만 차지하게 두고, 길어지면 자연히 늘어난다.
    // (지면 폭에 억지로 맞추면 숫자 칸에 빈 공간이 남고, 100%로 늘리면 우측 열이 잘렸다)
    // 폭 규칙은 인쇄 CSS의 `bc-<열id>` 클래스에 모아 두었다.
    function colClass(col) {
      var base = "bc-" + (col.kind === "custom" ? "custom" : col.id);
      if (col.kind === "num") base += " qty";
      else if (col.kind === "link") base += " link";
      return base;
    }

    if (data.rows.length) {
      // 1페이지는 배선도만 — BOM부터 다음 장에서 시작
      bomBox.appendChild(sectionTitle(WE.i18n.t("부품 목록 (BOM)"), true));

      var table = document.createElement("table");
      table.className = "bom";
      table.style.setProperty("--bom-rh", (Number(proj.bomRowH) || 6) + "px");   // 화면과 같은 행 높이
      function td(text, cls) { var d = document.createElement("td"); if (cls) d.className = cls; d.textContent = text; return d; }
      function th(text, cls) { var d = document.createElement("th"); if (cls) d.className = cls; d.textContent = text; return d; }
      // 구매링크 셀: 실제 클릭 가능한 하이퍼링크(href)로 — 화면은 JS가 클릭을 가로채는 방식이라 PDF엔 안 통함
      function linkTd(url) {
        var d = document.createElement("td"); d.className = "bc-link link";
        if (url) {
          var a = document.createElement("a");
          a.href = url; a.target = "_blank"; a.rel = "noopener";
          a.textContent = WE.app.linkLabel ? WE.app.linkLabel(url) : url;
          d.appendChild(a);
        }
        return d;
      }

      var thead = document.createElement("thead"), htr = document.createElement("tr");
      htr.appendChild(th("No", "bc-no qty"));
      cols.forEach(function (col) { htr.appendChild(th(col.label, colClass(col))); });
      thead.appendChild(htr); table.appendChild(thead);

      var tbody = document.createElement("tbody");
      data.rows.forEach(function (b) {
        var tr = document.createElement("tr");
        tr.appendChild(td(String(b.no), "bc-no qty"));
        cols.forEach(function (col) {
          if (col.id === "link") { tr.appendChild(linkTd(b.link)); return; }
          tr.appendChild(td(cellText(col, b), colClass(col)));
        });
        tbody.appendChild(tr);
      });
      // 합계 행
      var trT = document.createElement("tr");
      trT.className = "bom-total";
      trT.appendChild(td("", "bc-no qty"));
      cols.forEach(function (col) {
        if (col.id === "name") trT.appendChild(td(WE.i18n.t("합계"), colClass(col)));
        else if (col.id === "qty") trT.appendChild(td(data.totalQty + WE.i18n.t("개"), colClass(col)));
        else if (col.id === "sum") trT.appendChild(td(won(data.total), colClass(col)));
        else trT.appendChild(td("", colClass(col)));
      });
      tbody.appendChild(trT);
      table.appendChild(tbody);
      bomBox.appendChild(table);
    }

    /* 결선표 (조립용) — 넷 한 덩어리를 한 묶음으로 찍는다.
       한 줄씩 늘어놓지 않는 이유: "이 단자에 몇 군데가 물리는가" 가 보여야 케이블을 어떻게 뺄지
       정할 수 있다. 흩어 놓으면 두 군데 중 한 군데만 하고 넘어간다(2026-09-03 실작업에서 나온 문제).
       맨 앞 칸은 **순번**이다 (2026-09-13 고원빈: "체크박스보다 그냥 번호가 낫겠다" — 예전엔 빈
       체크박스 ☐ 였는데, 넷마다 번호를 매겨 "몇 번째 넷인지" 로 짚게 한다. 페이지가 여러 장으로
       나뉘어도 번호는 그 시트 안에서 계속 이어진다 — 2페이지 첫 줄이 다시 1번이면 안 된다.
       ⚠ "번호" 대신 "순번" 을 쓴다 — 도면 위 배선 번호(W1·W2, 개발_기록.md 6.10)와 헷갈리지 않게.

       ⚠ 페이지는 **표 1개(좌우 2단 폐지)**다. 예전엔 좌우 2단으로 지면을 아꼈는데,
          실측해 보니 표 2개의 폭(약 287mm)이 **가로 A4 내용폭(281mm)조차 못 채우고
          세로 A4(194mm)에서는 두 번째 표가 페이지 밖으로 잘렸다** — 규격 열을 더하기 전부터
          이미 그랬다. 표 1개(실측 폭 150~185mm)는 세로 A4 194mm 안에도 항상 들어가므로
          이것만으로 폭 문제는 풀린다. 남는 폭은 비고 칸에 몰아준다(styles.css .wl-note).

          ⚠ 2026-09-13에는 여기서 한 걸음 더 나가 "결선표는 도면 방향과 무관하게 항상
          세로 A4로 고정"(`page: pr-tall`)까지 했었다. 그런데 배포 후 실제로 도면이 가로인
          단일 시트 프로젝트에서 **PDF 마지막에 빈 페이지가 한 장 더 생기는 문제**가
          나왔다 — 가로(도면·BOM) → 세로(결선표)로 쪽 방향이 바뀌는 자리에서 브라우저가
          여분의 빈 쪽을 끼워 넣은 것으로 보인다(이 문서 6절·CLAUDE.md에 이미 있던
          "쪽 이름이 바뀌면 빈 쪽이 생긴다"는 것과 같은 부류의 문제). 표 1개면 어차피 폭
          문제가 없으므로(위 문단), **방향을 강제하는 이득이 없다** — 그래서 되돌렸다.
          결선표는 이제 도면 방향을 그대로 따라간다(BOM과 같은 방식). 페이지 높이 예산은
          두 방향 중 더 작은 쪽(세로 A4 194mm)을 항상 기준으로 삼아 계산한다 — 실제 방향을
          매번 판별하지 않아도 절대 넘치지 않는다(도면이 세로라 실제로 281mm를 쓸 수 있는
          경우엔 페이지를 살짝 더 아낄 여지를 포기하는 정도의 손해만 있다). */
    /* ⚠ 결선표는 **시트마다** 만든다 (2026-09-13 고원빈: "한 프로젝트의 결선표가 전부 나와야 한다").
       netListByComponent() 는 안에서 netFrom · getComponent · getWire 를 쓰는데, 셋 다 '현재 시트' 별칭
       (model.js 의 project.wires / project.components)을 읽는다. 그래서 한 번만 부르면 보고 있던
       시트의 결선표만 나왔다. 도면을 복제하는 buildSheetPages() 와 같은 방법으로 — 시트를 하나씩
       활성으로 바꿔 가며 표를 만들고, 끝나면 원래 시트로 되돌린다.
       (데이터 함수를 '시트 지정형'으로 바꾸는 길은 그 셋의 참조가 수십 곳이라 택하지 않았다) */
    {
      function wireTable(nets, startNo) {
        var t = document.createElement("table");
        t.className = "bom wl-table";
        var head = document.createElement("thead");
        head.innerHTML = WE.i18n.t("<tr><th>순번</th><th>부품</th><th>시작</th><th>연결 부품</th><th>연결부 단자</th><th>규격</th><th>배선</th><th>비고</th></tr>");
        t.appendChild(head);
        var body = document.createElement("tbody");
        var no = startNo;   // 이 페이지에서 이어지는 순번 — appendWireList 가 페이지 시작 번호를 넘겨준다
        nets.forEach(function (그룹) {
          var 부품첫줄 = true;
          그룹.rows.forEach(function (net) {
            net.targets.forEach(function (m, i) {
              var tr = document.createElement("tr");
              if (i === 0) tr.className = "wl-first";
              function wtd(text, cls, span) {
                var d = document.createElement("td");
                if (cls) d.className = cls;
                if (span > 1) d.rowSpan = span;
                d.textContent = text; return d;
              }
              if (i === 0) tr.appendChild(wtd(String(no++), "wl-chk", net.count));

              /* 부품 그림 + 이름 — 그 부품의 모든 줄에 걸쳐 한 번만.
                 종이에서 "아, 이 부품" 을 그림으로 먼저 알아보고 단자를 찾는 순서가 된다. */
              if (부품첫줄) {
                var ptd = document.createElement("td");
                ptd.className = "wl-part";
                if (그룹.lines > 1) ptd.rowSpan = 그룹.lines;
                if (그룹.image) {
                  var img = document.createElement("img");
                  img.className = "wl-thumb"; img.src = 그룹.image; img.alt = "";
                  ptd.appendChild(img);
                }
                var nm = document.createElement("div");
                nm.className = "wl-part-name"; nm.textContent = 그룹.name;
                ptd.appendChild(nm);
                tr.appendChild(ptd);
                부품첫줄 = false;
              }

              // 시작 단자 — 한 번만 적고 아래 줄들이 여기서 뻗어나간다.
              // "여기서 나갈 선이 N가닥" 이 종이에서 바로 읽혀야 한다.
              if (i === 0) {
                var otd = document.createElement("td");
                otd.className = "wl-origin";
                if (net.count > 1) otd.rowSpan = net.count;
                var sw = document.createElement("span");
                sw.className = "wl-sw";
                sw.style.cssText = "display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:3px;vertical-align:middle;background:" + net.colorHex;
                otd.appendChild(sw);
                var ob = document.createElement("b"); ob.textContent = net.origin.term;
                otd.appendChild(ob);
                tr.appendChild(otd);
              }

              /* 부품명과 단자를 칸으로 나눈다 — 붙여 쓰면 어디까지가 부품 이름인지 안 보인다.
                 같은 이름이 이어지면 한 칸으로 합친다 — 합칠 범위는 app.js 의
                 연결부품합치기() 가 이미 정해 두었다(_cmpSpan). 여기서 다시 판단하지 않는다.
                 ⚠ 묶음은 단을 나눌 때 쪼개지지 않으므로 이 병합이 단 경계에 걸리지 않는다. */
              if (m._cmpSpan !== 0) {
                var mtd = document.createElement("td");
                mtd.className = "wl-member";
                if (m._cmpSpan > 1) mtd.rowSpan = m._cmpSpan;
                mtd.textContent = m.cmp;
                tr.appendChild(mtd);
              }

              /* ⚠ 연결부 단자에는 색을 안 붙인다. 이어진 단자끼리는 같은 색으로 잇게 되어 있어
                 시작 칸의 색과 늘 같다 — 반복하면 칸만 넓어진다. (2026-09-03 고원빈) */
              var ttd = document.createElement("td");
              ttd.className = "wl-mterm";
              var b = document.createElement("b"); b.textContent = m.term;
              ttd.appendChild(b);
              tr.appendChild(ttd);

              /* 규격(AWG) — 넷 하나에 하나(배선수·비고와 같은 자리). 시작 단자에 꽂히는
                 배선의 규격을 쓴다 — 팔레트에서 색마다 정한 값이 net.awg 로 와 있다.
                 (2026-09-13 고원빈: "연결부단자와 배선수 사이에 배선규격이 무엇으로
                 되어있는지 만들어야해"). 미지정이면 빈칸.
                 ⚠ "22" 처럼 숫자만 적으면 무슨 단위인지 안 보여서 "AWG22" 로 붙여 쓴다
                 (2026-09-13 고원빈: "AWG인지 뭔지 표현을 적어야 맞을것 같아"). */
              if (i === 0) {
                var gtd = document.createElement("td");
                gtd.className = "wl-awg";
                if (net.count > 1) gtd.rowSpan = net.count;
                gtd.textContent = net.awg ? "AWG" + net.awg : "";
                tr.appendChild(gtd);
              }

              // 배선(가닥 수) — 화면 결선표와 같은 구성으로 맞춘다(레이아웃은 달라도 내용은 같아야 한다)
              if (i === 0) {
                var ntd = document.createElement("td");
                ntd.className = "wl-count";
                if (net.count > 1) ntd.rowSpan = net.count;
                ntd.textContent = String(net.count);
                tr.appendChild(ntd);
                /* 비고 — 케이블 길이 같은 현장 메모. 화면에만 있고 종이에 없으면
                   현장에 못 들고 간다 (2026-09-10 고원빈: "비고칸은 PDF에 나오지가 않네?"). */
                var vtd = document.createElement("td");
                vtd.className = "wl-note";
                if (net.count > 1) vtd.rowSpan = net.count;
                vtd.textContent = WE.app.wireNoteOf ? WE.app.wireNoteOf(net) : "";
                tr.appendChild(vtd);
              }
              body.appendChild(tr);
            });
          });
        });
        t.appendChild(body);
        return t;
      }

      /* 한 시트의 결선표(wl)를 페이지마다 표 1개씩 담는다 — **실제 인쇄 높이(mm)** 로 채운다.
         (2026-09-13 고원빈: "MicroSD·푸시스위치까지 한 페이지에 다 들어가는 사이즈면 제일 좋겠다" —
         실측해 보니 '줄 수'만 세는 예전 방식(PER_COL=30)은 실제로 남는 여백을 못 본다.
         39줄짜리 결선표가 28/11로 갈렸는데, 실제 높이로 재면 39줄이 전부 275.8mm — 페이지
         예산 281mm 안에 들어가는데도 잘렸다. 그래서 줄 수 대신 실제 렌더링 높이를 쓴다.)

         실측 상수(세로 A4·이 폰트 기준, `probe_wlheight` 로 잰 값 — 크게 벗어나면 다시 잰다):
           · 그림 없는 이어줄 1개  = 5.82mm
           · 부품 그림(.wl-thumb 13mm+이름)이 강제하는 한 묶음의 최소 높이 = 18.94mm
             (묶음의 자연 높이(줄수×5.82)가 이보다 작으면 이만큼까지 늘어난다 —
              4줄 넘는 묶음은 이미 자연 높이가 이를 넘어서므로 영향이 없다)
           · 표 머리글(thead) = 5.8mm · 결선표 제목줄(.bom-title, 시트의 **첫 페이지에만** 붙는다) = 7.95mm
         ⚠ 한 부품 묶음은 쪼개지 않는다 — 그림과 단자가 다른 페이지로 갈라지면
            "이 단자가 어느 부품 것인지" 를 종이에서 잃는다. 그래서 예산을 넘기기 직전에
            다음 페이지로 넘긴다(묶음 전체를 통째로 옮긴다).
         ⚠ PAGE_MM 은 **세로 A4 높이(194mm)로 고정**한다 — 결선표가 도면 방향을 그대로
            따라가므로(위 설명 참고) 실제로는 가로 A4(194mm)일 수도 세로 A4(281mm)일 수도
            있는데, 매번 방향을 판별하는 대신 항상 더 작은 쪽을 기준으로 삼는다. 그러면
            실제 방향이 무엇이든 절대 넘치지 않는다 — 손해는 세로 도면일 때 페이지를
            조금 덜 아끼는 정도뿐이다. */
      var ROW_MM = 5.82, MIN_GROUP_MM = 18.94, HEAD_MM = 5.8, TITLE_MM = 7.95, PAGE_MM = 194;
      function groupCostMM(g) { return Math.max(g.lines * ROW_MM, MIN_GROUP_MM); }

      function appendWireList(wl) {
        var 페이지들 = [], 담김 = [];
        // 첫 페이지는 제목줄까지 얹으므로 그만큼 좁고, 다음 페이지부터는 표만 있어 더 넓다.
        var 남은예산 = PAGE_MM - TITLE_MM - HEAD_MM;
        wl.forEach(function (그룹) {
          var 비용 = groupCostMM(그룹);
          if (담김.length && 비용 > 남은예산) {
            페이지들.push(담김); 담김 = [];
            남은예산 = PAGE_MM - HEAD_MM;
          }
          담김.push(그룹); 남은예산 -= 비용;
        });
        if (담김.length) 페이지들.push(담김);
        var 순번커서 = 1;   // 이 시트의 결선표 안에서는 페이지가 넘어가도 순번이 계속 이어진다
        페이지들.forEach(function (그룹들, i) {
          var wrap = document.createElement("div");
          // wl-cols: 예전 좌우 2단 시절의 이름을 그대로 쓴다 — 검사·CSS가 이 클래스로 '결선표 한 쪽'을 센다.
          wrap.className = "wl-cols" + (i > 0 ? " pdf-page-break" : "");
          wrap.appendChild(wireTable(그룹들, 순번커서));
          // 다음 페이지 시작 번호 — 이 페이지에 실린 넷 개수(그룹마다 rows.length)만큼 이어간다
          그룹들.forEach(function (g) { 순번커서 += g.rows.length; });
          bomBox.appendChild(wrap);
        });
      }

      /* 시트 순서대로 — 1번 도면의 결선표, 2번 도면의 결선표 … 각각 새 쪽에서 시작한다.
         제목 규칙 (2026-09-13 고원빈: "결선표-01(페이지이름) 식으로 어느 페이지 것인지 구분"):
           · 시트가 한 장이면 예전 그대로 "결선표" — 구분할 게 없는데 글자만 는다.
             (도면 제목이 한 장일 때 시트명을 안 붙이는 것과 같은 규칙)
           · 여러 장이면 "결선표-01(전원부)". 시트 이름이 기본값(쪽 번호 "01")과 같으면
             "결선표-01(01)" 이 되어 겹치므로 괄호를 뺀다 → "결선표-01".
         배선이 없는 시트는 결선표를 만들지 않는다(빈 표 한 장이 낭비다). */
      var sheets = WE.model.project.sheets || [];
      var keepSheet = WE.model.getActiveSheetId();
      var multiSheet = sheets.length > 1;
      sheets.forEach(function (sh, si) {
        WE.model.setActiveSheet(sh.id);
        var wl = WE.app.netListByComponent ? WE.app.netListByComponent() : [];
        if (!wl.length) return;
        var no = (si + 1 < 10 ? "0" : "") + (si + 1);
        var nm = String(sh.name || "").trim();
        var title = !multiSheet ? WE.i18n.t("결선표")
                  : WE.i18n.t("결선표") + "-" + no + (nm && nm !== no ? "(" + nm + ")" : "");
        bomBox.appendChild(sectionTitle(title, true));
        appendWireList(wl);
      });
      // 보고 있던 시트로 되돌린다 — 인쇄가 화면 상태를 바꾸면 안 된다 (그리기는 안 건드렸으니 다시 그릴 것도 없다)
      WE.model.setActiveSheet(keepSheet);
    }

    // 전력/배터리 요약
    var rows = WE.app.powerSummaryRows ? WE.app.powerSummaryRows() : [];
    if (rows.length) {
      var pt = sectionTitle(WE.i18n.t("전력 / 배터리 요약"), false);
      pt.style.marginTop = "8mm";
      bomBox.appendChild(pt);
      var ptbl = document.createElement("table");
      ptbl.className = "bom"; ptbl.style.width = "auto";
      rows.forEach(function (r) {
        var tr = document.createElement("tr");
        var th = document.createElement("th"); th.textContent = r[0];
        var td = document.createElement("td"); td.textContent = r[1];
        tr.appendChild(th); tr.appendChild(td); ptbl.appendChild(tr);
      });
      bomBox.appendChild(ptbl);
    }
  }

  // 화면 BOM 표(#bomTable)에 실제로 그려진 열 너비를 그대로 측정해 반환: [No열, col1, col2, ...]
  // (화면이 지금 BOM 탭이 아니어도 잠시 보이지 않게(visibility:hidden) 그려서 정확한 폭을 잼)
  return { init: init, exportPrint: exportPrint, populate: populate };
})();
