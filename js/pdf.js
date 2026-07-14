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
      var name = (WE.model.project.meta.name || "").trim() || "배선도";
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

  function populate() {
    // 제목
    document.getElementById("printTitle").textContent = WE.model.project.meta.name || "";

    // BOM (자재명세서) — 화면에 보이는 그 표(열 구성·순서·너비·행 높이)를 그대로 인쇄
    var bomBox = document.getElementById("printBOM");
    bomBox.innerHTML = "";
    var data = WE.app.bomData ? WE.app.bomData() : { rows: [], total: 0, totalQty: 0 };
    var cols = WE.app.bomColumns ? WE.app.bomColumns() : [];
    var proj = WE.model.project;
    function won(v) { return v ? "₩" + Math.round(v).toLocaleString() : ""; }
    // 텍스트 셀 내용(구매링크·데이터시트는 별도 처리 — 아래 linkTd/ds 분기 참고)
    function cellText(col, r) {
      if (col.kind === "custom") return (r.custom && r.custom[col.colId]) || "";
      switch (col.id) {
        case "name": return r.name;
        case "spec": return r.spec || "";
        case "qty": return r.qty + "개";
        case "price": return r.price ? Math.round(Number(r.price)).toLocaleString() : "";
        case "sum": return won(r.sum);
      }
      return "";
    }
    // 화면에 실제로 그려진 열 너비를 그대로 측정(사용자가 직접 조절했든 자동 맞춤이든 전부 반영)
    var screenWidths = measureScreenBomColWidths(cols);

    if (data.rows.length) {
      var bt = document.createElement("div");
      bt.className = "bom-title pdf-page-break"; bt.textContent = "부품 목록 (BOM)";   // 1페이지는 배선도만 — BOM부터 다음 페이지 시작
      bomBox.appendChild(bt);

      var table = document.createElement("table");
      table.className = "bom";
      table.style.setProperty("--bom-rh", (Number(proj.bomRowH) || 6) + "px");   // 화면과 같은 행 높이
      function td(text, cls) { var d = document.createElement("td"); if (cls) d.className = cls; d.textContent = text; return d; }
      function th(text, cls) { var d = document.createElement("th"); if (cls) d.className = cls; d.textContent = text; return d; }
      // 구매링크 셀: 실제 클릭 가능한 하이퍼링크(href)로 — 화면은 JS가 클릭을 가로채는 방식이라 PDF엔 안 통함
      function linkTd(url) {
        var d = document.createElement("td"); d.className = "link";
        if (url) {
          var a = document.createElement("a");
          a.href = url; a.target = "_blank"; a.rel = "noopener";
          a.textContent = WE.app.linkLabel ? WE.app.linkLabel(url) : url;
          d.appendChild(a);
        }
        return d;
      }

      // 열 너비: 화면에서 실측한 픽셀 값을 그대로 적용, 표 전체 폭도 그 합으로 고정(비율 왜곡 방지)
      var cg = document.createElement("colgroup");
      var widths = [38];   // No열 기본값(실측 실패 시 폴백)
      if (screenWidths && screenWidths.length === cols.length + 1) widths = screenWidths;
      widths.forEach(function (w) {
        var c = document.createElement("col"); c.style.width = Math.round(w) + "px"; cg.appendChild(c);
      });
      table.appendChild(cg);
      table.style.width = Math.round(widths.reduce(function (a, b) { return a + b; }, 0)) + "px";

      var thead = document.createElement("thead"), htr = document.createElement("tr");
      htr.appendChild(th("No", "qty"));
      cols.forEach(function (col) { htr.appendChild(th(col.label, col.kind === "num" ? "qty" : (col.kind === "link" ? "link" : ""))); });
      thead.appendChild(htr); table.appendChild(thead);

      var tbody = document.createElement("tbody");
      data.rows.forEach(function (b) {
        var tr = document.createElement("tr");
        tr.appendChild(td(String(b.no), "qty"));
        cols.forEach(function (col) {
          if (col.id === "link") { tr.appendChild(linkTd(b.link)); return; }
          if (col.id === "ds") { tr.appendChild(td((b.dsNames || []).length ? ("📎 " + b.dsNames.length) : "", "qty")); return; }
          tr.appendChild(td(cellText(col, b), col.kind === "num" ? "qty" : ""));
        });
        tbody.appendChild(tr);
      });
      // 합계 행
      var trT = document.createElement("tr");
      trT.className = "bom-total";
      trT.appendChild(td(""));
      cols.forEach(function (col) {
        if (col.id === "name") trT.appendChild(td("합계"));
        else if (col.id === "qty") trT.appendChild(td(data.totalQty + "개", "qty"));
        else if (col.id === "sum") trT.appendChild(td(won(data.total), "qty"));
        else trT.appendChild(td("", col.kind === "num" ? "qty" : ""));
      });
      tbody.appendChild(trT);
      table.appendChild(tbody);
      bomBox.appendChild(table);
    }

    // 배선 리스트 (조립용: 번호·색·AWG·출발→도착)
    var wl = WE.app.wireListData ? WE.app.wireListData() : [];
    if (wl.length) {
      var wt = document.createElement("div");
      wt.className = "bom-title pdf-page-break"; wt.textContent = "배선 리스트";
      bomBox.appendChild(wt);
      var wtbl = document.createElement("table");
      wtbl.className = "bom";
      var whead = document.createElement("thead");
      whead.innerHTML = "<tr><th>번호</th><th>색</th><th>AWG</th><th>출발</th><th>도착</th></tr>";
      wtbl.appendChild(whead);
      var wbody = document.createElement("tbody");
      wl.forEach(function (r) {
        var tr = document.createElement("tr");
        function wtd(text, cls) { var d = document.createElement("td"); if (cls) d.className = cls; d.textContent = text; return d; }
        tr.appendChild(wtd(r.no, "qty"));
        var ctd = document.createElement("td");
        var sw = document.createElement("span");
        sw.style.cssText = "display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:4px;vertical-align:middle;background:" + r.colorHex;
        ctd.appendChild(sw); ctd.appendChild(document.createTextNode(r.color));
        tr.appendChild(ctd);
        tr.appendChild(wtd(r.awg ? ("AWG " + r.awg) : "", "qty"));
        tr.appendChild(wtd(r.fromCmp + " · " + r.fromTerm));
        tr.appendChild(wtd(r.toCmp + " · " + r.toTerm));
        wbody.appendChild(tr);
      });
      wtbl.appendChild(wbody);
      bomBox.appendChild(wtbl);
    }

    // 전력/배터리 요약
    var rows = WE.app.powerSummaryRows ? WE.app.powerSummaryRows() : [];
    if (rows.length) {
      var pt = document.createElement("div");
      pt.className = "bom-title"; pt.style.marginTop = "10px"; pt.textContent = "전력 / 배터리 요약";
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
  function measureScreenBomColWidths(cols) {
    var bomView = document.getElementById("bomView");
    var wasHidden = bomView.hidden;
    var prevVisibility = bomView.style.visibility;
    try {
      if (wasHidden) { bomView.hidden = false; bomView.style.visibility = "hidden"; }
      if (WE.app.renderBOMView) WE.app.renderBOMView();
      var ths = document.querySelectorAll("#bomTable thead th");
      // ths[0]=드래그용 여백열(제외), ths[1]="#"(No), ths[2..]=실제 열들
      if (ths.length < cols.length + 2) return null;
      var widths = [];
      for (var i = 1; i < ths.length; i++) widths.push(ths[i].getBoundingClientRect().width);
      return widths;
    } catch (e) {
      return null;
    } finally {
      if (wasHidden) { bomView.hidden = true; bomView.style.visibility = prevVisibility; }
    }
  }

  return { init: init, exportPrint: exportPrint };
})();
