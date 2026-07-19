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
    buildWatermark();
  }

  // 워터마크: 반투명 대각선 문구를 캔버스 전체에 타일 배치 (부품 아래 레이어라 작업 방해 없음).
  // 캔버스(도면 용지)의 일부라서 화면·PDF 양쪽에 함께 나타남.
  function buildWatermark() {
    var g = document.getElementById("layerWatermark");
    if (!g) return;
    var TEXT = "EasyCable · easycable.co.kr";
    var COL_W = 460, ROW_H = 230;   // 타일 간격
    for (var row = 0, y = 140; y < 900 + ROW_H; row++, y += ROW_H) {
      var offset = (row % 2) ? COL_W / 2 : 0;   // 벽돌식 엇배치
      for (var x = 120 + offset; x < 1600 + COL_W; x += COL_W) {
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

  function el(name, attrs) {
    var node = document.createElementNS(SVGNS, name);
    if (attrs) for (var k in attrs) node.setAttribute(k, attrs[k]);
    return node;
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
    var W = cmp.width, H = cmp.height;
    var corners = [
      WE.geometry.localToAbs(cmp, 0, 0), WE.geometry.localToAbs(cmp, W, 0),
      WE.geometry.localToAbs(cmp, W, H), WE.geometry.localToAbs(cmp, 0, H)
    ];
    var maxY = Math.max(corners[0].y, corners[1].y, corners[2].y, corners[3].y);
    var center = WE.geometry.localToAbs(cmp, W / 2, H / 2);
    var gap = hasAutoBottomTermLabels(cmp) ? 26 : 5;   // 하단 단자 라벨과 겹치지 않게 여백 확보
    return { x: center.x, y: maxY + gap };
  }
  function updateComponentLabel(cmp) {
    var lbl = layerLabels.querySelector('text[data-label-for="' + cmp.id + '"]');
    var bg = layerLabels.querySelector('rect[data-label-bg-for="' + cmp.id + '"]');
    if (!lbl) {
      bg = el("rect", { "class": "cmp-label-bg", "data-label-bg-for": cmp.id });
      lbl = el("text", { "class": "cmp-label", "data-label-for": cmp.id });
      layerLabels.appendChild(bg);
      layerLabels.appendChild(lbl);
    }
    var p = labelPos(cmp);
    lbl.setAttribute("x", p.x);
    lbl.setAttribute("y", p.y);
    lbl.textContent = cmp.name;
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
    WE.model.project.components.forEach(function (cmp) { updateComponentLabel(cmp); });
  }

  // ---- 단자 점 크기: 화면상 겉보기 크기를 일정하게 유지 (단자 배치 모달과 동일한 UX) ----
  // 캔버스는 canvas.style.width = 1600*zoom 방식이라 그냥 두면 단자도 함께 스케일됨.
  // 그래서 반지름을 (부품 스케일 × 캔버스 줌)으로 나눠, 확대해도 점이 커지지 않게 함.
  // 단, 촘촘한 핀헤더는 이웃 거리 절반(cap)으로 상한을 둬서 히트영역이 겹치지 않게 함.
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
    var gs = layerComponents.querySelectorAll(".term-dot");
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
    // 각 단자의 로컬 좌표를 미리 계산 (겹침 방지용 최근접 거리 산출에 사용)
    var pos = cmp.terminals.map(function (t) { return { x: t.rx * cmp.width, y: t.ry * cmp.height }; });
    cmp.terminals.forEach(function (t, i) {
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

    function draw(t, dot, lx, ly, anchor, vertical) {
      var color = t.color || def;
      layerTermLabels.appendChild(el("line", {
        x1: dot.x, y1: dot.y, x2: lx, y2: ly,
        stroke: color, "stroke-width": 1, "stroke-opacity": 0.55, "pointer-events": "none"
      }));
      var attrs = {
        "class": "term-label", "text-anchor": anchor, "dominant-baseline": "middle",
        "data-label-tid": t.id, "data-cmp-id": cmp.id, style: "cursor:move"
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
    }

    var autoTerms = [];
    cmp.terminals.forEach(function (t) {
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
    }, { sideOf: function (t) { return WE.geometry.termSideScreen(cmp, t); } });
    laid.forEach(function (o) { draw(o.t, o.dot, o.lx, o.ly, o.anchor, o.vertical); });
  }
  function renderTermLabels() {
    layerTermLabels.innerHTML = "";
    WE.model.project.components.forEach(function (cmp) { appendTermLabels(cmp); });
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
    g.appendChild(el("path", {
      d: d, fill: "none", stroke: wire.color, "stroke-width": wire.width,
      "stroke-linecap": "round", "stroke-linejoin": "round", "pointer-events": "none"
    }));
    return g;
  }

  // 배선 번호(W# 또는 수동 지정 텍스트) + AWG 라벨 — 경로 위에 직접(중앙 정렬) 표시.
  // 별도 레이어(layerWireLabels)에 그려 항상 모든 배선 선보다 위에 보이도록 함.
  // obs: 이미 배치된 라벨(단자 라벨 + 앞서 그려진 배선 라벨) 사각형 목록 — 있으면 누적해 서로 겹치지 않게 회피
  function buildWireLabel(wire, obs) {
    var lblParts = [];
    var tubeTxt = (wire.labelText || "").trim();   // ▭ 라벨 모드에서 수동 부착한 라벨(수축튜브)
    if (tubeTxt) lblParts.push(tubeTxt);
    if (wire.awg) lblParts.push("AWG " + wire.awg);
    if (!lblParts.length) return null;
    var pts = WE.geometry.wireRoutePoints(wire);
    if (!pts || pts.length < 2) return null;

    var text = lblParts.join(" · ");
    var lw = text.length * 6.4 + 6, lh = 12;   // 라벨 근사 크기
    function rectAtPoint(p) { return { x: p.x - lw / 2, y: p.y - lh / 2, w: lw, h: lh, cx: p.x, cy: p.y }; }
    var pos;
    var segDir = null;   // 라벨이 놓인 구간 — 튜브를 배선 방향으로 눕히는 각도 계산용

    if (wire.labelT != null || wire.labelPos) {
      // 수동 지정 위치: labelT(경로 비율, 신규) 우선 — 재라우팅돼도 배선을 따라옴.
      // labelPos(절대좌표, 예전 저장본)는 가장 가까운 구간에 투영해 호환 유지.
      var basePt, mi;
      if (wire.labelT != null) {
        basePt = WE.geometry.polylinePointAt(pts, wire.labelT);
        mi = basePt ? basePt.seg : -1;
      } else {
        mi = WE.geometry.nearestSegmentIndex(pts, wire.labelPos);
        basePt = wire.labelPos;
      }
      var mSeg = mi >= 0 ? [pts[mi], pts[mi + 1]] : [basePt, basePt];
      segDir = mSeg;
      var msx = mSeg[1].x - mSeg[0].x, msy = mSeg[1].y - mSeg[0].y;
      var mSegLen = Math.hypot(msx, msy) || 1;
      var mt0 = ((basePt.x - mSeg[0].x) * msx + (basePt.y - mSeg[0].y) * msy) / (mSegLen * mSegLen);
      mt0 = Math.max(0, Math.min(1, mt0));
      function ptAtT(t) {
        t = Math.max(0, Math.min(1, t));
        return { x: mSeg[0].x + msx * t, y: mSeg[0].y + msy * t };
      }
      var mObs = obs || termLabelRects();
      function mHits(r) {
        for (var oi = 0; oi < mObs.length; oi++) {
          var o = mObs[oi];
          if (r.x < o.x + o.w && r.x + r.w > o.x && r.y < o.y + o.h && r.y + r.h > o.y) return true;
        }
        return false;
      }
      // 겹치면 같은 경로(구간) 위에서 좌/우(또는 위/아래)로 조금씩 밀어 빈 자리를 찾음 — 경로를 벗어나지 않음
      var mDeltas = [0, 20, -20, 40, -40, 60, -60, 80, -80, 100, -100];
      pos = rectAtPoint(ptAtT(mt0));
      for (var mdi = 0; mdi < mDeltas.length; mdi++) {
        var mcand = rectAtPoint(ptAtT(mt0 + mDeltas[mdi] / mSegLen));
        if (!mHits(mcand)) { pos = mcand; break; }
      }
    } else {
      // 가장 긴 세그먼트(가로 우선)의 중앙에 라벨 — 인덱스 기준 중간은 짧은 스텁에 걸려 위치가 제각각이 됨
      var bestH = null, bhLen = -1, bestAny = null, baLen = -1;
      for (var si = 0; si < pts.length - 1; si++) {
        var p1 = pts[si], p2 = pts[si + 1];
        var len = Math.abs(p2.x - p1.x) + Math.abs(p2.y - p1.y);
        if (Math.abs(p1.y - p2.y) < 0.5 && len > bhLen) { bhLen = len; bestH = [p1, p2]; }
        if (len > baLen) { baLen = len; bestAny = [p1, p2]; }
      }
      // 가로 구간이 어느 정도 길면(라벨 폭 이상) 가로 우선, 아니면 최장 구간
      var seg = (bestH && bhLen >= 40) ? bestH : bestAny;
      segDir = seg;
      // 단자 라벨·다른 배선 라벨과 겹치면 구간 위에서 자리를 옮겨가며 빈 곳을 찾음
      var obsList = obs || termLabelRects();
      function rectAt(f) {
        var cx = seg[0].x + (seg[1].x - seg[0].x) * f, cy = seg[0].y + (seg[1].y - seg[0].y) * f;
        return rectAtPoint({ x: cx, y: cy });
      }
      function hits(r) {
        for (var oi = 0; oi < obsList.length; oi++) {
          var o = obsList[oi];
          if (r.x < o.x + o.w && r.x + r.w > o.x && r.y < o.y + o.h && r.y + r.h > o.y) return true;
        }
        return false;
      }
      // 가로 세그먼트는 라벨 폭 안에서도 시도(줄 간격만 살짝 다르면 옆으로 이동)하고, 실패하면 위/아래로 살짝 띄움
      var fr = [0.5, 0.35, 0.65, 0.25, 0.75, 0.15, 0.85], tried = [0, 14, -14, 28, -28];
      pos = rectAt(0.5);
      outer:
      for (var ti = 0; ti < tried.length; ti++) {
        for (var fi = 0; fi < fr.length; fi++) {
          var cand = rectAt(fr[fi]);
          cand.y += tried[ti]; cand.cy += tried[ti];
          if (!hits(cand)) { pos = cand; break outer; }
        }
        if (ti === tried.length - 1) pos = rectAt(0.5);
      }
    }
    if (obs) obs.push({ x: pos.x, y: pos.y, w: pos.w, h: pos.h });   // 다음 배선이 이 라벨도 피하도록 누적

    // AWG만 있으면 기존 텍스트 방식, 수동 라벨이 있으면 실물 수축튜브(흰 튜브에 번호 인쇄) 모양
    if (!tubeTxt) {
      var lbl = el("text", {
        x: pos.cx, y: pos.cy, "text-anchor": "middle", "dominant-baseline": "central", "class": "wire-awg",
        "data-wire-label-for": wire.id,
        "data-wire-label-cx": pos.cx, "data-wire-label-cy": pos.cy,
        style: "font:600 11px 'Malgun Gothic',sans-serif;fill:" + wire.color +
          ";paint-order:stroke;stroke:#fff;stroke-width:3px;pointer-events:all;cursor:move;user-select:none"
      });
      lbl.textContent = text;
      return lbl;
    }
    // 튜브 각도: 놓인 구간 방향을 따라 눕힘 (글자가 뒤집히지 않게 -90°~90°로 정규화)
    var ang = 0;
    if (segDir) {
      ang = Math.atan2(segDir[1].y - segDir[0].y, segDir[1].x - segDir[0].x) * 180 / Math.PI;
      if (ang > 90) ang -= 180;
      if (ang <= -90) ang += 180;
    }
    var tw = text.length * 6.4 + 14, th = 16;
    // 회전 후 화면 차지 영역(AABB) — 선택/호버 강조가 getBBox 대신 사용(g의 getBBox는 회전 미반영)
    var rad = ang * Math.PI / 180;
    var aw = Math.abs(tw * Math.cos(rad)) + Math.abs(th * Math.sin(rad));
    var ah = Math.abs(tw * Math.sin(rad)) + Math.abs(th * Math.cos(rad));
    var g = el("g", {
      "class": "wire-tube", "data-wire-label-for": wire.id,
      "data-wire-label-cx": pos.cx, "data-wire-label-cy": pos.cy,
      "data-aabb-w": aw, "data-aabb-h": ah,
      transform: "translate(" + pos.cx + "," + pos.cy + ") rotate(" + ang + ")",
      style: "pointer-events:all;cursor:move;user-select:none"
    });
    g.appendChild(el("rect", {
      x: -tw / 2, y: -th / 2, width: tw, height: th, rx: 3,
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
      var lbl = buildWireLabel(w, labelObs);
      if (lbl) { layerWireLabels.appendChild(lbl); centerTubeText(lbl); }
    });
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
    // 배선 번호 라벨도 경로 위에 다시 배치(드래그 중 라벨이 옛 위치에 남지 않게)
    _termRects = null;
    layerWireLabels.innerHTML = "";
    var labelObs = termLabelRects().slice();
    WE.model.project.wires.forEach(function (w) {
      var lbl = buildWireLabel(w, labelObs);
      if (lbl) { layerWireLabels.appendChild(lbl); centerTubeText(lbl); }
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
    var comps = WE.model.project.components.slice().sort(function (a, b) { return a.z - b.z; });
    comps.forEach(function (cmp) {
      layerComponents.appendChild(renderComponent(cmp));
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
  function renderOverlay() {
    layerOverlay.innerHTML = "";
    if (_marquee) {
      layerOverlay.appendChild(el("rect", {
        x: _marquee.x, y: _marquee.y, width: _marquee.w, height: _marquee.h,
        fill: "#1e88e5", "fill-opacity": 0.08, stroke: "#1e88e5", "stroke-width": 1,
        "stroke-dasharray": "4 3", "pointer-events": "none"
      }));
    }
    if (_rubber) layerOverlay.appendChild(_rubber);
    if (_snap) {
      layerOverlay.appendChild(el("circle", {
        cx: _snap.x, cy: _snap.y, r: 11, fill: "#1e88e5", "fill-opacity": 0.2,
        stroke: "#1e88e5", "stroke-width": 2.5, "pointer-events": "none"
      }));
    }
    drawNetHighlight();
    drawWireLabelGuide();
    drawWireLabelHover();
    drawAlignGuides();
    drawLabelPreview();

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
    // 선택된 배선의 번호 라벨도 눈에 띄게 (호버 강조와 구분되는 선택 강조)
    var selLbl = layerWireLabels.querySelector('[data-wire-label-for="' + wire.id + '"]');
    if (selLbl) {
      var lb = wireLabelBox(selLbl);
      if (lb) {
        layerOverlay.appendChild(el("rect", {
          x: lb.x - 4, y: lb.y - 3, width: lb.width + 8, height: lb.height + 6, rx: 4,
          "class": "wire-label-selected"
        }));
      }
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

  // 배선 그리기 프리뷰: 러버밴드 + 스냅 하이라이트
  var _rubber = null, _snap = null;
  function setWirePreview(a, b, snap) {
    _rubber = (a && b) ? el("line", {
      x1: a.x, y1: a.y, x2: b.x, y2: b.y,
      stroke: WE.model.ui.wireColor, "stroke-width": WE.model.ui.wireWidth,
      "stroke-dasharray": "6 4", "stroke-linecap": "round", "pointer-events": "none", opacity: 0.7
    }) : null;
    _snap = snap || null;
    renderOverlay();
  }
  function clearWirePreview() { _rubber = null; _snap = null; renderOverlay(); }

  var _marquee = null;
  function setMarquee(r) { _marquee = r; renderOverlay(); }

  // ---- 배선 번호 라벨: 드래그 중 정렬 가이드선 + 마우스오버 강조 ----
  var _wireLabelGuide = null;   // { axis: "x"|"y", value: number }
  function setWireLabelGuide(g) { _wireLabelGuide = g; renderOverlay(); }
  var _hoverWireLabelId = null;
  function setWireLabelHover(id) { _hoverWireLabelId = id; renderOverlay(); }
  // ---- 라벨 모드 미리보기: 마우스에 수축튜브가 들려 다니고, 배선 근처에선 경로에 착 붙음 ----
  var _labelPreview = null;   // { x, y, text, angle, snapped }
  function setLabelPreview(p) { _labelPreview = p; renderOverlay(); }
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
      layerOverlay.appendChild(el("line", g.axis === "x"
        ? { x1: g.value, y1: g.from, x2: g.value, y2: g.to, "class": "align-guide" }
        : { x1: g.from, y1: g.value, x2: g.to, y2: g.value, "class": "align-guide" }));
    });
  }

  function drawWireLabelHover() {
    if (!_hoverWireLabelId) return;
    var lblEl = layerWireLabels.querySelector('[data-wire-label-for="' + _hoverWireLabelId + '"]');
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
  function componentBBox(cmp) {
    var W = cmp.width, H = cmp.height;
    var cs = [
      WE.geometry.localToAbs(cmp, 0, 0), WE.geometry.localToAbs(cmp, W, 0),
      WE.geometry.localToAbs(cmp, W, H), WE.geometry.localToAbs(cmp, 0, H)
    ];
    var xs = cs.map(function (p) { return p.x; }), ys = cs.map(function (p) { return p.y; });
    return { x: Math.min.apply(null, xs), y: Math.min.apply(null, ys), x2: Math.max.apply(null, xs), y2: Math.max.apply(null, ys) };
  }
  function annoBBox(id) {
    var elT = layerAnnotations.querySelector('[data-anno-id="' + id + '"]');
    if (!elT) return null;
    try { var b = elT.getBBox(); return { x: b.x, y: b.y, x2: b.x + b.width, y2: b.y + b.height }; }
    catch (e) { return null; }
  }

  // 부품 그룹의 크기/위치/라벨을 실제로 갱신 (드래그·리사이즈용)
  function updateComponent(cmp) {
    var g = layerComponents.querySelector('[data-id="' + cmp.id + '"]');
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
    var g = layerComponents.querySelector('[data-id="' + cmp.id + '"]');
    if (!g) { renderAll(); return; }
    var fresh = renderComponent(cmp);
    g.parentNode.replaceChild(fresh, g);
    updateComponentLabel(cmp);
    renderTermLabels();
  }

  function setGridVisible(visible) {
    document.getElementById("gridBg").style.display = visible ? "" : "none";
  }

  return {
    init: init,
    renderAll: renderAll,
    renderOverlay: renderOverlay,
    renderWires: renderWires,
    renderAnnotations: renderAnnotations,
    renderTermLabels: renderTermLabels,
    updateWiresFor: updateWiresFor,
    updateComponent: updateComponent,
    rerenderComponent: rerenderComponent,
    setWirePreview: setWirePreview,
    clearWirePreview: clearWirePreview,
    setMarquee: setMarquee,
    clearMarquee: clearMarquee,
    setNetHighlight: setNetHighlight,
    setWireLabelGuide: setWireLabelGuide,
    setLabelPreview: setLabelPreview,
    setAlignGuides: setAlignGuides,
    setViewZoom: setViewZoom,
    setWireLabelHover: setWireLabelHover,
    componentBBox: componentBBox,
    annoBBox: annoBBox,
    setGridVisible: setGridVisible
  };
})();
