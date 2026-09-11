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
       체크칸(☐)을 맨 앞에 둔다 — 수십 가닥을 하다 보면 어디까지 했는지가 진짜 문제다.
       열이 좁아 한 단으로 뽑으면 지면 절반이 비므로 좌우 2단으로 나눠 담는다. */
    var wl = WE.app.netListByComponent ? WE.app.netListByComponent() : [];
    if (wl.length) {
      bomBox.appendChild(sectionTitle(WE.i18n.t("결선표"), true));

      function wireTable(nets) {
        var t = document.createElement("table");
        t.className = "bom wl-table";
        var head = document.createElement("thead");
        head.innerHTML = WE.i18n.t("<tr><th>☐</th><th>부품</th><th>시작</th><th>연결 부품</th><th>연결부 단자</th><th>배선수</th><th>비고</th></tr>");
        t.appendChild(head);
        var body = document.createElement("tbody");
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
              if (i === 0) tr.appendChild(wtd("☐", "wl-chk", net.count));

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

              // 배선수 — 화면 결선표와 같은 구성으로 맞춘다(레이아웃은 달라도 내용은 같아야 한다)
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

      /* 부품 묶음은 줄 수가 제각각이라 '개수'가 아니라 '줄 수'로 단을 나눈다.
         ⚠ 한 부품 묶음은 쪼개지 않는다 — 그림과 단자가 다른 단으로 갈라지면
            "이 단자가 어느 부품 것인지" 를 종이에서 잃는다.

         ⚠ 한 단을 꽉 채우고 넘기면 종이가 남는다. 예전에는 18줄로 끊어 35줄짜리가
            18/17 로 갈릴 것을 18/16/1 세 단으로 흩어져 두 장이 됐다(2026-09-03).
            그래서 **먼저 몇 장에 담을지 정하고, 그 장수에 맞춰 고르게 나눈다.** */
      var PER_COL = 30;                                   // 한 단(세로 한 칸)에 들어가는 줄 수 상한
      var 전체줄 = 0;
      wl.forEach(function (g) { 전체줄 += g.lines; });
      var 단수 = Math.max(1, Math.ceil(전체줄 / PER_COL));  // 필요한 단 수
      if (단수 % 2 === 1 && 단수 > 1) 단수++;                 // 한 장에 두 단이므로 짝수로 맞춘다
      var 목표 = Math.ceil(전체줄 / 단수);                   // 단마다 이만큼씩 고르게

      var 쪽 = [], 단 = [], 줄수 = 0;
      wl.forEach(function (그룹) {
        // 이미 목표를 채웠고 남은 단이 있으면 다음 단으로 (묶음은 통째로 옮긴다)
        if (줄수 && 줄수 + 그룹.lines > 목표 && 쪽.length + 1 < 단수) {
          쪽.push(단); 단 = []; 줄수 = 0;
        }
        단.push(그룹); 줄수 += 그룹.lines;
      });
      if (단.length) 쪽.push(단);
      for (var i = 0; i < 쪽.length; i += 2) {
        var row = document.createElement("div");
        row.className = "wl-cols" + (i > 0 ? " pdf-page-break" : "");
        row.appendChild(wireTable(쪽[i]));
        if (쪽[i + 1]) row.appendChild(wireTable(쪽[i + 1]));
        bomBox.appendChild(row);
      }
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
