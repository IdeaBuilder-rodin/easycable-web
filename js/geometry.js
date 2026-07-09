// geometry.js — 좌표 계산 유틸
var WE = window.WE || {};
window.WE = WE;

WE.geometry = (function () {
  // 그리드 스냅
  function snap(value, grid) {
    return Math.round(value / grid) * grid;
  }

  // 화면(clientX/Y) → SVG 캔버스 좌표 변환
  function clientToCanvas(svg, clientX, clientY) {
    var pt = svg.createSVGPoint();
    pt.x = clientX; pt.y = clientY;
    var ctm = svg.getScreenCTM();
    if (!ctm) return { x: clientX, y: clientY };
    var p = pt.matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  }

  // 부품 로컬 픽셀좌표(lx,ly) → 캔버스 절대좌표 (박스 중심 기준 회전 + 스케일)
  function localToAbs(cmp, lx, ly) {
    var s = cmp.scale, W = cmp.width, H = cmp.height;
    var cxAbs = cmp.x + W * s / 2, cyAbs = cmp.y + H * s / 2;
    var vx = (lx - W / 2) * s, vy = (ly - H / 2) * s;
    var rad = (cmp.rotation * Math.PI) / 180;
    var cos = Math.cos(rad), sin = Math.sin(rad);
    return { x: cxAbs + vx * cos - vy * sin, y: cyAbs + vx * sin + vy * cos };
  }

  // 단자 상대좌표(rx,ry 0~1) → 캔버스 절대좌표
  function terminalAbs(cmp, term) {
    return localToAbs(cmp, term.rx * cmp.width, term.ry * cmp.height);
  }

  // 캔버스 절대좌표 → 부품 로컬 상대좌표(rx,ry). terminalAbs의 역변환.
  function absToTerminal(cmp, pt) {
    var s = cmp.scale, W = cmp.width, H = cmp.height;
    var cxAbs = cmp.x + W * s / 2, cyAbs = cmp.y + H * s / 2;
    var vx = pt.x - cxAbs, vy = pt.y - cyAbs;
    var rad = (cmp.rotation * Math.PI) / 180;
    var cos = Math.cos(rad), sin = Math.sin(rad);
    var ux = (vx * cos + vy * sin) / s;   // R(-rad)
    var uy = (-vx * sin + vy * cos) / s;
    return { rx: (W / 2 + ux) / W, ry: (H / 2 + uy) / H };
  }

  // 부품 그룹의 SVG transform 문자열 (렌더/오버레이 공용)
  function transformString(cmp) {
    var s = cmp.scale, W = cmp.width, H = cmp.height;
    var cxAbs = cmp.x + W * s / 2, cyAbs = cmp.y + H * s / 2;
    return "translate(" + cxAbs + "," + cyAbs + ") rotate(" + cmp.rotation + ") scale(" + s +
      ") translate(" + (-W / 2) + "," + (-H / 2) + ")";
  }

  // 배선 끝점(단자)의 절대좌표. 없으면 null.
  function wireEndpoint(ref) {
    var cmp = WE.model.getComponent(ref.componentId);
    if (!cmp) return null;
    var t = WE.model.getTerminal(cmp, ref.terminalId);
    if (!t) return null;
    return terminalAbs(cmp, t);
  }

  // 단자 끝점 정보(부품/단자/절대좌표)
  function endpointFull(ref) {
    var cmp = WE.model.getComponent(ref.componentId); if (!cmp) return null;
    var t = WE.model.getTerminal(cmp, ref.terminalId); if (!t) return null;
    return { cmp: cmp, t: t, pos: terminalAbs(cmp, t) };
  }
  // 단자의 수평 탈출 방향(회전 반영).
  // 가장 가까운 이웃 단자가 수평으로 옆에 있으면 그 "반대쪽"으로 나감(예: VCC↔GND 분리).
  // 이웃이 위/아래로만 있으면 붙은 변(rx) 기준.
  function exitDir(cmp, t) {
    var rad = cmp.rotation * Math.PI / 180;
    var nearest = null, nd = Infinity;
    cmp.terminals.forEach(function (o) {
      if (o.id === t.id) return;
      var d = Math.abs(o.rx - t.rx) + Math.abs(o.ry - t.ry);
      if (d < nd) { nd = d; nearest = o; }
    });
    var lx;
    if (nearest && Math.abs(nearest.rx - t.rx) > 0.06) {
      lx = t.rx >= nearest.rx ? 1 : -1;   // 이웃 반대쪽으로
    } else {
      lx = t.rx < 0.5 ? -1 : 1;           // 이웃이 위/아래면 변 기준
    }
    return { x: lx * Math.cos(rad), y: lx * Math.sin(rad) };
  }

  function dedupe(pts) {
    var out = [];
    for (var i = 0; i < pts.length; i++) {
      var p = pts[i], last = out[out.length - 1];
      if (!last || Math.abs(last.x - p.x) > 0.5 || Math.abs(last.y - p.y) > 0.5) out.push(p);
    }
    return out;
  }

  // 같은 단자에 붙은 배선들
  function termWires(ref) {
    return WE.model.project.wires.filter(function (w) {
      return (w.from.componentId === ref.componentId && w.from.terminalId === ref.terminalId) ||
             (w.to.componentId === ref.componentId && w.to.terminalId === ref.terminalId);
    });
  }
  // 이 배선에서 ref 단자 반대쪽 끝점
  function farOf(w, ref) {
    var onFrom = (w.from.componentId === ref.componentId && w.from.terminalId === ref.terminalId);
    return onFrom ? wireEndpoint(w.to) : wireEndpoint(w.from);
  }
  // 한 단자에서 나가는 배선들의 탭 순번. 목적지의 "수직 거리(perp)"가 클수록 안쪽(작은 스텁),
  // 작을수록(바에 가까운 목적지) 바깥쪽(큰 스텁) → 세로 드롭이 중첩되어 교차 0.
  function tapIndex(wire, ref, pt, da) {
    var ws = termWires(ref);
    if (ws.length < 2) return { i: 0, n: 1 };
    var perp = { x: -da.y, y: da.x };
    function proj(w) { var f = farOf(w, ref); return f ? Math.abs((f.x - pt.x) * perp.x + (f.y - pt.y) * perp.y) : 0; }
    // 목적지가 탈출 방향 앞쪽(facing)인지, 반대쪽(U턴)인지
    var sumDot = 0;
    ws.forEach(function (w) { var f = farOf(w, ref); if (f) sumDot += (f.x - pt.x) * da.x + (f.y - pt.y) * da.y; });
    var facing = sumDot >= 0;
    // facing: 가까운 목적지=바깥(proj 내림차순 → index0 안쪽) / U턴: 반대
    ws = ws.slice().sort(function (a, b) { return facing ? (proj(b) - proj(a)) : (proj(a) - proj(b)); });
    var i = ws.indexOf(wire);
    return { i: i < 0 ? 0 : i, n: ws.length };
  }

  // 매니폴드 직각 라우팅: 한 단자에 여러 선이면 탈출 방향으로 바를 만들어 탭마다 분기
  // 규칙: 단자에서 좌/우(수평)로 최소 STUB_BASE(20px) 나간 뒤 꺾음. 여러 개면 +LANE_STEP(10px)씩 차등(20,30,40…)
  var STUB_BASE = 20, LANE_STEP = 10;
  function orthoStub(A, B, wire) {
    var a0 = A.pos, b0 = B.pos;
    var da = exitDir(A.cmp, A.t), db = exitDir(B.cmp, B.t);

    var tapA = tapIndex(wire, wire.from, a0, da);
    var tapB = tapIndex(wire, wire.to, b0, db);
    // 공유 단자 쪽은 탭 거리를 차등(바 위에서 갈라짐), 단일이면 기본 스텁
    var sa = STUB_BASE + (tapA.n > 1 ? tapA.i * LANE_STEP : 0);
    var sb = STUB_BASE + (tapB.n > 1 ? tapB.i * LANE_STEP : 0);
    var pa = { x: a0.x + da.x * sa, y: a0.y + da.y * sa };
    var pb = { x: b0.x + db.x * sb, y: b0.y + db.y * sb };

    // 매니폴드(더 많이 공유되는) 쪽에 통로. 경로 위상은 위치(dx/dy)가 아니라
    // "단자 탈출 방향"으로 결정 → 부품을 움직여도 위상이 안 바뀜(꼬임 방지).
    var manifoldA = tapA.n >= tapB.n;
    var mDir = manifoldA ? da : db;
    var horizExit = Math.abs(mDir.x) >= Math.abs(mDir.y);   // 수평 탈출 → H-V-H
    var pts;
    if (horizExit) {
      var cx = manifoldA ? pa.x : pb.x;
      pts = [a0, pa, { x: cx, y: pa.y }, { x: cx, y: pb.y }, pb, b0];
    } else {
      var cy = manifoldA ? pa.y : pb.y;
      pts = [a0, pa, { x: pa.x, y: cy }, { x: pb.x, y: cy }, pb, b0];
    }
    return dedupe(pts);
  }

  // 대각선 구간에 코너를 넣어 무조건 직각으로 (부품 이동해도 수직/수평 유지)
  function orthogonalize(pts) {
    if (!pts || pts.length < 2) return pts;
    var out = [pts[0]];
    for (var i = 1; i < pts.length; i++) {
      var p = pts[i], last = out[out.length - 1];
      if (Math.abs(p.x - last.x) > 0.5 && Math.abs(p.y - last.y) > 0.5) {
        out.push({ x: last.x, y: p.y });   // 세로 먼저 코너
      }
      out.push(p);
    }
    return out;
  }

  // 일직선상의 중간점 제거 (너징이 꼬이지 않도록)
  function simplify(pts) {
    if (pts.length < 3) return pts;
    var out = [pts[0]];
    for (var i = 1; i < pts.length - 1; i++) {
      var a = out[out.length - 1], b = pts[i], c = pts[i + 1];
      var col = (Math.abs(a.x - b.x) < 0.5 && Math.abs(b.x - c.x) < 0.5) ||
                (Math.abs(a.y - b.y) < 0.5 && Math.abs(b.y - c.y) < 0.5);
      if (!col) out.push(b);
    }
    out.push(pts[pts.length - 1]);
    return out;
  }

  // 한 배선의 원시 경로 (너징 전)
  function wireRouteRaw(wire) {
    var A = endpointFull(wire.from), B = endpointFull(wire.to);
    if (!A || !B) return null;
    if (wire.waypoints && wire.waypoints.length) {
      return { pts: orthogonalize([A.pos].concat(wire.waypoints, [B.pos])), auto: false };  // 수동 우선(직각 강제)
    }
    if (WE.model.ui.wireRouting === "ortho") return { pts: simplify(orthoStub(A, B, wire)), auto: true };
    return { pts: [A.pos, B.pos], auto: false };
  }

  // ---- 너징: 같은 선 위에서 겹치는 내부 세그먼트를 서로 다른 레인으로 분리 ----
  var LANE_GAP = 9;
  function nudge(routes) {
    var verts = [], hors = [];
    routes.forEach(function (r) {
      if (!r || !r.auto) return;               // 자동배선만 대상
      var pts = r.pts, last = pts.length - 1;
      for (var i = 0; i < last; i++) {
        // 세그먼트 양끝이 모두 '내부점'이어야 이동 가능(단자 고정점 제외)
        if (i < 1 || i + 1 > last - 1) continue;
        var p = pts[i], q = pts[i + 1];
        if (Math.abs(p.x - q.x) < 0.5 && Math.abs(p.y - q.y) > 1) {        // 세로
          verts.push({ pts: pts, i: i, fixed: Math.round(p.x), lo: Math.min(p.y, q.y), hi: Math.max(p.y, q.y) });
        } else if (Math.abs(p.y - q.y) < 0.5 && Math.abs(p.x - q.x) > 1) { // 가로
          hors.push({ pts: pts, i: i, fixed: Math.round(p.y), lo: Math.min(p.x, q.x), hi: Math.max(p.x, q.x) });
        }
      }
    });
    separate(verts, "x");
    separate(hors, "y");
  }
  function separate(segs, axis) {
    var byFixed = {};
    segs.forEach(function (s) { (byFixed[s.fixed] = byFixed[s.fixed] || []).push(s); });
    Object.keys(byFixed).forEach(function (k) {
      var arr = byFixed[k].sort(function (a, b) { return a.lo - b.lo; });   // 스윕용
      var cluster = [], end = -Infinity;
      function flush() {
        if (cluster.length > 1) {
          // 레인 배정은 세그먼트 중점 순(교차 최소화)
          var ord = cluster.slice().sort(function (a, b) { return (a.lo + a.hi) - (b.lo + b.hi); });
          var n = ord.length;
          ord.forEach(function (s, idx) {
            var off = (idx - (n - 1) / 2) * LANE_GAP;
            s.pts[s.i][axis] += off; s.pts[s.i + 1][axis] += off;
          });
        }
        cluster = [];
      }
      arr.forEach(function (s) {
        if (cluster.length && s.lo > end + 1) flush();   // 범위 안 겹치면 새 클러스터
        cluster.push(s); end = Math.max(end, s.hi);
      });
      flush();
    });
  }

  // 전체 배선 경로 계산 + 너징 → 캐시
  var _cache = {};
  function computeRoutes() {
    _cache = {};
    var wires = WE.model.project.wires;
    var routes = wires.map(function (w) { var r = wireRouteRaw(w); if (r) r.id = w.id; return r; });
    nudge(routes);
    routes.forEach(function (r) { if (r) _cache[r.id] = r.pts; });
  }

  // 배선 경로 점 배열
  function wireRoutePoints(wire) {
    // 수동 꺾임 배선은 항상 현재 waypoint로 계산(너징 캐시 안 씀 → 편집 즉시 반영)
    if (wire.waypoints && wire.waypoints.length) {
      var A = endpointFull(wire.from), B = endpointFull(wire.to);
      if (!A || !B) return null;
      return orthogonalize([A.pos].concat(wire.waypoints, [B.pos]));   // 직각 강제
    }
    if (_cache[wire.id]) return _cache[wire.id];   // 자동배선: 너징 캐시
    var r = wireRouteRaw(wire);
    return r ? r.pts : null;
  }

  // 점-선분 거리
  function segDist(p, a, b) {
    var vx = b.x - a.x, vy = b.y - a.y, wx = p.x - a.x, wy = p.y - a.y;
    var len2 = vx * vx + vy * vy;
    var t = len2 > 0 ? (wx * vx + wy * vy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    var dx = a.x + t * vx - p.x, dy = a.y + t * vy - p.y;
    return Math.sqrt(dx * dx + dy * dy);
  }
  // 경로 점 배열에서 pt에 가장 가까운 선분 인덱스
  function nearestSegmentIndex(pts, pt) {
    if (!pts || pts.length < 2) return -1;
    var best = -1, bd = Infinity;
    for (var i = 0; i < pts.length - 1; i++) {
      var d = segDist(pt, pts[i], pts[i + 1]);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }
  // 경로 점 배열 위에서 pt와 가장 가까운 지점(경로 위로 투영, 선분 안으로 clamp)
  function nearestPointOnPolyline(pts, pt) {
    if (!pts || pts.length < 2) return pt;
    var best = null, bd = Infinity;
    for (var i = 0; i < pts.length - 1; i++) {
      var a = pts[i], b = pts[i + 1];
      var vx = b.x - a.x, vy = b.y - a.y, wx = pt.x - a.x, wy = pt.y - a.y;
      var len2 = vx * vx + vy * vy;
      var t = len2 > 0 ? (wx * vx + wy * vy) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      var px = a.x + t * vx, py = a.y + t * vy;
      var d = Math.hypot(px - pt.x, py - pt.y);
      if (d < bd) { bd = d; best = { x: px, y: py }; }
    }
    return best;
  }

  // 겹침 회피: 이동하는 배선(movingId)의 선분을 startCoord에 두려 할 때, 다른 배선의 같은 방향
  // 평행 선분과 (좌표 근접 + 수직범위 겹침) 충돌하면 gap씩 밀어 가장 가까운 빈 좌표를 반환.
  // 단, 같은 분기점(단자 공유) 배선과 '겹침 허용' 배선은 장애물로 보지 않음(매니폴드 유지).
  // vertical=true → coord는 x, [lo,hi]는 y범위
  function avoidOverlapCoord(movingId, vertical, startCoord, lo, hi, gap, preferDir) {
    var g = gap > 0 ? gap : 9;
    var mv = WE.model.getWire(movingId);
    if (!mv || mv.allowOverlap) return startCoord;   // 겹침 허용 배선은 회피 안 함
    var mvTerms = {};
    mvTerms[mv.from.terminalId] = 1; mvTerms[mv.to.terminalId] = 1;
    var obs = [];
    WE.model.project.wires.forEach(function (w) {
      if (w.id === movingId) return;
      if (w.allowOverlap) return;                                            // 겹침 허용 배선 제외
      if (mvTerms[w.from.terminalId] || mvTerms[w.to.terminalId]) return;    // 같은 분기점(단자) 공유 → 무시
      var pts = wireRoutePoints(w); if (!pts) return;
      for (var i = 0; i < pts.length - 1; i++) {
        var a = pts[i], b = pts[i + 1];
        if (vertical && Math.abs(a.x - b.x) < 0.5) obs.push({ c: a.x, lo: Math.min(a.y, b.y), hi: Math.max(a.y, b.y) });
        else if (!vertical && Math.abs(a.y - b.y) < 0.5) obs.push({ c: a.y, lo: Math.min(a.x, b.x), hi: Math.max(a.x, b.x) });
      }
    });
    function hit(c) {
      for (var i = 0; i < obs.length; i++) {
        var o = obs[i];
        if (Math.abs(o.c - c) < g - 0.5 && o.hi > lo + 0.5 && o.lo < hi - 0.5) return true;
      }
      return false;
    }
    if (!hit(startCoord)) return startCoord;
    var d = preferDir || 1;
    for (var s = 1; s <= 400; s++) {
      if (!hit(startCoord + d * g * s)) return startCoord + d * g * s;
      if (!hit(startCoord - d * g * s)) return startCoord - d * g * s;
    }
    return startCoord;
  }

  // ---- 넷(전기적으로 이어진 배선·단자) 탐색 ----
  // 시작 단자 ref({componentId, terminalId})에서 배선을 따라 연결된 전체를 BFS로 수집
  function netFrom(startRefs) {
    var tKey = function (r) { return r.componentId + "" + r.terminalId; };
    var visited = {}, wires = {}, queue = [];
    (startRefs || []).forEach(function (r) {
      var k = tKey(r);
      if (!visited[k]) { visited[k] = r; queue.push(k); }
    });
    // 단자키 → 연결 배선 목록 인덱스
    var byTerm = {};
    WE.model.project.wires.forEach(function (w) {
      var a = tKey(w.from), b = tKey(w.to);
      (byTerm[a] = byTerm[a] || []).push(w);
      (byTerm[b] = byTerm[b] || []).push(w);
    });
    while (queue.length) {
      var k = queue.shift();
      (byTerm[k] || []).forEach(function (w) {
        wires[w.id] = true;
        [w.from, w.to].forEach(function (r) {
          var k2 = tKey(r);
          if (!visited[k2]) { visited[k2] = r; queue.push(k2); }
        });
      });
    }
    var terms = [];
    Object.keys(visited).forEach(function (k) { terms.push(visited[k]); });
    return { wireIds: Object.keys(wires), terms: terms };
  }

  // 단자 라벨 자동배치(충돌회피 공용 로직) — 배선도 캔버스·단자배치 모달이 동일한 결과를 내도록 공유
  // terminals: t.labelPos(수동 위치)가 없는 단자만 넘길 것. cmpW/cmpH: 회전 무관 원본 폭/높이(분류 기준)
  // box: {x,y,x2,y2} 라벨을 붙일 기준 사각형(호출측 좌표계). dotOf(t): 해당 좌표계의 단자 점 위치 반환
  // 반환: [{ t, dot:{x,y}, lx, ly, anchor:'start'|'end'|'middle', side:'L'|'R'|'T'|'B' }, ...]
  function layoutTermLabels(terminals, cmpW, cmpH, box, dotOf, opts) {
    opts = opts || {};
    var offset = opts.offset != null ? opts.offset : 10;
    var minGapLR = opts.minGapLR != null ? opts.minGapLR : 15;
    var minGapTB = opts.minGapTB != null ? opts.minGapTB : 26;
    var groups = { L: [], R: [], T: [], B: [] };
    terminals.forEach(function (t) {
      var dot = dotOf(t);
      var side;
      if (t.labelSide === "L" || t.labelSide === "R" || t.labelSide === "T" || t.labelSide === "B") {
        side = t.labelSide;
      } else {
        var dl = t.rx * cmpW, dr = (1 - t.rx) * cmpW, dt = t.ry * cmpH, db = (1 - t.ry) * cmpH;
        var minD = Math.min(dl, dr, dt, db);
        side = minD === dt ? "T" : minD === db ? "B" : minD === dl ? "L" : "R";
      }
      groups[side].push({ t: t, dot: dot });
    });
    var out = [];
    ["L", "R"].forEach(function (side) {
      var arr = groups[side];
      arr.sort(function (a, b) { return a.dot.y - b.dot.y; });
      var lastY = -Infinity;
      var lx = side === "L" ? box.x - offset : box.x2 + offset;
      arr.forEach(function (o) {
        var ly = o.dot.y;
        if (ly < lastY + minGapLR) ly = lastY + minGapLR;
        lastY = ly;
        out.push({ t: o.t, dot: o.dot, lx: lx, ly: ly, anchor: side === "L" ? "end" : "start", side: side });
      });
    });
    ["T", "B"].forEach(function (side) {
      var arr = groups[side];
      arr.sort(function (a, b) { return a.dot.x - b.dot.x; });
      var lastX = -Infinity;
      var ly = side === "T" ? box.y - offset : box.y2 + offset;
      arr.forEach(function (o) {
        var lx = o.dot.x;
        if (lx < lastX + minGapTB) lx = lastX + minGapTB;
        lastX = lx;
        out.push({ t: o.t, dot: o.dot, lx: lx, ly: ly, anchor: "middle", side: side });
      });
    });
    return out;
  }

  // 배선 path의 d 문자열
  function wirePath(wire) {
    var pts = wireRoutePoints(wire);
    if (!pts) return null;
    return "M " + pts.map(function (p) { return p.x + " " + p.y; }).join(" L ");
  }

  return {
    snap: snap,
    clientToCanvas: clientToCanvas,
    localToAbs: localToAbs,
    terminalAbs: terminalAbs,
    absToTerminal: absToTerminal,
    transformString: transformString,
    wireEndpoint: wireEndpoint,
    computeRoutes: computeRoutes,
    wireRoutePoints: wireRoutePoints,
    nearestSegmentIndex: nearestSegmentIndex,
    nearestPointOnPolyline: nearestPointOnPolyline,
    simplify: simplify,
    avoidOverlapCoord: avoidOverlapCoord,
    netFrom: netFrom,
    wirePath: wirePath,
    layoutTermLabels: layoutTermLabels
  };
})();
