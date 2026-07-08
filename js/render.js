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
      img.setAttribute("preserveAspectRatio", "xMidYMid meet"); // 이미지 자기 비율 유지(찌그러짐 방지)
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

  // 부품명 라벨: 회전과 무관하게 항상 수평·박스 아래 중앙
  function labelPos(cmp) {
    var W = cmp.width, H = cmp.height;
    var corners = [
      WE.geometry.localToAbs(cmp, 0, 0), WE.geometry.localToAbs(cmp, W, 0),
      WE.geometry.localToAbs(cmp, W, H), WE.geometry.localToAbs(cmp, 0, H)
    ];
    var maxY = Math.max(corners[0].y, corners[1].y, corners[2].y, corners[3].y);
    var center = WE.geometry.localToAbs(cmp, W / 2, H / 2);
    return { x: center.x, y: maxY + 5 };
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

  // 단자 점 + 히트영역 (라벨은 별도 화면기준 레이어에서)
  function appendTerminals(cmp, g) {
    var def = WE.model.DEFAULT_TERMINAL_COLOR;
    cmp.terminals.forEach(function (t) {
      var cx = t.rx * cmp.width, cy = t.ry * cmp.height;
      var color = t.color || def;
      g.appendChild(el("circle", {
        cx: cx, cy: cy, r: 10, fill: "#000", "fill-opacity": 0,
        "data-term-id": t.id, "data-cmp-id": cmp.id, style: "pointer-events:all;cursor:pointer"
      }));
      if (WE.model.ui.selectedTerminalId === t.id) {
        g.appendChild(el("circle", { cx: cx, cy: cy, r: 8, fill: "none", stroke: "#1e88e5", "stroke-width": 2, "pointer-events": "none" }));
      }
      g.appendChild(el("circle", { cx: cx, cy: cy, r: 4.5, fill: color, stroke: "#fff", "stroke-width": 1.5, "pointer-events": "none" }));
    });
  }

  // ---- 단자 라벨 (화면 기준 자동 배치: 회전해도 수평·안 꼬임) ----
  function appendTermLabels(cmp) {
    var def = WE.model.DEFAULT_TERMINAL_COLOR;
    var center = WE.geometry.localToAbs(cmp, cmp.width / 2, cmp.height / 2);
    var box = componentBBox(cmp);

    function draw(t, dot, lx, ly, anchor) {
      var color = t.color || def;
      layerTermLabels.appendChild(el("line", {
        x1: dot.x, y1: dot.y, x2: lx, y2: ly,
        stroke: color, "stroke-width": 1, "stroke-opacity": 0.55, "pointer-events": "none"
      }));
      var tx = el("text", {
        x: lx + (anchor === "end" ? -2 : 2), y: ly,
        "class": "term-label", "text-anchor": anchor, "dominant-baseline": "middle",
        "data-label-tid": t.id, "data-cmp-id": cmp.id, style: "cursor:move"
      });
      tx.textContent = t.name;
      layerTermLabels.appendChild(tx);
    }

    var groups = { L: [], R: [] };
    cmp.terminals.forEach(function (t) {
      var dot = WE.geometry.terminalAbs(cmp, t);
      if (t.labelPos) {                                   // 수동 위치(로컬 저장) → 화면좌표
        var lp = WE.geometry.localToAbs(cmp, t.labelPos.x, t.labelPos.y);
        draw(t, dot, lp.x, lp.y, lp.x < dot.x ? "end" : "start");
        return;
      }
      (dot.x < center.x ? groups.L : groups.R).push({ t: t, dot: dot });
    });
    ["L", "R"].forEach(function (side) {
      var arr = groups[side];
      arr.sort(function (a, b) { return a.dot.y - b.dot.y; });
      var minGap = 15, lastY = -Infinity;
      var lx = side === "L" ? box.x - 10 : box.x2 + 10;
      arr.forEach(function (o) {
        var ly = o.dot.y;
        if (ly < lastY + minGap) ly = lastY + minGap;
        lastY = ly;
        draw(o.t, o.dot, lx, ly, side === "L" ? "end" : "start");
      });
    });
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
    if (WE.model.ui.showWireNums) {
      var numTxt = (wire.labelText && wire.labelText.trim()) || ("W" + (WE.model.project.wires.indexOf(wire) + 1));
      lblParts.push(numTxt);
    }
    if (wire.awg) lblParts.push("AWG " + wire.awg);
    if (!lblParts.length) return null;
    var pts = WE.geometry.wireRoutePoints(wire);
    if (!pts || pts.length < 2) return null;

    var text = lblParts.join(" · ");
    var lw = text.length * 6.4 + 6, lh = 12;   // 라벨 근사 크기
    function rectAtPoint(p) { return { x: p.x - lw / 2, y: p.y - lh / 2, w: lw, h: lh, cx: p.x, cy: p.y }; }
    var pos;

    if (wire.labelPos) {
      // 수동으로 드래그해 지정한 위치(경로 위 지점)를 그대로 사용
      var mi = WE.geometry.nearestSegmentIndex(pts, wire.labelPos);
      var mSeg = mi >= 0 ? [pts[mi], pts[mi + 1]] : [wire.labelPos, wire.labelPos];
      var msx = mSeg[1].x - mSeg[0].x, msy = mSeg[1].y - mSeg[0].y;
      var mSegLen = Math.hypot(msx, msy) || 1;
      var mt0 = ((wire.labelPos.x - mSeg[0].x) * msx + (wire.labelPos.y - mSeg[0].y) * msy) / (mSegLen * mSegLen);
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
      if (lbl) layerWireLabels.appendChild(lbl);
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
    var d = WE.geometry.wirePath(wire);
    if (d) {
      layerOverlay.appendChild(el("path", {
        d: d, fill: "none", stroke: "#1e88e5", "stroke-width": wire.width + 4,
        "stroke-opacity": 0.35, "stroke-linecap": "round", "stroke-linejoin": "round",
        "pointer-events": "none"
      }));
    }
    // 선택된 배선의 번호 라벨도 눈에 띄게 (호버 강조와 구분되는 선택 강조)
    var selLbl = layerWireLabels.querySelector('text[data-wire-label-for="' + wire.id + '"]');
    if (selLbl) {
      try {
        var lb = selLbl.getBBox();
        layerOverlay.appendChild(el("rect", {
          x: lb.x - 4, y: lb.y - 3, width: lb.width + 8, height: lb.height + 6, rx: 4,
          "class": "wire-label-selected"
        }));
      } catch (e) { /* getBBox 실패 무시 */ }
    }
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
  function drawWireLabelHover() {
    if (!_hoverWireLabelId) return;
    var lblEl = layerWireLabels.querySelector('text[data-wire-label-for="' + _hoverWireLabelId + '"]');
    if (!lblEl) return;
    try {
      var b = lblEl.getBBox();
      layerOverlay.appendChild(el("rect", {
        x: b.x - 4, y: b.y - 3, width: b.width + 8, height: b.height + 6, rx: 4,
        "class": "wire-label-hover"
      }));
    } catch (e) { /* getBBox 실패 무시 */ }
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
    setWireLabelHover: setWireLabelHover,
    componentBBox: componentBBox,
    annoBBox: annoBBox,
    setGridVisible: setGridVisible
  };
})();
