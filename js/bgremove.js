// bgremove.js — 색상 기반 배경 제거 (모서리 flood-fill)
var WE = window.WE || {};
window.WE = WE;

WE.bgremove = (function () {
  var MAX_SIDE = 800; // 처리/저장 해상도 상한 (용량 관리)

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

  function init() {
    modal = document.getElementById("bgModal");
    canvas = document.getElementById("bgCanvas");
    ctx = canvas.getContext("2d");

    document.getElementById("bgTol").addEventListener("input", function (e) {
      document.getElementById("bgTolVal").textContent = e.target.value;
      renderPreview();
    });
    document.getElementById("bgEnable").addEventListener("change", renderPreview);
    document.getElementById("bgFeather").addEventListener("change", renderPreview);
    document.getElementById("bgReset").addEventListener("click", function () {
      setCornerSeeds(); renderPreview();
    });
    document.getElementById("bgCrop").addEventListener("change", function (e) {
      document.getElementById("bgCropHint").hidden = !e.target.checked;
      if (e.target.checked && !cropRect) {
        cropRect = { x: Math.round(W * 0.08), y: Math.round(H * 0.08), w: Math.round(W * 0.84), h: Math.round(H * 0.84) };
      }
      renderPreview();
    });
    canvas.addEventListener("pointerdown", onCanvasDown);
    window.addEventListener("pointermove", onCanvasMove);
    window.addEventListener("pointerup", onCanvasUp);
    document.getElementById("bgRotL").addEventListener("click", function () { rotation = (rotation + 270) % 360; drawSource(); });
    document.getElementById("bgRotR").addEventListener("click", function () { rotation = (rotation + 90) % 360; drawSource(); });

    document.getElementById("bgCancel").addEventListener("click", close);
    document.getElementById("bgUseOriginal").addEventListener("click", function () {
      finish(exportOriginal());
    });
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

  // "원본 사용": 회전/크롭/배경제거 없이 원본 그대로 쓰되, 용량 관리를 위해 MAX_SIDE로 리사이즈 후 압축
  function exportOriginal() {
    var w = origImg.width, h = origImg.height;
    if (Math.max(w, h) > MAX_SIDE) {
      var r = MAX_SIDE / Math.max(w, h);
      w = Math.round(w * r); h = Math.round(h * r);
    }
    var tmp = document.createElement("canvas");
    tmp.width = w; tmp.height = h;
    tmp.getContext("2d").drawImage(origImg, 0, 0, w, h);
    return encodeForStorage(tmp);
  }

  // 공개: 이미지 dataURL을 받아 모달 열기, 완료 시 콜백(결과 dataURL)
  function open(dataUrl, callback) {
    origDataUrl = dataUrl;
    onDone = callback;
    origImg = new Image();
    origImg.onload = function () {
      rotation = 0;
      document.getElementById("bgEnable").checked = true;
      document.getElementById("bgFeather").checked = false;
      document.getElementById("bgCrop").checked = false;
      document.getElementById("bgCropHint").hidden = true;
      cropRect = null; cropDrag = null;
      drawSource();
      modal.hidden = false;
    };
    origImg.src = dataUrl;
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
    document.getElementById("bgCrop").checked = false;
    document.getElementById("bgCropHint").hidden = true;
    renderPreview();
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
  function cropOn() { return document.getElementById("bgCrop").checked && cropRect; }
  function corners() {
    var c = cropRect;
    return [
      { k: "nw", x: c.x, y: c.y }, { k: "ne", x: c.x + c.w, y: c.y },
      { k: "sw", x: c.x, y: c.y + c.h }, { k: "se", x: c.x + c.w, y: c.y + c.h }
    ];
  }

  function onCanvasDown(e) {
    if (modal.hidden) return;
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
    // 배경 시드 추가
    var x = Math.max(0, Math.min(W - 1, Math.floor(p.x)));
    var y = Math.max(0, Math.min(H - 1, Math.floor(p.y)));
    seeds.push({ x: x, y: y });
    renderPreview();
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
    if (cropDrag) { try { canvas.releasePointerCapture(e.pointerId); } catch (err) {} cropDrag = null; }
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

    if (document.getElementById("bgEnable").checked) {
      var tol = parseInt(document.getElementById("bgTol").value, 10);
      var feather = document.getElementById("bgFeather").checked;
      var removed = computeMask(tol);
      applyMask(out.data, removed, feather);
    }
    ctx.putImageData(out, 0, 0);
    // 시드 마커
    ctx.save();
    seeds.forEach(function (s) {
      ctx.beginPath();
      ctx.arc(s.x, s.y, 4, 0, Math.PI * 2);
      ctx.strokeStyle = "#1e88e5"; ctx.lineWidth = 2; ctx.stroke();
    });
    ctx.restore();
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
  }

  // removed 마스크를 alpha에 적용 (feather 시 경계 픽셀 반투명)
  function applyMask(data, removed, feather) {
    for (var i = 0; i < removed.length; i++) {
      if (removed[i]) { data[i * 4 + 3] = 0; continue; }
      if (feather) {
        var x = i % W, y = (i - x) / W;
        var edge =
          (x > 0 && removed[i - 1]) || (x < W - 1 && removed[i + 1]) ||
          (y > 0 && removed[i - W]) || (y < H - 1 && removed[i + W]);
        if (edge) data[i * 4 + 3] = 110;
      }
    }
  }

  // 최종 결과 dataURL 생성 (마커 없이, 투명 배경 유지) — WebP 우선(용량 절감), 미지원 시 PNG
  function exportPng() {
    var out = ctx.createImageData(W, H);
    out.data.set(srcImageData.data);
    if (document.getElementById("bgEnable").checked) {
      var tol = parseInt(document.getElementById("bgTol").value, 10);
      var feather = document.getElementById("bgFeather").checked;
      applyMask(out.data, computeMask(tol), feather);
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
    if (cb) cb(dataUrl);
  }

  function close() {
    modal.hidden = true;
    onDone = null; // 취소: 콜백 호출 안 함
  }

  return { init: init, open: open };
})();
