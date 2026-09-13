// render.js — SVG 렌더링
var WE = window.WE || {};
window.WE = WE;

WE.render = (function () {
  var SVGNS = "http://www.w3.org/2000/svg";
  var layerWires, layerWireLabels, layerComponents, layerLabels, layerTermLabels, layerAnnotations, layerOverlay;

  function init() {
    layerWires = document.getElementById("layerWires");
    layerWireLabels = document.getElementById("layerWireLabels");
    layerComponents = document.getElementById("layerComponents");
    layerLabels = document.getElementById("layerLabels");
    layerTermLabels = document.getElementById("layerTermLabels");
    layerAnnotations = document.getElementById("layerAnnotations");
    layerOverlay = document.getElementById("layerOverlay");
    layerComponentsTop = document.getElementById("layerComponentsTop");
    layerLabelsTop = document.getElementById("layerLabelsTop");
    refreshWatermark();
  }

  // 워터마크: 반투명 대각선 문구를 캔버스 전체에 타일 배치 (부품 아래 레이어라 작업 방해 없음).
  // 캔버스(도면 용지)의 일부라서 화면·PDF 양쪽에 함께 나타남.
  function buildWatermark() {
    var g = document.getElementById("layerWatermark");
    if (!g) return;
    // Pro 는 결과물에 서명을 남기지 않는다 (2026-09-06). 만들지 않고 비워 둔다 —
    // CSS 로 숨기기만 하면 PNG 내보내기가 이 레이어를 다시 채워서 살아난다.
    while (g.firstChild) g.removeChild(g.firstChild);
    if (WE.pro && !WE.pro.watermark()) return;
    var TEXT = "EasyCable · easycable.co.kr";
    var COL_W = 460, ROW_H = 230;   // 타일 간격
    var 종이 = WE.geometry.canvasSize();       // 페이지마다 다르다(2026-09-08)
    for (var row = 0, y = 140; y < 종이.height + ROW_H; row++, y += ROW_H) {
      var offset = (row % 2) ? COL_W / 2 : 0;   // 벽돌식 엇배치
      for (var x = 120 + offset; x < 종이.width + COL_W; x += COL_W) {
        var t = el("text", {
          "class": "canvas-watermark",
          transform: "translate(" + x + "," + y + ") rotate(-30)",
          "text-anchor": "middle"
        });
        t.textContent = TEXT;
        g.appendChild(t);
      }
    }
  }

  // 인쇄용 페이지 워터마크 — 도면 칸이 아니라 '종이 전체'를 덮는다.
  // 캔버스 안 워터마크(위)는 PNG 내보내기가 계속 쓰므로 그대로 두고, 인쇄에서만 이걸로 바꾼다.
  // 위치를 %로 잡아 두면 용지 크기·방향이 달라져도 그대로 채워진다.
  function buildPageWatermark() {
    var box = document.getElementById("pageWatermark");
    if (!box) return;
    box.innerHTML = "";
    if (WE.pro && !WE.pro.watermark()) return;   // Pro 는 인쇄물에도 안 찍는다
    var TEXT = "EasyCable · easycable.co.kr";
    // 간격은 넉넉히. 촘촘하면 글자끼리 붙어 한 덩어리로 보이고 도면·표를 읽기 힘들어진다.
    // 가로 52% · 세로 26% = A4 가로 한 장에 대략 3열 x 5행.
    for (var row = 0, y = -6; y < 115; row++, y += 26) {
      var offset = (row % 2) ? 26 : 0;           // 벽돌식 엇배치
      for (var x = -18 + offset; x < 115; x += 52) {
        var t = document.createElement("span");
        t.className = "pw-t";
        t.style.left = x + "%";
        t.style.top = y + "%";
        t.textContent = TEXT;
        box.appendChild(t);
      }
    }
  }

  function el(name, attrs) {
    var node = document.createElementNS(SVGNS, name);
    if (attrs) for (var k in attrs) node.setAttribute(k, attrs[k]);
    return node;
  }

  /* 선 종류 -> SVG stroke-dasharray.
     칸 길이를 선 두께에 비례시킨다. 고정값이면 굵은 선에서는 점선이 거의 안 보이고
     가는 선에서는 끊긴 자국만 남는다.
     dash 필드가 없으면(예전 파일·기본값) 실선이라 null 을 돌려준다. */
  function dashPattern(wire) {
    var w = Math.max(1, wire.width || 1);
    switch (wire.dash) {
      case "dash":    return (w * 3.5) + "," + (w * 2.5);
      case "dot":     return (w * 0.9) + "," + (w * 2.0);
      case "dashdot": return (w * 4.0) + "," + (w * 2.0) + "," + (w * 0.9) + "," + (w * 2.0);
      default:        return null;   // 실선
    }
  }

  // 부품 하나를 <g>로 렌더
  function renderComponent(cmp) {
    var g = el("g", {
      "class": "component",
      "data-id": cmp.id,
      "transform": WE.geometry.transformString(cmp)
    });

    // 이미지 (없으면 회색 박스)
    if (cmp.image) {
      var img = el("image", { x: 0, y: 0, width: cmp.width, height: cmp.height });
      img.setAttributeNS("http://www.w3.org/1999/xlink", "href", cmp.image);
      img.setAttribute("href", cmp.image);
      // 이미지를 박스에 꽉 채움(stretch) — 단자 좌표(박스 기준 rx·ry)와 이미지가 항상 일치.
      // 예전 meet(여백 유지) 방식은 박스/이미지 비율이 어긋나면 단자가 밀려 보여서,
      // 단자 편집 모달이 부품 height를 몰래 고쳐야 했음(비율이 멋대로 바뀌는 버그의 원인)
      img.setAttribute("preserveAspectRatio", "none");
      g.appendChild(img);
    } else {
      g.appendChild(el("rect", {
        x: 0, y: 0, width: cmp.width, height: cmp.height,
        fill: "#dfe4ea", stroke: "#aab", "stroke-width": 1
      }));
    }

    // 단자 (점 + 겹침 방지 라벨)
    appendTerminals(cmp, g);

    return g;
  }

  /* ── 부품별 '단자 라벨의 실제 최저점' (사용자 좌표) ──────────────────
     왜 필요한가 (2026-09-01):
       아래 labelPos() 는 원래 아래쪽 라벨이 있으면 26px 만 내렸다.
       가로로 눕는 라벨에는 맞지만, 촘촘한 핀헤더는 라벨이 90° 세워진다.
       세워지면 아래로 뻗는 길이가 글자 '높이'가 아니라 글자 '길이' 가 되어
       40~50px 까지 내려온다. 26px 로는 못 피해서 **부품명이 라벨 숲에 묻혔다.**
       (ESP32-S3 처럼 핀 많은 보드에서 이름이 아예 안 보였다)

     그래서 라벨을 그릴 때 실제 최저점을 재 두고, 이름을 그 아래로 놓는다. */
  var termLabelBottom = {};

  /* 그려진 라벨 한 개의 '아래 끝' 을 layerTermLabels 좌표로 돌려준다.
     ⚠ getBBox() 만 쓰면 안 된다 — 회전된 <text> 는 **회전 전** 상자를 준다.
        세워진 라벨에 물으면 글자 높이(≈12px)가 나와서 "안 내려온다" 는 거짓 답을 얻는다.
        노드→레이어 변환 행렬을 상자 네 귀퉁이에 적용해야 실제 좌표가 나온다.
     ⚠ 실패하면 null 을 돌려준다. 그러면 아래에서 예전 방식(26/5)으로 되돌아간다 —
        최악의 경우가 '지금과 같음' 이지 '깨짐' 이 아니다. */
  function labelBottomY(node) {
    try {
      var bb = node.getBBox();
      var mNode = node.getCTM(), mLayer = layerTermLabels.getCTM();
      if (!bb || !mNode || !mLayer) return null;
      var rel = mLayer.inverse().multiply(mNode);
      var pts = [[bb.x, bb.y], [bb.x + bb.width, bb.y],
                 [bb.x + bb.width, bb.y + bb.height], [bb.x, bb.y + bb.height]];
      var lowest = null;
      for (var i = 0; i < pts.length; i++) {
        var y = rel.b * pts[i][0] + rel.d * pts[i][1] + rel.f;   // 변환 후 y
        if (lowest === null || y > lowest) lowest = y;
      }
      return lowest;
    } catch (e) { return null; }
  }

  // appendTermLabels()의 변 판정과 동일한 기준으로, 자동배치된(수동 위치 없는) 단자 중
  // 아래쪽으로 뻗는 라벨이 있는지 확인 → 부품명이 그 라벨들과 겹치지 않게 더 아래로 내림
  function hasAutoBottomTermLabels(cmp) {
    if (cmp.hideTermLabels) return false;
    var box = componentBBox(cmp);   // 화면 좌표 기준(회전 반영) — layoutTermLabels와 같은 판정
    return cmp.terminals.some(function (t) {
      if (t.labelPos) return false;
      if (t.labelSide) return t.labelSide === "B";
      var dot = WE.geometry.terminalAbs(cmp, t);
      var dl = dot.x - box.x, dr = box.x2 - dot.x, dt = dot.y - box.y, db = box.y2 - dot.y;
      return Math.min(dl, dr, dt, db) === db;
    });
  }

  // 부품명 라벨: 회전과 무관하게 항상 수평·박스 아래 중앙
  function labelPos(cmp) {
    if (cmp.nameLabelPos) {
      return WE.geometry.localToAbs(cmp, cmp.nameLabelPos.x, cmp.nameLabelPos.y);
    }
    var W = cmp.width, H = cmp.height;
    var corners = [
      WE.geometry.localToAbs(cmp, 0, 0), WE.geometry.localToAbs(cmp, W, 0),
      WE.geometry.localToAbs(cmp, W, H), WE.geometry.localToAbs(cmp, 0, H)
    ];
    var maxY = Math.max(corners[0].y, corners[1].y, corners[2].y, corners[3].y);
    var center = WE.geometry.localToAbs(cmp, W / 2, H / 2);
    var gap = hasAutoBottomTermLabels(cmp) ? 26 : 5;   // 하단 단자 라벨과 겹치지 않게 여백 확보
    var y = maxY + gap;

    /* ★ 잰 값이 더 아래면 그것을 쓴다. **max 로 고르는 것이 핵심이다.**
       무조건 잰 값을 쓰면 지금 멀쩡한 부품(가로 라벨)까지 위치가 미세하게 달라져
       이미 뽑아 둔 도면·PDF 가 통째로 바뀐다.
       max 로 두면 **가려지던 부품만, 딱 필요한 만큼만** 내려간다.
       ⚠ .cmp-label 은 dominant-baseline:hanging 이라 y 가 글자 '윗변' 이다.
          그래서 최저점 + 여백이 곧 글자가 시작하는 자리가 된다. */
    var 잰것 = termLabelBottom[cmp.id];
    if (잰것 != null) y = Math.max(y, 잰것 + 6);
    return { x: center.x, y: y };
  }
  function updateComponentLabel(cmp) {
    /* ⚠ 이름표도 부품을 따라 층을 옮겨야 한다. 안 그러면 부품만 배선 위로 올라가고
       이름은 배선 아래에 남아 서로 떨어져 보인다.
       그래서 두 층을 다 뒤져 찾고, 제자리가 아니면 옮겨 붙인다. */
    var 층 = 이름층(cmp);
    var lbl = layerLabels.querySelector('text[data-label-for="' + cmp.id + '"]')
           || layerLabelsTop.querySelector('text[data-label-for="' + cmp.id + '"]');
    var bg = layerLabels.querySelector('rect[data-label-bg-for="' + cmp.id + '"]')
          || layerLabelsTop.querySelector('rect[data-label-bg-for="' + cmp.id + '"]');
    if (!lbl) {
      bg = el("rect", { "class": "cmp-label-bg", "data-label-bg-for": cmp.id });
      lbl = el("text", { "class": "cmp-label", "data-label-for": cmp.id });
    }
    if (lbl.parentNode !== 층) { 층.appendChild(bg); 층.appendChild(lbl); }
    var p = labelPos(cmp);
    lbl.setAttribute("x", p.x);
    lbl.setAttribute("y", p.y);
    lbl.textContent = WE.model.cmpLabel(cmp);   // "#3 스텝다운모듈" — 표기 규칙은 model.cmpLabel 한 곳에
    // 이름표 배경 사각블럭(설정에서 켠 경우만 CSS로 보임)
    try {
      var b = lbl.getBBox();
      bg.setAttribute("x", b.x - 3);
      bg.setAttribute("y", b.y - 2);
      bg.setAttribute("width", b.width + 6);
      bg.setAttribute("height", b.height + 4);
    } catch (e) { /* 아직 레이아웃 전이면 다음 렌더에서 반영 */ }
  }
  function renderComponentLabels() {
    layerLabels.innerHTML = "";
    layerLabelsTop.innerHTML = "";
    WE.model.project.components.forEach(function (cmp) { updateComponentLabel(cmp); });
  }

  // ---- 단자 점 크기: 화면상 겉보기 크기를 일정하게 유지 (단자 배치 모달과 동일한 UX) ----
  // 캔버스는 canvas.style.width = 1600*zoom 방식이라 그냥 두면 단자도 함께 스케일됨.
  // 그래서 반지름을 (부품 스케일 × 캔버스 줌)으로 나눠, 확대해도 점이 커지지 않게 함.
  // 단, 촘촘한 핀헤더는 이웃 거리 절반(cap)으로 상한을 둬서 히트영역이 겹치지 않게 함.
  var layerComponentsTop = null, layerLabelsTop = null;

  /* 이 부품을 배선 위에 그리는가. 두 층으로 나뉘어 있어서 어느 쪽을 봐야 할지
     매번 판단해야 하는데, 그 판단을 여기 한 곳에 모은다. */
  function 위층인가(cmp) { return !!(cmp && cmp.aboveWires); }
  function 부품층(cmp) { return 위층인가(cmp) ? layerComponentsTop : layerComponents; }
  function 이름층(cmp) { return 위층인가(cmp) ? layerLabelsTop : layerLabels; }
  // 층을 옮겨 다니므로 '어느 층에 있든' 찾아야 한다
  function 부품찾기(id) {
    return layerComponents.querySelector('[data-id="' + id + '"]')
        || (layerComponentsTop && layerComponentsTop.querySelector('[data-id="' + id + '"]'));
  }

  var _viewZoom = 1;
  function termRadii(nearest, cscale) {
    var k = cscale * _viewZoom;
    var cap = nearest / 2;                              // 겹침 방지 상한(로컬 좌표)
    var hit = Math.min(11 / k, cap); hit = Math.max(hit, Math.min(3, cap));
    var mark = Math.min(4.5 / k, cap * 0.85); mark = Math.max(mark, Math.min(1.6, cap * 0.85));
    var sel = Math.min(mark + 3.5 / k, cap);
    return { hit: hit, mark: mark, sel: sel };
  }
  function setViewZoom(z) { _viewZoom = z || 1; applyTermSizes(); }
  // 줌 변경 시: 이미 그려진 단자 원들의 반지름만 갱신(전체 재렌더 없이 가볍게)
  function applyTermSizes() {
    var gs = document.querySelectorAll("#layerComponents .term-dot, #layerComponentsTop .term-dot");
    for (var i = 0; i < gs.length; i++) {
      var g = gs[i];
      var r = termRadii(+g.getAttribute("data-nearest"), +g.getAttribute("data-cscale"));
      var hit = g.querySelector("[data-term-id]"); if (hit) hit.setAttribute("r", r.hit);
      var mk = g.querySelector(".term-dot-mark"); if (mk) mk.setAttribute("r", r.mark);
      var sel = g.querySelector(".term-dot-sel"); if (sel) sel.setAttribute("r", r.sel);
    }
  }

  // 단자 점 + 히트영역 (라벨은 별도 화면기준 레이어에서)
  function appendTerminals(cmp, g) {
    var def = WE.model.DEFAULT_TERMINAL_COLOR;
    var cscale = cmp.scale || 1;
    var visibleTerms = cmp.terminals.filter(function (t) { return t.visible !== false; });
    // 각 단자의 로컬 좌표를 미리 계산 (겹침 방지용 최근접 거리 산출에 사용)
    var pos = visibleTerms.map(function (t) { return { x: t.rx * cmp.width, y: t.ry * cmp.height }; });
    visibleTerms.forEach(function (t, i) {
      var cx = pos[i].x, cy = pos[i].y;
      var color = t.color || def;
      var nearest = Infinity;
      for (var j = 0; j < pos.length; j++) {
        if (j === i) continue;
        var d = Math.hypot(pos[j].x - cx, pos[j].y - cy);
        if (d < nearest) nearest = d;
      }
      var r = termRadii(nearest, cscale);
      // 그룹으로 묶어 CSS :hover로 마우스오버 시 강조 + 커스텀 툴팁(interactions.js)으로 단자명 표시.
      // data-nearest/cscale를 저장해두면 줌 변경 시 재계산 없이 반지름만 갱신 가능
      var tg = el("g", { "class": "term-dot", "data-nearest": nearest, "data-cscale": cscale });
      tg.appendChild(el("circle", {
        cx: cx, cy: cy, r: r.hit, fill: "#000", "fill-opacity": 0,
        "data-term-id": t.id, "data-cmp-id": cmp.id, style: "pointer-events:all;cursor:pointer"
      }));
      if (WE.model.ui.selectedTerminalId === t.id) {
        tg.appendChild(el("circle", {
          cx: cx, cy: cy, r: r.sel, fill: "none", stroke: "#1e88e5", "stroke-width": 2,
          "vector-effect": "non-scaling-stroke", "pointer-events": "none", "class": "term-dot-sel"
        }));
      }
      tg.appendChild(el("circle", {
        cx: cx, cy: cy, r: r.mark, fill: color, stroke: "#fff", "stroke-width": 1.5,
        "vector-effect": "non-scaling-stroke", "pointer-events": "none", "class": "term-dot-mark"
      }));
      g.appendChild(tg);
    });
  }

  // ---- 단자 라벨 (화면 기준 자동 배치: 회전해도 수평·안 꼬임) ----
  function appendTermLabels(cmp) {
    if (cmp.hideTermLabels) return;   // 단자 많은 복잡한 부품은 라벨을 꺼서 도면을 깔끔하게 (마우스 오버 시 이름 표시로 대체)
    var def = WE.model.DEFAULT_TERMINAL_COLOR;
    var box = componentBBox(cmp);
    var 최저 = null;                   // 이 부품 라벨들의 아래 끝 (labelPos 가 쓴다)

    var 그린것 = [];
    function draw(t, dot, lx, ly, anchor, vertical, side, col) {
      var color = t.color || def;
      var ln = el("line", {
        x1: dot.x, y1: dot.y, x2: lx, y2: ly,
        stroke: color, "stroke-width": 1, "stroke-opacity": 0.55, "pointer-events": "none"
      });
      layerTermLabels.appendChild(ln);
      var attrs = {
        "class": "term-label", "text-anchor": anchor, "dominant-baseline": "middle",
        "data-label-tid": t.id, "data-cmp-id": cmp.id
      };
      if (vertical) {   // 촘촘한 핀헤더: 글자를 90° 세워서(아래→위로 읽음) 겹침 방지
        attrs.transform = "translate(" + lx + "," + ly + ") rotate(-90)";
        attrs.x = 0; attrs.y = 0;
      } else {
        attrs.x = lx + (anchor === "end" ? -2 : (anchor === "start" ? 2 : 0));
        attrs.y = ly;
      }
      var tx = el("text", attrs);
      tx.textContent = t.name;
      layerTermLabels.appendChild(tx);
      그린것.push({ tx: tx, ln: ln, dot: dot, side: side, col: col || 0, vertical: !!vertical });
      // 붙인 직후에 잰다 — 여기가 노드를 손에 쥐고 있는 유일한 자리다.
      // 나중에 querySelectorAll 로 다시 찾아 재면 같은 일을 두 번 하게 된다.
      var by = labelBottomY(tx);
      if (by != null && (최저 === null || by > 최저)) 최저 = by;
    }

    /* 같은 면·같은 열의 이름들을 **바깥쪽 끝**(단자가 나가는 쪽)으로 줄 맞춘다.
       (2026-09-09 고원빈: "OUT은 튀어나오고 VCC는 들어가고 하니까 이상하다.
        단자가 나가는 방향을 기준으로 — 좌측으로 나가면 좌측, 우측이면 우측")

       예전에는 부품 쪽 끝을 맞췄다(왼쪽 면은 text-anchor:end). 부품과의 간격은 일정했지만
       바깥쪽이 이름 길이만큼 들쭉날쭉해서, 이름들이 한 줄로 읽히지 않았다.

       ⚠ 글자 수 × 어림 폭으로 맞추면 안 된다. 'OUT+' 와 'VCC' 는 실제 폭이 크게 다르고,
          어림이 빗나가면 긴 이름이 부품 쪽으로 삐져나온다. **그려 놓고 실측**해서 옮긴다.
       ⚠ 잇는 선은 글자의 **부품 쪽 끝**까지만 그린다. 안 그러면 선이 글자를 가로지른다.
       ⚠ 세로쓰기(촘촘한 핀헤더)와 위·아래 면은 건드리지 않는다 — 규칙이 따로다. */
    function 줄맞춤() {
      var 묶음 = {};
      그린것.forEach(function (g) {
        if (g.vertical || (g.side !== "L" && g.side !== "R")) return;
        var k = g.side + ":" + g.col;
        (묶음[k] = 묶음[k] || []).push(g);
      });
      Object.keys(묶음).forEach(function (k) {
        var arr = 묶음[k], side = k.charAt(0);
        var 바깥 = null, 상자 = [];
        arr.forEach(function (g) {
          var b = null;
          try { b = g.tx.getBBox(); } catch (e) { b = null; }
          상자.push(b);
          if (!b || !b.width) return;
          var 끝 = (side === "L") ? b.x : (b.x + b.width);
          if (바깥 === null) 바깥 = 끝;
          else 바깥 = (side === "L") ? Math.min(바깥, 끝) : Math.max(바깥, 끝);
        });
        if (바깥 === null) return;
        arr.forEach(function (g, i) {
          var b = 상자[i];
          if (!b || !b.width) return;
          var 지금 = (side === "L") ? b.x : (b.x + b.width);
          var 옮김 = 바깥 - 지금;
          if (옮김) {
            var x0 = parseFloat(g.tx.getAttribute("x") || 0);
            g.tx.setAttribute("x", x0 + 옮김);
          }
          // 잇는 선이 닿을 곳 = 글자의 부품 쪽 끝
          g.ln.setAttribute("x2", (side === "L") ? (b.x + b.width + 옮김) : (b.x + 옮김));
        });
      });
    }

    var autoTerms = [];
    cmp.terminals.filter(function (t) { return t.visible !== false; }).forEach(function (t) {
      if (t.labelPos) {                                   // 수동 위치(로컬 저장) → 화면좌표
        var dot = WE.geometry.terminalAbs(cmp, t);
        var lp = WE.geometry.localToAbs(cmp, t.labelPos.x, t.labelPos.y);
        draw(t, dot, lp.x, lp.y, lp.x < dot.x ? "end" : "start");
        return;
      }
      autoTerms.push(t);
    });
    // 단자배치 모달(termeditor.js)과 동일한 충돌회피 로직(geometry.layoutTermLabels) 공유 → 두 화면이 항상 같은 결과
    var laid = WE.geometry.layoutTermLabels(autoTerms, cmp.width, cmp.height, box, function (t) {
      return WE.geometry.terminalAbs(cmp, t);
    }, {
      sideOf: function (t) { return WE.geometry.termSideScreen(cmp, t); },
      // 라벨 자리에서 그 단자의 배선이 지나는 높이 — 라벨을 자기 배선 위에 얹는다.
      // 단자배치 모달에는 배선이 없어 이 옵션을 안 넘긴다(그쪽은 예전 그대로).
      wireYAt: function (t, x) { return WE.geometry.wireYAtXForTerminal(cmp.id, t.id, x); }
    });
    laid.forEach(function (o) { draw(o.t, o.dot, o.lx, o.ly, o.anchor, o.vertical, o.side, o.col); });
    줄맞춤();
    if (최저 !== null) termLabelBottom[cmp.id] = 최저;
  }
  function renderTermLabels() {
    layerTermLabels.innerHTML = "";
    /* ⚠ 잰 값이 **달라진 부품만** 이름을 다시 놓는다.
       단자 라벨 드래그(interactions.js)와 부품 이동·크기변경은 mousemove 마다
       이 함수를 부른다. 매번 전체 이름을 다시 계산하면 드래그가 무거워진다. */
    var 이전 = termLabelBottom;
    termLabelBottom = {};
    WE.model.project.components.forEach(function (cmp) { appendTermLabels(cmp); });
    WE.model.project.components.forEach(function (cmp) {
      if (이전[cmp.id] !== termLabelBottom[cmp.id]) updateComponentLabel(cmp);
    });
  }

  // ---- 배선 ----
  function renderWire(wire) {
    var d = WE.geometry.wirePath(wire);
    if (!d) return null;
    var g = el("g", { "class": "wire", "data-wire-id": wire.id });
    // 넓은 투명 히트영역
    g.appendChild(el("path", {
      d: d, fill: "none", stroke: "#000", "stroke-opacity": 0,
      "stroke-width": Math.max(wire.width + 10, 14), "stroke-linecap": "round",
      style: "pointer-events:stroke;cursor:pointer"
    }));
    // 표시 선
    var 선속성 = {
      d: d, fill: "none", stroke: wire.color, "stroke-width": wire.width,
      "stroke-linecap": "round", "stroke-linejoin": "round", "pointer-events": "none"
    };
    var 점선 = dashPattern(wire);
    if (점선) {
      선속성["stroke-dasharray"] = 점선;
      // 둥근 끝(round)은 점선의 빈칸을 메워 거의 실선처럼 보인다 — 점선일 때만 각지게
      선속성["stroke-linecap"] = "butt";
    }
    g.appendChild(el("path", 선속성));
    return g;
  }

  /* ── 배선 번호 라벨(수축튜브) ────────────────────────────────────────
     실물 배선에서는 **한 가닥의 양 끝에 같은 번호의 마킹 튜브**를 끼운다.
     현장에서 한쪽 끝을 잡았을 때 그게 무슨 선인지 알아야 결선할 수 있어서다.
     그래서 번호는 배선당 하나(labelText)지만 **그리는 자리는 두 곳**이다. (2026-09-09)

     ⚠ 분기 쪽 끝에도 찍는다. 분기선도 작업자가 양손에 들고 결선하는 물리적인 전선
        한 가닥이라, 분기 쪽을 비워 두면 그 끝을 잡았을 때 무슨 선인지 알 수 없다.
     ⚠ AWG 는 도면에 안 찍는다 (2026-09-13 고원빈: "도면이 너무 지저분해져").
        예전엔 번호 없이 AWG만 있어도 가운데에 "AWG 22" 를 찍었는데, 부품이 많은 도면에서
        그 글자만으로 지저분해 보였다. 규격은 결선표·BOM에 이미 나오므로 도면에서는 뺀다.
        (데이터 wire.awg 자체는 그대로 둔다 — 결선표·CSV·속성창 권장 표시가 여전히 읽는다)

     데이터
       w.labelText            번호. 배선당 하나.
       w.labelAt.from/to      손으로 옮긴 자리 { d, n }
                                d = 그 끝에서 경로를 따라 잰 거리(px)
                                n = 경로에 수직으로 어긋난 거리(px)
       w.labelSkip            "from" | "to" — 그 끝 마커만 지웠다
       w.labelT / w.labelPos  옛 파일. from 쪽 수동 위치로 읽는다.

     별도 레이어(layerWireLabels)에 그려 항상 모든 배선 선 위에 보이게 한다.
     obs: 이미 놓인 라벨 사각형 목록 — 누적해서 서로 겹치지 않게 피한다. */
  /* 기본 자리는 **끝이 무엇이냐**에 따라 다르다 (2026-09-09 고원빈).

       단자 끝 → 단자점 **바로 위**. 실물에서 커넥터 바로 옆에 튜브를 끼우는 것과 같은 모양이고,
                 도면에서도 "이 단자에 꽂히는 선이 W9 다" 가 한눈에 읽힌다.
                 단자 점을 덮어도 된다 — 단자가 거기 있다는 건 부품 모양으로 이미 안다.

       분기 끝 → 접점 동그라미를 **덮으면 안 된다.** 그 점이 "여기가 분기다" 를 알려 주는
                 유일한 표시라, 가리면 그냥 지나가는 선과 구분이 안 된다.
                 그래서 점 반지름 + 여유만큼 비켜 놓는다. */
  var 분기점여유 = 4;   // 접점 동그라미와 튜브 사이 틈(px)

  function 기본거리(wire, end, sz) {
    var ref = wire[end];
    if (!ref || !ref.wireId) {
      /* 단자 끝 — 단자점에서 **부품 쪽으로 튜브 반쪽만큼** 물린다(음수 = 경로 바깥).
         단자점에 중심을 맞추면 튜브 절반이 배선 쪽으로 나가 단자 이름과 겹친다.
         실제 도면에서 66개 중 31개가 그렇게 이름을 덮었다. 부품 쪽은 비어 있다. */
      return -(sz.w / 2 + 2);
    }
    // drawBranchDots 와 **같은 식**으로 점 크기를 구한다. 두 값이 달라지면 점이 가려진다.
    var host = WE.model.getWire(ref.wireId);
    var r = Math.max(3, ((host && host.width) || 2) + 1.5);
    return sz.w / 2 + r + 분기점여유;
  }

  /* 튜브를 어느 쪽으로 눕힐 것인가 —
     그 자리 **한 점의 구간 방향**이 아니라, 튜브가 덮는 구간의 **양 끝을 잇는 방향**을 쓴다.

     ⚠ 단자에서 5px 쯤 세로로 나갔다가 가로로 길게 뻗는 배선이 흔하다. 한 점의 구간
        방향만 보면 그 짧은 스텁 때문에 튜브가 **세로로 눕는다** — 눈에는 가로로 뻗는
        배선인데 라벨만 세워져 있어 저것만 이상해 보인다 (2026-09-09 고원빈: "W19는
        세로로 갑자기 이상하게 저것만 세로형으로 생겼네").
        시위로 재면 5px 스텁은 묻히고 실제로 뻗어 나가는 쪽이 나온다. */
  function 주된방향(pts, dFrom, span) {
    var L = WE.geometry.polylineLength(pts);
    var a = Math.max(0, Math.min(L, dFrom - span / 2));
    var b = Math.max(0, Math.min(L, dFrom + span / 2));
    if (b - a < 1) { a = 0; b = Math.min(L, Math.max(span, 1)); }   // 경로가 튜브보다 짧다
    /* 튜브가 덮는 구간들 중 **가장 길게 겹치는** 구간의 방향.
       ⚠ 양 끝을 잇는 시위로 재면 8px 스텁과 가로 주행이 섞여 대각선이 나온다
          (튜브가 35×34 로 거의 정사각형이 됐다). 가장 긴 구간을 고르면 짧은 스텁이
          이길 수 없고, 직각 배선에서는 늘 가로 아니면 세로가 된다. */
    var acc = 0, best = null, bl = -1;
    for (var i = 0; i < pts.length - 1; i++) {
      var p1 = pts[i], p2 = pts[i + 1];
      var l = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      var 겹침 = Math.min(acc + l, b) - Math.max(acc, a);
      if (겹침 > bl && l > 0.5) { bl = 겹침; best = { x: p2.x - p1.x, y: p2.y - p1.y, len: l }; }
      acc += l;
    }
    if (!best || bl <= 0) return null;
    return { ux: best.x / best.len, uy: best.y / best.len };
  }

  function labelSize(text) { return { w: text.length * 6.4 + 14, h: 16 }; }
  function labelBoxOf(c) { return { x: c.cx - c.w / 2, y: c.cy - c.h / 2, w: c.w, h: c.h }; }
  function labelHits(c, obs) {
    var r = labelBoxOf(c);
    for (var i = 0; i < obs.length; i++) {
      var o = obs[i];
      if (r.x < o.x + o.w && r.x + r.w > o.x && r.y < o.y + o.h && r.y + r.h > o.y) return true;
    }
    return false;
  }

  /* 한쪽 끝에 놓을 자리. 끝에서 바깥으로 걸으며
       ① 튜브가 **한 구간 안에 온전히** 들어가고
       ② 단자 이름·다른 라벨과 안 겹치는
     첫 자리를 쓴다.

     ⚠ ①이 없으면 단자 바로 앞에서 배선이 꺾이는 흔한 경우에 튜브가 모서리에 걸터앉아
        글자가 꺾인 채로 그려진다. 그때는 다음 구간까지 걸어 나가는 게 맞다.
     ⚠ 손으로 정한 자리는 **회피도 하지 않고** 그대로 둔다. 사람이 일부러 거기 둔 것이라
        프로그램이 다시 밀면 끌어다 놓을 수가 없다. */
  function placeEndLabel(wire, pts, end, sz, obs) {
    var half = sz.w / 2 + 3;
    var manual = wire.labelAt && wire.labelAt[end];
    // 옛 파일 — labelT(비율)/labelPos(절대)는 from 쪽 수동 위치로 읽는다
    if (!manual && end === "from" && (wire.labelT != null || wire.labelPos)) {
      var lp = wire.labelT != null ? WE.geometry.polylinePointAt(pts, wire.labelT) : wire.labelPos;
      if (lp) manual = WE.geometry.polylineOffsetFromEnd(pts, "from", lp);
    }
    function at(d) {
      var p = WE.geometry.polylinePointFromEnd(pts, end, d);
      if (!p) return null;
      /* 눕힐 방향은 튜브가 덮는 만큼의 시위로 정한다. 경로 바깥(부품 쪽)에 물린
         기본 자리는 경로가 시작되는 쪽 한 튜브 길이를 본다. */
      var L0 = WE.geometry.polylineLength(pts);
      var dFrom = (end === "to") ? (L0 - d) : d;
      var 방 = 주된방향(pts, Math.max(0, Math.min(L0, dFrom)), sz.w) || { ux: p.ux, uy: p.uy };
      return { cx: p.x, cy: p.y, ux: 방.ux, uy: 방.uy,
               segIn: p.segIn, segLen: p.segLen, w: sz.w, h: sz.h };
    }
    if (manual) return at(manual.d);
    /* ⚠ **경로 위에서만** 찾는다 (2026-09-09 고원빈: "라벨은 무조건 배선 경로에").
       한때 경로에 수직으로 살짝 밀어 단자 이름을 피하게 했는데, 실제 도면에서는
       단자 이름이 기본 자리를 거의 늘 막아서 마커가 옆으로 튀어 나갔다.
       선에서 떨어진 마커는 어느 선의 번호인지 알 수 없으니, 겹치더라도 선 위가 낫다.

       ⚠ 장애물은 **다른 마커뿐**이다. 단자 이름은 피하지 않는다 —
          단자 이름을 피하려 들면 마커가 단자에서 멀어지는데, 그러면 "이 선이 어느 단자에
          꽂히는가" 라는 마커의 존재 이유가 없어진다. 이름과 나란히 놓이는 게 정상이다.
       ⚠ 절반까지만 걷는다. 더 가면 반대쪽 끝 마커와 자리를 다툰다. */
    var 시작 = 기본거리(wire, end, sz);
    var 분기끝 = !!(wire[end] && wire[end].wireId);
    /* ⚠ 멀리 걸어 나가면 겹침은 피하지만 "이 선이 어느 단자에 꽂히는가" 를 잃는다.
       튜브 세 개 길이쯤에서 멈추고, 그래도 빈 자리가 없으면 겹치더라도 단자 옆에 둔다. */
    var L = WE.geometry.polylineLength(pts);
    var 끝까지 = Math.min(Math.max(시작 + 8, L / 2 - half), 시작 + sz.w * 3);
    for (var d = 시작; d <= 끝까지; d += 8) {
      var c = at(d);
      if (!c) continue;
      /* 모서리에 걸터앉으면 글자가 꺾여 안 읽힌다 — 다음 구간까지 걸어 나간다.
         ⚠ 경로 **바깥**(단자 끝 기본 자리)은 구간이랄 게 없으니 따지지 않는다.
            분기 끝은 경로 안이라 처음부터 따진다 — 그래야 접점 옆에서 꺾이는 분기선의
            튜브가 모서리에 걸터앉지 않는다. */
      if (!c.바깥 && (c.segIn < half || c.segLen - c.segIn < half)) continue;
      if (!labelHits(c, obs)) return c;
    }
    /* 빈 자리가 없다 — 기본 자리에 두되 **겹쳤다고 표시**한다.
       부르는 쪽이 "그럴 바에는 이쪽은 빼자" 를 판단할 수 있어야 한다. */
    var 마지막 = at(시작);
    if (마지막) 마지막.겹침 = true;
    return 마지막;
  }

  /* 끝에서 자리를 못 찾았거나 배선이 짧을 때 — 예전 방식(가장 긴 가로 구간 한가운데).
     인덱스 기준 중간은 짧은 스텁에 걸려 위치가 제각각이 된다. */
  function placeMidLabel(pts, sz, obs) {
    var bestH = null, bhLen = -1, bestAny = null, baLen = -1;
    for (var si = 0; si < pts.length - 1; si++) {
      var p1 = pts[si], p2 = pts[si + 1];
      var len = Math.abs(p2.x - p1.x) + Math.abs(p2.y - p1.y);
      if (Math.abs(p1.y - p2.y) < 0.5 && len > bhLen) { bhLen = len; bestH = [p1, p2]; }
      if (len > baLen) { baLen = len; bestAny = [p1, p2]; }
    }
    var seg = (bestH && bhLen >= 40) ? bestH : bestAny;
    if (!seg) return null;
    var sx = seg[1].x - seg[0].x, sy = seg[1].y - seg[0].y;
    var sl = Math.hypot(sx, sy) || 1;
    // ⚠ 여기도 **구간 위에서만** 옮긴다. 예전에는 위/아래로 14·28px 씩 띄웠는데,
    //    그게 "라벨이 배선에 안 붙어 있다" 로 보이는 원인 중 하나였다.
    function at(f) {
      return { cx: seg[0].x + sx * f, cy: seg[0].y + sy * f,
               ux: sx / sl, uy: sy / sl, w: sz.w, h: sz.h };
    }
    var fr = [0.5, 0.35, 0.65, 0.25, 0.75, 0.15, 0.85, 0.45, 0.55, 0.3, 0.7];
    for (var fi = 0; fi < fr.length; fi++) {
      var c = at(fr[fi]);
      if (!labelHits(c, obs)) return c;
    }
    return at(0.5);
  }

  // 실물 수축튜브 모양(흰 튜브에 번호 인쇄). 놓인 구간 방향으로 눕힌다.
  function tubeNode(wire, end, text, c) {
    // 글자가 뒤집히지 않게 -90°~90°로 정규화
    var ang = Math.atan2(c.uy, c.ux) * 180 / Math.PI;
    if (ang > 90) ang -= 180;
    if (ang <= -90) ang += 180;
    // 회전 후 화면 차지 영역(AABB) — g의 getBBox는 회전을 반영하지 않아 선택 강조가 어긋난다
    var rad = ang * Math.PI / 180;
    var aw = Math.abs(c.w * Math.cos(rad)) + Math.abs(c.h * Math.sin(rad));
    var ah = Math.abs(c.w * Math.sin(rad)) + Math.abs(c.h * Math.cos(rad));
    var g = el("g", {
      "class": "wire-tube", "data-wire-label-for": wire.id, "data-wire-label-end": end,
      "data-wire-label-cx": c.cx, "data-wire-label-cy": c.cy,
      "data-aabb-w": aw, "data-aabb-h": ah,
      transform: "translate(" + c.cx + "," + c.cy + ") rotate(" + ang + ")",
      style: "pointer-events:all;cursor:move;user-select:none"
    });
    g.appendChild(el("rect", {
      x: -c.w / 2, y: -c.h / 2, width: c.w, height: c.h, rx: 3,
      fill: "#fff", stroke: "#98a2ad", "stroke-width": 1
    }));
    var t2 = el("text", {
      x: 0, y: 0, "text-anchor": "middle", "dominant-baseline": "central",
      style: "font:600 10.5px 'Malgun Gothic',sans-serif;fill:#222;pointer-events:none"
    });
    t2.textContent = text;
    g.appendChild(t2);
    return g;
  }

  // 배선 하나가 만들어 내는 라벨 노드들(0~2개) — 번호(labelText)가 있을 때만 그린다.
  // AWG 는 도면에 안 찍는다(위 설명 참고) — 결선표·BOM 에서 이미 보여준다.
  function buildWireLabels(wire, obs) {
    var out = [];
    var tubeTxt = (wire.labelText || "").trim();
    if (!tubeTxt) return out;
    var pts = WE.geometry.wireRoutePoints(wire);
    if (!pts || pts.length < 2) return out;
    var text = tubeTxt;
    obs = obs || termLabelRects().slice();

    var sz = labelSize(text);
    /* ⚠ 단자 이름도 장애물이다. 부품 쪽 기본 자리가 비어 있으면 거기 붙고,
       빽빽해서 막혔을 때만 배선을 따라 바깥으로 걸어 나간다.
       이름을 아예 안 피했더니 실제 도면에서 66개 중 31개가 이름을 덮었다. */
    var ends = ["from", "to"].filter(function (e) { return wire.labelSkip !== e; });

    // 두 자리를 먼저 잡아 본다 (obs 는 아직 건드리지 않는다 — 서로를 장애물로 보면 안 된다)
    var 자리 = {};
    ends.forEach(function (end) {
      자리[end] = placeEndLabel(wire, pts, end, sz, obs) || placeMidLabel(pts, sz, obs);
    });

    /* 짧은 배선에서 한쪽이 단자 이름 위에 얹히게 되면 **그쪽은 그리지 않는다**.
       두 마커가 가까우니 하나만 있어도 어느 선인지 알 수 있고, 가려진 단자 이름을
       되찾는 편이 낫다 (2026-09-09 고원빈: "W3을 보면 단자명칭과 겹쳐서 한개가 가려지는
       문제가 발생하네 … 가까운 부분은 어차피 라벨 하나만 있어도 구분 가능하니까").

       ⚠ **짧을 때만** 그렇게 한다. 긴 배선의 반대쪽 끝은 화면 저 멀리라, 거기 마커가
          없으면 그 끝을 잡은 작업자가 무슨 선인지 알 길이 없다. 그때는 이름을 덮더라도
          마커가 있는 편이 낫다. */
    if (ends.length === 2 && 자리.from && 자리.to &&
        WE.geometry.polylineLength(pts) <= sz.w * 3.5) {
      var 깨끗 = ends.filter(function (e) { return 자리[e] && !자리[e].겹침; });
      if (깨끗.length === 1) ends = 깨끗;
    }

    /* 아주 짧은 배선에서는 두 튜브가 서로 겹친다 — 그때도 하나로 줄인다.
       ⚠ 예전에는 **경로 길이**로 잘랐다(길이 < 튜브×2+16). 그런데 단자 끝 튜브는 경로
          바깥(부품 쪽)에 놓이므로 짧아도 서로 안 부딪히는 경우가 많다. 그 규칙 때문에
          짧은 분기선의 분기 쪽 마커가 통째로 사라졌다
          (2026-09-09 고원빈: "W10은 분기부분에 라벨이 한개 안생겼네"). */
    if (ends.length === 2 && 자리.from && 자리.to &&
        labelHits(자리.from, [labelBoxOf(자리.to)])) {
      // 남길 쪽 — 단자 끝이 읽기 좋다. 둘 다 단자거나 둘 다 분기면 from.
      var 남길 = (wire.to && wire.to.wireId && !(wire.from && wire.from.wireId)) ? "from"
               : ((wire.from && wire.from.wireId && !(wire.to && wire.to.wireId)) ? "to" : "from");
      ends = [남길];
    }

    ends.forEach(function (end) {
      var c = 자리[end];
      if (!c) return;
      obs.push(labelBoxOf(c));
      out.push(tubeNode(wire, end, text, c));
    });
    return out;
  }


  // 튜브 글자 자동 중앙 정렬: DOM에 붙은 뒤 실제 글자 영역(getBBox)을 재서 세로 중심을 0에 맞춤
  // (dominant-baseline은 폰트의 em 박스 기준이라 글꼴에 따라 시각적 중심이 어긋남 — 실측으로 보정)
  function centerTubeText(g) {
    if (!g || !g.querySelector) return;
    var tx = g.querySelector("text");
    if (!tx) return;
    try {
      var b = tx.getBBox();
      tx.setAttribute("y", parseFloat(tx.getAttribute("y") || 0) - (b.y + b.height / 2));
    } catch (e) { /* 무시 */ }
  }

  // 배선 라벨의 화면 영역 — 튜브(g, 회전 있음)는 data-aabb 속성 사용, 텍스트는 getBBox
  function wireLabelBox(n) {
    if (n.hasAttribute("data-aabb-w")) {
      var cx = parseFloat(n.getAttribute("data-wire-label-cx")), cy = parseFloat(n.getAttribute("data-wire-label-cy"));
      var w2 = parseFloat(n.getAttribute("data-aabb-w")), h2 = parseFloat(n.getAttribute("data-aabb-h"));
      return { x: cx - w2 / 2, y: cy - h2 / 2, width: w2, height: h2 };
    }
    try { return n.getBBox(); } catch (e) { return null; }
  }

  // 단자 라벨들의 화면 영역(라벨 충돌 회피용, renderWires 1회당 캐시)
  var _termRects = null;
  function termLabelRects() {
    if (_termRects) return _termRects;
    _termRects = [];
    var texts = layerTermLabels.querySelectorAll("text");
    for (var i = 0; i < texts.length; i++) {
      try {
        var b = texts[i].getBBox();
        _termRects.push({ x: b.x - 2, y: b.y - 2, w: b.width + 4, h: b.height + 4 });
      } catch (e) { /* 무시 */ }
    }
    return _termRects;
  }

  function renderWires() {
    WE.geometry.computeRoutes();   // 전역 너징(레인 분리) 반영
    _termRects = null;             // 단자 라벨 위치 캐시 갱신
    layerWires.innerHTML = "";
    layerWireLabels.innerHTML = "";   // 번호 라벨은 별도 레이어 — 항상 모든 배선 선 위에 그려짐
    var labelObs = termLabelRects().slice();   // 단자 라벨 + 배선 라벨끼리도 서로 피하도록 누적
    WE.model.project.wires.forEach(function (w) {
      var g = renderWire(w);
      if (g) layerWires.appendChild(g);
      buildWireLabels(w, labelObs).forEach(function (lbl) {
        layerWireLabels.appendChild(lbl); centerTubeText(lbl);
      });
    });
    drawBranchDots();   // 선을 다 그린 뒤 — 접점이 선 위에 얹혀야 한다
  }

  // 배선 path 갱신 (너징은 전역이라 전부 다시 계산)
  function updateWiresFor(cmpId) {
    WE.geometry.computeRoutes();
    WE.model.project.wires.forEach(function (w) {
      var d = WE.geometry.wirePath(w);
      if (!d) return;
      var g = layerWires.querySelector('[data-wire-id="' + w.id + '"]');
      if (g) {
        var paths = g.querySelectorAll("path");
        paths[0].setAttribute("d", d);
        paths[1].setAttribute("d", d);
      }
    });
    // 분기 접점도 함께 옮긴다. 이 함수는 드래그 중 가볍게 돌리려고 경로만 갱신했는데,
    // 접점 점은 renderWires()에서만 그려져 옛 자리에 남아 있었다(선은 따라갔는데 점만 뒤처짐).
    redrawBranchDots();
    // 배선 번호 라벨도 경로 위에 다시 배치(드래그 중 라벨이 옛 위치에 남지 않게)
    _termRects = null;
    layerWireLabels.innerHTML = "";
    var labelObs = termLabelRects().slice();
    WE.model.project.wires.forEach(function (w) {
      buildWireLabels(w, labelObs).forEach(function (lbl) {
        layerWireLabels.appendChild(lbl); centerTubeText(lbl);
      });
    });
  }

  // ---- 주석 ----
  function renderAnnotation(a) {
    var t = el("text", {
      "class": "annotation", "data-anno-id": a.id,
      x: a.x, y: a.y, fill: a.color,
      "font-size": a.fontSize, "font-weight": a.bold ? "700" : "400",
      style: "cursor:move"
    });
    var lines = String(a.text).split("\n");
    lines.forEach(function (line, i) {
      var ts = el("tspan", { x: a.x, dy: i === 0 ? 0 : a.fontSize * 1.2 });
      ts.textContent = line || " ";
      t.appendChild(ts);
    });
    return t;
  }
  function renderAnnotations() {
    layerAnnotations.innerHTML = "";
    WE.model.project.annotations.forEach(function (a) {
      layerAnnotations.appendChild(renderAnnotation(a));
    });
  }

  // 전체 레이어 다시 그림
  function renderAll() {
    layerComponents.innerHTML = "";
    layerComponentsTop.innerHTML = "";
    var comps = WE.model.project.components.slice().sort(function (a, b) { return a.z - b.z; });
    comps.forEach(function (cmp) {
      부품층(cmp).appendChild(renderComponent(cmp));   // 배선 위/아래 중 제자리에
    });
    renderComponentLabels();
    renderTermLabels();
    renderWires();      // 배선 라벨이 최신 단자 라벨 위치를 참조하도록 단자 라벨 뒤에
    renderAnnotations();
    renderOverlay();
    // 부품 변경이 BOM(하단 탭)에도 즉시 반영되도록
    if (WE.app && WE.app.afterModelRender) WE.app.afterModelRender();
  }

  // 선택 표시(선택 박스 + 리사이즈 핸들 / 배선 하이라이트 + waypoint)
  // ---- 미연결 단자 ----
  // 배선 끝점은 '단자'({componentId,terminalId}) 아니면 '다른 배선'({wireId,x,y}) 둘 뿐이다.
  // 그래서 모든 끝점을 모아 단자 목록과 대조하면 끝 — 추측이 전혀 안 들어간다.
  // 현재 시트만 본다(다른 시트는 화면에 없다).
  /* 인자 없이 부르면 예전 그대로 **보이는 단자만** 준다 — 오버레이가 그걸 그린다.
     includeHidden 을 주면 숨긴 것까지 준다.

     ⚠ 왜 이 구분이 필요한가 (2026-09-07):
        숨긴 단자를 안 세면, 안 이어진 단자를 숨긴 뒤 개수가 0 이 되어
        "모든 단자가 이어졌습니다" 라는 **거짓 보고**가 나갔다.
        점검 도구가 안전하다고 거짓말하면 배선이 빠진 도면을 그대로 납품하게 된다. */
  function unconnectedTerminals(opts) {
    var 숨긴것도 = !!(opts && opts.includeHidden);
    var used = {};
    WE.model.project.wires.forEach(function (w) {
      [w.from, w.to].forEach(function (r) {
        if (r && r.componentId && r.terminalId) used[r.componentId + "|" + r.terminalId] = 1;
      });
    });
    var out = [];
    WE.model.project.components.forEach(function (c) {
      (c.terminals || []).forEach(function (t) {
        if (!숨긴것도 && t.visible === false) return;
        if (!used[c.id + "|" + t.id]) out.push({ cmp: c, term: t, 숨김: t.visible === false });
      });
    });
    return out;
  }
  // 툴바 '⚠ 미연결 확인'을 켰을 때만 그린다. 화면 전용 — 오버레이 레이어라 인쇄·PNG에는 안 나간다.
  // 색만으로는 부족하다 — 도면이 이미 빨간 배선·색색의 단자로 가득해서 정적인 링은 묻힌다.
  // 그래서 세 가지를 함께 쓴다: ①배선에 안 쓰는 자홍색 ②단자 점보다 큰 면적 ③맥동(움직임).
  // 움직이는 것은 시야 주변에서도 눈에 걸리므로, '어디가 빠졌나' 찾는 데는 이게 가장 빠르다.
  //
  // 색은 후보를 흰 배경·빨간선·주황선·어두운 부품 네 조건에 놓고 비교해 정했다.
  // 호박색은 밝기가 높아 흰 배경과 명도 차이가 거의 없어 묻혔고, 진한 주황은 주황 배선 위에서 사라졌다.
  // 자홍은 네 조건 모두에서 살아남고 배선 팔레트(빨강·검정·흰색·노랑·파랑)와도 겹치지 않는다.
  function drawUnconnected() {
    if (!WE.model.ui.checkTerminals) return;
    var r = 9 / _viewZoom;   // 확대·축소해도 화면에서 같은 크기로 보이게
    unconnectedTerminals().forEach(function (o) {
      var p = WE.geometry.terminalAbs(o.cmp, o.term);
      var g = el("g", { "class": "term-unconn", "pointer-events": "none" });
      // 퍼졌다 사라지는 원 — 움직임 담당
      g.appendChild(el("circle", { cx: p.x, cy: p.y, r: r, "class": "tu-pulse" }));
      // 어두운 부품 사진 위에서도 보이도록 흰 테두리를 한 겹 깔고
      g.appendChild(el("circle", {
        cx: p.x, cy: p.y, r: r, fill: "none", stroke: "#fff", "stroke-width": 5.5,
        "vector-effect": "non-scaling-stroke"
      }));
      // 그 위에 호박색 링 — 깜박이며 진해졌다 옅어졌다 한다
      g.appendChild(el("circle", {
        cx: p.x, cy: p.y, r: r, fill: "none", stroke: "#c2008b", "stroke-width": 2.6,
        "vector-effect": "non-scaling-stroke", "class": "tu-ring"
      }));
      layerOverlay.appendChild(g);
    });
  }

  function renderOverlay() {
    layerOverlay.innerHTML = "";
    if (_marquee) {
      layerOverlay.appendChild(el("rect", {
        x: _marquee.x, y: _marquee.y, width: _marquee.w, height: _marquee.h,
        fill: "#1e88e5", "fill-opacity": 0.08, stroke: "#1e88e5", "stroke-width": 1,
        "stroke-dasharray": "4 3", "pointer-events": "none"
      }));
    }
    drawBranchTarget();     // 분기 대상 강조 — 미리보기 선 아래에 깔린다
    drawWireAlignGuide();   // 배선 미리보기 아래에 깔리도록 먼저
    if (_rubber) layerOverlay.appendChild(_rubber);
    if (_snap) {
      layerOverlay.appendChild(el("circle", {
        cx: _snap.x, cy: _snap.y, r: 11, fill: "#1e88e5", "fill-opacity": 0.2,
        stroke: "#1e88e5", "stroke-width": 2.5, "pointer-events": "none"
      }));
    }
    drawUnconnected();      // 선택 표시보다 먼저 — 파란 선택 링이 위로 오게
    drawNetHighlight();
    drawWireLabelGuide();
    drawWireLabelHover();
    drawAlignGuides();
    drawLabelPreview();
    drawTextPreview();

    // 다중 선택(2개 이상): 부품 + 주석 + 배선 하이라이트 — 단일 선택보다 먼저 판정
    var multi = WE.model.getMulti(), mAnno = WE.model.getMultiAnno(), mWire = WE.model.getMultiWire();
    if (multi.length + mAnno.length + mWire.length > 1) {
      multi.forEach(function (id) {
        var c = WE.model.getComponent(id);
        if (!c) return;
        var mg2 = el("g", { transform: WE.geometry.transformString(c) });
        mg2.appendChild(el("rect", { x: 0, y: 0, width: c.width, height: c.height, "class": "selection-box" }));
        layerOverlay.appendChild(mg2);
      });
      mAnno.forEach(function (id) {
        var elT = layerAnnotations.querySelector('[data-anno-id="' + id + '"]');
        if (!elT) return;
        try {
          var bb = elT.getBBox();
          layerOverlay.appendChild(el("rect", {
            x: bb.x - 4, y: bb.y - 3, width: bb.width + 8, height: bb.height + 6, "class": "selection-box"
          }));
        } catch (e) { /* ignore */ }
      });
      mWire.forEach(function (id, mi) {
        var w = WE.model.getWire(id); if (!w) return;
        var pts = WE.geometry.wireRoutePoints(w); if (!pts) return;
        var d = "M " + pts.map(function (p) { return p.x + " " + p.y; }).join(" L ");
        layerOverlay.appendChild(el("path", {
          d: d, fill: "none", stroke: "#1e88e5", "stroke-width": w.width + 4,
          "stroke-opacity": 0.3, "stroke-linecap": "round", "stroke-linejoin": "round", "pointer-events": "none"
        }));
        // 클릭한(정렬 대상) 구간을 굵게 강조 — 기준(첫)은 파랑, 나머지는 주황
        var pt = WE.model.getWireClickPt(id);
        if (pt) {
          var si = WE.geometry.nearestSegmentIndex(pts, pt);
          if (si >= 0) {
            var a = pts[si], b = pts[si + 1];
            layerOverlay.appendChild(el("path", {
              d: "M " + a.x + " " + a.y + " L " + b.x + " " + b.y, fill: "none",
              stroke: mi === 0 ? "#1e88e5" : "#fb8c00", "stroke-width": w.width + 8,
              "stroke-opacity": 0.9, "stroke-linecap": "round", "pointer-events": "none"
            }));
          }
        }
      });
      return;
    }

    // 단일 주석 선택
    var anno = WE.model.getSelectedAnnotation();
    if (anno) {
      var elT = layerAnnotations.querySelector('[data-anno-id="' + anno.id + '"]');
      if (elT) {
        try {
          var b = elT.getBBox();
          layerOverlay.appendChild(el("rect", {
            x: b.x - 4, y: b.y - 3, width: b.width + 8, height: b.height + 6,
            "class": "selection-box"
          }));
        } catch (e) { /* getBBox 실패 무시 */ }
      }
      return;
    }

    // 단일 배선 선택
    var wire = WE.model.getSelectedWire();
    if (wire) { renderWireOverlay(wire); return; }

    var cmp = WE.model.getSelectedComponent();
    if (!cmp) return;

    // 부품과 같은 transform을 건 그룹에 로컬 좌표로 그려 회전/스케일 자동 반영
    var W = cmp.width, H = cmp.height;
    var og = el("g", { transform: WE.geometry.transformString(cmp) });

    og.appendChild(el("rect", { x: 0, y: 0, width: W, height: H, "class": "selection-box" }));

    // 우하단 리사이즈 핸들
    var hs = 9;
    og.appendChild(el("rect", {
      x: W - hs / 2, y: H - hs / 2, width: hs, height: hs,
      "class": "resize-handle", "data-handle": "se"
    }));

    // 상단 회전 핸들 (박스 위)
    var rhY = -26;
    og.appendChild(el("line", { x1: W / 2, y1: 0, x2: W / 2, y2: rhY, stroke: "#1e88e5", "stroke-width": 1.5, "pointer-events": "none" }));
    og.appendChild(el("circle", { cx: W / 2, cy: rhY, r: 7, "class": "rotate-handle", "data-rotate": "1" }));

    layerOverlay.appendChild(og);

    // ⋯ 옵션 메뉴 버튼: 회전과 무관하게 항상 화면 우측상단(AABB 기준)
    var bb2 = componentBBox(cmp);
    var bw = 22, bh = 18;
    var mg = el("g", { "class": "cmp-menu-btn", "data-menu": "1" });
    mg.appendChild(el("rect", { x: bb2.x2 - bw, y: bb2.y - bh - 2, width: bw, height: bh, rx: 3, fill: "#1e88e5", stroke: "#1565c0" }));
    var mt = el("text", { x: bb2.x2 - bw / 2, y: bb2.y - bh / 2 - 2, "class": "cmp-menu-dots" });
    mt.textContent = "⋯";
    mg.appendChild(mt);
    layerOverlay.appendChild(mg);
  }

  // 배선 선택 시: 하이라이트 + waypoint 핸들
  function renderWireOverlay(wire) {
    // 라벨(수축튜브)을 직접 클릭한 상태면 라벨만 선택된 것처럼 — 배선 하이라이트·꺾임점 핸들 생략
    var labelOnly = WE.model.ui.selectedWireLabel === wire.id;
    var d = WE.geometry.wirePath(wire);
    if (d && !labelOnly) {
      layerOverlay.appendChild(el("path", {
        d: d, fill: "none", stroke: "#1e88e5", "stroke-width": wire.width + 4,
        "stroke-opacity": 0.35, "stroke-linecap": "round", "stroke-linejoin": "round",
        "pointer-events": "none"
      }));
    }
    /* 선택된 배선의 번호 라벨도 눈에 띄게 (호버 강조와 구분되는 선택 강조).
       라벨을 콕 집어 클릭했으면 **그 하나만**, 배선을 고른 것이면 그 배선의 라벨을 전부. */
    var selEnd = WE.model.ui.selectedWireLabelEnd;
    var sq = '[data-wire-label-for="' + wire.id + '"]';
    if (labelOnly && selEnd) sq += '[data-wire-label-end="' + selEnd + '"]';
    var selLbls = layerWireLabels.querySelectorAll(sq);
    for (var sli = 0; sli < selLbls.length; sli++) {
      var lb = wireLabelBox(selLbls[sli]);
      if (!lb) continue;
      layerOverlay.appendChild(el("rect", {
        x: lb.x - 4, y: lb.y - 3, width: lb.width + 8, height: lb.height + 6, rx: 4,
        "class": "wire-label-selected"
      }));
    }
    if (labelOnly) return;   // 라벨 단독 선택: 꺾임점 핸들도 표시 안 함
    var selWp = WE.model.ui.selectedWp;
    (wire.waypoints || []).forEach(function (p, i) {
      var sel = selWp === i;
      layerOverlay.appendChild(el("circle", {
        cx: p.x, cy: p.y, r: sel ? 7 : 6,
        "class": "wp-handle" + (sel ? " sel" : ""),
        "data-wp-index": i, style: "cursor:pointer"
      }));
    });
  }

  // 분기 접점 — 회로도 관례대로 물린 자리에 점을 찍는다.
  // 점이 없으면 그냥 지나가는 선인지 실제로 물린 선인지 구분이 안 된다.
  // 색은 호스트(물린 대상) 배선을 따른다 — 점이 그 선 위에 얹히므로 그 선의 일부로 보여야 한다.
  // 이미 그려진 접점 점만 지우고 다시 그린다 (경로만 갱신하는 가벼운 경로에서 함께 부른다)
  function redrawBranchDots() {
    var old = layerWires.querySelectorAll("circle.branch-dot");
    for (var i = 0; i < old.length; i++) old[i].parentNode.removeChild(old[i]);
    drawBranchDots();
  }
  function drawBranchDots() {
    WE.model.project.wires.forEach(function (w) {
      ["from", "to"].forEach(function (k) {
        var ref = w[k];
        if (!ref || !ref.wireId) return;
        var host = WE.model.getWire(ref.wireId);
        var pts = WE.geometry.wireRoutePoints(w);
        if (!host || !pts || !pts.length) return;
        var at = (k === "from") ? pts[0] : pts[pts.length - 1];
        layerWires.appendChild(el("circle", {
          "class": "branch-dot",
          cx: at.x, cy: at.y, r: Math.max(3, (host.width || 2) + 1.5),
          fill: host.color, "pointer-events": "none"
        }));
      });
    });
  }

  // 배선 그리기 프리뷰: 지금까지 찍은 경로 + 커서까지의 예상 구간 + 스냅 하이라이트.
  // pts = [시작단자, ...찍은 점들, 커서] — 점을 하나도 안 찍었으면 예전처럼 고무줄 한 줄이 된다.
  var _rubber = null, _snap = null, _wireAlign = null;
  function setWirePreview(pts, snap, align) {
    _rubber = null;
    _wireAlign = align || null;
    if (pts && pts.length >= 2) {
      var g = el("g", { "pointer-events": "none" });
      g.appendChild(el("polyline", {
        points: pts.map(function (p) { return p.x + "," + p.y; }).join(" "),
        fill: "none",
        stroke: WE.model.ui.wireColor, "stroke-width": WE.model.ui.wireWidth,
        "stroke-dasharray": "6 4", "stroke-linecap": "round", "stroke-linejoin": "round", opacity: 0.7
      }));
      // 찍어 둔 점을 동그라미로 — 몇 개를 어디에 찍었는지 보이게 (시작단자·커서는 뺀다)
      pts.slice(1, -1).forEach(function (p) {
        g.appendChild(el("circle", {
          cx: p.x, cy: p.y, r: 3.5,
          fill: "#fff", stroke: WE.model.ui.wireColor, "stroke-width": 2
        }));
      });
      _rubber = g;
    }
    _snap = snap || null;
    renderOverlay();
  }
  function clearWirePreview() {
    _rubber = null; _snap = null; _wireAlign = null; _branchTarget = null; renderOverlay();
  }

  // 분기 대상 미리보기 — 지금 클릭하면 '이 배선의 이 자리'에 물린다는 것을 미리 보여 준다.
  // 이게 없으면 인식이 된 건지 아닌지 알 수 없어, 엉뚱한 선에 붙거나 꺾임점을 찍으려다
  // 배선이 끝나 버린다(빽빽한 도면에서 실제로 그런 일이 났다).
  var _branchTarget = null;   // { wireId, pos }
  function setBranchTarget(bt) { _branchTarget = bt || null; }
  function drawBranchTarget() {
    if (!_branchTarget) return;
    var w = WE.model.getWire(_branchTarget.wireId); if (!w) return;
    var d = WE.geometry.wirePath(w);
    if (d) {
      layerOverlay.appendChild(el("path", {
        d: d, fill: "none", stroke: "#ffb300", "stroke-width": (w.width || 2) + 6,
        "stroke-opacity": 0.5, "stroke-linecap": "round", "stroke-linejoin": "round", "pointer-events": "none"
      }));
    }
    // 붙을 자리에 미리 접점을 찍어 둔다(실제 생성될 점과 같은 모양)
    layerOverlay.appendChild(el("circle", {
      cx: _branchTarget.pos.x, cy: _branchTarget.pos.y, r: Math.max(4, (w.width || 2) + 2.5),
      fill: w.color, stroke: "#ffb300", "stroke-width": 2, "pointer-events": "none"
    }));
  }

  // 정렬된 단자까지 잇는 점선 + 그 단자 강조 — "이 단자에 맞춘 것"임을 눈으로 알려 준다
  function drawWireAlignGuide() {
    if (!_wireAlign) return;
    layerOverlay.appendChild(el("line", {
      x1: _wireAlign.x1, y1: _wireAlign.y1, x2: _wireAlign.x2, y2: _wireAlign.y2,
      "class": "wire-align-guide"
    }));
    layerOverlay.appendChild(el("circle", {
      cx: _wireAlign.x2, cy: _wireAlign.y2, r: 5,
      fill: "none", stroke: "#ff3d7f", "stroke-width": 1.5, "pointer-events": "none"
    }));
  }

  var _marquee = null;
  function setMarquee(r) { _marquee = r; renderOverlay(); }

  // ---- 배선 번호 라벨: 드래그 중 정렬 가이드선 + 마우스오버 강조 ----
  var _wireLabelGuide = null;   // { axis: "x"|"y", value: number }
  function setWireLabelGuide(g) { _wireLabelGuide = g; renderOverlay(); }
  var _hoverWireLabelId = null, _hoverWireLabelEnd = null;
  // ⚠ 배선 하나에 라벨이 둘이므로 '어느 끝'까지 받아야 한다. 안 그러면 한쪽에
  //    마우스를 올렸는데 반대쪽 라벨이 강조된다.
  function setWireLabelHover(id, end) {
    _hoverWireLabelId = id; _hoverWireLabelEnd = end || null; renderOverlay();
  }
  // ---- 라벨 모드 미리보기: 마우스에 수축튜브가 들려 다니고, 배선 근처에선 경로에 착 붙음 ----
  var _labelPreview = null;   // { x, y, text, angle, snapped }
  function setLabelPreview(p) { _labelPreview = p; renderOverlay(); }

  /* 텍스트 모드 미리보기 — 마우스에 '이 자리에 이렇게 생긴다' 를 들려 보낸다.

     ⚠ 실제로 생길 글자와 **같은 글꼴 크기·같은 색**으로 그린다.
        모양이 다르면 미리보기가 거짓말이 되고, 놓고 나서 또 옮기게 된다.
     ⚠ 주석의 x,y 는 글자의 **왼쪽 기준선**이다(renderAnnotation 참고).
        그래서 점선 상자를 기준선 기준으로 위로 올려 그린다 —
        이게 "클릭한 점에서 글자가 오른쪽·위로 뻗는다" 를 눈으로 알려 주는 부분이다. */
  var _textPreview = null;
  function setTextPreview(p) { _textPreview = p; renderOverlay(); }
  function drawTextPreview() {
    if (!_textPreview) return;
    var p = _textPreview;
    var fs = p.fontSize || 18;
    var g = el("g", { transform: "translate(" + p.x + "," + p.y + ")", "pointer-events": "none" });

    // 글자가 차지할 자리 — 한글은 대략 글꼴 크기만큼, 영문·숫자는 그 절반쯤 먹는다
    var 폭 = 0;
    String(p.text || "").split("").forEach(function (ch) {
      폭 += /[가-힣ㄱ-ㅎㅏ-ㅣ]/.test(ch) ? fs : fs * 0.55;
    });
    폭 = Math.max(폭, fs * 2);
    g.appendChild(el("rect", {
      x: -3, y: -fs, width: 폭 + 6, height: fs * 1.32, rx: 3,
      /* 흰 바탕을 깐다 — 없으면 배선·단자 이름이 빽빽한 자리에서 미리보기가 통째로 묻힌다.
         (실측: 레벨 시프터 주변에 놓아 보니 글자가 배선에 섞여 안 읽혔다)
         라벨 미리보기(drawLabelPreview)도 같은 이유로 흰 바탕을 쓴다. */
      fill: "rgba(255,255,255,.86)", stroke: "#1e88e5", "stroke-width": 1.2,
      "stroke-dasharray": "4 3"
    }));

    // 놓일 글자 자체 — 흐리게. 색·크기는 실제로 만들어질 값 그대로다
    var t = el("text", {
      x: 0, y: 0, fill: p.color || "#e53935",
      "font-size": fs, "font-weight": p.bold ? "700" : "400", opacity: 0.75
    });
    t.textContent = p.text;
    g.appendChild(t);

    /* 기준점 십자 — "정확히 여기가 글자의 왼쪽 아래" 를 콕 집어 준다.
       상자만 있으면 상자의 어느 지점에 놓이는지가 여전히 애매하다. */
    var c = el("g", { stroke: "#1e88e5", "stroke-width": 1.2, opacity: 0.95 });
    c.appendChild(el("line", { x1: -5, y1: 0, x2: 5, y2: 0 }));
    c.appendChild(el("line", { x1: 0, y1: -5, x2: 0, y2: 5 }));
    g.appendChild(c);

    layerOverlay.appendChild(g);
  }
  function drawLabelPreview() {
    if (!_labelPreview) return;
    var p = _labelPreview;
    var tw = p.text.length * 6.4 + 14, th = 16;
    var g = el("g", {
      transform: "translate(" + p.x + "," + p.y + ") rotate(" + (p.angle || 0) + ")",
      "pointer-events": "none", opacity: p.snapped ? 0.95 : 0.6
    });
    g.appendChild(el("rect", {
      x: -tw / 2, y: -th / 2, width: tw, height: th, rx: 3,
      fill: "#fff", stroke: p.snapped ? "#1e88e5" : "#98a2ad", "stroke-width": p.snapped ? 1.5 : 1
    }));
    var t = el("text", {
      x: 0, y: 0, "text-anchor": "middle", "dominant-baseline": "central",
      style: "font:600 10.5px 'Malgun Gothic',sans-serif;fill:#222"
    });
    t.textContent = p.text;
    g.appendChild(t);
    layerOverlay.appendChild(g);
    centerTubeText(g);
  }

  function drawWireLabelGuide() {
    if (!_wireLabelGuide) return;
    var c = WE.model.project.meta.canvas;
    if (_wireLabelGuide.axis === "x") {
      layerOverlay.appendChild(el("line", {
        x1: _wireLabelGuide.value, y1: 0, x2: _wireLabelGuide.value, y2: c.height, "class": "wire-label-guide"
      }));
    } else {
      layerOverlay.appendChild(el("line", {
        x1: 0, y1: _wireLabelGuide.value, x2: c.width, y2: _wireLabelGuide.value, "class": "wire-label-guide"
      }));
    }
  }
  // ---- 부품 드래그 스마트 정렬 가이드 (다른 부품의 변/중심과 정렬되면 파란 선) ----
  var _alignGuides = null;   // [{ axis:"x"|"y", value:number }, ...]
  function setAlignGuides(g) { _alignGuides = (g && g.length) ? g : null; renderOverlay(); }
  function drawAlignGuides() {
    if (!_alignGuides) return;
    // 정렬된 두 부품 사이 구간(from~to)만 그림 — 화면 전체를 가로지르면 오히려 헷갈림
    _alignGuides.forEach(function (g) {
      var cls = g.kind === "label" ? "label-align-guide" : "align-guide";
      layerOverlay.appendChild(el("line", g.axis === "x"
        ? { x1: g.value, y1: g.from, x2: g.value, y2: g.to, "class": cls }
        : { x1: g.from, y1: g.value, x2: g.to, y2: g.value, "class": cls }));
    });
  }

  function drawWireLabelHover() {
    if (!_hoverWireLabelId) return;
    var hq = '[data-wire-label-for="' + _hoverWireLabelId + '"]';
    if (_hoverWireLabelEnd) hq += '[data-wire-label-end="' + _hoverWireLabelEnd + '"]';
    var lblEl = layerWireLabels.querySelector(hq);
    if (!lblEl) return;
    var b = wireLabelBox(lblEl);
    if (b) {
      layerOverlay.appendChild(el("rect", {
        x: b.x - 4, y: b.y - 3, width: b.width + 8, height: b.height + 6, rx: 4,
        "class": "wire-label-hover"
      }));
    }
  }

  // ---- 넷 하이라이트(연결된 배선·단자 강조) ----
  var _netHl = null;   // { wireIds:[], terms:[{componentId,terminalId}] }
  function setNetHighlight(net) { _netHl = net; renderOverlay(); }
  function drawNetHighlight() {
    if (!_netHl) return;
    _netHl.wireIds.forEach(function (id) {
      var w = WE.model.getWire(id); if (!w) return;
      var d = WE.geometry.wirePath(w); if (!d) return;
      layerOverlay.appendChild(el("path", {
        d: d, fill: "none", stroke: "#ffb300", "stroke-width": w.width + 6,
        "stroke-opacity": 0.45, "stroke-linecap": "round", "stroke-linejoin": "round", "pointer-events": "none"
      }));
    });
    _netHl.terms.forEach(function (r) {
      var cmp = WE.model.getComponent(r.componentId); if (!cmp) return;
      var t = WE.model.getTerminal(cmp, r.terminalId); if (!t) return;
      var p = WE.geometry.terminalAbs(cmp, t);
      layerOverlay.appendChild(el("circle", {
        cx: p.x, cy: p.y, r: 9, fill: "none",
        stroke: "#ffb300", "stroke-width": 3, "stroke-opacity": 0.9, "pointer-events": "none"
      }));
    });
  }
  function clearMarquee() { _marquee = null; renderOverlay(); }
  // 부품의 화면상 경계(회전 반영 AABB)
  // 부품 사각형 계산은 geometry 한 곳에만 둔다 — 두 군데면 한쪽만 고쳐서 어긋난다.
  function componentBBox(cmp) { return WE.geometry.componentBox(cmp); }
  function annoBBox(id) {
    var elT = layerAnnotations.querySelector('[data-anno-id="' + id + '"]');
    if (!elT) return null;
    try { var b = elT.getBBox(); return { x: b.x, y: b.y, x2: b.x + b.width, y2: b.y + b.height }; }
    catch (e) { return null; }
  }

  // 부품 그룹의 크기/위치/라벨을 실제로 갱신 (드래그·리사이즈용)
  function updateComponent(cmp) {
    var g = 부품찾기(cmp.id);
    if (!g) return;
    g.setAttribute("transform", WE.geometry.transformString(cmp));
    var img = g.querySelector("image");
    if (img) { img.setAttribute("width", cmp.width); img.setAttribute("height", cmp.height); }
    var rect = g.querySelector("rect");
    if (rect) { rect.setAttribute("width", cmp.width); rect.setAttribute("height", cmp.height); }
    updateComponentLabel(cmp);
    renderTermLabels();
  }

  // 부품 그룹 하나를 통째로 다시 그림 (단자 편집 등 내부 변경용, z순서 유지)
  function rerenderComponent(cmp) {
    var g = 부품찾기(cmp.id);
    if (!g) { renderAll(); return; }
    var fresh = renderComponent(cmp);
    g.parentNode.replaceChild(fresh, g);
    updateComponentLabel(cmp);
    renderTermLabels();
  }

  function setGridVisible(visible) {
    document.getElementById("gridBg").style.display = visible ? "" : "none";
  }

  /* 로그인 상태가 바뀌면 워터마크를 다시 만든다.
     init 은 앱이 뜰 때 한 번만 도는데, 로그인 확인은 그 뒤에 끝난다 —
     그래서 Pro 로 로그인해도 워터마크가 그대로 남아 있었다. (2026-09-06) */
  function refreshWatermark() {
    /* 인쇄 전용 각인(#canvasMarkPrint)은 CSS 가 @media print 에서 켠다 —
       JS 로 지울 수 없으니 몸통에 표식을 달아 CSS 쪽에서 함께 끈다(styles.css). */
    try {
      if (document.body) document.body.classList.toggle("no-wm", !!(WE.pro && !WE.pro.watermark()));
    } catch (e) { /* 무시 */ }
    buildWatermark();
    buildPageWatermark();
  }

  return {
    unconnectedTerminals: unconnectedTerminals,
    init: init,
    refreshWatermark: refreshWatermark,
    renderAll: renderAll,
    renderOverlay: renderOverlay,
    renderWires: renderWires,
    renderAnnotations: renderAnnotations,
    renderTermLabels: renderTermLabels,
    updateWiresFor: updateWiresFor,
    updateComponent: updateComponent,
    rerenderComponent: rerenderComponent,
    setWirePreview: setWirePreview,
    setBranchTarget: setBranchTarget,
    clearWirePreview: clearWirePreview,
    setMarquee: setMarquee,
    clearMarquee: clearMarquee,
    setNetHighlight: setNetHighlight,
    setWireLabelGuide: setWireLabelGuide,
    setLabelPreview: setLabelPreview,
    setTextPreview: setTextPreview,
    setAlignGuides: setAlignGuides,
    setViewZoom: setViewZoom,
    setWireLabelHover: setWireLabelHover,
    componentBBox: componentBBox,
    annoBBox: annoBBox,
    setGridVisible: setGridVisible,
    componentLabelPos: labelPos
  };
})();
