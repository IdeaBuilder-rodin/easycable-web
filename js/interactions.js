// interactions.js — 선택 / 드래그 / 리사이즈 이벤트
var WE = window.WE || {};
window.WE = WE;

WE.interactions = (function () {
  var svg, wrap;
  var drag = null;          // 진행 중 드래그
  var wirePending = null;    // 배선 그리기: 첫 단자 { cmpId, tid }
  var spaceDown = false;     // 스페이스바(팬)
  var lastX = 0, lastY = 0;  // 마지막 마우스 위치(화면 좌표) — 단축키로 여는 팝업 위치 계산용

  function init() {
    svg = document.getElementById("canvas");
    wrap = document.getElementById("canvasWrap");
    svg.addEventListener("pointerdown", onPointerDown);
    svg.addEventListener("dblclick", onDblClick);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointermove", function (e) { lastX = e.clientX; lastY = e.clientY; });
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    svg.addEventListener("pointerover", onNetHover);
    svg.addEventListener("pointerout", onNetHoverOut);
    svg.addEventListener("pointerover", onWireLabelHover);
    svg.addEventListener("pointerleave", function () { _hoverLabelId = null; WE.render.setWireLabelHover(null); });
    svg.addEventListener("pointermove", onTermTooltipMove);
    svg.addEventListener("pointerleave", hideTermTooltip);
    svg.addEventListener("pointerleave", function () { WE.render.setLabelPreview(null); });
  }

  // 배선 번호 라벨 위에 마우스를 올리면 강조(드래그 가능함을 명확히 표시)
  var _hoverLabelId = null;
  function onWireLabelHover(e) {
    if (drag) return;
    if (WE.model.ui.mode !== "select") {   // 선택 모드에서만(드래그 가능한 상태만 강조)
      if (_hoverLabelId) { _hoverLabelId = null; WE.render.setWireLabelHover(null); }
      return;
    }
    var lblEl = e.target.closest("[data-wire-label-for]");
    var id = lblEl ? lblEl.getAttribute("data-wire-label-for") : null;
    if (id === _hoverLabelId) return;
    _hoverLabelId = id;
    WE.render.setWireLabelHover(id);
  }

  function getLastPointer() { return { x: lastX, y: lastY }; }

  // ---- 넷 하이라이트: 배선/단자에 마우스 올리면 전기적으로 이어진 전체 강조 ----
  var _netKey = null;   // 현재 하이라이트 기준(중복 계산 방지)
  function onNetHover(e) {
    if (drag) return;                                    // 드래그 중엔 끔
    if (WE.model.ui.mode !== "select") return;           // 선택 모드에서만
    var refs = null, key = null;
    var wireEl = e.target.closest("[data-wire-id]");
    if (wireEl) {
      var w = WE.model.getWire(wireEl.getAttribute("data-wire-id"));
      if (w) { refs = [w.from]; key = "w:" + w.id; }
    } else {
      var termEl = e.target.closest("[data-term-id]");
      if (termEl) {
        refs = [{ componentId: termEl.getAttribute("data-cmp-id"), terminalId: termEl.getAttribute("data-term-id") }];
        key = "t:" + termEl.getAttribute("data-term-id");
      }
    }
    if (!refs) { if (_netKey) { _netKey = null; WE.render.setNetHighlight(null); } return; }
    if (key === _netKey) return;
    _netKey = key;
    WE.render.setNetHighlight(WE.geometry.netFrom(refs));
  }
  function onNetHoverOut(e) {
    // svg 밖으로 나가면 해제 (내부 요소 간 이동은 pointerover가 갱신)
    if (!e.relatedTarget || !svg.contains(e.relatedTarget)) {
      if (_netKey) { _netKey = null; WE.render.setNetHighlight(null); }
    }
  }

  // ---- 단자 마우스오버 툴팁: 라벨을 꺼둔 부품도 단자 이름을 바로 확인 ----
  var _tipEl = null, _tipShown = false;
  function onTermTooltipMove(e) {
    if (drag) { hideTermTooltip(); return; }
    // 1) 단자 히트영역 위에 직접 있을 때
    var termEl = e.target.closest("[data-term-id]");
    if (termEl) {
      var cmp = WE.model.getComponent(termEl.getAttribute("data-cmp-id"));
      var t = cmp && WE.model.getTerminal(cmp, termEl.getAttribute("data-term-id"));
      if (t) { showTermTooltip(t.name, e.clientX, e.clientY); return; }
    }
    // 2) 배선이 단자를 덮고 있을 때: 그 배선의 끝점 단자 중 마우스에 가까운 것을 표시
    var wireEl = e.target.closest("[data-wire-id]");
    var m = svg.getScreenCTM();
    if (wireEl && m) {
      var w = WE.model.getWire(wireEl.getAttribute("data-wire-id"));
      if (w) {
        var best = null;
        [w.from, w.to].forEach(function (ref) {
          var pos = WE.geometry.wireEndpoint(ref); if (!pos) return;
          var sx = m.a * pos.x + m.c * pos.y + m.e;    // 캔버스→화면 좌표
          var sy = m.b * pos.x + m.d * pos.y + m.f;
          var d = Math.hypot(e.clientX - sx, e.clientY - sy);
          if (d < 20 && (!best || d < best.d)) {
            var c2 = WE.model.getComponent(ref.componentId);
            var t2 = c2 && WE.model.getTerminal(c2, ref.terminalId);
            if (t2) best = { d: d, name: t2.name };
          }
        });
        if (best) { showTermTooltip(best.name, e.clientX, e.clientY); return; }
      }
    }
    hideTermTooltip();
  }
  function showTermTooltip(text, clientX, clientY) {
    if (!_tipEl) _tipEl = document.getElementById("termTooltip");
    var rect = document.getElementById("centerCol").getBoundingClientRect();
    _tipEl.textContent = text || WE.i18n.t("(이름 없음)");
    _tipEl.style.left = (clientX - rect.left) + "px";
    _tipEl.style.top = (clientY - rect.top) + "px";
    if (!_tipShown) { _tipEl.hidden = false; _tipShown = true; }
  }
  function hideTermTooltip() {
    if (!_tipEl) _tipEl = document.getElementById("termTooltip");
    if (_tipShown) { _tipEl.hidden = true; _tipShown = false; }
  }

  function onKeyUp(e) {
    if (e.code === "Space") { spaceDown = false; document.body.classList.remove("pan-ready"); }
  }

  function snapVal(v) {
    var m = WE.model.project.meta.canvas;
    return m.snap ? WE.geometry.snap(v, m.grid) : v;
  }

  function onPointerDown(e) {
    // 드래그/클릭 시작 시 넷 하이라이트 해제
    if (_netKey) { _netKey = null; WE.render.setNetHighlight(null); }
    WE.model.ui.selectedWireLabel = null;   // 라벨 단독 선택은 라벨을 직접 클릭했을 때만 유지
    // 팬: 스페이스 드래그 또는 휠(가운데) 버튼 드래그
    if (spaceDown || e.button === 1) {
      drag = { mode: "pan", startX: e.clientX, startY: e.clientY, sl: wrap.scrollLeft, st: wrap.scrollTop };
      document.body.classList.add("panning");
      try { svg.setPointerCapture(e.pointerId); } catch (_) {}
      e.preventDefault();
      return;
    }

    if (WE.model.ui.mode === "wire") { onWireDown(e); return; }
    if (WE.model.ui.mode === "text") { onTextDown(e); return; }
    if (WE.model.ui.mode === "label") { onLabelDown(e); return; }
    if (WE.model.ui.mode === "terminal") { onTerminalDown(e); return; }

    // 주석 클릭 → (다중 선택에 포함되면 그룹 이동) 아니면 단일 선택+이동
    var annoEl0 = e.target.closest("[data-anno-id]");
    if (annoEl0) {
      var aid0 = annoEl0.getAttribute("data-anno-id");
      var tot0 = WE.model.getMulti().length + WE.model.getMultiAnno().length;
      if (tot0 > 1 && WE.model.getMultiAnno().indexOf(aid0) >= 0) { startGroupMove(e); return; }
      selectAnnoAndDrag(annoEl0, e); return;
    }

    // 단자 라벨 클릭 → 라벨만 드래그로 위치 이동
    var lblEl = e.target.closest("[data-label-tid]");
    if (lblEl) {
      var lCmpId = lblEl.getAttribute("data-cmp-id");
      WE.model.select("component", lCmpId);
      WE.render.renderOverlay();
      WE.app.refreshProps();
      drag = { mode: "tlabel", cmpId: lCmpId, tid: lblEl.getAttribute("data-label-tid") };
      svg.setPointerCapture(e.pointerId);
      return;
    }

    // 배선 번호 라벨 클릭 → 라벨만 드래그로 위치 이동
    var wlblEl = e.target.closest("[data-wire-label-for]");
    if (wlblEl) {
      var wlWireId = wlblEl.getAttribute("data-wire-label-for");
      WE.model.ui.selectedWireLabel = wlWireId;   // 라벨 자체를 선택 → Delete 시 라벨만 삭제
      WE.model.select("wire", wlWireId);
      WE.render.renderOverlay();
      WE.app.refreshProps();
      drag = { mode: "wlabel", wireId: wlWireId };
      svg.setPointerCapture(e.pointerId);
      return;
    }

    // ⋯ 옵션 메뉴 버튼
    var menuBtn = e.target.closest("[data-menu]");
    if (menuBtn) {
      var mc = WE.model.getSelectedComponent();
      if (mc) WE.app.openComponentMenu(menuBtn, mc);
      e.preventDefault();
      return;
    }

    // 회전 핸들
    var rotEl = e.target.closest("[data-rotate]");
    if (rotEl) {
      var rc = WE.model.getSelectedComponent();
      if (rc) {
        var center = WE.geometry.localToAbs(rc, rc.width / 2, rc.height / 2);
        drag = { mode: "rotate", id: rc.id, cx: center.x, cy: center.y };
        svg.setPointerCapture(e.pointerId);
      }
      return;
    }

    var handle = e.target.closest("[data-handle]");
    if (handle) {
      // 리사이즈 시작
      var cmp = WE.model.getSelectedComponent();
      if (!cmp) return;
      drag = {
        mode: "resize", id: cmp.id,
        startX: e.clientX, startY: e.clientY,
        orig: { width: cmp.width, height: cmp.height }
      };
      svg.setPointerCapture(e.pointerId);
      return;
    }

    // 배선 꺾임점 핸들 클릭 → 선택(삭제용). 드래그 이동은 안 함(직각 유지)
    var wpEl = e.target.closest("[data-wp-index]");
    if (wpEl) {
      var sw = WE.model.getSelectedWire();
      if (sw) {
        WE.model.ui.selectedWp = parseInt(wpEl.getAttribute("data-wp-index"), 10);
        WE.render.renderOverlay();
        return;
      }
    }
    WE.model.ui.selectedWp = null;

    // 배선 몸통 클릭 → 선택. Ctrl/⌘+클릭 = 다중 토글, 그냥 드래그하면 세그먼트 이동
    var wireEl = e.target.closest("[data-wire-id]");
    if (wireEl) {
      var wid = wireEl.getAttribute("data-wire-id");
      var clickPt = WE.geometry.clientToCanvas(svg, e.clientX, e.clientY);   // 클릭한 구간 판별용
      if (e.ctrlKey || e.metaKey) {
        WE.model.toggleMultiWire(wid);
        // 선택에 남아 있으면 클릭 지점 기록, 해제됐으면 제거
        WE.model.setWireClickPt(wid, WE.model.getMultiWire().indexOf(wid) >= 0 ? clickPt : null);
        WE.render.renderOverlay();
        WE.app.refreshProps();
        return;
      }
      WE.model.select("wire", wid);
      WE.model.setWireClickPt(wid, clickPt);
      WE.render.renderOverlay();
      WE.app.refreshProps();
      drag = { mode: "wire-pending", wireId: wid, startX: e.clientX, startY: e.clientY };
      svg.setPointerCapture(e.pointerId);
      return;
    }

    var g = e.target.closest(".component");
    if (g) {
      var id = g.getAttribute("data-id");

      // Ctrl/⌘ + 클릭 → 다중 선택 토글 (드래그 없음)
      if (e.ctrlKey || e.metaKey) {
        WE.model.toggleMulti(id);
        var m = WE.model.getMulti();
        if (m.length === 0) WE.model.clearSelection();
        else WE.model.setPrimary(m.indexOf(id) >= 0 ? id : m[m.length - 1]);
        WE.render.renderOverlay();
        WE.app.refreshProps();
        return;
      }

      // 이미 다중 선택된 부품을 잡으면 → 그룹 이동
      var totSel = WE.model.getMulti().length + WE.model.getMultiAnno().length;
      if (totSel > 1 && WE.model.getMulti().indexOf(id) >= 0) { startGroupMove(e); return; }

      // 단일 선택 + 이동
      WE.model.select("component", id);
      WE.render.renderOverlay();
      WE.app.refreshProps();
      var c = WE.model.getComponent(id);
      drag = {
        mode: "move", id: id,
        startX: e.clientX, startY: e.clientY,
        orig: { x: c.x, y: c.y },
        follow: beginWireFollow([id])
      };
      svg.setPointerCapture(e.pointerId);
    } else {
      // 빈 곳 → 드래그로 사각형(마퀴) 다중 선택 (클릭이면 선택 해제)
      var mp = WE.geometry.clientToCanvas(svg, e.clientX, e.clientY);
      drag = { mode: "marquee", startX: e.clientX, startY: e.clientY, ox: mp.x, oy: mp.y, rect: null };
      svg.setPointerCapture(e.pointerId);
    }
  }

  // 다중 선택 그룹 이동 시작 (부품 + 주석)
  function startGroupMove(e) {
    var comps = WE.model.getMulti().slice(), annos = WE.model.getMultiAnno().slice();
    var origs = {};
    comps.forEach(function (id) { var c = WE.model.getComponent(id); if (c) origs["c" + id] = { x: c.x, y: c.y }; });
    annos.forEach(function (id) { var a = WE.model.getAnnotation(id); if (a) origs["a" + id] = { x: a.x, y: a.y }; });
    drag = { mode: "move-group", comps: comps, annos: annos, origs: origs, startX: e.clientX, startY: e.clientY, follow: beginWireFollow(comps) };
    svg.setPointerCapture(e.pointerId);
  }

  // 마퀴 사각형 안의 부품·주석·배선 선택
  function applyMarquee(rect) {
    var comps = [], annos = [], wires = [], rx2 = rect.x + rect.w, ry2 = rect.y + rect.h;
    function ptIn(p) { return p && p.x >= rect.x && p.x <= rx2 && p.y >= rect.y && p.y <= ry2; }
    // 직교 세그먼트가 사각형과 겹치는지
    function segHit(a, b) {
      if (ptIn(a) || ptIn(b)) return true;
      if (Math.abs(a.y - b.y) < 0.5) {                 // 수평
        if (a.y < rect.y || a.y > ry2) return false;
        return Math.min(a.x, b.x) <= rx2 && Math.max(a.x, b.x) >= rect.x;
      }
      if (Math.abs(a.x - b.x) < 0.5) {                 // 수직
        if (a.x < rect.x || a.x > rx2) return false;
        return Math.min(a.y, b.y) <= ry2 && Math.max(a.y, b.y) >= rect.y;
      }
      return false;
    }
    WE.model.project.components.forEach(function (c) {
      var b = WE.render.componentBBox(c);
      if (b.x < rx2 && b.x2 > rect.x && b.y < ry2 && b.y2 > rect.y) comps.push(c.id);
    });
    WE.model.project.annotations.forEach(function (a) {
      var b = WE.render.annoBBox(a.id);
      if (b && b.x < rx2 && b.x2 > rect.x && b.y < ry2 && b.y2 > rect.y) annos.push(a.id);
    });
    // 배선: 경로 일부라도 사각형과 겹치면 선택
    WE.model.project.wires.forEach(function (w) {
      var pts = WE.geometry.wireRoutePoints(w); if (!pts) return;
      for (var i = 0; i < pts.length - 1; i++) {
        if (segHit(pts[i], pts[i + 1])) { wires.push(w.id); break; }
      }
    });
    WE.model.setMultiSelection(comps, annos, wires);
    WE.render.renderOverlay(); WE.app.refreshProps();
  }

  // 단자 편집 모드: 클릭으로 단자 추가 / 기존 단자 선택·드래그
  function onTerminalDown(e) {
    var termEl = e.target.closest("[data-term-id]");
    if (termEl) {
      var cmpId = termEl.getAttribute("data-cmp-id");
      var cmp = WE.model.getComponent(cmpId);
      WE.model.select("component", cmpId);
      WE.model.ui.selectedTerminalId = termEl.getAttribute("data-term-id");
      WE.render.rerenderComponent(cmp);
      WE.render.renderOverlay();
      WE.app.refreshProps();
      drag = { mode: "term", cmpId: cmpId, tid: WE.model.ui.selectedTerminalId };
      svg.setPointerCapture(e.pointerId);
      return;
    }
    var g = e.target.closest(".component");
    if (g) {
      var cid = g.getAttribute("data-id");
      var comp = WE.model.getComponent(cid);
      WE.model.select("component", cid);
      var abs = WE.geometry.clientToCanvas(svg, e.clientX, e.clientY);
      var rc = WE.geometry.absToTerminal(comp, abs);
      var t = WE.model.addTerminal(comp, rc.rx, rc.ry);
      WE.model.ui.selectedTerminalId = t.id;
      WE.render.rerenderComponent(comp);
      WE.render.renderOverlay();
      WE.app.refreshProps();
      drag = { mode: "term", cmpId: cid, tid: t.id };
      svg.setPointerCapture(e.pointerId);
    }
  }

  var SNAP_DIST = 22; // 단자 스냅 반경(캔버스 px)

  // 모든 단자의 절대좌표
  function allTerminals() {
    var list = [];
    WE.model.project.components.forEach(function (c) {
      c.terminals.forEach(function (t) {
        list.push({ cmpId: c.id, tid: t.id, pos: WE.geometry.terminalAbs(c, t) });
      });
    });
    return list;
  }
  // 점 p에서 가장 가까운 단자 (thresh 이내)
  function nearestTerminal(p, thresh) {
    var best = null, bestD = thresh;
    allTerminals().forEach(function (o) {
      var d = Math.hypot(o.pos.x - p.x, o.pos.y - p.y);
      if (d <= bestD) { bestD = d; best = o; }
    });
    return best;
  }

  // 배선 프리뷰(러버밴드 + 스냅 하이라이트) 갱신
  function updateWirePreview(p) {
    var hit = nearestTerminal(p, SNAP_DIST);
    var snap = hit ? hit.pos : null;
    if (wirePending) {
      var a = WE.geometry.wireEndpoint({ componentId: wirePending.cmpId, terminalId: wirePending.tid });
      WE.render.setWirePreview(a, snap || p, snap);
    } else {
      WE.render.setWirePreview(null, null, snap);
    }
  }

  // 배선 모드: 가장 가까운 단자를 클릭 → 단자 → 단자로 배선
  function onWireDown(e) {
    var p = WE.geometry.clientToCanvas(svg, e.clientX, e.clientY);
    var hit = nearestTerminal(p, SNAP_DIST);
    if (hit) {
      if (!wirePending) {
        wirePending = { cmpId: hit.cmpId, tid: hit.tid };
      } else if (!(wirePending.cmpId === hit.cmpId && wirePending.tid === hit.tid)) {
        var w = WE.model.addWire(wirePending.cmpId, wirePending.tid, hit.cmpId, hit.tid);
        if (w && WE.app.trackOnce) WE.app.trackOnce("create_wire");
        wirePending = null;
        WE.render.clearWirePreview();
        WE.render.renderWires();
        WE.model.select("wire", w.id);
        WE.app.refreshProps();
        e.preventDefault();
        return;
      }
      updateWirePreview(p);
      e.preventDefault();
      return;
    }
    // 단자 없는 빈 곳 클릭 → 취소
    if (wirePending) { wirePending = null; WE.render.clearWirePreview(); }
  }

  function segIndexAt(pts, p) {
    var best = 0, bestD = Infinity;
    for (var i = 0; i < pts.length - 1; i++) {
      var d = distToSeg(p, pts[i], pts[i + 1]);
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  // 대각선 세그먼트에 코너를 넣어 직각화 + 불필요한 일직선 점 제거
  function orthogonalize(pts) {
    if (pts.length < 2) return pts;
    var out = [pts[0]];
    for (var i = 1; i < pts.length; i++) {
      var p = pts[i], last = out[out.length - 1];
      if (Math.abs(p.x - last.x) > 0.5 && Math.abs(p.y - last.y) > 0.5) {
        out.push({ x: last.x, y: p.y });   // 세로 먼저 코너
      }
      out.push(p);
    }
    var res = [out[0]];
    for (i = 1; i < out.length - 1; i++) {
      var a = res[res.length - 1], b = out[i], c = out[i + 1];
      var col = (Math.abs(a.x - b.x) < 0.5 && Math.abs(b.x - c.x) < 0.5) ||
                (Math.abs(a.y - b.y) < 0.5 && Math.abs(b.y - c.y) < 0.5);
      if (!col) res.push(b);
    }
    res.push(out[out.length - 1]);
    return res;
  }
  // 배선 경로를 직각으로 정리해 waypoints 갱신
  function cleanupWire(w) {
    var pts = WE.geometry.wireRoutePoints(w);
    if (!pts) return;
    w.waypoints = orthogonalize(pts).slice(1, -1);
  }

  // ---- 부품 이동 시 수동배선(정렬된 배선) 따라오게 하기 ----
  // 이동 시작 시 연결된 수동배선의 원본 꺾임점·단자위치를 스냅샷
  function beginWireFollow(movingIds) {
    var set = {}; movingIds.forEach(function (id) { set[id] = 1; });
    var arr = [];
    WE.model.project.wires.forEach(function (w) {
      if (!w.waypoints || !w.waypoints.length) return;   // 수동배선만
      var fromMoving = !!set[w.from.componentId], toMoving = !!set[w.to.componentId];
      if (!fromMoving && !toMoving) return;
      var A = WE.geometry.wireEndpoint(w.from), B = WE.geometry.wireEndpoint(w.to);
      arr.push({
        w: w, orig: w.waypoints.map(function (p) { return { x: p.x, y: p.y }; }),
        fromMoving: fromMoving, toMoving: toMoving,
        a0: A ? { x: A.x, y: A.y } : null, b0: B ? { x: B.x, y: B.y } : null
      });
    });
    return arr;
  }
  // 이동량(dx,dy)만큼 단자쪽 인접 꺾임점을 이동해 첫 세그먼트 방향(수평/수직) 유지
  function applyWireFollow(follows, dx, dy) {
    if (!follows) return;
    follows.forEach(function (f) {
      var wp = f.w.waypoints, n = wp.length;
      if (f.fromMoving && f.toMoving) {   // 양쪽 다 이동 → 전체 평행이동
        for (var i = 0; i < n; i++) { wp[i].x = f.orig[i].x + dx; wp[i].y = f.orig[i].y + dy; }
        return;
      }
      if (f.fromMoving && n && f.a0) followEnd(wp[0], f.orig[0], f.a0, dx, dy);
      if (f.toMoving && n && f.b0) followEnd(wp[n - 1], f.orig[n - 1], f.b0, dx, dy);
    });
  }
  function followEnd(wpPt, origPt, term0, dx, dy) {
    // 단자-인접 세그먼트가 수평이면 y를, 수직이면 x를 단자와 함께 이동(방향 유지)
    var horiz = Math.abs(term0.y - origPt.y) <= Math.abs(term0.x - origPt.x);
    if (horiz) { wpPt.x = origPt.x; wpPt.y = origPt.y + dy; }
    else { wpPt.x = origPt.x + dx; wpPt.y = origPt.y; }
  }

  // 드래그 시작 시: 자동 경로를 waypoint로 고정하고 잡은 세그먼트를 계산해 wseg로 전환
  function beginWireSeg(wid, startClientX, startClientY) {
    var w = WE.model.getWire(wid); if (!w) { drag = null; return; }
    var pts = WE.geometry.wireRoutePoints(w);
    if (!pts || pts.length < 2) { drag = null; return; }
    if (!w.waypoints || !w.waypoints.length) {
      w.waypoints = pts.slice(1, -1).map(function (p) { return { x: p.x, y: p.y }; });
    }
    cleanupWire(w);   // 잡는 순간 대각선을 직각으로 정리
    var full = WE.geometry.wireRoutePoints(w);   // [a0, ...waypoints, b0]
    var p = WE.geometry.clientToCanvas(svg, startClientX, startClientY);
    var seg = segIndexAt(full, p);
    var q1 = full[seg], q2 = full[seg + 1];
    var isHoriz = Math.abs(q1.y - q2.y) <= Math.abs(q1.x - q2.x);
    var W = w.waypoints, last = full.length - 1, wpi1, wpi2;
    if (seg === 0) {                              // a0 → 첫 waypoint: 단자쪽 복제 삽입
      W.unshift({ x: full[0].x, y: full[0].y }); wpi1 = 0; wpi2 = 1;
    } else if (seg === last - 1) {                // 마지막 waypoint → b0
      W.push({ x: full[last].x, y: full[last].y }); wpi1 = W.length - 2; wpi2 = W.length - 1;
    } else {                                       // 내부 세그먼트
      wpi1 = seg - 1; wpi2 = seg;
    }
    drag = {
      mode: "wseg", wireId: wid, isHoriz: isHoriz, wpi1: wpi1, wpi2: wpi2,
      baseX: W[wpi1].x, baseY: W[wpi1].y, startX: startClientX, startY: startClientY
    };
    WE.render.renderWires(); WE.render.renderOverlay();
  }
  function distToSeg(p, a, b) {
    var dx = b.x - a.x, dy = b.y - a.y;
    var len2 = dx * dx + dy * dy;
    var t = len2 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    var cx = a.x + t * dx, cy = a.y + t * dy;
    return Math.hypot(p.x - cx, p.y - cy);
  }

  // 라벨 모드 미리보기: 커서 위치의 튜브. 배선 위에선 경로에 투영 + 구간 방향으로 회전
  function updateLabelPreview(e) {
    var pt = WE.geometry.clientToCanvas(svg, e.clientX, e.clientY);
    var text = WE.app.nextWireLabel ? WE.app.nextWireLabel() : "W1";
    var snap = null, ang = 0;
    var wireEl = e.target.closest && e.target.closest("[data-wire-id]");
    if (wireEl) {
      var w = WE.model.getWire(wireEl.getAttribute("data-wire-id"));
      if (w) {
        if ((w.labelText || "").trim()) text = w.labelText.trim();   // 라벨 있는 배선: 이동 미리보기
        var pts = WE.geometry.wireRoutePoints(w);
        var on = pts && WE.geometry.nearestPointOnPolyline(pts, pt);
        if (on) {
          var si = WE.geometry.nearestSegmentIndex(pts, on);
          if (si >= 0) {
            ang = Math.atan2(pts[si + 1].y - pts[si].y, pts[si + 1].x - pts[si].x) * 180 / Math.PI;
            if (ang > 90) ang -= 180;
            if (ang <= -90) ang += 180;
          }
          snap = on;
        }
      }
    }
    var at = snap || pt;
    WE.render.setLabelPreview({ x: at.x, y: at.y, text: text, angle: snap ? ang : 0, snapped: !!snap });
  }

  // 라벨 모드: 배선을 클릭하면 그 지점에 수축튜브 라벨 부착 (이미 있으면 클릭 지점으로 이동)
  function onLabelDown(e) {
    var wireEl = e.target.closest("[data-wire-id]");
    var tubeEl = e.target.closest("[data-wire-label-for]");
    var wid = wireEl ? wireEl.getAttribute("data-wire-id") : (tubeEl ? tubeEl.getAttribute("data-wire-label-for") : null);
    if (!wid) return;
    var w = WE.model.getWire(wid);
    if (!w) return;
    var pt = WE.geometry.clientToCanvas(svg, e.clientX, e.clientY);
    var pts = WE.geometry.wireRoutePoints(w);
    w.labelT = pts ? WE.geometry.polylineRatioOf(pts, pt) : 0.5;   // 경로 비율로 저장(이동해도 따라옴)
    delete w.labelPos;
    if (!(w.labelText || "").trim()) w.labelText = WE.app.nextWireLabel();
    WE.render.setLabelPreview(null);   // 부착 직후 미리보기 지움(다음 마우스 이동에 새 번호로 재표시)
    WE.render.renderWires();
    WE.history.commit();
    if (WE.app.trackOnce) WE.app.trackOnce("add_wire_label");
  }

  // 텍스트 모드: 빈 곳 클릭 → 주석 추가 / 기존 주석 클릭 → 선택·이동
  function onTextDown(e) {
    var annoEl = e.target.closest("[data-anno-id]");
    if (annoEl) { selectAnnoAndDrag(annoEl, e); return; }
    var p = WE.geometry.clientToCanvas(svg, e.clientX, e.clientY);
    var a = WE.model.addAnnotation({
      x: snapVal(p.x), y: snapVal(p.y),
      color: WE.model.ui.wireColor
    });
    WE.model.select("annotation", a.id);
    WE.render.renderAnnotations();
    WE.render.renderOverlay();
    WE.app.refreshProps();
    // fresh: 방금 배치한 주석 — 마우스를 떼면 바로 텍스트 입력으로 진입
    // (pointerdown 중의 focus()는 브라우저 기본 포커스 이동에 덮여 무효라 pointerup에서 처리)
    drag = { mode: "anno", id: a.id, startX: e.clientX, startY: e.clientY, orig: { x: a.x, y: a.y }, fresh: true };
    svg.setPointerCapture(e.pointerId);
  }

  function selectAnnoAndDrag(annoEl, e) {
    var id = annoEl.getAttribute("data-anno-id");
    WE.model.select("annotation", id);
    WE.render.renderOverlay();
    WE.app.refreshProps();
    var a = WE.model.getAnnotation(id);
    drag = { mode: "anno", id: id, startX: e.clientX, startY: e.clientY, orig: { x: a.x, y: a.y } };
    svg.setPointerCapture(e.pointerId);
  }

  function onDblClick(e) {
    // 배선 라벨(수축튜브) 더블클릭 → 문구 수정 (비우면 라벨 삭제)
    var wtube = e.target.closest("[data-wire-label-for]");
    if (wtube) {
      var tw = WE.model.getWire(wtube.getAttribute("data-wire-label-for"));
      if (tw) {
        var tv = prompt(WE.i18n.t("라벨 문구 (비우면 라벨 삭제)"), tw.labelText || "");
        if (tv !== null) {
          tv = tv.trim();
          if (tv) tw.labelText = tv; else { delete tw.labelText; delete tw.labelPos; delete tw.labelT; }
          WE.render.renderWires();
          WE.render.renderOverlay();
          WE.history.commit();
          if (WE.app.refreshProps) WE.app.refreshProps();
        }
      }
      return;
    }
    // 단자 라벨 더블클릭 → 자동 위치로 초기화
    var lblEl = e.target.closest("[data-label-tid]");
    if (lblEl) {
      var lc = WE.model.getComponent(lblEl.getAttribute("data-cmp-id"));
      var lt = lc && WE.model.getTerminal(lc, lblEl.getAttribute("data-label-tid"));
      if (lt) { delete lt.labelPos; WE.render.renderTermLabels(); WE.render.renderOverlay(); }
      return;
    }
    // 배선 더블클릭 → 자동 경로로 초기화(수동 꺾임 제거)
    var wireEl = e.target.closest("[data-wire-id]");
    if (wireEl) {
      var w = WE.model.getWire(wireEl.getAttribute("data-wire-id"));
      if (w) { w.waypoints = []; WE.render.renderWires(); WE.render.renderOverlay(); }
      return;
    }
    var annoEl = e.target.closest("[data-anno-id]");
    if (!annoEl) return;
    WE.model.select("annotation", annoEl.getAttribute("data-anno-id"));
    WE.render.renderOverlay();
    WE.app.refreshProps();
    if (WE.app.focusAnnoText) WE.app.focusAnnoText();
  }

  function onPointerMove(e) {
    // 팬(이동)
    if (drag && drag.mode === "pan") {
      wrap.scrollLeft = drag.sl - (e.clientX - drag.startX);
      wrap.scrollTop = drag.st - (e.clientY - drag.startY);
      return;
    }

    // 배선 모드: 근접 단자 스냅 하이라이트 + 러버밴드
    if (WE.model.ui.mode === "wire") {
      updateWirePreview(WE.geometry.clientToCanvas(svg, e.clientX, e.clientY));
      return;
    }

    // 라벨 모드: 마우스에 수축튜브 미리보기가 들려 다니고, 배선 위에선 경로에 착 붙음
    if (WE.model.ui.mode === "label") {
      updateLabelPreview(e);
      return;
    }

    if (!drag) return;

    // 단자 라벨 이동 (로컬 좌표로 저장 → 회전/이동에 따라옴)
    if (drag.mode === "tlabel") {
      var lc = WE.model.getComponent(drag.cmpId); if (!lc) return;
      var lt = WE.model.getTerminal(lc, drag.tid); if (!lt) return;
      var lp = WE.geometry.clientToCanvas(svg, e.clientX, e.clientY);
      var lrc = WE.geometry.absToTerminal(lc, lp);
      lt.labelPos = { x: lrc.rx * lc.width, y: lrc.ry * lc.height };
      WE.render.renderTermLabels();
      WE.render.renderOverlay();
      return;
    }

    // 배선 번호 라벨 이동 — 배선이 지나가는 경로 위로만 이동(경로 밖 임의 위치 금지) + 다른 배선 번호와
    // 같은 x(세로 구간 위일 때) 또는 y(가로 구간 위일 때)에 가까워지면 자동 정렬(스마트 가이드)
    if (drag.mode === "wlabel") {
      var wl = WE.model.getWire(drag.wireId); if (!wl) return;
      var wlp = WE.geometry.clientToCanvas(svg, e.clientX, e.clientY);
      var wlPts = WE.geometry.wireRoutePoints(wl);
      var onPath = WE.geometry.nearestPointOnPolyline(wlPts, wlp) || wlp;
      var wlSi = WE.geometry.nearestSegmentIndex(wlPts, onPath);
      var wlSeg = wlSi >= 0 ? [wlPts[wlSi], wlPts[wlSi + 1]] : null;
      var wlHoriz = !wlSeg || Math.abs(wlSeg[0].y - wlSeg[1].y) < 0.5;

      var finalPt = onPath, guide = null;
      if (wlSeg) {
        var SNAP_PX = 6;
        var others = [];
        var lblEls = svg.querySelectorAll("[data-wire-label-for]");
        for (var oi = 0; oi < lblEls.length; oi++) {
          if (lblEls[oi].getAttribute("data-wire-label-for") === drag.wireId) continue;
          var ox = parseFloat(lblEls[oi].getAttribute("data-wire-label-cx"));
          var oy = parseFloat(lblEls[oi].getAttribute("data-wire-label-cy"));
          if (!isNaN(ox) && !isNaN(oy)) others.push({ x: ox, y: oy });
        }
        if (wlHoriz) {
          // 가로 구간: x를 다른 라벨의 x에 맞춰 세로로 나란히(같은 열) 정렬
          var bestX = null, bxd = SNAP_PX;
          others.forEach(function (o) { var d = Math.abs(o.x - onPath.x); if (d < bxd) { bxd = d; bestX = o.x; } });
          if (bestX !== null) {
            var lo1 = Math.min(wlSeg[0].x, wlSeg[1].x), hi1 = Math.max(wlSeg[0].x, wlSeg[1].x);
            var cx1 = Math.max(lo1, Math.min(hi1, bestX));
            var t1 = (wlSeg[1].x - wlSeg[0].x) !== 0 ? (cx1 - wlSeg[0].x) / (wlSeg[1].x - wlSeg[0].x) : 0;
            finalPt = { x: cx1, y: wlSeg[0].y + (wlSeg[1].y - wlSeg[0].y) * t1 };
            guide = { axis: "x", value: bestX };
          }
        } else {
          // 세로 구간: y를 다른 라벨의 y에 맞춰 가로로 나란히(같은 행) 정렬
          var bestY = null, byd = SNAP_PX;
          others.forEach(function (o) { var d = Math.abs(o.y - onPath.y); if (d < byd) { byd = d; bestY = o.y; } });
          if (bestY !== null) {
            var lo2 = Math.min(wlSeg[0].y, wlSeg[1].y), hi2 = Math.max(wlSeg[0].y, wlSeg[1].y);
            var cy2 = Math.max(lo2, Math.min(hi2, bestY));
            var t2 = (wlSeg[1].y - wlSeg[0].y) !== 0 ? (cy2 - wlSeg[0].y) / (wlSeg[1].y - wlSeg[0].y) : 0;
            finalPt = { x: wlSeg[0].x + (wlSeg[1].x - wlSeg[0].x) * t2, y: cy2 };
            guide = { axis: "y", value: bestY };
          }
        }
      }
      wl.labelT = WE.geometry.polylineRatioOf(wlPts, finalPt);   // 경로 비율로 저장
      delete wl.labelPos;
      WE.render.setWireLabelGuide(guide);
      WE.render.renderWires();
      WE.render.renderOverlay();
      return;
    }

    // 주석 이동
    if (drag.mode === "anno") {
      var an = WE.model.getAnnotation(drag.id); if (!an) return;
      var ap0 = WE.geometry.clientToCanvas(svg, drag.startX, drag.startY);
      var ap1 = WE.geometry.clientToCanvas(svg, e.clientX, e.clientY);
      an.x = snapVal(drag.orig.x + (ap1.x - ap0.x));
      an.y = snapVal(drag.orig.y + (ap1.y - ap0.y));
      WE.render.renderAnnotations();
      WE.render.renderOverlay();
      return;
    }

    // 배선을 실제로 드래그하기 시작하면 세그먼트 편집으로 전환
    if (drag.mode === "wire-pending") {
      if (Math.abs(e.clientX - drag.startX) + Math.abs(e.clientY - drag.startY) < 4) return;
      beginWireSeg(drag.wireId, drag.startX, drag.startY);
      if (!drag || drag.mode !== "wseg") return;
    }

    // 배선 세그먼트 평행 이동 (꺾임점 유지, 수직/수평으로만)
    if (drag.mode === "wseg") {
      var ws = WE.model.getWire(drag.wireId); if (!ws) return;
      var W = ws.waypoints;
      if (!W[drag.wpi1] || !W[drag.wpi2]) return;
      var sp0 = WE.geometry.clientToCanvas(svg, drag.startX, drag.startY);
      var sp1 = WE.geometry.clientToCanvas(svg, e.clientX, e.clientY);
      if (drag.isHoriz) {
        var ny = snapVal(drag.baseY + (sp1.y - sp0.y));
        W[drag.wpi1].y = ny; W[drag.wpi2].y = ny;
      } else {
        var nx = snapVal(drag.baseX + (sp1.x - sp0.x));
        W[drag.wpi1].x = nx; W[drag.wpi2].x = nx;
      }
      WE.render.renderWires(); WE.render.renderOverlay();
      return;
    }

    // 마퀴 사각형 그리기
    if (drag.mode === "marquee") {
      var p = WE.geometry.clientToCanvas(svg, e.clientX, e.clientY);
      drag.rect = { x: Math.min(drag.ox, p.x), y: Math.min(drag.oy, p.y), w: Math.abs(p.x - drag.ox), h: Math.abs(p.y - drag.oy) };
      WE.render.setMarquee(drag.rect);
      return;
    }

    // 그룹 이동 (부품 + 주석)
    if (drag.mode === "move-group") {
      var gp0 = WE.geometry.clientToCanvas(svg, drag.startX, drag.startY);
      var gp1 = WE.geometry.clientToCanvas(svg, e.clientX, e.clientY);
      var gdx = gp1.x - gp0.x, gdy = gp1.y - gp0.y;
      drag.comps.forEach(function (mid) {
        var mc = WE.model.getComponent(mid); if (!mc) return;
        var o = drag.origs["c" + mid];
        mc.x = snapVal(o.x + gdx); mc.y = snapVal(o.y + gdy);
        WE.render.updateComponent(mc);
      });
      applyWireFollow(drag.follow, snapVal(gdx), snapVal(gdy));
      WE.render.updateWiresFor(drag.comps[0]);   // 모든 배선 경로 일괄 갱신
      drag.annos.forEach(function (aid) {
        var a = WE.model.getAnnotation(aid); if (!a) return;
        var o = drag.origs["a" + aid];
        a.x = snapVal(o.x + gdx); a.y = snapVal(o.y + gdy);
      });
      if (drag.annos.length) WE.render.renderAnnotations();
      WE.render.renderOverlay();
      return;
    }

    // 회전
    if (drag.mode === "rotate") {
      var rc = WE.model.getComponent(drag.id); if (!rc) return;
      var rp = WE.geometry.clientToCanvas(svg, e.clientX, e.clientY);
      var ang = Math.atan2(rp.y - drag.cy, rp.x - drag.cx) * 180 / Math.PI + 90; // 핸들이 위를 향하도록
      var norm = (ang % 360 + 360) % 360;
      if (e.shiftKey) {
        norm = Math.round(norm / 15) * 15;               // Shift: 15° 단위 스냅
      } else {
        var n90 = Math.round(norm / 90) * 90;            // 0/90/180/270 근처면 자동 정렬(마그넷)
        if (Math.abs(norm - n90) <= 10) norm = n90;
      }
      rc.rotation = Math.round(norm % 360);
      WE.render.rerenderComponent(rc);   // 단자 라벨 수평 유지 위해 다시 그림
      WE.render.updateWiresFor(rc.id);
      WE.render.renderOverlay();
      WE.app.refreshProps();
      return;
    }

    if (drag.mode === "term") {
      var tc = WE.model.getComponent(drag.cmpId);
      if (!tc) return;
      var t = WE.model.getTerminal(tc, drag.tid);
      if (!t) return;
      var pa = WE.geometry.clientToCanvas(svg, e.clientX, e.clientY);
      var rc = WE.geometry.absToTerminal(tc, pa);
      t.rx = Math.max(0, Math.min(1, rc.rx));
      t.ry = Math.max(0, Math.min(1, rc.ry));
      WE.render.rerenderComponent(tc);
      WE.render.renderOverlay();
      WE.app.refreshProps();
      return;
    }

    var cmp = WE.model.getComponent(drag.id);
    if (!cmp) return;

    // 화면 이동량 → 캔버스 좌표 이동량으로 스케일 보정
    var p0 = WE.geometry.clientToCanvas(svg, drag.startX, drag.startY);
    var p1 = WE.geometry.clientToCanvas(svg, e.clientX, e.clientY);
    var dx = p1.x - p0.x, dy = p1.y - p0.y;

    // ---- 스마트 정렬 스냅 (diagrams.net 스타일) ----
    // 드래그 중인 부품의 좌/중/우·상/중/하가 다른 부품의 같은 기준선과 가까우면
    // 그 선에 착 붙이고 파란 가이드선을 표시. 그리드 스냅보다 나중에 적용되어 우선함.
    var ALIGN_TOL = 5;
    function cmpBBox(c) {
      var W = c.width, H = c.height;
      var pts = [WE.geometry.localToAbs(c, 0, 0), WE.geometry.localToAbs(c, W, 0),
                 WE.geometry.localToAbs(c, W, H), WE.geometry.localToAbs(c, 0, H)];
      var xs = pts.map(function (p) { return p.x; }), ys = pts.map(function (p) { return p.y; });
      return { x: Math.min.apply(null, xs), y: Math.min.apply(null, ys),
               x2: Math.max.apply(null, xs), y2: Math.max.apply(null, ys) };
    }
    function applyAlignSnap(c) {
      var b = cmpBBox(c);
      var candX = [b.x, (b.x + b.x2) / 2, b.x2];
      var candY = [b.y, (b.y + b.y2) / 2, b.y2];
      var bestX = null, bdx = ALIGN_TOL, bestY = null, bdy = ALIGN_TOL;
      WE.model.project.components.forEach(function (o) {
        if (o.id === c.id) return;
        var ob = cmpBBox(o);
        [ob.x, (ob.x + ob.x2) / 2, ob.x2].forEach(function (tx) {
          candX.forEach(function (cx) {
            var d = Math.abs(tx - cx);
            if (d < bdx) { bdx = d; bestX = { target: tx, cur: cx, ob: ob }; }
          });
        });
        [ob.y, (ob.y + ob.y2) / 2, ob.y2].forEach(function (ty) {
          candY.forEach(function (cy) {
            var d = Math.abs(ty - cy);
            if (d < bdy) { bdy = d; bestY = { target: ty, cur: cy, ob: ob }; }
          });
        });
      });
      if (bestX) c.x += bestX.target - bestX.cur;
      if (bestY) c.y += bestY.target - bestY.cur;
      // 가이드선은 화면 전체가 아니라 "정렬된 두 부품 사이 구간"만 — 스냅 반영 후 위치로 계산
      var guides = [];
      if (bestX || bestY) {
        var nb = cmpBBox(c);
        if (bestX) guides.push({ axis: "x", value: bestX.target,
          from: Math.min(nb.y, bestX.ob.y), to: Math.max(nb.y2, bestX.ob.y2) });
        if (bestY) guides.push({ axis: "y", value: bestY.target,
          from: Math.min(nb.x, bestY.ob.x), to: Math.max(nb.x2, bestY.ob.x2) });
      }
      WE.render.setAlignGuides(guides);
    }

    if (drag.mode === "move") {
      cmp.x = snapVal(drag.orig.x + dx);
      cmp.y = snapVal(drag.orig.y + dy);
      applyAlignSnap(cmp);   // 다른 부품의 변/중심과 정렬되면 착 붙이고 파란 가이드선 표시
      applyWireFollow(drag.follow, cmp.x - drag.orig.x, cmp.y - drag.orig.y);
    } else if (drag.mode === "resize") {
      // 회전된 부품도 올바르게 리사이즈되도록 이동량을 로컬 좌표로 변환
      var rad = cmp.rotation * Math.PI / 180, cos = Math.cos(rad), sin = Math.sin(rad);
      var ldx = dx * cos + dy * sin, ldy = -dx * sin + dy * cos;
      var nw = Math.max(10, snapVal(drag.orig.width + ldx));
      if (WE.model.ui.lockAspect) {
        var ratio = drag.orig.width / drag.orig.height;
        cmp.width = nw;
        cmp.height = Math.max(10, Math.round(nw / ratio));
      } else {
        cmp.width = nw;
        cmp.height = Math.max(10, snapVal(drag.orig.height + ldy));
      }
    }

    // 리사이즈 시엔 단자도 새 크기에 맞게 다시 그림(안 그러면 위치 어긋남)
    if (drag.mode === "resize" && cmp.terminals.length) WE.render.rerenderComponent(cmp);
    else WE.render.updateComponent(cmp);
    WE.render.updateWiresFor(cmp.id); // 연결된 배선 추종
    WE.render.renderOverlay();
    WE.app.refreshProps();
  }

  function onPointerUp(e) {
    if (!drag) return;
    if (drag.mode === "pan") {
      document.body.classList.remove("panning");
      try { svg.releasePointerCapture(e.pointerId); } catch (err) {}
      drag = null;
      return;
    }
    if (drag.mode === "marquee") {
      WE.render.clearMarquee();
      if (drag.rect && (drag.rect.w > 3 || drag.rect.h > 3)) {
        applyMarquee(drag.rect);
      } else {
        WE.model.clearSelection(); WE.render.renderOverlay(); WE.app.refreshProps();
      }
    }
    // 배선 번호 라벨 드래그 종료 → 정렬 가이드선 정리
    if (drag.mode === "wlabel") {
      WE.render.setWireLabelGuide(null);
    }
    // 배선 세그먼트 드래그 종료 → 다른 배선과 겹치면 옆 레인으로 자동 회피
    if (drag.mode === "wseg") {
      var ws = WE.model.getWire(drag.wireId);
      if (ws && ws.waypoints && ws.waypoints[drag.wpi1] && ws.waypoints[drag.wpi2]) {
        var p1 = ws.waypoints[drag.wpi1], p2 = ws.waypoints[drag.wpi2];
        var vertical = !drag.isHoriz;
        var coord = vertical ? p1.x : p1.y;
        var lo = vertical ? Math.min(p1.y, p2.y) : Math.min(p1.x, p2.x);
        var hi = vertical ? Math.max(p1.y, p2.y) : Math.max(p1.x, p2.x);
        var gapEl = document.getElementById("wireGap");
        var gap = gapEl ? parseInt(gapEl.value, 10) : 0; if (isNaN(gap)) gap = 0;
        var nc = WE.geometry.avoidOverlapCoord(ws.id, vertical, coord, lo, hi, gap, 0);
        if (nc !== coord) {
          if (vertical) { p1.x = nc; p2.x = nc; } else { p1.y = nc; p2.y = nc; }
          cleanupWire(ws);
          WE.render.renderWires(); WE.render.renderOverlay();
        }
      }
    }
    // 부품 이동 종료 → 정렬 가이드선 정리
    if (drag.mode === "move") WE.render.setAlignGuides(null);

    // 방금 배치한 텍스트 주석 → 마우스를 뗀 즉시 입력 모드로 (별도 클릭 없이 바로 타이핑)
    if (drag.mode === "anno" && drag.fresh && WE.app.focusAnnoText) {
      WE.app.focusAnnoText();
    }
    try { svg.releasePointerCapture(e.pointerId); } catch (err) {}
    drag = null;
    if (WE.history) WE.history.commit();
  }

  function isBusy() { return !!drag; }

  function onKeyDown(e) {
    // Ctrl/⌘+S → 실제 파일에 저장(Chrome/Edge는 이미 연결된 파일에 조용히 덮어씀, 그 외엔 새로 저장창).
    // 브라우저 임시저장도 함께 갱신. 입력창·모달 상관없이 항상 동작
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      if (WE.store) WE.store.saveNow();
      if (WE.app.setSavedHint) WE.app.setSavedHint();
      if (WE.io) WE.io.save();
      return;
    }
    // Ctrl/⌘+O → 프로젝트 파일 열기 (브라우저 기본 '파일 열기' 대신)
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "o") {
      e.preventDefault();
      document.getElementById("btnOpen").click();
      return;
    }

    // 모달(단자 배치·배경 제거·프리셋)이 열려 있으면 캔버스 단축키 무시
    if (document.querySelector(".modal:not([hidden])")) return;

    // 입력창에 포커스 있으면 단축키 무시(텍스트 입력의 기본 undo 등 보존)
    var tag = (document.activeElement && document.activeElement.tagName) || "";
    if (tag === "INPUT" || tag === "TEXTAREA") return;

    // Esc → 어떤 모드에서든 기본(선택) 모드로 복귀
    if (e.key === "Escape" && WE.model.ui.mode !== "select") {
      WE.app.setMode("select");
      e.preventDefault(); return;
    }

    // 스페이스바 = 팬(이동) 모드
    if (e.code === "Space") { spaceDown = true; document.body.classList.add("pan-ready"); e.preventDefault(); return; }

    // Undo / Redo
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      if (e.shiftKey) WE.history.doRedo(); else WE.history.doUndo();
      e.preventDefault(); return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
      WE.history.doRedo(); e.preventDefault(); return;
    }

    // 사용자 지정 단축키(모드 전환 등, 조합키 없을 때)
    if (!e.ctrlKey && !e.metaKey && !e.altKey && WE.app.handleShortcut && WE.app.handleShortcut(e.key)) {
      e.preventDefault(); return;
    }

    // 다중 선택 시 Delete → 전체 삭제 (부품 + 주석 + 배선)
    // 단일 삭제 분기보다 반드시 먼저: 다중 선택에도 '대표 선택' 1개가 함께 잡혀 있어서
    // 이 검사가 뒤에 있으면 단일 분기가 먼저 걸려 하나만 지워지고 끝나버림
    var multiSel = WE.model.getMulti(), multiA = WE.model.getMultiAnno(), multiW = WE.model.getMultiWire();
    if (multiSel.length + multiA.length + multiW.length > 1 && (e.key === "Delete" || e.key === "Backspace")) {
      multiW.slice().forEach(function (id) { WE.model.removeWire(id); });
      multiSel.slice().forEach(function (id) { WE.model.removeComponent(id); });
      multiA.slice().forEach(function (id) { WE.model.removeAnnotation(id); });
      WE.model.clearSelection();
      WE.render.renderAll();
      WE.app.refreshProps();
      e.preventDefault();
      return;
    }

    // 주석 선택 시 Delete → 주석 삭제
    var selAnno = WE.model.getSelectedAnnotation();
    if (selAnno && (e.key === "Delete" || e.key === "Backspace")) {
      WE.model.removeAnnotation(selAnno.id);
      WE.render.renderAll();
      WE.app.refreshProps();
      e.preventDefault();
      return;
    }

    // 배선 선택 시 Delete
    var selWire = WE.model.getSelectedWire();
    if (selWire && (e.key === "Delete" || e.key === "Backspace")) {
      // 라벨을 직접 클릭해 선택한 상태면 라벨만 삭제 (배선은 유지)
      if (WE.model.ui.selectedWireLabel === selWire.id && (selWire.labelText || "").trim()) {
        delete selWire.labelText; delete selWire.labelPos; delete selWire.labelT;
        WE.model.ui.selectedWireLabel = null;
        WE.render.renderWires(); WE.render.renderOverlay(); WE.app.refreshProps();
        WE.history.commit();
        e.preventDefault(); return;
      }
      var wp = WE.model.ui.selectedWp;
      if (wp != null && selWire.waypoints && selWire.waypoints[wp] != null) {
        // 꺾임점만 제거 → 남으면 직각 재정리, 다 지우면 자동 최적경로로
        selWire.waypoints.splice(wp, 1);
        WE.model.ui.selectedWp = null;
        if (selWire.waypoints.length) cleanupWire(selWire);
        WE.render.renderWires(); WE.render.renderOverlay(); WE.app.refreshProps();
      } else {
        WE.model.removeWire(selWire.id);
        WE.render.renderAll(); WE.app.refreshProps();
      }
      e.preventDefault();
      return;
    }

    var cmp = WE.model.getSelectedComponent();
    if (!cmp) return;

    // 단자 편집 모드 + 단자 선택 시: Delete는 단자 삭제
    if (WE.model.ui.mode === "terminal" && WE.model.ui.selectedTerminalId &&
        (e.key === "Delete" || e.key === "Backspace")) {
      WE.model.removeTerminal(cmp, WE.model.ui.selectedTerminalId);
      WE.render.rerenderComponent(cmp);
      WE.render.renderOverlay();
      WE.app.refreshProps();
      e.preventDefault();
      return;
    }

    if (e.key === "Delete" || e.key === "Backspace") {
      WE.model.removeComponent(cmp.id);
      WE.render.renderAll();
      WE.app.refreshProps();
      e.preventDefault();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") {
      var copy = WE.model.duplicateComponent(cmp.id);
      if (copy) {
        WE.model.select("component", copy.id);
        WE.render.renderAll();
        WE.app.refreshProps();
      }
      e.preventDefault();
    }
  }

  function resetWire() {
    wirePending = null;
    WE.render.clearWirePreview();
  }

  return { init: init, resetWire: resetWire, isBusy: isBusy, getLastPointer: getLastPointer };
})();
