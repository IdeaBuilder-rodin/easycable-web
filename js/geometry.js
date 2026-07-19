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
  // ---- 단자 면(어느 외곽면에 붙었는지) 판정 ----
  // 기준(사용자 확정): 수동 고정(labelSide) > 줄 클러스터링(긴 줄 우선) > 가까운 변,
  // 애매한 고립 단자는 같은 부품에서 이미 나간 배선들의 다수 방향을 보조로 따름.
  // 배선 탈출 방향과 라벨 자동 배치가 이 판정을 공유한다.
  var SIDE_VEC = { L: { x: -1, y: 0 }, R: { x: 1, y: 0 }, T: { x: 0, y: -1 }, B: { x: 0, y: 1 } };
  // 로컬 side 문자를 deg 회전했을 때의 화면 side 문자
  function rotSide(side, deg) {
    var v = SIDE_VEC[side], rad = deg * Math.PI / 180;
    var x = v.x * Math.cos(rad) - v.y * Math.sin(rad), y = v.x * Math.sin(rad) + v.y * Math.cos(rad);
    return Math.abs(x) >= Math.abs(y) ? (x >= 0 ? "R" : "L") : (y >= 0 ? "B" : "T");
  }
  // 핵심 분류기(부품 로컬 기준, 회전 미반영): { side, sure } 반환
  // sure=false = 애매(줄에도 안 속하고 두 변 거리가 비슷) → 보조 규칙 대상
  function termSideInfo(terminals, W, H, t) {
    if (t.labelSide === "L" || t.labelSide === "R" || t.labelSide === "T" || t.labelSide === "B") {
      return { side: t.labelSide, sure: true, manual: true };
    }
    // 줄 클러스터링: 같은 y(가로줄)/같은 x(세로줄)에 놓인 이웃 수 — 더 긴 줄을 따름
    var EPS = 0.04;   // 상대좌표 오차(부품 크기의 4%)
    var row = 0, col = 0;
    (terminals || []).forEach(function (o) {
      if (o.id === t.id) return;
      if (Math.abs(o.ry - t.ry) <= EPS) row++;
      if (Math.abs(o.rx - t.rx) <= EPS) col++;
    });
    if (row > col) return { side: t.ry < 0.5 ? "T" : "B", sure: true };
    if (col > row) return { side: t.rx < 0.5 ? "L" : "R", sure: true };
    // 고립(또는 행/열 동수): 가까운 변 — px 환산 거리로 비교
    var d = [t.rx * W, (1 - t.rx) * W, t.ry * H, (1 - t.ry) * H];   // L R T B
    var sides = ["L", "R", "T", "B"];
    var mi = 0, i;
    for (i = 1; i < 4; i++) if (d[i] < d[mi]) mi = i;
    var second = Infinity;
    for (i = 0; i < 4; i++) if (i !== mi && d[i] < second) second = d[i];
    return { side: sides[mi], sure: (second - d[mi]) >= 8 };
  }
  // 부품 문맥 포함 판정(로컬 기준): 애매하면 같은 부품의 다른 배선 단자 방향 다수결
  function termSideResolved(cmp, t) {
    var r = termSideInfo(cmp.terminals, cmp.width, cmp.height, t);
    if (r.sure) return r.side;
    var votes = { L: 0, R: 0, T: 0, B: 0 }, any = false;
    WE.model.project.wires.forEach(function (w) {
      [w.from, w.to].forEach(function (ref) {
        if (ref.componentId !== cmp.id || ref.terminalId === t.id) return;
        var ot = WE.model.getTerminal(cmp, ref.terminalId);
        if (!ot) return;
        var or = termSideInfo(cmp.terminals, cmp.width, cmp.height, ot);
        if (or.sure && !or.manual) { votes[or.side]++; any = true; }
      });
    });
    if (any) {
      var best = null;
      ["L", "R", "T", "B"].forEach(function (s) { if (best === null || votes[s] > votes[best]) best = s; });
      if (votes[best] > 0) return best;
    }
    return r.side;
  }
  // 화면 기준 side (라벨 배치용): labelSide는 화면 기준이라 그대로, 자동 판정은 회전 반영
  function termSideScreen(cmp, t) {
    if (t.labelSide === "L" || t.labelSide === "R" || t.labelSide === "T" || t.labelSide === "B") return t.labelSide;
    return rotSide(termSideResolved(cmp, t), cmp.rotation || 0);
  }
  // 배선 탈출 정보: 방향(캔버스 기준 단위벡터) + 스텁 길이(부품 외곽을 벗어날 때까지 + 여유)
  function exitInfo(cmp, t) {
    var localSide;
    if (t.labelSide === "L" || t.labelSide === "R" || t.labelSide === "T" || t.labelSide === "B") {
      localSide = rotSide(t.labelSide, -(cmp.rotation || 0));   // 화면 기준 수동 고정 → 로컬로 환산
    } else {
      localSide = termSideResolved(cmp, t);
    }
    var s = cmp.scale || 1;
    var distEdge =
      localSide === "T" ? t.ry * cmp.height * s :
      localSide === "B" ? (1 - t.ry) * cmp.height * s :
      localSide === "L" ? t.rx * cmp.width * s : (1 - t.rx) * cmp.width * s;
    var v = SIDE_VEC[localSide], rad = (cmp.rotation || 0) * Math.PI / 180;
    return {
      dir: { x: v.x * Math.cos(rad) - v.y * Math.sin(rad), y: v.x * Math.sin(rad) + v.y * Math.cos(rad) },
      stub: distEdge + STUB_BASE
    };
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

  // 같은 부품·같은 면에서 나가 같은 방향으로 꺾이는 배선 묶음 내 순번 (계단식 스텁용)
  // 규칙(사용자 확정): 꺾임 방향에 가까운 단자일수록 안쪽(짧은 스텁) → 교차 없이 겹겹이 감싸는 하네스 묶음
  // 반환 { i, n } — i=0이 최내측. 수동 꺾임 배선은 묶음에서 제외.
  function bundleRank(wire, ref, cmp, t, dir) {
    var horizExit = Math.abs(dir.x) >= Math.abs(dir.y);
    var far0 = farOf(wire, ref);
    if (!far0) return { i: 0, n: 1 };
    var myPos = terminalAbs(cmp, t);
    // 꺾임 방향: 탈출 축의 수직 축에서 상대 끝점이 어느 쪽인가
    var sign = (horizExit ? (far0.y - myPos.y) : (far0.x - myPos.x)) >= 0 ? 1 : -1;
    var members = [];
    WE.model.project.wires.forEach(function (w) {
      if (w.waypoints && w.waypoints.length) return;
      [w.from, w.to].forEach(function (r) {
        if (r.componentId !== cmp.id) return;
        var ot = WE.model.getTerminal(cmp, r.terminalId);
        if (!ot) return;
        var oe = exitInfo(cmp, ot);
        if (oe.dir.x * dir.x + oe.dir.y * dir.y < 0.9) return;   // 같은 면(같은 탈출 방향)만
        var f = farOf(w, r);
        if (!f) return;
        var op = terminalAbs(cmp, ot);
        var turn = horizExit ? (f.y - op.y) : (f.x - op.x);
        if ((turn >= 0 ? 1 : -1) !== sign) return;               // 같은 방향으로 꺾이는 것만
        members.push({ tid: r.terminalId, key: horizExit ? op.y : op.x });
      });
    });
    if (members.length < 2) return { i: 0, n: 1 };
    // 안쪽 정렬: 아래/오른쪽으로 꺾이면(sign>0) 좌표 큰 단자가 안쪽, 위/왼쪽이면 작은 단자가 안쪽
    members.sort(function (a, b) { return sign > 0 ? (b.key - a.key) : (a.key - b.key); });
    var rank = {}, order = 0;
    members.forEach(function (m) { if (!(m.tid in rank)) rank[m.tid] = order++; });
    return { i: rank[t.id] != null ? rank[t.id] : 0, n: order };
  }

  // 매니폴드 직각 라우팅: 한 단자에 여러 선이면 탈출 방향으로 바를 만들어 탭마다 분기
  // 규칙(확정 기준): 첫 구간은 단자가 붙은 부품 외곽면의 바깥 방향으로 — 부품을 벗어난 뒤(+여유) 꺾는다.
  // 여러 개 공유 시 +LANE_STEP(10px)씩 차등.
  var STUB_BASE = 20, LANE_STEP = 10;
  function orthoStub(A, B, wire) {
    var a0 = A.pos, b0 = B.pos;
    var ea = exitInfo(A.cmp, A.t), eb = exitInfo(B.cmp, B.t);
    var da = ea.dir, db = eb.dir;

    var tapA = tapIndex(wire, wire.from, a0, da);
    var tapB = tapIndex(wire, wire.to, b0, db);
    // 같은 면 묶음 내 계단식 차등(하네스 네스팅) — 단자 공유 분기(tap)와 합산
    var bunA = bundleRank(wire, wire.from, A.cmp, A.t, da);
    var bunB = bundleRank(wire, wire.to, B.cmp, B.t, db);
    var sa = ea.stub + bunA.i * LANE_STEP + (tapA.n > 1 ? tapA.i * LANE_STEP : 0);
    var sb = eb.stub + bunB.i * LANE_STEP + (tapB.n > 1 ? tapB.i * LANE_STEP : 0);
    var pa = { x: a0.x + da.x * sa, y: a0.y + da.y * sa };
    var pb = { x: b0.x + db.x * sb, y: b0.y + db.y * sb };

    // 매니폴드(더 많이 공유되는) 쪽에 통로. 경로 위상은 위치(dx/dy)가 아니라
    // "단자 탈출 방향"으로 결정 → 부품을 움직여도 위상이 안 바뀜(꼬임 방지).
    var manifoldA = tapA.n >= tapB.n;
    var mDir = manifoldA ? da : db;
    var horizExit = Math.abs(mDir.x) >= Math.abs(mDir.y);   // 수평 탈출 → H-V-H
    // 양쪽이 같은 방향으로 탈출하면 채널은 두 스텁 중 더 바깥쪽에 — 양쪽 탈출 거리 모두 보장
    // (한쪽 기준으로만 잡으면 반대쪽 스텁이 0으로 뭉개지는 문제)
    var aH = Math.abs(da.x) >= Math.abs(da.y), bH = Math.abs(db.x) >= Math.abs(db.y);
    var pts;
    if (horizExit) {
      if (aH && bH && da.x * db.x < 0) {
        // 좌/우 반대 방향 탈출: 중간 y에 가로 통로 — 양쪽 스텁(최초 탈출 구간) 모두 보존
        var my = (pa.y + pb.y) / 2;
        pts = [a0, pa, { x: pa.x, y: my }, { x: pb.x, y: my }, pb, b0];
      } else {
        var cx;
        if (aH && bH && da.x * db.x > 0) cx = da.x > 0 ? Math.max(pa.x, pb.x) : Math.min(pa.x, pb.x);
        else cx = manifoldA ? pa.x : pb.x;
        pts = [a0, pa, { x: cx, y: pa.y }, { x: cx, y: pb.y }, pb, b0];
      }
    } else {
      if (!aH && !bH && da.y * db.y < 0) {
        // 위/아래 반대 방향 탈출: 중간 x에 세로 통로 — 양쪽 스텁 모두 보존
        var mx = (pa.x + pb.x) / 2;
        pts = [a0, pa, { x: mx, y: pa.y }, { x: mx, y: pb.y }, pb, b0];
      } else {
        var cy;
        if (!aH && !bH && da.y * db.y > 0) cy = da.y > 0 ? Math.max(pa.y, pb.y) : Math.min(pa.y, pb.y);
        else cy = manifoldA ? pa.y : pb.y;
        pts = [a0, pa, { x: pa.x, y: cy }, { x: pb.x, y: cy }, pb, b0];
      }
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
    if (!segs.length) return;
    // 1) 좌표 근접 클러스터: 정확히 같지 않아도 LANE_GAP 미만으로 붙어 있으면 같은 묶음
    //    (스텁 계산 차이로 2~4px만 어긋난 평행선도 분리 대상 — 수동 드래그의 근접 회피와 기준 통일)
    segs.sort(function (a, b) { return a.fixed - b.fixed; });
    var coordClusters = [], cur = null;
    segs.forEach(function (s) {
      if (cur && s.fixed - cur.ref <= LANE_GAP - 1) { cur.items.push(s); cur.ref = s.fixed; }
      else { cur = { items: [s], ref: s.fixed }; coordClusters.push(cur); }
    });
    coordClusters.forEach(function (cc) {
      // 2) 길이 방향 범위까지 겹치는 것끼리 스윕 클러스터 → 평균 좌표 중심으로 균등 레인 배치
      var arr = cc.items.sort(function (a, b) { return a.lo - b.lo; });
      var cluster = [], end = -Infinity;
      function flush() {
        if (cluster.length > 1) {
          // 기존 상대 순서(fixed) 우선, 동률이면 중점 순 — 교차 최소화
          var ord = cluster.slice().sort(function (a, b) { return (a.fixed - b.fixed) || ((a.lo + a.hi) - (b.lo + b.hi)); });
          var n = ord.length, mean = 0;
          ord.forEach(function (s) { mean += s.fixed; });
          mean /= n;
          ord.forEach(function (s, idx) {
            var target = mean + (idx - (n - 1) / 2) * LANE_GAP;
            s.pts[s.i][axis] = target; s.pts[s.i + 1][axis] = target;
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

  // ---- 경로 위 위치 ↔ 경로 길이 비율(0~1) ----
  // 배선 라벨은 절대좌표가 아니라 '경로상의 비율'로 저장 → 부품 이동/재라우팅 시 배선을 따라옴
  function polylinePointAt(pts, t) {
    if (!pts || pts.length < 2) return null;
    var lens = [], L = 0, i, l;
    for (i = 0; i < pts.length - 1; i++) { l = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y); lens.push(l); L += l; }
    var target = Math.max(0, Math.min(1, t)) * L;
    for (i = 0; i < lens.length; i++) {
      if (target <= lens[i] || i === lens.length - 1) {
        var f = lens[i] > 0 ? Math.min(1, target / lens[i]) : 0;
        return { x: pts[i].x + (pts[i + 1].x - pts[i].x) * f, y: pts[i].y + (pts[i + 1].y - pts[i].y) * f, seg: i };
      }
      target -= lens[i];
    }
    return { x: pts[pts.length - 1].x, y: pts[pts.length - 1].y, seg: pts.length - 2 };
  }
  function polylineRatioOf(pts, pt) {
    if (!pts || pts.length < 2) return 0;
    var lens = [], L = 0, i, l;
    for (i = 0; i < pts.length - 1; i++) { l = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y); lens.push(l); L += l; }
    var best = 0, bd = Infinity, acc = 0;
    for (i = 0; i < pts.length - 1; i++) {
      var a = pts[i], b = pts[i + 1];
      var vx = b.x - a.x, vy = b.y - a.y, wx = pt.x - a.x, wy = pt.y - a.y;
      var len2 = vx * vx + vy * vy;
      var t = len2 > 0 ? (wx * vx + wy * vy) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      var d = Math.hypot(a.x + t * vx - pt.x, a.y + t * vy - pt.y);
      if (d < bd) { bd = d; best = acc + t * lens[i]; }
      acc += lens[i];
    }
    return L > 0 ? best / L : 0;
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
      } else if (opts.sideOf) {
        // 배선 탈출 방향과 동일한 판정(줄 클러스터링 포함)을 공유 — 라벨과 선이 항상 같은 면
        side = opts.sideOf(t);
      } else {
        // 폴백: 실제 표시 좌표(dot)와 외곽 박스(box)의 거리로 판정
        var dl = dot.x - box.x, dr = box.x2 - dot.x, dt = dot.y - box.y, db = box.y2 - dot.y;
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
    var charW = opts.charW != null ? opts.charW : 6.5;       // 라벨 폭 추정용 글자 폭
    var minGapV = opts.minGapV != null ? opts.minGapV : 13;  // 세로쓰기 시 라벨 줄 간격
    ["T", "B"].forEach(function (side) {
      var arr = groups[side];
      arr.sort(function (a, b) { return a.dot.x - b.dot.x; });
      var ly = side === "T" ? box.y - offset : box.y2 + offset;
      // 밀도 판정: 평균 핀 간격이 평균 라벨 폭보다 좁으면 가로쓰기가 뭉개지므로 세로쓰기(90° 회전)로 전환.
      // 개수가 아니라 간격 기준이라, 핀 2개짜리(배터리)는 가로 유지·촘촘한 핀헤더만 세로가 됨
      var vertical = false;
      if (arr.length >= 2) {
        var span = arr[arr.length - 1].dot.x - arr[0].dot.x;
        var avgGap = span / (arr.length - 1);
        var avgW = 0;
        arr.forEach(function (o) { avgW += String(o.t.name || "").length * charW + 8; });
        avgW /= arr.length;
        vertical = avgGap < avgW;
      }
      var lastX = -Infinity, gap = vertical ? minGapV : minGapTB;
      arr.forEach(function (o) {
        var lx = o.dot.x;
        if (lx < lastX + gap) lx = lastX + gap;
        lastX = lx;
        out.push({
          t: o.t, dot: o.dot, lx: lx, ly: ly, side: side,
          vertical: vertical,
          // 세로쓰기: 글을 아래→위로 읽게 회전(-90°). 위쪽은 시작점이 점 위(위로 뻗음),
          // 아래쪽은 끝점이 점 아래(아래로 뻗음)가 되도록 앵커를 나눔
          anchor: vertical ? (side === "T" ? "start" : "end") : "middle"
        });
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
    polylinePointAt: polylinePointAt,
    polylineRatioOf: polylineRatioOf,
    simplify: simplify,
    avoidOverlapCoord: avoidOverlapCoord,
    netFrom: netFrom,
    wirePath: wirePath,
    layoutTermLabels: layoutTermLabels,
    termSideScreen: termSideScreen,
    termSideOf: function (terminals, W, H, t) { return termSideInfo(terminals, W, H, t).side; }
  };
})();
