// pdf.js — PDF 내보내기 (브라우저 인쇄 방식, 의존성 0)
var WE = window.WE || {};
window.WE = WE;

WE.pdf = (function () {
  function init() {
    document.getElementById("btnPdf").addEventListener("click", exportPrint);
    // Ctrl+P 직접 인쇄에도 제목/범례 채우기
    window.addEventListener("beforeprint", populate);
  }

  function exportPrint() {
    // 선택/러버밴드 등 편집 표시 제거 (인쇄에 안 나오게)
    WE.model.clearSelection();
    WE.render.clearWirePreview();
    WE.render.renderOverlay();
    populate();
    window.print();
  }

  function populate() {
    // 제목
    document.getElementById("printTitle").textContent = WE.model.project.meta.name || "";

    // 범례 (팔레트)
    var lg = document.getElementById("printLegend");
    lg.innerHTML = "";
    var pal = WE.model.project.palette || [];
    if (pal.length) {
      var title = document.createElement("div");
      title.className = "legend-title"; title.textContent = "범례";
      lg.appendChild(title);
      var rows = document.createElement("div");
      rows.className = "legend-rows";
      pal.forEach(function (p) {
        var row = document.createElement("div");
        row.className = "legend-row";
        var sw = document.createElement("span");
        sw.className = "legend-swatch"; sw.style.background = p.color;
        var tx = document.createElement("span");
        tx.textContent = p.label;
        row.appendChild(sw); row.appendChild(tx);
        rows.appendChild(row);
      });
      lg.appendChild(rows);
    }

    // BOM (자재명세서) — 화면 BOM 표와 동일한 데이터/열(표시/숨김·사용자열 포함) 사용
    var bomBox = document.getElementById("printBOM");
    bomBox.innerHTML = "";
    var data = WE.app.bomData ? WE.app.bomData() : { rows: [], total: 0, totalQty: 0 };
    var cols = WE.app.bomColumns ? WE.app.bomColumns() : [];
    function won(v) { return v ? "₩" + Math.round(v).toLocaleString() : ""; }
    function cellText(col, r) {
      if (col.kind === "custom") return (r.custom && r.custom[col.colId]) || "";
      switch (col.id) {
        case "name": return r.name;
        case "spec": return r.spec || "";
        case "qty": return r.qty + "개";
        case "price": return r.price ? Math.round(Number(r.price)).toLocaleString() : "";
        case "sum": return won(r.sum);
        case "link": return r.link || "";
        case "ds": return (r.dsNames || []).join(", ");
      }
      return "";
    }
    if (data.rows.length) {
      var bt = document.createElement("div");
      bt.className = "bom-title"; bt.textContent = "부품 목록 (BOM)";
      bomBox.appendChild(bt);

      var table = document.createElement("table");
      table.className = "bom";
      function td(text, cls) { var d = document.createElement("td"); if (cls) d.className = cls; d.textContent = text; return d; }
      function th(text, cls) { var d = document.createElement("th"); if (cls) d.className = cls; d.textContent = text; return d; }

      var thead = document.createElement("thead"), htr = document.createElement("tr");
      htr.appendChild(th("No", "qty"));
      cols.forEach(function (col) { htr.appendChild(th(col.label, col.kind === "num" ? "qty" : (col.kind === "link" ? "link" : ""))); });
      thead.appendChild(htr); table.appendChild(thead);

      var tbody = document.createElement("tbody");
      data.rows.forEach(function (b) {
        var tr = document.createElement("tr");
        tr.appendChild(td(String(b.no), "qty"));
        cols.forEach(function (col) {
          tr.appendChild(td(cellText(col, b), col.kind === "num" ? "qty" : (col.kind === "link" ? "link" : "")));
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
      wt.className = "bom-title"; wt.style.marginTop = "10px"; wt.textContent = "배선 리스트";
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

  return { init: init, exportPrint: exportPrint };
})();
