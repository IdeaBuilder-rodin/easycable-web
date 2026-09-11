// presetmodal.js — 단자 프리셋 관리 모달.
//
// 왜 app.js 에서 꺼냈나:
//   이 화면을 **관리자 페이지(admin.html)에서도 그대로** 써야 하는데,
//   app.js 는 캔버스·툴바·속성창 DOM 을 전제로 도는 727개 함수짜리 파일이라 통째로 실을 수 없다.
//   그렇다고 관리자용을 따로 만들면 같은 화면이 두 벌이 되어 고칠 때마다 두 번 고쳐야 한다.
//   그래서 컨트롤러만 떼어 양쪽이 **같은 코드**를 쓰게 했다(2026-08-30).
//
// 쓰는 법: WE.presetModal.open() — 처음 부를 때 알아서 이벤트를 묶는다(지연 초기화).
// 기대는 것: WE.presets · WE.presetSets · WE.colorPicker · WE.termeditor · WE.i18n
//            그리고 마크업 #presetModal (index.html / admin.html 양쪽에 같은 것이 있다).
var WE = window.WE || {};
window.WE = WE;

WE.presetModal = (function () {
  "use strict";

  // 상태 문구는 화면마다 다른 곳에 뜬다 — 에디터는 힌트줄, 관리자는 하단 줄.
  // 그 차이는 WE.app.setHint 가 흡수한다.
  function setHint(text) { if (WE.app && WE.app.setHint) WE.app.setHint(text); }

  // 색상 선택 UI(SV/Hue 팝오버, 최근 색상 저장)는 js/colorpicker.js 로 옮겼다 — 공용 단자·
  // 부품 단자·신규 단자·다중 선택 색상이 전부 같은 팝오버를 쓴다(WE.colorPicker.attach).
  var presetSelection = {};
  var presetAnchor = { common: null, part: null };

  function presetSelectionKey(type, id) { return type + ":" + id; }
  function presetRowInfo(row) {
    if (!row) return null;
    return row.classList.contains("preset-row")
      ? { type: "common", id: row.dataset.id }
      : { type: "part", id: row.dataset.queueId };
  }
  function selectedPresetIds(type) {
    return Object.keys(presetSelection).filter(function (key) { return key.indexOf(type + ":") === 0; }).map(function (key) { return key.slice(type.length + 1); });
  }
  function updatePresetSelectionUi() {
    document.querySelectorAll(".preset-row,.part-preset-row").forEach(function (row) {
      var info = presetRowInfo(row), selected = !!presetSelection[presetSelectionKey(info.type, info.id)];
      row.classList.toggle("selected", selected);
      row.setAttribute("aria-selected", selected ? "true" : "false");
    });
    var keys = Object.keys(presetSelection);
    var bar = document.getElementById("presetBulkBar");
    if (!bar) return;
    bar.hidden = keys.length < 1;
    document.getElementById("presetBulkCount").textContent = keys.length + WE.i18n.t("개 선택");
    if (keys.length) {
      var first = keys[0].split(":"), item = first[0] === "common"
        ? WE.presets.get(first.slice(1).join(":"))
        : WE.termeditor.getPlacementQueue().filter(function (p) { return p.id === first.slice(1).join(":"); })[0];
      if (item) WE.colorPicker.setSwatch(document.getElementById("presetBulkColor"), item.color);
    }
  }
  function clearPresetSelection(resetAnchor) {
    presetSelection = {};
    if (resetAnchor !== false) presetAnchor = { common: null, part: null };
    updatePresetSelectionUi();
  }
  function selectPresetRow(row, e) {
    var info = presetRowInfo(row), key = presetSelectionKey(info.type, info.id);
    var rows = [].slice.call(document.querySelectorAll(info.type === "common" ? ".preset-row" : ".part-preset-row"));
    if (e.shiftKey && presetAnchor[info.type]) {
      if (!e.ctrlKey && !e.metaKey) presetSelection = {};
      var from = rows.findIndex(function (r) { return presetRowInfo(r).id === presetAnchor[info.type]; });
      var to = rows.indexOf(row);
      if (from >= 0 && to >= 0) {
        var start = Math.min(from, to), end = Math.max(from, to);
        rows.slice(start, end + 1).forEach(function (r) {
          var item = presetRowInfo(r); presetSelection[presetSelectionKey(item.type, item.id)] = true;
        });
      }
    } else if (e.ctrlKey || e.metaKey) {
      if (presetSelection[key]) delete presetSelection[key]; else presetSelection[key] = true;
      presetAnchor[info.type] = info.id;
    } else {
      presetSelection = {}; presetSelection[key] = true; presetAnchor[info.type] = info.id;
    }
    updatePresetSelectionUi();
  }

  function bindPresetModal() {
    var dragItem = null;
    var suppressPresetClick = false;
    function clearPresetDragState() {
      document.querySelectorAll(".preset-manager-section.drop-active").forEach(function (el) { el.classList.remove("drop-active"); });
      document.querySelectorAll(".preset-row.dragging,.part-preset-row.dragging,.preset-row.drop-before,.part-preset-row.drop-before,.preset-row.drop-after,.part-preset-row.drop-after").forEach(function (el) {
        el.classList.remove("dragging", "drop-before", "drop-after");
      });
    }
    function closePresetModal() {
      document.getElementById("presetModal").hidden = true;
      WE.colorPicker.close();   // 모달을 닫는데 색상 팝오버만 화면에 떠 있으면 안 되니 같이 닫는다
      clearPresetSelection();
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    }
    document.getElementById("presetClose").addEventListener("click", closePresetModal);
    // Esc 는 "맨 위에 뜬 것 한 겹"만 닫는다.
    // 프리셋 관리 창이 떠 있으면 여기서 삼켜야 뒤에 있는 단자 배치 창이 같이 닫히지 않는다.
    // 색상 팝오버가 더 위에 있을 때는 colorpicker 가 capture 단계에서 먼저 가져가므로 여기까지 오지 않는다.
    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape" || document.getElementById("presetModal").hidden) return;
      closePresetModal();
      e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    }, true);
    // 신규 단자 색상 — 아직 만들어지지 않은 프리셋이라 반영할 대상이 없다.
    // 트리거의 data-color 에만 값을 들고 있다가 "+ 추가" 클릭 때 읽는다.
    WE.colorPicker.attach(document.getElementById("newPresetColor"), {});
    function addPresetFromInput() {
      var labelInput = document.getElementById("newPresetLabel");
      var label = labelInput.value.trim();
      var color = document.getElementById("newPresetColor").dataset.color || "#1e88e5";
      if (!label) { labelInput.focus(); return false; }
      if (!WE.termeditor.addPlacementQueueItem(label, color)) return false;
      labelInput.value = "";
      renderPresetList();
      labelInput.focus();
      return true;
    }
    document.getElementById("btnAddPreset").addEventListener("click", addPresetFromInput);
    document.getElementById("newPresetLabel").addEventListener("keydown", function (e) {
      if (e.key !== "Enter" || e.isComposing || e.keyCode === 229) return;
      e.preventDefault();
      addPresetFromInput();
    });
    var pl = document.getElementById("presetList");
    pl.addEventListener("input", function (e) {
      var row = e.target.closest(".preset-row"); if (!row) return;
      if (!e.target.classList.contains("plabel")) return;
      var preset = WE.presets.get(row.dataset.id); if (!preset) return;
      var before = { label: preset.label, color: preset.color };
      var fields = { label: e.target.value };
      WE.presets.update(row.dataset.id, fields);
      WE.termeditor.syncPlacedPreset("common", row.dataset.id, before, fields);
      onPresetsChanged();
    });
    pl.addEventListener("click", function (e) {
      if (!e.target.classList.contains("pdel")) return;
      var row = e.target.closest(".preset-row");
      delete presetSelection[presetSelectionKey("common", row.dataset.id)];
      WE.presets.remove(row.dataset.id);
      renderPresetList();
      onPresetsChanged();
    });
    var partList = document.getElementById("partPresetList");
    partList.addEventListener("input", function (e) {
      var row = e.target.closest(".part-preset-row"); if (!row) return;
      if (e.target.classList.contains("plabel")) WE.termeditor.updatePlacementQueueItem(row.dataset.queueId, { label: e.target.value });
    });
    partList.addEventListener("click", function (e) {
      if (!e.target.classList.contains("pdel")) return;
      var row = e.target.closest(".part-preset-row");
      delete presetSelection[presetSelectionKey("part", row.dataset.queueId)];
      WE.termeditor.removePlacementQueueItem(row.dataset.queueId);
      renderPresetList();
    });
    document.getElementById("presetRestoreDefaults").addEventListener("click", function () {
      WE.presets.restoreDefaults(); renderPresetList(); onPresetsChanged();
    });

    // 공용 단자 새로 만들기 — 부품 단자의 ＋추가 와 같은 모양·같은 자리(칼럼 맨 아래)
    WE.colorPicker.attach(document.getElementById("newCommonColor"), {});
    function addCommonFromInput() {
      var labelInput = document.getElementById("newCommonLabel");
      var label = labelInput.value.trim();
      if (!label) { labelInput.focus(); return; }
      var color = document.getElementById("newCommonColor").dataset.color || "#1e88e5";
      WE.presets.add(label, color);
      labelInput.value = "";
      renderPresetList();
      onPresetsChanged();
      labelInput.focus();
      setHint(WE.i18n.t("공용 단자를 추가했습니다: ") + label);
    }
    document.getElementById("btnAddCommon").addEventListener("click", addCommonFromInput);
    document.getElementById("newCommonLabel").addEventListener("keydown", function (e) {
      if (e.key !== "Enter" || e.isComposing || e.keyCode === 229) return;
      e.preventDefault();
      addCommonFromInput();
    });

    // 세트 저장
    function saveSetFromInput() {
      var nameInput = document.getElementById("presetSetName");
      var name = nameInput.value.trim();
      if (!name) { nameInput.focus(); setHint(WE.i18n.t("세트 이름을 입력하세요.")); return; }
      var items = selectedOrAllQueueItems();
      if (!items.length) { setHint(WE.i18n.t("저장할 부품 단자가 없습니다.")); return; }
      var exists = WE.presetSets.byName(name);
      if (exists && !confirm(WE.i18n.t("이미 있는 세트입니다: ") + name +
        WE.i18n.t("\n\n지금 목록으로 덮어쓸까요?"))) return;
      try {
        var r = WE.presetSets.put(name, items);
        nameInput.value = "";
        renderPresetSets();
        setHint((r.replaced ? WE.i18n.t("세트를 덮어썼습니다: ") : WE.i18n.t("세트를 저장했습니다: ")) +
          r.name + " (" + r.count + WE.i18n.t("개)"));
      } catch (e) { setHint(e.message); }
    }
    document.getElementById("btnSavePresetSet").addEventListener("click", saveSetFromInput);
    document.getElementById("presetSetName").addEventListener("keydown", function (e) {
      if (e.key !== "Enter" || e.isComposing || e.keyCode === 229) return;
      e.preventDefault(); saveSetFromInput();
    });

    // 세트 고르기 = 불러오기. 다만 **한 번 물어본다** —
    // 실수로 목록을 건드리면 32개가 통째로 붙어 되돌리기가 번거롭다(2026-08-30 확정).
    // ⚠ 중복을 지우지 않는다 — GND 가 여러 개인 것이 정상이다.
    document.getElementById("presetSetPick").addEventListener("change", function (e) {
      var set = e.target.value ? WE.presetSets.get(e.target.value) : null;
      document.getElementById("btnDelPresetSet").disabled = !e.target.value;
      if (!set) return;
      var ok = confirm(WE.i18n.t("「") + set.name + WE.i18n.t("」의 단자 ") + set.items.length +
        WE.i18n.t("개를 부품 단자 맨 뒤에 추가합니다.\n\n불러올까요?"));
      // ⚠ 취소해도 **고른 상태를 유지한다.**
      //    예전엔 취소하면 선택을 풀어 버려서, 삭제(×)를 하려면 반드시 한 번 불러와야 했다.
      //    고르는 것은 '이 세트를 쓰겠다'는 뜻일 뿐이고, 불러올지는 이 확인창이 정한다.
      if (!ok) { setHint(WE.i18n.t("불러오지 않았습니다. 지우려면 옆의 × 를 누르세요.")); return; }
      var added = 0;
      set.items.forEach(function (t) {
        if (WE.termeditor.addPlacementQueueItem(t.label, t.color)) added++;
      });
      renderPresetList();
      setHint(WE.i18n.t("불러왔습니다: ") + set.name + " (" + added + WE.i18n.t("개 추가)"));
    });

    document.getElementById("btnDelPresetSet").addEventListener("click", function () {
      var sel = document.getElementById("presetSetPick");
      var set = sel.value ? WE.presetSets.get(sel.value) : null;
      if (!set) return;
      if (!confirm(WE.i18n.t("세트를 지웁니다: ") + set.name +
        WE.i18n.t("\n\n이미 부품에 추가한 단자는 그대로 남습니다."))) return;
      WE.presetSets.remove(set.id);
      sel.value = "";
      renderPresetSets();
      setHint(WE.i18n.t("세트를 지웠습니다: ") + set.name);
    });
    function applySelectedPresetColor(color) {
      color = WE.colorPicker.normalizeHex(color);
      if (!color || !Object.keys(presetSelection).length) return;
      var commonIds = selectedPresetIds("common");
      var commonBefore = commonIds.map(function (id) {
        var preset = WE.presets.get(id);
        return preset ? { id: id, label: preset.label, color: preset.color } : null;
      }).filter(Boolean);
      WE.presets.updateMany(commonIds, { color: color });
      commonBefore.forEach(function (before) {
        WE.termeditor.syncPlacedPreset("common", before.id, before, { color: color });
      });
      WE.termeditor.updatePlacementQueueItems(selectedPresetIds("part"), { color: color });
      renderPresetList(); onPresetsChanged();
    }
    // 다중 선택 일괄 색상 — 선택된 단자가 여럿이라 renderPresetList() 로 목록 전체를 다시 그린다.
    // 그래서 드래그 픽셀마다(onInput) 부르지 않고, 값이 확정되는 순간(onCommit: 마우스를 뗐을 때·
    // HEX/RGB 입력 확정·기본/최근 색상 클릭)에만 실제로 적용한다. 팝오버 자체 미리보기는 계속 실시간이다.
    WE.colorPicker.attach(document.getElementById("presetBulkColor"), {
      getColor: function () {
        var keys = Object.keys(presetSelection);
        if (!keys.length) return "#1e88e5";
        var first = keys[0].split(":");
        var item = first[0] === "common"
          ? WE.presets.get(first.slice(1).join(":"))
          : WE.termeditor.getPlacementQueue().filter(function (p) { return p.id === first.slice(1).join(":"); })[0];
        return item ? item.color : "#1e88e5";
      },
      onCommit: function (color) { applySelectedPresetColor(color); }
    });
    document.getElementById("presetClearSelection").addEventListener("click", function () { clearPresetSelection(); });

    var columns = document.querySelector(".preset-manager-columns");
    columns.addEventListener("click", function (e) {
      if (suppressPresetClick || e.target.closest(".pdel")) return;
      var row = e.target.closest(".preset-row,.part-preset-row");
      if (row) {
        // 공용 단자를 그냥 누르면 **부품 단자에 바로 추가**한다.
        // 공용 단자는 '가져다 쓰는 재료'라, 쓰려고 끌어오는 동작(드래그)이 번거로웠다.
        // 여러 번 누르면 여러 번 들어간다 — GND 를 세 개 쓰는 부품이 실제로 있다.
        //
        // 색상칸·이름칸·손잡이를 누른 것은 각자의 조작이므로 추가로 치지 않는다.
        // 여러 개를 골라 색을 한 번에 바꾸는 기존 방식은 Ctrl/Shift+클릭으로 그대로 쓴다.
        var common = row.classList.contains("preset-row");
        if (common && e.target.closest(".pedit")) { beginCommonEdit(row); return; }
        // 수정 모드인 줄은 그대로 둔다 — 고치는 중에 눌렀다고 추가되면 안 된다
        if (common && row.classList.contains("editing")) return;
        var onControl = !!e.target.closest(".preset-drag-handle");
        if (common && !onControl && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
          var p = WE.presets.get(row.dataset.id);
          if (p && WE.termeditor.addPlacementQueueItem(p.label, p.color)) {
            renderPresetList();
            setHint(WE.i18n.t("부품 단자에 추가: ") + p.label);
          }
          return;
        }
        selectPresetRow(row, e);
      }
      else if (e.target.closest(".preset-list,.preset-manager-section")) clearPresetSelection();
    });
    // 공용 단자 **수정 모드** — 연필(✎) 버튼으로만 연다. 이름과 색상을 둘 다 고칠 수 있다.
    // 평소에는 행 전체가 버튼이라 안쪽 조작기가 클릭을 안 먹는데(CSS pointer-events),
    // 수정 모드에서만 살려 준다. 다 고치면 포커스가 줄을 벗어날 때 잠근다.
    function endCommonEdit(row) {
      if (!row) return;
      row.classList.remove("editing");
      row.draggable = true;
      var label = row.querySelector(".plabel");
      if (label) label.readOnly = true;
    }
    function beginCommonEdit(row) {
      if (!row || row.classList.contains("editing")) return;
      // 한 번에 한 줄만 고친다 — 여러 줄이 열려 있으면 어디를 고치는지 헷갈린다
      columns.querySelectorAll(".preset-row.editing").forEach(endCommonEdit);
      row.classList.add("editing");
      row.draggable = false;   // 글자를 고르려고 끄는 동작과 부딪힌다
      var label = row.querySelector(".plabel");
      if (label) { label.readOnly = false; label.focus(); label.select(); }
    }
    columns.addEventListener("focusout", function (e) {
      var row = e.target.closest(".preset-row.editing"); if (!row) return;
      // 색상 팝오버로 포커스가 옮겨간 경우까지 닫아 버리면 색을 못 고른다.
      // 다음 틱에 아직 이 줄 밖에 있는지 확인하고 잠근다.
      setTimeout(function () {
        if (!row.isConnected) return;
        if (row.contains(document.activeElement)) return;
        if (document.querySelector(".cc-popover:not([hidden])")) return;   // 색 고르는 중
        endCommonEdit(row);
      }, 0);
    });
    columns.addEventListener("keydown", function (e) {
      if (!e.target.classList.contains("plabel")) return;
      var row = e.target.closest(".preset-row.editing"); if (!row) return;
      if (e.key === "Enter" || e.key === "Escape") { e.preventDefault(); e.target.blur(); endCommonEdit(row); }
    });

    columns.addEventListener("dragstart", function (e) {
      // 공용 단자는 **행 어디를 잡아도** 끌 수 있다.
      // 행 전체를 버튼으로 만든 뒤 손잡이(⠿)만 잡아야 하는 게 눈에 안 띄어
      // "위아래 이동이 안 된다"가 됐다(2026-08-30). 부품 단자는 예전대로 손잡이만.
      var handle = e.target.closest(".preset-drag-handle");
      var row = handle ? (handle.closest(".preset-row") || handle.closest(".part-preset-row"))
                       : e.target.closest(".preset-row");
      if (!row || row.classList.contains("editing")) return;   // 수정 중에는 끌지 않는다
      var info = presetRowInfo(row); if (!info) return;
      var key = presetSelectionKey(info.type, info.id);
      if (!presetSelection[key]) {
        presetSelection = {}; presetSelection[key] = true; presetAnchor[info.type] = info.id;
        updatePresetSelectionUi();
      }
      var selector = info.type === "common" ? ".preset-row" : ".part-preset-row";
      var ids = [].slice.call(document.querySelectorAll(selector)).map(presetRowInfo).filter(function (item) {
        return presetSelection[presetSelectionKey(item.type, item.id)];
      }).map(function (item) { return item.id; });
      dragItem = { type: info.type, ids: ids };
      document.querySelectorAll(selector).forEach(function (itemRow) {
        var item = presetRowInfo(itemRow); itemRow.classList.toggle("dragging", ids.indexOf(item.id) >= 0);
      });
      suppressPresetClick = true;
      e.dataTransfer.effectAllowed = "copyMove";
      e.dataTransfer.setData("text/plain", dragItem.type + ":" + dragItem.ids.join(","));
    });
    columns.addEventListener("dragend", function () {
      dragItem = null;
      clearPresetDragState();
      setTimeout(function () { suppressPresetClick = false; }, 0);
    });
    columns.addEventListener("dragover", function (e) {
      var section = e.target.closest("[data-preset-drop]"); if (!section || !dragItem) return;
      e.preventDefault(); e.dataTransfer.dropEffect = dragItem.type === section.dataset.presetDrop ? "move" : "copy";
      columns.querySelectorAll(".drop-active").forEach(function (el) { el.classList.remove("drop-active"); });
      columns.querySelectorAll(".drop-before,.drop-after").forEach(function (el) { el.classList.remove("drop-before", "drop-after"); });
      section.classList.add("drop-active");
      var row = e.target.closest(section.dataset.presetDrop === "common" ? ".preset-row" : ".part-preset-row");
      if (row && !row.classList.contains("dragging")) {
        var after = e.clientY > row.getBoundingClientRect().top + row.offsetHeight / 2;
        row.classList.add(after ? "drop-after" : "drop-before");
      }
    });
    columns.addEventListener("drop", function (e) {
      var section = e.target.closest("[data-preset-drop]"); if (!section || !dragItem) return;
      e.preventDefault();
      var targetRow = e.target.closest(section.dataset.presetDrop === "common" ? ".preset-row" : ".part-preset-row");
      var beforeId = targetRow ? (targetRow.dataset.id || targetRow.dataset.queueId) : null;
      if (targetRow && e.clientY > targetRow.getBoundingClientRect().top + targetRow.offsetHeight / 2) {
        var next = targetRow.nextElementSibling;
        beforeId = next ? (next.dataset.id || next.dataset.queueId) : null;
      }
      if (dragItem.ids.indexOf(beforeId) >= 0) {
        dragItem = null; clearPresetDragState(); setTimeout(function () { suppressPresetClick = false; }, 0); return;
      }
      if (section.dataset.presetDrop === "part") {
        if (dragItem.type === "part") WE.termeditor.reorderPlacementQueueItems(dragItem.ids, beforeId);
        else dragItem.ids.forEach(function (id) {
          var added = WE.termeditor.addCommonToQueue(id);
          if (added && beforeId) WE.termeditor.reorderPlacementQueue(added.id, beforeId);
        });
      } else if (dragItem.type === "common") WE.presets.reorderManyBefore(dragItem.ids, beforeId);
      else {
        var queue = WE.termeditor.getPlacementQueue();
        dragItem.ids.forEach(function (id) {
          var source = queue.filter(function (p) { return p.id === id; })[0];
          if (source) {
            var commonAdded = WE.presets.addUnique(source.label, source.color);
            if (beforeId) WE.presets.reorderBefore(commonAdded.id, beforeId);
          }
        });
      }
      dragItem = null; clearPresetDragState(); renderPresetList(); onPresetsChanged();
      setTimeout(function () { suppressPresetClick = false; }, 0);
    });
  }

  function openPresetModal() {
    clearPresetSelection();
    renderPresetList();
    renderPresetSets();
    document.getElementById("presetModal").hidden = false;
    requestAnimationFrame(function () {
      document.getElementById("newPresetLabel").focus();
    });
  }

  // 공용 단자 하나의 색상을 바꾼다 — 이미 배치된 단자 동기화(syncPlacedPreset)까지 함께 처리한다.
  // 팝오버의 onInput(드래그 중)·onCommit(확정) 양쪽 모두 이 함수를 그대로 쓴다.
  function applyCommonPresetColor(id, color) {
    var preset = WE.presets.get(id); if (!preset) return;
    var before = { label: preset.label, color: preset.color };
    WE.presets.update(id, { color: color });
    WE.termeditor.syncPlacedPreset("common", id, before, { color: color });
    onPresetsChanged();
  }
  // ---- 단자 세트 (부품 단자 목록을 이름 붙여 저장·재사용) ----
  function renderPresetSets() {
    var sel = document.getElementById("presetSetPick");
    var del = document.getElementById("btnDelPresetSet");
    if (!sel) return;
    var keep = sel.value;
    var sets = WE.presetSets.getAll();
    sel.innerHTML = "";
    var ph = document.createElement("option");
    ph.value = ""; ph.textContent = "…";
    sel.appendChild(ph);
    sets.forEach(function (s) {
      var o = document.createElement("option");
      o.value = s.id; o.textContent = s.name + " (" + s.items.length + ")";
      sel.appendChild(o);
    });
    if (keep && sel.querySelector('option[value="' + keep + '"]')) sel.value = keep;
    sel.disabled = !sets.length;
    if (del) del.disabled = !sel.value;
  }

  // 저장 — 고른 단자가 있으면 그것만, 없으면 **목록 전체**를 담는다.
  // 32개를 일일이 고르는 건 현실적이지 않고, 대개 원하는 건 "이 부품 구성 통째로"다.
  function selectedOrAllQueueItems() {
    var queue = WE.termeditor.getPlacementQueue();
    var picked = selectedPresetIds("part");
    if (!picked.length) return queue;
    // 화면에 보이는 차례를 지킨다 — 배치 순서가 곧 작업 순서다
    return queue.filter(function (q) { return picked.indexOf(q.id) >= 0; });
  }

  function renderPresetList() {
    var pl = document.getElementById("presetList");
    pl.innerHTML = "";
    WE.presets.getAll().forEach(function (p) {
      var row = document.createElement("div");
      row.className = "preset-row"; row.dataset.id = p.id;
      var handle = document.createElement("span");
      handle.className = "preset-drag-handle"; handle.draggable = true; handle.textContent = "⋮⋮";
      handle.title = WE.i18n.t("드래그해서 순서 변경 또는 현재 부품에 복사");
      var color = document.createElement("button");
      color.type = "button"; color.className = "color-trigger";
      WE.colorPicker.attach(color, {
        getColor: function () { return p.color; },
        onInput: function (c) { applyCommonPresetColor(p.id, c); },
        onCommit: function (c) { applyCommonPresetColor(p.id, c); }
      });
      var label = document.createElement("input");
      label.type = "text"; label.className = "plabel"; label.value = p.label;
      // 평소엔 읽기전용 — 행 전체가 '부품 단자에 추가' 버튼이기 때문이다.
      // 고치려면 더블클릭(수정 모드). 그래야 누르려다 편집이 열리는 일이 없다.
      label.readOnly = true;
      row.draggable = true;   // 손잡이뿐 아니라 행 어디를 잡아도 순서를 옮길 수 있다
      row.title = WE.i18n.t("클릭: 부품 단자에 추가 · 드래그: 순서 변경");
      // 수정은 연필 버튼으로만 연다.
      // 더블클릭은 쓸 수 없다 — 앞선 클릭 두 번이 먼저 단자를 두 개 추가해 버리고,
      // 그때마다 목록을 다시 그려서 더블클릭이 갈 줄이 사라진다(2026-08-30 확인).
      var edit = document.createElement("button");
      edit.className = "pedit"; edit.type = "button"; edit.textContent = "✎";
      edit.title = WE.i18n.t("이름·색상 수정"); edit.setAttribute("aria-label", WE.i18n.t("이름·색상 수정"));
      var del = document.createElement("button");
      del.className = "pdel"; del.type = "button"; del.textContent = "×"; del.title = WE.i18n.t("단자 삭제"); del.setAttribute("aria-label", WE.i18n.t("단자 삭제"));
      row.appendChild(handle); row.appendChild(color); row.appendChild(label);
      row.appendChild(edit); row.appendChild(del);
      pl.appendChild(row);
    });
    var partList = document.getElementById("partPresetList");
    partList.innerHTML = "";
    var queue = WE.termeditor.getPlacementQueue();
    queue.forEach(function (p) {
      var row = document.createElement("div"); row.className = "part-preset-row"; row.dataset.queueId = p.id;
      var handle = document.createElement("span");
      handle.className = "preset-drag-handle"; handle.draggable = true; handle.textContent = "⋮⋮";
      handle.title = WE.i18n.t("드래그해서 배치 순서 변경 또는 공용 단자에 복사");
      var color = document.createElement("button");
      color.type = "button"; color.className = "color-trigger";
      WE.colorPicker.attach(color, {
        getColor: function () { return p.color; },
        onInput: function (c) { WE.termeditor.updatePlacementQueueItem(p.id, { color: c }); },
        onCommit: function (c) { WE.termeditor.updatePlacementQueueItem(p.id, { color: c }); }
      });
      var label = document.createElement("input"); label.type = "text"; label.className = "plabel"; label.value = p.label;
      var del = document.createElement("button"); del.className = "pdel"; del.type = "button"; del.textContent = "×"; del.title = WE.i18n.t("단자 삭제"); del.setAttribute("aria-label", WE.i18n.t("단자 삭제"));
      row.appendChild(handle); row.appendChild(color); row.appendChild(label); row.appendChild(del); partList.appendChild(row);
    });
    document.getElementById("partPresetCount").textContent = queue.length + WE.i18n.t("개");
    updatePresetSelectionUi();
  }

  // 프리셋 목록 변경 시 관련 UI 갱신
  function onPresetsChanged() {
    if (WE.termeditor.isOpen()) WE.termeditor.refreshPresets();
  }
  // 처음 열 때 한 번만 이벤트를 묶는다 — 화면마다 초기화 시점이 달라서,
  // 부르는 쪽이 init 을 기억해야 하면 빠뜨리기 쉽다(bgremove.init 을 실제로 빠뜨렸다).
  var bound = false;
  function open() {
    if (!bound) { bound = true; bindPresetModal(); }
    openPresetModal();
  }
  return { open: open, renderList: renderPresetList, onPresetsChanged: onPresetsChanged };
})();
