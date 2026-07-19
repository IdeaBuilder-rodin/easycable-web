// bgremove.js — 색상 기반 배경 제거 (모서리 flood-fill)
var WE = window.WE || {};
window.WE = WE;

WE.bgremove = (function () {
  var MAX_SIDE = 800; // 처리/저장 해상도 상한 (용량 관리)
  var TOL = 30;       // 배경 제거 허용오차 (고정 — UI 조절 제거)

  var modal, canvas, ctx;
  var srcImageData;      // 원본 픽셀 (처리 전 기준)
  var W, H;              // 처리 해상도
  var seeds = [];        // [{x,y}] 배경 시드 픽셀
  var onDone = null;     // 완료 콜백(resultDataUrl)
  var origDataUrl = null;
  var cropRect = null;   // {x,y,w,h} 이미지 픽셀
  var cropDrag = null;
  var origImg = null;    // 원본 Image
  var rotation = 0;      // 0/90/180/270
  var _bgFit = 1;        // 캔버스 원본 픽셀 → 뷰포트에 맞춘 배율(맞춤 기준)
  var _bgZoom = 1;       // 맞춤 배율 대비 사용자 확대/축소 배수
  var _bgEnable = false; // 배경 제거 켜짐 여부(버튼 토글, 기본 꺼짐 — 사용자가 직접 켜야 함)
  var _bgCropOn = false; // 자르기 켜짐 여부(버튼 토글)
  var _bgPan = null;     // 휠클릭 드래그로 화면 이동 중 상태
  var _maxSide = 160;    // 배치 크기 기준(긴 변 px) — 사용자가 입력하면 갱신, 회전/자르기 시 비율만 다시 계산
  // 모달 지역 undo (단자 편집기와 같은 패턴 — 편집 상태 스냅샷 스택)
  var bgUndoStack = [], bgRedoStack = [], bgLastState = null;

  function init() {
    modal = document.getElementById("bgModal");
    canvas = document.getElementById("bgCanvas");
    ctx = canvas.getContext("2d");

    document.getElementById("bgResetAll").addEventListener("click", resetAll);

    // 화면 이동/확대축소: 단자 배치 편집기·메인 캔버스와 동일한 조작(Ctrl+휠 확대, 휠클릭 드래그 이동)
    var wrap = document.getElementById("bgCanvasWrap");
    wrap.addEventListener("wheel", function (e) {
      if (!e.ctrlKey) return;
      e.preventDefault();
      _bgZoom = Math.max(0.25, Math.min(4, _bgZoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
      applyBgZoom();
    }, { passive: false });
    wrap.addEventListener("pointerdown", function (e) {
      if (e.button !== 1) return;   // 가운데(휠) 버튼만
      e.preventDefault();
      _bgPan = { x: e.clientX, y: e.clientY, sl: wrap.scrollLeft, st: wrap.scrollTop };
      wrap.setPointerCapture(e.pointerId);
      wrap.style.cursor = "grabbing";
    });
    wrap.addEventListener("pointermove", function (e) {
      if (!_bgPan) return;
      wrap.scrollLeft = _bgPan.sl - (e.clientX - _bgPan.x);
      wrap.scrollTop = _bgPan.st - (e.clientY - _bgPan.y);
    });
    wrap.addEventListener("pointerup", function (e) {
      if (!_bgPan) return;
      _bgPan = null;
      try { wrap.releasePointerCapture(e.pointerId); } catch (err) {}
      wrap.style.cursor = "";
    });

    document.getElementById("bgEnable").addEventListener("click", function () {
      setBgEnable(!_bgEnable); bgCommit();
    });
    // 배치 크기: 한쪽을 입력하면 현재 결과물 비율로 다른 쪽을 맞춤
    document.getElementById("bgSizeW").addEventListener("input", function () { onSizeInput("w"); });
    document.getElementById("bgSizeH").addEventListener("input", function () { onSizeInput("h"); });
    // 배치 크기는 입력을 마쳤을 때(change)만 undo 지점으로 기록
    document.getElementById("bgSizeW").addEventListener("change", bgCommit);
    document.getElementById("bgSizeH").addEventListener("change", bgCommit);
    document.getElementById("bgCrop").addEventListener("click", function () {
      setBgCropOn(!_bgCropOn); bgCommit();
    });
    canvas.addEventListener("pointerdown", onCanvasDown);
    window.addEventListener("pointermove", onCanvasMove);
    window.addEventListener("pointerup", onCanvasUp);
    document.getElementById("bgRotL").addEventListener("click", function () { rotation = (rotation + 270) % 360; drawSource(); bgCommit(); });
    document.getElementById("bgRotR").addEventListener("click", function () { rotation = (rotation + 90) % 360; drawSource(); bgCommit(); });
    window.addEventListener("keydown", onBgKey);

    document.getElementById("bgCancel").addEventListener("click", close);
    document.getElementById("bgApply").addEventListener("click", function () {
      finish(exportPng());
    });
  }

  // 캔버스를 저장용으로 인코딩: WebP(투명도 유지, 용량 대폭 절감) 우선, 미지원 브라우저는 PNG로 폴백
  function encodeForStorage(canvasEl) {
    var webp = canvasEl.toDataURL("image/webp", 0.85);
    if (webp.indexOf("data:image/webp") === 0) return webp;
    return canvasEl.toDataURL("image/png");
  }

  // ---- 지역 undo/redo (Ctrl+Z / Ctrl+Shift+Z·Ctrl+Y) ----
  function bgState() {
    return JSON.stringify({ r: rotation, c: cropRect, e: _bgEnable, o: _bgCropOn, m: _maxSide });
  }
  function bgResetHistory() { bgUndoStack = []; bgRedoStack = []; bgLastState = bgState(); }
  function bgCommit() {
    var s = bgState();
    if (s === bgLastState) return;
    bgUndoStack.push(bgLastState);
    bgLastState = s;
    bgRedoStack = [];
  }
  function bgApplyState(json) {
    var s = JSON.parse(json);
    if (s.r !== rotation) { rotation = s.r; drawSource(); }   // 회전이 다르면 캔버스 재구성(크롭은 아래서 복원)
    _bgEnable = s.e;
    document.getElementById("bgEnable").classList.toggle("active", s.e);
    cropRect = s.c ? { x: s.c.x, y: s.c.y, w: s.c.w, h: s.c.h } : null;
    _bgCropOn = s.o;
    document.getElementById("bgCrop").classList.toggle("active", s.o);
    document.getElementById("bgCropHint").hidden = !s.o;
    _maxSide = s.m;
    renderPreview();
  }
  function bgDoUndo() {
    if (!bgUndoStack.length) return;
    bgRedoStack.push(bgLastState);
    bgLastState = bgUndoStack.pop();
    bgApplyState(bgLastState);
  }
  function bgDoRedo() {
    if (!bgRedoStack.length) return;
    bgUndoStack.push(bgLastState);
    bgLastState = bgRedoStack.pop();
    bgApplyState(bgLastState);
  }
  function onBgKey(e) {
    if (modal.hidden) return;
    if (!(e.ctrlKey || e.metaKey)) return;
    var tag = (document.activeElement && document.activeElement.tagName) || "";
    if (tag === "INPUT") return;   // 배치 크기 입력 중에는 입력창 기본 undo 보존
    var k = e.key.toLowerCase();
    if (k === "z") { e.preventDefault(); if (e.shiftKey) bgDoRedo(); else bgDoUndo(); }
    else if (k === "y") { e.preventDefault(); bgDoRedo(); }
  }

  // 공개: 이미지 dataURL을 받아 모달 열기, 완료 시 콜백(결과 dataURL, 변환정보, 배치크기)
  // initSize: 기존 배치 부품 재편집 시 {width, height} — 배치 크기 입력의 초기값 기준
  function open(dataUrl, callback, initSize) {
    origDataUrl = dataUrl;
    onDone = callback;
    _maxSide = (initSize && initSize.width > 0) ? Math.max(initSize.width, initSize.height) : 160;
    origImg = new Image();
    origImg.onload = function () {
      rotation = 0; _bgEnable = false; _bgCropOn = false;
      document.getElementById("bgEnable").classList.remove("active");
      document.getElementById("bgCrop").classList.remove("active");
      document.getElementById("bgCropHint").hidden = true;
      cropRect = null; cropDrag = null;
      modal.hidden = false;   // 먼저 화면에 보이게 해야 뷰포트 크기를 잴 수 있음
      drawSource();           // W/H/srcImageData를 여기서 초기화 → 그 다음에 상태 관련 함수를 불러야 안전
      bgResetHistory();       // 열 때마다 undo 스택 초기화
      // 모달이 막 표시된 직후엔 캔버스 영역 크기(특히 50vh 높이)가 아직 확정 전이라
      // 첫 fit이 어긋날 수 있음 → 레이아웃이 잡힌 다음 프레임에 한 번 더 화면 맞춤
      requestAnimationFrame(fitBgZoom);
    };
    origImg.src = dataUrl;
  }

  // 배경 제거 켜짐/꺼짐 토글 버튼
  function setBgEnable(v) {
    _bgEnable = v;
    document.getElementById("bgEnable").classList.toggle("active", v);
    renderPreview();
  }
  // 자르기 켜짐/꺼짐 토글 버튼
  function setBgCropOn(v) {
    _bgCropOn = v;
    document.getElementById("bgCrop").classList.toggle("active", v);
    document.getElementById("bgCropHint").hidden = !v;
    if (v && !cropRect) {
      // 이미지를 분석해 부품 최외곽에 자동으로 맞춤 (실패 시 기본 8% 여백 사각형)
      cropRect = autoCropRect() ||
        { x: Math.round(W * 0.08), y: Math.round(H * 0.08), w: Math.round(W * 0.84), h: Math.round(H * 0.84) };
    }
    renderPreview();
  }

  // 배경 마스크(모서리 flood-fill)로 부품(배경이 아닌 픽셀)의 최외곽 사각형을 계산
  function autoCropRect() {
    var removed = computeMask(TOL);
    var data = srcImageData.data;
    var minX = W, minY = H, maxX = -1, maxY = -1;
    for (var i = 0; i < removed.length; i++) {
      if (removed[i]) continue;              // 배경으로 지워질 픽셀
      if (data[i * 4 + 3] === 0) continue;   // 원본부터 투명한 픽셀(투명 PNG 여백)
      var x = i % W, y = (i - x) / W;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    if (maxX < 0 || maxX - minX < 10 || maxY - minY < 10) return null;   // 감지 실패/너무 작음
    var pad = Math.max(4, Math.round(Math.min(W, H) * 0.015));           // 최외곽에 살짝 여유
    var x1 = Math.max(0, minX - pad), y1 = Math.max(0, minY - pad);
    var x2 = Math.min(W, maxX + 1 + pad), y2 = Math.min(H, maxY + 1 + pad);
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  }

  // ---- 배치 크기 (도면에 놓일 부품 px) ----
  // 현재 결과물(자르기 반영) 비율 기준. 긴 변 = _maxSide 유지, 회전/자르기 시 비율만 재계산
  function resultDims() {
    return cropOn() ? { w: cropRect.w, h: cropRect.h } : { w: W, h: H };
  }
  function updateSizeInputs() {
    var d = resultDims();
    if (!(d.w > 0 && d.h > 0)) return;
    var w, h;
    if (d.w >= d.h) { w = _maxSide; h = Math.round(_maxSide * d.h / d.w); }
    else { h = _maxSide; w = Math.round(_maxSide * d.w / d.h); }
    document.getElementById("bgSizeW").value = Math.max(10, w);
    document.getElementById("bgSizeH").value = Math.max(10, h);
  }
  function onSizeInput(which) {
    var d = resultDims();
    var wEl = document.getElementById("bgSizeW"), hEl = document.getElementById("bgSizeH");
    if (which === "w") {
      var w = parseInt(wEl.value, 10);
      if (!(w >= 10)) return;   // 입력 중(비었거나 너무 작음)에는 그대로 둠
      hEl.value = Math.max(10, Math.round(w * d.h / d.w));
    } else {
      var h = parseInt(hEl.value, 10);
      if (!(h >= 10)) return;
      wEl.value = Math.max(10, Math.round(h * d.w / d.h));
    }
    _maxSide = Math.max(parseInt(wEl.value, 10) || 10, parseInt(hEl.value, 10) || 10);
  }
  function currentSize() {
    var w = parseInt(document.getElementById("bgSizeW").value, 10);
    var h = parseInt(document.getElementById("bgSizeH").value, 10);
    if (!(w >= 10 && h >= 10)) return null;
    return { width: w, height: h };
  }

  // 배경 제거·자르기·회전 등 편집을 전부 원본 상태로 되돌림
  function resetAll() {
    rotation = 0; cropRect = null; cropDrag = null;
    setBgEnable(false);
    setBgCropOn(false);
    drawSource();   // origImg 기준으로 다시 그리며 seeds도 모서리로 초기화됨
    bgCommit();     // 초기화도 undo로 되돌릴 수 있게 기록
  }

  // 뷰포트에 원본 픽셀이 딱 맞는 배율 계산 — 작은 이미지는 확대해서 작업 영역을 채움(최대 4배)
  function computeBgFit() {
    var wrap = document.getElementById("bgCanvasWrap");
    _bgFit = Math.min(4, wrap.clientWidth / canvas.width, wrap.clientHeight / canvas.height) || 1;
  }
  function applyBgZoom() {
    var scale = _bgFit * _bgZoom;
    canvas.style.width = Math.round(canvas.width * scale) + "px";
    canvas.style.height = Math.round(canvas.height * scale) + "px";
  }
  function fitBgZoom() {
    computeBgFit();
    _bgZoom = 1;
    applyBgZoom();
  }

  // 원본을 현재 회전값으로 캔버스에 그리고 srcImageData 갱신
  function drawSource() {
    var w = origImg.width, h = origImg.height;
    if (Math.max(w, h) > MAX_SIDE) {
      var r = MAX_SIDE / Math.max(w, h);
      w = Math.round(w * r); h = Math.round(h * r);
    }
    var swap = (rotation === 90 || rotation === 270);
    canvas.width = swap ? h : w;
    canvas.height = swap ? w : h;
    W = canvas.width; H = canvas.height;
    ctx.save();
    ctx.clearRect(0, 0, W, H);
    ctx.translate(W / 2, H / 2);
    ctx.rotate(rotation * Math.PI / 180);
    ctx.drawImage(origImg, -w / 2, -h / 2, w, h);
    ctx.restore();
    srcImageData = ctx.getImageData(0, 0, W, H);
    setCornerSeeds();
    cropRect = null;                 // 회전 시 크롭 초기화
    _bgCropOn = false;
    document.getElementById("bgCrop").classList.remove("active");
    document.getElementById("bgCropHint").hidden = true;
    renderPreview();
    fitBgZoom();   // 회전 등으로 원본 픽셀 크기가 바뀔 수 있어 매번 화면에 맞춰 재조정
  }

  function setCornerSeeds() {
    seeds = [
      { x: 0, y: 0 },
      { x: W - 1, y: 0 },
      { x: 0, y: H - 1 },
      { x: W - 1, y: H - 1 }
    ];
  }

  // 화면 좌표 → 이미지 픽셀 좌표
  function toPx(e) {
    var rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (canvas.width / rect.width),
      y: (e.clientY - rect.top) * (canvas.height / rect.height),
      scale: canvas.width / rect.width
    };
  }
  function cropOn() { return _bgCropOn && cropRect; }
  function corners() {
    var c = cropRect;
    return [
      { k: "nw", x: c.x, y: c.y }, { k: "ne", x: c.x + c.w, y: c.y },
      { k: "sw", x: c.x, y: c.y + c.h }, { k: "se", x: c.x + c.w, y: c.y + c.h }
    ];
  }

  function onCanvasDown(e) {
    if (modal.hidden) return;
    if (e.button === 1) return;   // 가운데 버튼은 화면 이동 전용(wrap의 pan 핸들러가 처리)
    var p = toPx(e);
    if (cropOn()) {
      var tol = 12 * p.scale;
      var hit = corners().filter(function (c) { return Math.abs(c.x - p.x) < tol && Math.abs(c.y - p.y) < tol; })[0];
      if (hit) { cropDrag = { mode: "resize", k: hit.k }; canvas.setPointerCapture(e.pointerId); return; }
      if (p.x > cropRect.x && p.x < cropRect.x + cropRect.w && p.y > cropRect.y && p.y < cropRect.y + cropRect.h) {
        cropDrag = { mode: "move", sx: p.x, sy: p.y, ox: cropRect.x, oy: cropRect.y };
        canvas.setPointerCapture(e.pointerId); return;
      }
      return;
    }
  }

  function onCanvasMove(e) {
    if (!cropDrag) return;
    var p = toPx(e);
    var px = Math.max(0, Math.min(W, p.x)), py = Math.max(0, Math.min(H, p.y));
    if (cropDrag.mode === "move") {
      var nx = cropDrag.ox + (p.x - cropDrag.sx), ny = cropDrag.oy + (p.y - cropDrag.sy);
      cropRect.x = Math.max(0, Math.min(W - cropRect.w, nx));
      cropRect.y = Math.max(0, Math.min(H - cropRect.h, ny));
    } else if (cropDrag.mode === "resize") {
      var x1 = cropRect.x, y1 = cropRect.y, x2 = cropRect.x + cropRect.w, y2 = cropRect.y + cropRect.h;
      if (cropDrag.k.indexOf("w") >= 0) x1 = Math.min(px, x2 - 10);
      if (cropDrag.k.indexOf("e") >= 0) x2 = Math.max(px, x1 + 10);
      if (cropDrag.k.indexOf("n") >= 0) y1 = Math.min(py, y2 - 10);
      if (cropDrag.k.indexOf("s") >= 0) y2 = Math.max(py, y1 + 10);
      cropRect = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
    }
    renderPreview();
  }
  function onCanvasUp(e) {
    if (cropDrag) {
      try { canvas.releasePointerCapture(e.pointerId); } catch (err) {}
      cropDrag = null;
      bgCommit();   // 자르기 영역 조절 확정 → undo 지점
    }
  }

  // 배경 제거 계산 → removed 마스크(Uint8Array)
  function computeMask(tol) {
    var data = srcImageData.data;
    var removed = new Uint8Array(W * H);
    var visited = new Uint8Array(W * H);
    var tol2 = tol * tol;

    seeds.forEach(function (s) {
      var seedIdx = s.y * W + s.x;
      var sp = seedIdx * 4;
      var sr = data[sp], sg = data[sp + 1], sb = data[sp + 2];
      var stack = [seedIdx];
      if (!visited[seedIdx]) visited[seedIdx] = 1;
      while (stack.length) {
        var i = stack.pop();
        var p = i * 4;
        var dr = data[p] - sr, dg = data[p + 1] - sg, db = data[p + 2] - sb;
        if (dr * dr + dg * dg + db * db > tol2) continue; // 색 다르면 확장 중단
        removed[i] = 1;
        var x = i % W, y = (i - x) / W;
        if (x > 0 && !visited[i - 1]) { visited[i - 1] = 1; stack.push(i - 1); }
        if (x < W - 1 && !visited[i + 1]) { visited[i + 1] = 1; stack.push(i + 1); }
        if (y > 0 && !visited[i - W]) { visited[i - W] = 1; stack.push(i - W); }
        if (y < H - 1 && !visited[i + W]) { visited[i + W] = 1; stack.push(i + W); }
      }
    });
    return removed;
  }

  // 미리보기 렌더(체커보드 위에)
  function renderPreview() {
    var out = ctx.createImageData(W, H);
    out.data.set(srcImageData.data);

    if (_bgEnable) {
      applyMask(out.data, computeMask(TOL));
    }
    ctx.putImageData(out, 0, 0);
    // 크롭 오버레이
    if (cropOn()) {
      var c = cropRect;
      ctx.save();
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      ctx.fillRect(0, 0, W, c.y);
      ctx.fillRect(0, c.y + c.h, W, H - (c.y + c.h));
      ctx.fillRect(0, c.y, c.x, c.h);
      ctx.fillRect(c.x + c.w, c.y, W - (c.x + c.w), c.h);
      ctx.strokeStyle = "#1e88e5"; ctx.lineWidth = 2; ctx.strokeRect(c.x, c.y, c.w, c.h);
      ctx.fillStyle = "#fff";
      corners().forEach(function (cn) {
        ctx.beginPath(); ctx.rect(cn.x - 5, cn.y - 5, 10, 10); ctx.fill(); ctx.stroke();
      });
      ctx.restore();
    }
    updateSizeInputs();   // 회전·자르기 등으로 비율이 바뀌면 배치 크기도 비율에 맞춰 갱신
  }

  // removed 마스크를 alpha에 적용
  function applyMask(data, removed) {
    for (var i = 0; i < removed.length; i++) {
      if (removed[i]) data[i * 4 + 3] = 0;
    }
  }

  // 최종 결과 dataURL 생성 (마커 없이, 투명 배경 유지) — WebP 우선(용량 절감), 미지원 시 PNG
  function exportPng() {
    var out = ctx.createImageData(W, H);
    out.data.set(srcImageData.data);
    if (_bgEnable) {
      applyMask(out.data, computeMask(TOL));
    }
    var tmp = document.createElement("canvas");
    tmp.width = W; tmp.height = H;
    tmp.getContext("2d").putImageData(out, 0, 0);

    // 크롭 적용
    if (cropOn()) {
      var c = cropRect;
      var cw = Math.max(1, Math.round(c.w)), ch = Math.max(1, Math.round(c.h));
      var cc = document.createElement("canvas");
      cc.width = cw; cc.height = ch;
      cc.getContext("2d").drawImage(tmp, Math.round(c.x), Math.round(c.y), cw, ch, 0, 0, cw, ch);
      return encodeForStorage(cc);
    }
    return encodeForStorage(tmp);
  }

  function finish(dataUrl) {
    modal.hidden = true;
    var cb = onDone; onDone = null;
    // 좌표계를 바꾸는 편집(회전·크롭) 정보를 함께 전달 —
    // 받는 쪽에서 기존 단자 좌표(rx·ry)를 같은 방식으로 변환해 배치가 깨지지 않게 함
    var tf = { rotation: rotation, crop: null };
    if (cropOn()) tf.crop = { x: cropRect.x / W, y: cropRect.y / H, w: cropRect.w / W, h: cropRect.h / H };
    if (cb) cb(dataUrl, tf, currentSize());
  }

  function close() {
    modal.hidden = true;
    onDone = null; // 취소: 콜백 호출 안 함
  }

  return { init: init, open: open };
})();
