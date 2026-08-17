// interactions.js — 선택 / 드래그 / 리사이즈 이벤트
var WE = window.WE || {};
window.WE = WE;

WE.interactions = (function () {
  var svg, wrap;
  var drag = null;          // 진행 중 드래그
  var wirePending = null;    // 배선 그리기 중 상태: { from: 끝점참조, waypoints }
                             //   from = { componentId, terminalId } 또는 { wireId, x, y }(배선에서 시작)
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
    // 우클릭 = 그리던 배선 버리기. 배선을 그리는 중일 때만 기본 메뉴를 막는다
    // (평소 우클릭은 브라우저 메뉴 그대로 — 개발자도구·이미지 저장 등을 쓸 수 있어야 한다)
    svg.addEventListener("contextmenu", function (e) {
      if (cancelWireDraw()) e.preventDefault();
    });
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
    var lblEl = dblTarget(e, "[data-label-tid]");
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
        drag = { mode: "rotate", id: rc.id, cx: center.x, cy: center.y,
                 termFollow: beginTermFollow([rc.id]), branchFollow: beginBranchFollow([rc.id]) };
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
        orig: { width: cmp.width, height: cmp.height },
        termFollow: beginTermFollow([cmp.id]),   // 단자가 움직이므로 수동배선이 따라와야 한다
        branchFollow: beginBranchFollow([cmp.id])
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
      // 이미 다중 선택된 배선을 잡았으면 선택을 유지한다(select()는 multiWire를 1개로 리셋함)
      // → 선택한 여러 세그먼트를 간격 유지한 채 함께 평행이동
      var mw = WE.model.getMultiWire() || [];
      if (!(mw.length > 1 && mw.indexOf(wid) >= 0)) WE.model.select("wire", wid);
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
        follow: beginWireFollow([id]),
        branchFollow: beginBranchFollow([id])
      };
      svg.setPointerCapture(e.pointerId);
    } else {
      // 빈 곳 → 드래그로 사각형(마퀴) 다중 선택 (클릭이면 선택 해제).
      // Ctrl/⌘ + 드래그 = '쓸어담기': 배선 구간만 선택, 박스 모양으로 방향 자동
      //   (가로로 길쭉 → 세로선만 / 세로로 길쭉 → 가로선만 / 정사각에 가까우면 전부)
      var mp = WE.geometry.clientToCanvas(svg, e.clientX, e.clientY);
      drag = { mode: "marquee", sweep: !!(e.ctrlKey || e.metaKey),
               startX: e.clientX, startY: e.clientY, ox: mp.x, oy: mp.y, rect: null };
      svg.setPointerCapture(e.pointerId);
    }
  }

  // 다중 선택 그룹 이동 시작 (부품 + 주석)
  function startGroupMove(e) {
    var comps = WE.model.getMulti().slice(), annos = WE.model.getMultiAnno().slice();
    var origs = {};
    comps.forEach(function (id) { var c = WE.model.getComponent(id); if (c) origs["c" + id] = { x: c.x, y: c.y }; });
    annos.forEach(function (id) { var a = WE.model.getAnnotation(id); if (a) origs["a" + id] = { x: a.x, y: a.y }; });
    drag = { mode: "move-group", comps: comps, annos: annos, origs: origs, startX: e.clientX, startY: e.clientY,
             follow: beginWireFollow(comps), branchFollow: beginBranchFollow(comps) };
    svg.setPointerCapture(e.pointerId);
  }

  // 마퀴 사각형 선택. 배선은 '쓸어담기(Ctrl)' 모드에서만 잡는다(일반 마퀴=부품·주석만).
  // opts.wiresOnly : true=배선만 선택(쓸어담기) / false·미지정=부품·주석만 선택
  // opts.dirFilter : "h"=가로 구간만 / "v"=세로 구간만 / null=방향 무관
  // opts.origin    : 드래그 시작점(캔버스 좌표) — 배선을 이 점에 '세그먼트 수직거리'가
  //                  가까운 순으로 정렬해 '처음 쓸린 선'이 ids[0](정렬 기준선)이 되게 함.
  function applyMarquee(rect, opts) {
    opts = opts || {};
    var comps = [], annos = [], wires = [], clickPts = {};
    var rx2 = rect.x + rect.w, ry2 = rect.y + rect.h;
    var cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2;   // 박스 중심(가장 가까운 구간 판별용)
    function ptIn(p) { return p && p.x >= rect.x && p.x <= rx2 && p.y >= rect.y && p.y <= ry2; }
    function segDir(a, b) {   // 'h' | 'v' | null
      if (Math.abs(a.y - b.y) < 0.5) return "h";
      if (Math.abs(a.x - b.x) < 0.5) return "v";
      return null;
    }
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
    var segs = {};
    // 일반 마퀴는 부품·주석도 함께 선택(쓸어담기 모드는 배선만)
    if (!opts.wiresOnly) {
      WE.model.project.components.forEach(function (c) {
        var b = WE.render.componentBBox(c);
        if (b.x < rx2 && b.x2 > rect.x && b.y < ry2 && b.y2 > rect.y) comps.push(c.id);
      });
      WE.model.project.annotations.forEach(function (a) {
        var b = WE.render.annoBBox(a.id);
        if (b && b.x < rx2 && b.x2 > rect.x && b.y < ry2 && b.y2 > rect.y) annos.push(a.id);
      });
    }
    // 배선: 일반 마퀴·쓸어담기 모두 선택(dirFilter는 쓸어담기일 때만 지정).
    // 히트한 세그먼트 중 박스 중심에 가장 가까운 구간을 대상으로 삼아 그 중점을 wireClickPt에 기록.
    WE.model.project.wires.forEach(function (w) {
      var pts = WE.geometry.wireRoutePoints(w); if (!pts) return;
      var bestMid = null, bestSeg = null, bestD = Infinity;
      for (var i = 0; i < pts.length - 1; i++) {
        var a = pts[i], b = pts[i + 1];
        if (opts.dirFilter && segDir(a, b) !== opts.dirFilter) continue;
        if (!segHit(a, b)) continue;
        var mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        var d = Math.abs(mx - cx) + Math.abs(my - cy);
        if (d < bestD) { bestD = d; bestMid = { x: mx, y: my }; bestSeg = { a: a, b: b }; }
      }
      if (bestMid) { wires.push(w.id); clickPts[w.id] = bestMid; segs[w.id] = bestSeg; }
    });
    // 기준선(ids[0]) = 드래그 시작점에 가장 가까운 선. 단 세그먼트 '중점'이 아니라
    // '세그먼트 자체까지의 수직 거리'로 잰다 — 중점 거리는 선 길이(평행축) 성분이 섞여
    // 나란한 배선 묶음에서 엉뚱한 선이 기준이 됨(짧은 선의 중점이 더 가까워 보이는 착시).
    if (opts.origin) {
      var O = opts.origin;
      wires.sort(function (a, b) {
        return distToSeg(O, segs[a].a, segs[a].b) - distToSeg(O, segs[b].a, segs[b].b);
      });
    }
    WE.model.setMultiSelection(comps, annos, wires);   // 이 안에서 wireClickPt 초기화됨
    wires.forEach(function (id) { WE.model.setWireClickPt(id, clickPts[id]); });
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
      // 단자가 우선, 없으면 분기 대상 배선, 그것도 없으면 빈 곳
      var bt = snap ? null : branchTargetAt(wirePending, p);
      var mode = snap ? "terminal" : (bt ? "branch" : "free");
      var path = wireDraftPath(wirePending, snap || (bt ? bt.pos : p), mode, hit);   // _alignGuide 갱신
      WE.render.setBranchTarget(bt ? { wireId: bt.wire.id, pos: bt.pos } : null);
      WE.render.setWirePreview(path, snap, _alignGuide);
    } else {
      // 그리는 중이 아닐 때도 배선 위에 커서를 올리면 강조한다 —
      // "여기서 시작할 수 있다"를 보여 줘야 기능이 있는 줄 안다
      _alignGuide = null;
      var st = snap ? null : branchStartAt(p);
      WE.render.setBranchTarget(st ? { wireId: st.wire.id, pos: st.pos } : null);
      WE.render.setWirePreview(null, snap, null);
    }
  }

  // 찍는 점을 직전 점과 수평/수직으로 맞춘다 — 배선도에 대각선은 쓰지 않는다.
  // 커서가 더 많이 벗어난 축을 살리고 나머지 축은 직전 점 값을 그대로 물려받는다.
  function axisLock(prev, p) {
    return Math.abs(p.x - prev.x) >= Math.abs(p.y - prev.y)
      ? { x: p.x, y: prev.y }    // 가로로 간다
      : { x: prev.x, y: p.y };   // 세로로 간다
  }
  function lastSegHoriz(pts) {
    var n = pts.length;
    if (n < 2) return true;
    return Math.abs(pts[n - 1].x - pts[n - 2].x) >= Math.abs(pts[n - 1].y - pts[n - 2].y);
  }
  // ---- 단자 정렬 가이드 ----
  // 찍으려는 점의 '자유 축'(직전 점에 묶이지 않은 쪽)을 가까운 단자에 맞춘다.
  // 예: 세로로 내려가는 중이면 x는 직전 점에 묶여 있고 y가 자유 → 근처 단자의 y에 흡착.
  // 그래야 다음 구간이 그 단자로 곧장 들어가고, 도착해서 한 번 더 꺾이는 일이 없다.
  var TERM_ALIGN_TOL = 8;
  var _alignGuide = null;   // { x1, y1, x2, y2 } — 흡착된 단자까지의 점선
  function alignToTerminal(prev, p) {
    _alignGuide = null;
    var horiz = Math.abs(p.x - prev.x) >= Math.abs(p.y - prev.y);
    var best = null;
    // 가로로 가는 중이면 자유 축은 x, 세로면 y
    function consider(pos) {
      if (!pos) return;
      var d = horiz ? Math.abs(pos.x - p.x) : Math.abs(pos.y - p.y);
      if (d <= TERM_ALIGN_TOL && (!best || d < best.d)) best = { d: d, pos: pos };
    }
    WE.model.project.components.forEach(function (c) {
      (c.terminals || []).forEach(function (t) {
        consider(WE.geometry.wireEndpoint({ componentId: c.id, terminalId: t.id }));
      });
    });
    // 기존 배선의 꺾임점·접점에도 맞춘다 — 단자만큼이나 자주 기준이 되는 자리다.
    // (경로의 양 끝은 단자나 접점이라 위에서 이미 봤거나 여기서 함께 걸린다)
    WE.model.project.wires.forEach(function (w) {
      var pts = WE.geometry.wireRoutePoints(w);
      if (!pts) return;
      for (var i = 1; i < pts.length - 1; i++) consider(pts[i]);
      if (w.from && w.from.wireId) consider(pts[0]);
      if (w.to && w.to.wireId) consider(pts[pts.length - 1]);
    });
    if (!best) return p;
    var out = horiz ? { x: best.pos.x, y: p.y } : { x: p.x, y: best.pos.y };
    _alignGuide = { x1: out.x, y1: out.y, x2: best.pos.x, y2: best.pos.y };
    return out;
  }

  // 커서 아래에 있는 '기존 배선' 찾기 — 분기(다른 배선 중간에 물리기)용.
  // 그리는 중인 배선 자신과, 이미 이 배선을 호스트로 삼은 것은 후보에서 뺀다(순환 방지).
  var BRANCH_HIT = 7;
  function wireUnder(p, excludeId) {
    var best = null;
    WE.model.project.wires.forEach(function (w) {
      if (w.id === excludeId) return;
      var pts = WE.geometry.wireRoutePoints(w);
      if (!pts || pts.length < 2) return;
      var q = WE.geometry.projectOnPath(pts, p);
      if (!q) return;
      var d = Math.hypot(q.x - p.x, q.y - p.y);
      // 겹친 선에서는 가장 가까운 것, 같으면 나중에 그려진(위에 있는) 것
      if (d <= BRANCH_HIT && (!best || d <= best.d)) best = { d: d, wire: w, pos: q };
    });
    return best;
  }

  // 그리는 중인 배선의 전체 경로. 미리보기와 실제 생성이 같은 함수를 쓰므로
  // "보이는 대로 만들어진다"가 보장된다.
  //   toTerminal=true → 끝점이 단자다. 축이 어긋나면 모서리를 하나 끼워 ㄱ자로 맞춘다
  //                     (단자 위치는 우리가 못 정하니, 마지막 구간이 대각선이 되는 걸 여기서 막는다)
  // 그리기 시작점의 좌표. 단자에서 시작했을 수도, 기존 배선 위에서 시작했을 수도 있다.
  function pendStartPos(pend) {
    var r = pend.from;
    if (r.wireId) {
      var host = WE.model.getWire(r.wireId);
      var pts = host && WE.geometry.wireRoutePoints(host);
      return (pts && WE.geometry.projectOnPath(pts, r)) || { x: r.x, y: r.y };
    }
    return WE.geometry.wireEndpoint(r);
  }

  // 지금까지 확정된 마지막 점 (시작점 또는 마지막 꺾임점)
  function pendPrev(pend) {
    if (pend.waypoints.length) return pend.waypoints[pend.waypoints.length - 1];
    return pendStartPos(pend);
  }

  // 배선 위에서 시작할 땐 첫 구간을 호스트와 '수직'으로 내보낸다.
  // 안 그러면 호스트를 따라 나란히 겹쳐 나가는 선이 생겨 어느 선인지 구분이 안 된다.
  // 첫 걸음도 여느 점과 똑같이 '커서가 더 많이 벗어난 축'을 따른다.
  //
  // 예전엔 시작한 배선과 수직인 축으로 첫 걸음을 못박았는데, 꺾임점에서 시작하면
  // 그 자리는 두 구간이 만나는 곳이라 어느 구간을 기준으로 삼느냐가 자의적이었다.
  // 결과적으로 한쪽 방향이 길이 0이 되어 미리보기가 아예 안 보였다
  // (꺾임점을 한 번 더 찍어야 잠금이 풀려 그제야 보였다).
  // 축을 강제하지 않아도 수직으로 움직이면 수직으로 붙으므로 의도는 그대로 살아 있다.
  function firstStepLock(pend, prev, target) {
    return axisLock(prev, target);
  }

  // 단자에 들어가는 마지막 구간이 가로여야 하는가.
  // 기준은 단자가 붙은 '면'이다 — 옆면(L/R) 단자는 가로로, 위/아래(T/B) 면은 세로로 들어가야
  // 부품에 제대로 꽂힌 것처럼 보인다. 부품 회전·수동 고정(labelSide)까지 반영된 값을 쓴다.
  //
  // 예전엔 직전 구간의 방향만 보고 번갈아 꺾었다. 그래서 세로로 내려오다 옆면 단자를 찍으면
  // '왼쪽으로 갔다가 아래로' 꺾여 단자 위에서 수직으로 꽂히는 선이 나왔다.
  // 면을 모를 때만 예전 규칙으로 돌아간다.
  function arrivesHoriz(pts, termRef) {
    if (termRef) {
      var cmp = WE.model.getComponent(termRef.cmpId);
      var t = cmp && WE.model.getTerminal(cmp, termRef.tid);
      if (cmp && t) {
        var side = WE.geometry.termSideScreen(cmp, t);
        return side === "L" || side === "R";
      }
    }
    return lastSegHoriz(pts);
  }

  // mode: "free"(빈 곳) | "terminal"(단자에서 끝) | "branch"(다른 배선에 물려 끝)
  // termRef: 단자로 끝날 때의 { cmpId, tid } — 마지막 구간을 그 단자의 면에 맞추는 데 쓴다
  function wireDraftPath(pend, target, mode, termRef) {
    var a = pendStartPos(pend);
    if (!a) return null;
    var pts = [a].concat(pend.waypoints);
    var prev = pts[pts.length - 1];
    if (mode === "free") { pts.push(alignToTerminal(prev, firstStepLock(pend, prev, target))); return pts; }
    _alignGuide = null;   // 끝점에 붙는 순간엔 가이드가 필요 없다
    // 분기는 접점이 호스트 선 위를 미끄러질 수 있으므로 모서리를 끼우지 않는다.
    // 들어온 방향 그대로 선에 닿게 하는 게 맞다(끼우면 접점 직전에 쓸데없이 한 번 꺾인다).
    // 단자는 위치가 고정이라 축이 어긋나면 모서리가 꼭 필요하다.
    if (mode === "terminal" && pend.waypoints.length &&
        target.x !== prev.x && target.y !== prev.y) {
      pts.push(arrivesHoriz(pts, termRef) ? { x: prev.x, y: target.y } : { x: target.x, y: prev.y });
    }
    pts.push(target);
    return pts;
  }

  // 분기 대상 찾기 — 커서를 그대로 쓰지 않고 '축에 맞춘 점'으로 찾는다.
  // 세로로 내려오는 중이면 x가 직전 점에 묶여 있으므로, 그 x선이 호스트와 만나는 자리가
  // 접점이 된다 → 들어온 방향 그대로 선에 닿고 꺾임이 생기지 않는다.
  // 배선 위에서 '시작'할 자리 찾기. 꺾임점(경로의 꼭짓점) 근처면 정확히 그 점으로 붙인다 —
  // 사용자가 눈으로 볼 수 있는 점이 그것뿐이라, 거기서 시작하고 싶어 하는 경우가 많다.
  var VERTEX_SNAP = 10;
  function branchStartAt(p) {
    var hit = wireUnder(p, null);
    if (!hit) return null;
    var pts = WE.geometry.wireRoutePoints(hit.wire) || [];
    var pos = hit.pos, best = VERTEX_SNAP;
    pts.forEach(function (v) {
      var d = Math.hypot(v.x - p.x, v.y - p.y);
      if (d < best) { best = d; pos = { x: v.x, y: v.y }; }
    });
    return { wire: hit.wire, pos: pos };
  }

  function branchTargetAt(pend, p) {
    if (!pend) return null;
    var prev = pendPrev(pend);
    if (!prev) return null;
    var hit = wireUnder(axisLock(prev, p), null);
    return hit ? { wire: hit.wire, pos: hit.pos } : null;
  }

  // 배선 모드
  //   단자 → 단자        : 예전 그대로 자동배선(최적 경로를 알아서 잡음)
  //   단자 → 빈 곳 클릭… : 클릭한 자리마다 꺾임점이 생기고, 수평/수직으로만 이어진다(수동배선)
  // 빈 곳 클릭이 예전엔 '취소'였다 → 이제 점 찍기다. 취소는 Esc·우클릭, 한 점 무르기는 Backspace.
  function onWireDown(e) {
    var p = WE.geometry.clientToCanvas(svg, e.clientX, e.clientY);
    var hit = nearestTerminal(p, SNAP_DIST);
    if (hit) {
      if (!wirePending) {
        wirePending = { from: { componentId: hit.cmpId, terminalId: hit.tid }, waypoints: [] };
      } else if (!(wirePending.from.componentId === hit.cmpId && wirePending.from.terminalId === hit.tid)) {
        var w = WE.model.addWireRef(wirePending.from,
          { componentId: hit.cmpId, terminalId: hit.tid });
        if (w) {
          if (wirePending.waypoints.length) {
            // 미리보기와 같은 계산을 써서 보이던 그대로 만든다(끝 모서리 보정 포함).
            // 점들은 이미 수평·수직으로만 찍히므로 여느 수동배선과 똑같이 다뤄진다
            // (구간 드래그·꺾임점 편집·부품 따라오기가 전부 그대로 동작).
            var path = wireDraftPath(wirePending, hit.pos, "terminal", hit);
            // 일직선 위에 겹쳐 놓인 점은 지운다 — 마무리 모서리를 끼우면서 직전 점과
            // 한 줄이 되는 경우가 생기는데, 그대로 두면 잡을 게 없는 꺾임점 손잡이만 남는다
            if (path) path = WE.geometry.simplify(path);
            w.waypoints = path ? path.slice(1, -1) : wirePending.waypoints;
          }
          if (WE.app.trackOnce) WE.app.trackOnce("create_wire");
        }
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
    // 아직 아무것도 안 그리는 중 + 기존 배선 클릭 → 그 배선에서 새 배선을 시작
    // (단자와 같은 규칙: 그리는 중이 아니면 '시작', 그리는 중이면 '끝')
    if (!wirePending) {
      var st = branchStartAt(p);
      if (st) {
        wirePending = { from: { wireId: st.wire.id, x: st.pos.x, y: st.pos.y }, waypoints: [] };
        updateWirePreview(p);
        e.preventDefault();
      }
      return;
    }

    // 기존 배선 위를 클릭 → 그 배선에 물리는 분기로 마무리
    var host = branchTargetAt(wirePending, p);
    if (host && wirePending) {
      var bp = wireDraftPath(wirePending, host.pos, "branch");
      var wb = WE.model.addWireRef(wirePending.from,
        { wireId: host.wire.id, x: host.pos.x, y: host.pos.y });
      if (wb && bp) wb.waypoints = WE.geometry.simplify(bp).slice(1, -1);
      wirePending = null;
      WE.render.clearWirePreview();
      WE.render.renderWires();
      WE.model.select("wire", wb.id);
      WE.app.refreshProps();
      if (WE.app.trackOnce) WE.app.trackOnce("create_branch");
      e.preventDefault();
      return;
    }

    // 단자 없는 빈 곳 클릭 → 꺾임점 추가 (시작 단자를 아직 안 골랐으면 아무 일도 없음)
    if (wirePending) {
      var path = wireDraftPath(wirePending, { x: snapVal(p.x), y: snapVal(p.y) }, "free");
      if (path) wirePending.waypoints.push(path[path.length - 1]);
      updateWirePreview(p);
      e.preventDefault();
    }
  }

  // 그리던 배선 버리기 (Esc·우클릭)
  function cancelWireDraw() {
    if (!wirePending) return false;
    wirePending = null;
    WE.render.clearWirePreview();
    return true;
  }
  // 마지막에 찍은 점 하나만 무르기 (Backspace) — 점이 없으면 전체 취소와 같다
  function undoWirePoint() {
    if (!wirePending) return false;
    if (!wirePending.waypoints.length) return cancelWireDraw();
    wirePending.waypoints.pop();
    updateWirePreview(WE.geometry.clientToCanvas(svg, lastX, lastY));
    return true;
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
  // 분기 접점과 같은 자리에 겹친 양 끝 꺾임점 제거 (길이 0인 구간 정리)
  function dropWaypointsOnBranchAnchor(w) {
    var wps = w.waypoints;
    if (!wps || !wps.length) return;
    function same(p, ref) {
      return ref && ref.wireId && Math.abs(p.x - ref.x) < 0.5 && Math.abs(p.y - ref.y) < 0.5;
    }
    while (wps.length && same(wps[wps.length - 1], w.to)) wps.pop();
    while (wps.length && same(wps[0], w.from)) wps.shift();
  }

  // 배선 경로를 직각으로 정리해 waypoints 갱신
  function cleanupWire(w) {
    var pts = WE.geometry.wireRoutePoints(w);
    if (!pts) return;
    w.waypoints = orthogonalize(pts).slice(1, -1);
  }

  // ---- 부품 이동 시 수동배선(정렬된 배선) 따라오게 하기 ----
  // 방향키 이동 — 선택된 부품·주석을 함께 옮긴다.
  // 되돌리기는 history의 주기 커밋(700ms)이 알아서 묶어 주므로 키를 누를 때마다 쌓지 않는다.
  var ARROW_DELTA = {
    ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1]
  };
  function nudgeSelection(dx, dy) {
    var sel = WE.model.getSelection() || {};
    var comps = (WE.model.getMulti() || []).slice();
    var annos = (WE.model.getMultiAnno() || []).slice();
    if (sel.type === "component" && comps.indexOf(sel.id) < 0) comps.push(sel.id);
    if (sel.type === "annotation" && annos.indexOf(sel.id) < 0) annos.push(sel.id);
    if (!comps.length && !annos.length) return false;

    var follow = beginWireFollow(comps);
    var bFollow = beginBranchFollow(comps);
    comps.forEach(function (id) {
      var c = WE.model.getComponent(id); if (!c) return;
      c.x += dx; c.y += dy;
      WE.render.updateComponent(c);
    });
    annos.forEach(function (id) {
      var a = WE.model.getAnnotation(id); if (!a) return;
      a.x += dx; a.y += dy;
    });
    applyWireFollow(follow, dx, dy);
    applyBranchFollow(bFollow, dx, dy);
    if (comps.length) WE.render.updateWiresFor(comps[0]);
    if (annos.length) WE.render.renderAnnotations();
    WE.render.renderOverlay();
    return true;
  }

  // ---- 단자가 움직일 때 반대쪽 분기 접점도 함께 미끄러뜨리기 ----
  // 부품을 옮기면 단자는 따라가는데 접점은 제자리에 남아, 곧던 선이 ㄱ자로 꺾였다.
  // 꺾임점이 없는 배선(단자 → 접점 한 줄)도 반드시 포함해야 한다 —
  // beginWireFollow는 '수동배선만' 보기 때문에 이런 배선이 통째로 빠져 있었고,
  // 사실 그런 배선이 가장 흔하다(버스에 물린 전원선 등).
  // 어떤 배선이 '통째로' 함께 움직이는지 미리 가려낸다.
  // 접점은 부품이 아니라 다른 배선 위에 얹혀 있어서 componentId 가 없다. 그래서 끝이 움직이는지를
  // '움직이는 부품에 붙었는가'로만 판정하면 접점 쪽 끝은 언제나 '안 움직임'이 되고,
  // 전체를 함께 옮길 때 배선이 평행이동하지 못한 채 접점만 옛 자리에 남아 도면 밖까지 늘어난다.
  // '호스트 배선이 움직이면 그 위의 접점도 움직인다'를 더 바뀔 게 없을 때까지 반복 적용한다
  // (분기에 분기가 걸린 경우까지 따라가기 위해서다).
  function movingEnds(cmpIds) {
    var set = {}; (cmpIds || []).forEach(function (id) { set[id] = 1; });
    var wires = WE.model.project.wires;
    var moving = {};                       // 배선id → 양 끝이 모두 움직이는가
    function endMoves(ref) {
      if (!ref) return false;
      if (ref.componentId) return !!set[ref.componentId];
      if (ref.wireId) return !!moving[ref.wireId];
      return false;
    }
    for (var pass = 0; pass <= wires.length; pass++) {
      var changed = false;
      wires.forEach(function (w) {
        if (moving[w.id]) return;
        if (endMoves(w.from) && endMoves(w.to)) { moving[w.id] = 1; changed = true; }
      });
      if (!changed) break;
    }
    return { endMoves: endMoves, moving: moving, set: set };
  }

  function beginBranchFollow(cmpIds) {
    var mv = movingEnds(cmpIds), set = mv.set;
    var arr = [];
    WE.model.project.wires.forEach(function (w) {
      ["from", "to"].forEach(function (k) {
        var ref = w[k], other = w[k === "from" ? "to" : "from"];
        if (!ref || !ref.wireId) return;                             // 이 끝이 분기여야
        var hostMoves = !!mv.moving[ref.wireId];                     // 얹혀 있는 배선도 함께 움직이나
        var otherMoves = !!(other && other.componentId && set[other.componentId]);
        if (!hostMoves && !otherMoves) return;
        var t0 = otherMoves ? WE.geometry.wireEndpoint(other) : null;
        arr.push({
          w: w, key: k, hostMoves: hostMoves,
          t0: t0 ? { x: t0.x, y: t0.y } : null,
          a0: { x: ref.x, y: ref.y },
          seg0: ref.seg ? { axis: ref.seg.axis, coord: ref.seg.coord } : null
        });
      });
    });
    return arr;
  }
  function applyBranchFollow(snap, dx, dy) {
    var shift = (typeof dx === "number" && typeof dy === "number");
    (snap || []).forEach(function (f) {
      var ref = f.w[f.key];
      // 호스트까지 같은 양만큼 움직이는 경우엔 접점도 그대로 평행이동하면 끝이다.
      // 이때 다시 투영하면 안 된다 — 기억해 둔 구간 좌표(seg.coord)는 '이동 전' 값이라
      // 옮겨진 호스트에서는 엉뚱한 평행 구간이 더 가까워지고, 접점이 그쪽으로 붙어
      // 옛 자리에 눌러앉는다(전체 이동인데 분기 배선만 제자리에 남는 증상).
      if (f.hostMoves && shift) {
        ref.x = f.a0.x + dx; ref.y = f.a0.y + dy;
        if (ref.seg && f.seg0) ref.seg.coord = f.seg0.coord + (f.seg0.axis === "v" ? dx : dy);
        return;
      }
      var host = WE.model.getWire(ref.wireId);
      var pts = host && WE.geometry.wireRoutePoints(host);
      if (!pts) return;
      var wps = f.w.waypoints || [];
      if (wps.length) {
        // 꺾임점이 있는 배선은 접점 바로 옆 꺾임점을 호스트에 투영해서 자리를 잡는다.
        // 단자가 움직인 거리를 접점에 그대로 더하면 안 된다 — 접점 쪽 구간은 제자리인데
        // 접점만 끌려가 마지막 구간이 대각선이 되고, 직각 보정이 모서리를 끼워 넣어
        // 선이 목표를 지나쳐 위로 쭉 튀었다가 되돌아온다.
        // 접점 옆 꺾임점이 실제로 움직인 경우(단자와 맞닿은 꺾임점)에는 이 투영이
        // 곧 따라간 결과가 되므로, 두 경우가 한 규칙으로 처리된다.
        var near = (f.key === "from") ? wps[0] : wps[wps.length - 1];
        var q0 = WE.geometry.placeOnHost(ref, pts, near);
        if (q0) { ref.x = q0.x; ref.y = q0.y; }
        return;
      }
      // 꺾임점이 없는 배선은 단자와 접점이 한 구간으로 곧장 이어져 있다.
      // 이때는 단자가 움직인 만큼 접점도 따라가야 수평/수직이 유지된다
      // (세로 버스에 물린 수평 배선이면 x는 버스에 고정되고 y만 따라간다).
      var other = f.w[f.key === "from" ? "to" : "from"];
      var t1 = f.t0 ? WE.geometry.wireEndpoint(other) : null;
      // 반대쪽 단자가 움직이지 않는 경우(호스트만 움직임)엔 옮길 기준이 없으니 제자리에서 다시 잡는다
      var q = t1
        ? WE.geometry.placeOnHost(ref, pts, { x: f.a0.x + (t1.x - f.t0.x), y: f.a0.y + (t1.y - f.t0.y) })
        : WE.geometry.placeOnHost(ref, pts, null);
      if (q) { ref.x = q.x; ref.y = q.y; }
    });
  }

  // 이동 시작 시 연결된 수동배선의 원본 꺾임점·단자위치를 스냅샷
  function beginWireFollow(movingIds) {
    var mv = movingEnds(movingIds);
    var arr = [];
    WE.model.project.wires.forEach(function (w) {
      if (!w.waypoints || !w.waypoints.length) return;   // 수동배선만
      // 접점으로 물린 끝도 '호스트가 움직이면 함께 움직인다'로 본다 —
      // 이게 없으면 분기 배선은 끝 꺾임점 하나만 따라오고 몸통은 제자리에 남는다.
      var fromMoving = mv.endMoves(w.from), toMoving = mv.endMoves(w.to);
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
  // ---- 크기·배율·회전으로 '단자가 움직일 때' 수동배선 따라오게 하기 ----
  // 이동(move)과 나눠 둔 이유: 이동은 모든 단자가 같은 양만큼 움직여 dx·dy 하나면 되지만,
  // 크기·회전은 단자마다 이동량이 달라 끝점별로 각자 계산해야 한다.
  // 이게 없으면 단자만 움직이고 꺾임점은 제자리에 남아, 직각 정리가 끼어들며 선이 위로 튄다.
  function beginTermFollow(cmpIds) {
    var set = {}; (cmpIds || []).forEach(function (id) { set[id] = 1; });
    var arr = [];
    WE.model.project.wires.forEach(function (w) {
      if (!w.waypoints || !w.waypoints.length) return;   // 수동배선만(자동배선은 알아서 다시 잡힌다)
      var fromIn = !!(w.from.componentId && set[w.from.componentId]);
      var toIn = !!(w.to.componentId && set[w.to.componentId]);
      if (!fromIn && !toIn) return;
      arr.push({
        w: w, fromIn: fromIn, toIn: toIn,
        a0: fromIn ? WE.geometry.wireEndpoint(w.from) : null,
        b0: toIn ? WE.geometry.wireEndpoint(w.to) : null,
        orig: w.waypoints.map(function (p) { return { x: p.x, y: p.y }; })
      });
    });
    return arr;
  }
  function applyTermFollow(snap) {
    (snap || []).forEach(function (f) {
      var wp = f.w.waypoints, n = wp.length;
      if (!n) return;
      if (f.fromIn && f.a0) {
        var a1 = WE.geometry.wireEndpoint(f.w.from);
        if (a1) followEnd(wp[0], f.orig[0], f.a0, a1.x - f.a0.x, a1.y - f.a0.y);
      }
      if (f.toIn && f.b0) {
        var b1 = WE.geometry.wireEndpoint(f.w.to);
        if (b1) followEnd(wp[n - 1], f.orig[n - 1], f.b0, b1.x - f.b0.x, b1.y - f.b0.y);
      }
    });
  }
  // 단자가 움직이는 변경을 감싸 실행한다 (크기·배율·회전 공용)
  function withTermFollow(cmpIds, mutate) {
    var snap = beginTermFollow(cmpIds);
    var bSnap = beginBranchFollow(cmpIds);
    mutate();
    applyTermFollow(snap);
    applyBranchFollow(bSnap);
  }

  function followEnd(wpPt, origPt, term0, dx, dy) {
    // 단자-인접 세그먼트가 수평이면 y를, 수직이면 x를 단자와 함께 이동(방향 유지)
    var horiz = Math.abs(term0.y - origPt.y) <= Math.abs(term0.x - origPt.x);
    if (horiz) { wpPt.x = origPt.x; wpPt.y = origPt.y + dy; }
    else { wpPt.x = origPt.x + dx; wpPt.y = origPt.y; }
  }

  function segIsHoriz(pts, i) {
    return Math.abs(pts[i].y - pts[i + 1].y) <= Math.abs(pts[i].x - pts[i + 1].x);
  }
  // 원하는 방향의 가장 긴 구간 (클릭 지점이 없는 배선의 대체 기준)
  function longestSegIndex(pts, wantHoriz) {
    var best = -1, bestLen = -1;
    for (var i = 0; i < pts.length - 1; i++) {
      if (wantHoriz != null && segIsHoriz(pts, i) !== wantHoriz) continue;
      var len = Math.abs(pts[i].x - pts[i + 1].x) + Math.abs(pts[i].y - pts[i + 1].y);
      if (len > bestLen) { bestLen = len; best = i; }
    }
    return best;
  }
  // 한 배선에서 이동 대상 구간을 확정하고 waypoint 인덱스 쌍으로 돌려준다.
  // pt = 그 배선에서 클릭한 지점(없으면 같은 방향 최장 구간). wantHoriz = 맞춰야 할 방향(null이면 자유)
  // 클릭 지점 우선, 없거나 방향이 안 맞으면 원하는 방향의 최장 구간
  function pickSegIndex(pts, pt, wantHoriz) {
    var seg = pt ? segIndexAt(pts, pt) : -1;
    if (seg >= 0 && wantHoriz != null && segIsHoriz(pts, seg) !== wantHoriz) seg = -1;
    return seg < 0 ? longestSegIndex(pts, wantHoriz) : seg;
  }
  function prepWireSeg(w, pt, wantHoriz) {
    var pts = WE.geometry.wireRoutePoints(w);
    if (!pts || pts.length < 2) return null;
    // 대상 구간이 있는지 먼저 판정한다. 여기서 걸러질 배선은 건드리지 않는다 —
    // waypoints를 채우는 순간 자동배선이 수동배선으로 바뀌어(너징·자동 최적경로 상실)
    // 실제로 움직이지도 않을 배선이 망가진다.
    if (pickSegIndex(pts, pt, wantHoriz) < 0) return null;

    if (!w.waypoints || !w.waypoints.length) {
      w.waypoints = pts.slice(1, -1).map(function (p) { return { x: p.x, y: p.y }; });
    }
    cleanupWire(w);   // 잡는 순간 대각선을 직각으로 정리
    var full = WE.geometry.wireRoutePoints(w);   // [a0, ...waypoints, b0]
    if (!full || full.length < 2) return null;
    // cleanup으로 점 구성이 바뀌었을 수 있으니 정리된 경로에서 다시 판정
    var seg = pickSegIndex(full, pt, wantHoriz);
    if (seg < 0) return null;
    var isHoriz = segIsHoriz(full, seg);
    var W = w.waypoints, last = full.length - 1, wpi1, wpi2;
    if (seg === 0) {                              // a0 → 첫 waypoint: 단자쪽 복제 삽입
      W.unshift({ x: full[0].x, y: full[0].y }); wpi1 = 0; wpi2 = 1;
    } else if (seg === last - 1) {                // 마지막 waypoint → b0
      W.push({ x: full[last].x, y: full[last].y }); wpi1 = W.length - 2; wpi2 = W.length - 1;
    } else {                                       // 내부 세그먼트
      wpi1 = seg - 1; wpi2 = seg;
    }
    if (!W[wpi1] || !W[wpi2]) return null;
    return { wireId: w.id, isHoriz: isHoriz, wpi1: wpi1, wpi2: wpi2, baseX: W[wpi1].x, baseY: W[wpi1].y };
  }

  // 드래그 시작 시: 자동 경로를 waypoint로 고정하고 잡은 세그먼트를 계산해 wseg로 전환.
  // 다중 선택 상태면 같은 방향 구간을 가진 나머지 배선도 함께 잡는다(간격 유지 평행이동).
  function beginWireSeg(wid, startClientX, startClientY) {
    var w = WE.model.getWire(wid); if (!w) { drag = null; return; }
    var p = WE.geometry.clientToCanvas(svg, startClientX, startClientY);
    var anchor = prepWireSeg(w, p, null);
    if (!anchor) { drag = null; return; }

    // 함께 이동할 배선 = 다중 선택된 것 + 잡은 배선과 같은 다발(bundleId)의 전체.
    // → 다발은 하나만 잡아도 통째로 움직인다(겹쳐 있으므로 같은 이동량이면 겹친 채 유지).
    var moveIds = {};
    (WE.model.getMultiWire() || []).forEach(function (id) { moveIds[id] = 1; });
    var bundles = {};
    if (w.bundleId) bundles[w.bundleId] = 1;
    Object.keys(moveIds).forEach(function (id) {
      var mw = WE.model.getWire(id); if (mw && mw.bundleId) bundles[mw.bundleId] = 1;
    });
    WE.model.project.wires.forEach(function (ow) {
      if (ow.bundleId && bundles[ow.bundleId]) moveIds[ow.id] = 1;
    });

    var items = [anchor];
    Object.keys(moveIds).forEach(function (id) {
      if (id === wid) return;
      var ow = WE.model.getWire(id); if (!ow) return;
      // 각 배선에서 Ctrl+클릭했던 지점 기준. 방향이 다른 구간은 함께 옮기지 않는다.
      var it = prepWireSeg(ow, WE.model.getWireClickPt(id), anchor.isHoriz);
      if (it) items.push(it);
    });

    drag = {
      mode: "wseg", wireId: wid, isHoriz: anchor.isHoriz, wpi1: anchor.wpi1, wpi2: anchor.wpi2,
      baseX: anchor.baseX, baseY: anchor.baseY, items: items,
      startX: startClientX, startY: startClientY
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

  // 부품의 단자 이름 라벨을 자동 배치로 되돌린다. 하나라도 되돌렸으면 true.
  // 손으로 옮긴 위치(labelPos)와 손으로 고정한 변(labelSide)을 함께 푼다 —
  // 사용자에게 '원래대로'는 하나지, 둘로 나뉘어 있지 않다.
  function resetTermLabels(cmp) {
    var changed = false;
    (cmp.terminals || []).forEach(function (t) {
      if (t.labelPos) { delete t.labelPos; changed = true; }
      if (t.labelSide) { delete t.labelSide; changed = true; }
    });
    return changed;
  }

  // 더블클릭 대상 찾기.
  //
  // e.target을 그대로 쓰면 안 된다 — pointerdown에서 svg.setPointerCapture()를 걸기 때문에
  // 이후 click·dblclick의 대상이 캡처한 요소(svg)로 재지정된다. 그래서 closest(...)가 전부
  // 빗나갔고, 더블클릭 기능(배선 자동경로 복귀 등)이 통째로 죽어 있었다.
  // 좌표로 다시 조회해 실제로 그 자리에 있는 요소를 찾는다.
  function dblTarget(e, sel) {
    var direct = e.target && e.target.closest && e.target.closest(sel);
    if (direct) return direct;
    var el = document.elementFromPoint(e.clientX, e.clientY);
    return el && el.closest ? el.closest(sel) : null;
  }

  function onDblClick(e) {
    // 배선 라벨(수축튜브) 더블클릭 → 문구 수정 (비우면 라벨 삭제)
    var wtube = dblTarget(e, "[data-wire-label-for]");
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
    // 배선 더블클릭은 일부러 두지 않는다.
    // 예전에 '자동 경로로 초기화'가 있었으나 포인터 캡처 때문에 실제로는 한 번도 동작하지 않았고,
    // 이제 클릭으로 경로를 직접 찍는 방식이 주가 되면서 실수 한 번에 그 경로가 통째로 날아가는
    // 위험만 남는다. 자동으로 되돌리려면 꺾임점을 지우면 된다.
    // 부품 더블클릭 → 단자 이름 위치를 자동 배치로 되돌린다.
    // '더블클릭 = 자동 배치로 되돌리기'는 배선(자동 경로 복귀)과 같은 규칙이다.
    // 라벨 글자는 13x9px밖에 안 돼 정확히 두 번 누르기 어려우므로, 부품 전체를 대상으로 삼는다.
    var cmpEl = dblTarget(e, ".component");
    if (cmpEl) {
      var dc = WE.model.getComponent(cmpEl.getAttribute("data-id"));
      if (dc && resetTermLabels(dc)) {
        WE.render.rerenderComponent(dc);
        WE.render.renderOverlay();
        WE.history.commit();
        if (WE.app.setHint) WE.app.setHint(WE.i18n.t("단자 이름 위치를 원래대로 되돌렸습니다."));
      }
      return;
    }

    var annoEl = dblTarget(e, "[data-anno-id]");
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
      var sp0 = WE.geometry.clientToCanvas(svg, drag.startX, drag.startY);
      var sp1 = WE.geometry.clientToCanvas(svg, e.clientX, e.clientY);
      // 잡은 구간(앵커)이 그리드에 맞도록 '이동량'을 정하고, 나머지는 같은 이동량을 그대로 적용
      // → 앵커는 그리드 정렬, 선택된 배선끼리의 픽셀 간격은 정확히 보존
      var d = drag.isHoriz
        ? snapVal(drag.baseY + (sp1.y - sp0.y)) - drag.baseY
        : snapVal(drag.baseX + (sp1.x - sp0.x)) - drag.baseX;
      drag.items.forEach(function (it) {
        var w2 = WE.model.getWire(it.wireId); if (!w2) return;
        var W2 = w2.waypoints;
        if (!W2 || !W2[it.wpi1] || !W2[it.wpi2]) return;
        if (drag.isHoriz) { W2[it.wpi1].y = W2[it.wpi2].y = it.baseY + d; }
        else { W2[it.wpi1].x = W2[it.wpi2].x = it.baseX + d; }
        // 분기 배선이면 접점도 호스트를 타고 함께 미끄러지게 한다.
        // 드래그 '중'에만 부른다 — 시작 시점(cleanupWire)에 부르면 손대기 전에 접점이 튄다.
        WE.geometry.syncBranchAnchors(w2);
      });
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
      applyBranchFollow(drag.branchFollow, snapVal(gdx), snapVal(gdy));
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
      applyTermFollow(drag.termFollow);
      applyBranchFollow(drag.branchFollow);
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

    // Shift + 이동 = 수평/수직으로만 (PPT·피그마 관례).
    // 정렬해 둔 부품을 줄에서 벗어나지 않게 옮길 때 쓴다. 더 많이 움직인 축만 남긴다.
    if (e.shiftKey && drag.mode === "move") {
      if (Math.abs(dx) >= Math.abs(dy)) dy = 0; else dx = 0;
    }

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
      applyBranchFollow(drag.branchFollow, cmp.x - drag.orig.x, cmp.y - drag.orig.y);
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

    if (drag.mode === "resize") { applyTermFollow(drag.termFollow); applyBranchFollow(drag.branchFollow); }
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
        var origin = { x: drag.ox, y: drag.oy };   // 드래그 시작점(캔버스 좌표) = 기준선 판별용
        if (drag.sweep) {
          // 종횡비 2:1 이상이면 짧은 축과 나란한 선만 골라잡는다(가로로 길면 세로선)
          var R = 2, r = drag.rect, dir = null;
          if (r.w >= r.h * R) dir = "v";
          else if (r.h >= r.w * R) dir = "h";
          applyMarquee(r, { wiresOnly: true, dirFilter: dir, origin: origin });
        } else {
          applyMarquee(drag.rect, { origin: origin });
        }
      } else if (!drag.sweep) {
        // 헛클릭(움직임 거의 없음) → 선택 해제. 단 쓸어담기(Ctrl) 중엔 유지(실수로 다 날리는 것 방지)
        WE.model.clearSelection(); WE.render.renderOverlay(); WE.app.refreshProps();
      }
    }
    // 배선 번호 라벨 드래그 종료 → 정렬 가이드선 정리
    if (drag.mode === "wlabel") {
      WE.render.setWireLabelGuide(null);
    }
    // 배선 세그먼트 드래그 종료 → 다른 배선과 겹치면 옆 레인으로 자동 회피
    // (다중 이동은 제외 — 사용자가 의도적으로 잡은 묶음 간격을 자동 회피가 흐트러뜨리므로)
    if (drag.mode === "wseg" && (!drag.items || drag.items.length < 2)) {
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
    // 구간 드래그가 끝나면 접점 위에 겹쳐 남은 꺾임점을 정리한다.
    // prepWireSeg가 끝단 구간을 잡을 때 끝점 복사본을 꺾임점으로 하나 끼워 넣는데,
    // 접점이 그 점을 따라 움직이고 나면 둘이 같은 자리가 되어 길이 0인 구간이 남는다.
    // 눈에는 안 보이지만 핸들이 접점 위에 겹쳐 다음 드래그를 방해한다.
    if (drag.mode === "wseg") {
      (drag.items || [{ wireId: drag.wireId }]).forEach(function (it) {
        var w2 = WE.model.getWire(it.wireId);
        if (w2) dropWaypointsOnBranchAnchor(w2);
      });
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
    // Ctrl/⌘+Shift+S → 다른 이름으로 저장. 반드시 아래 Ctrl+S보다 먼저 볼 것 —
    // Ctrl+S 분기는 Shift를 보지 않아서, 뒤에 두면 Shift 조합이 그냥 덮어쓰기로 새어 나간다.
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "s") {
      e.preventDefault();
      if (WE.store) WE.store.saveNow();
      if (WE.io) WE.io.saveAs();
      return;
    }
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

    // Ctrl/⌘+C · Ctrl/⌘+V — 선택한 부품·배선·주석을 그대로 복사해 다른 배선도로 가져오기.
    // 반드시 위 입력창 가드 **뒤에** 둘 것 — 이름·비고·BOM 칸에서는 평소대로 텍스트 복사가 되어야 한다.
    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "c") {
      if (WE.app.copySelection && WE.app.copySelection()) e.preventDefault();
      return;
    }
    // Ctrl+V 는 여기서 다루지 않는다 — app.js 의 paste 이벤트 한 곳에서 판단한다.
    // 클립보드 내용(이미지인지 아닌지)은 paste 이벤트에서만 볼 수 있고,
    // 여기서 먼저 붙여넣어 버리면 이미지가 왔을 때 두 번 처리된다.

    // 배선을 그리는 중이면 Esc·Backspace가 먼저다 — 모드 복귀보다 '그리던 것 정리'가 우선.
    // (Esc 한 번에 배선도 버리고 모드까지 빠져나가면 실수로 눌렀을 때 되돌리기 번거롭다)
    if (wirePending && (e.key === "Escape" || e.key === "Backspace" || e.key === "Delete")) {
      if (e.key === "Escape") cancelWireDraw(); else undoWirePoint();
      e.preventDefault(); return;
    }

    // 방향키로 선택한 부품·주석 미세 이동.
    //   그냥      → 그리드 한 칸 (스냅이 꺼져 있으면 1px)
    //   Shift 함께 → 1px — 그리드에서 살짝 벗어나게 두고 싶을 때
    // 드래그와 같은 경로를 타야 수동배선이 함께 따라온다(applyWireFollow).
    if (!e.ctrlKey && !e.metaKey && !e.altKey && ARROW_DELTA[e.key]) {
      var d = ARROW_DELTA[e.key];
      var cv = WE.model.project.meta.canvas;
      var step = e.shiftKey ? 1 : (cv.snap ? (cv.grid || 10) : 1);
      if (nudgeSelection(d[0] * step, d[1] * step)) { e.preventDefault(); return; }
    }

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

    // Shift+C → 부품 라이브러리 폴더 전체 접기/펼치기.
    // 반드시 아래 '사용자 지정 단축키'보다 먼저 볼 것 — handleShortcut은 e.key를 소문자로 바꿔
    // 비교하므로, 사용자가 모드 단축키를 'c'로 잡아 두면 Shift+C가 그쪽으로 먼저 새어 나간다.
    if (e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === "c") {
      if (WE.app.toggleAllFolders) WE.app.toggleAllFolders();
      e.preventDefault(); return;
    }

    // 사용자 지정 단축키(모드 전환 등, 조합키 없을 때)
    // e.repeat 를 거르는 이유: 모드 키는 '다시 누르면 선택으로' 토글이라,
    // 키를 꾹 누르고 있으면 자동 반복이 들어와 모드가 깜빡인다. 모드 키를 길게 누를 일은 없다.
    // wirePending 이면 토글을 막는다 — 그리던 배선을 잃지 않게(취소는 Esc 담당).
    if (!e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey &&
        WE.app.handleShortcut && WE.app.handleShortcut(e.key, !wirePending)) {
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
        // 꺾임점만 제거 → 이웃을 축에 맞춰 끌어당겨 꺾임을 흡수, 다 지우면 자동 최적경로로
        var np = WE.geometry.dissolveWaypoint(selWire, wp);
        if (np) selWire.waypoints = np;
        else { selWire.waypoints.splice(wp, 1); if (selWire.waypoints.length) cleanupWire(selWire); }
        WE.model.ui.selectedWp = null;
        WE.render.renderWires(); WE.render.renderOverlay(); WE.app.refreshProps();
        WE.history.commit();
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

  return { init: init, resetWire: resetWire, isBusy: isBusy, getLastPointer: getLastPointer,
           withTermFollow: withTermFollow, resetTermLabels: resetTermLabels };
})();
