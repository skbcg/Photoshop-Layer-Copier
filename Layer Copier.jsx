// Copy Layer to Matching Artboards - Enhanced
// - Single layer selected: copies to all same-size artboards (original behavior)
// - Multiple artboards selected: dialog to choose layer, copies each to matching-size artboards

(function () {
  var doc = app.activeDocument;

  // ─── Artboard Utilities ───────────────────────────────────────────────────

  function isArtboard(layer) {
    try {
      var ref = new ActionReference();
      ref.putIdentifier(charIDToTypeID("Lyr "), layer.id);
      var desc = executeActionGet(ref);
      return desc.hasKey(stringIDToTypeID("artboard"));
    } catch (e) {
      return false;
    }
  }

  function getArtboardRect(layer) {
    try {
      var ref = new ActionReference();
      ref.putIdentifier(charIDToTypeID("Lyr "), layer.id);
      var desc = executeActionGet(ref);
      var ab   = desc.getObjectValue(stringIDToTypeID("artboard"));
      var rect = ab.getObjectValue(stringIDToTypeID("artboardRect"));
      return {
        left:   rect.getDouble(stringIDToTypeID("left")),
        top:    rect.getDouble(stringIDToTypeID("top")),
        right:  rect.getDouble(stringIDToTypeID("right")),
        bottom: rect.getDouble(stringIDToTypeID("bottom"))
      };
    } catch (e) {
      return null;
    }
  }

  function artboardSize(rect) {
    return {
      w: Math.round(rect.right  - rect.left),
      h: Math.round(rect.bottom - rect.top)
    };
  }

  function sizeKey(w, h) { return w + "x" + h; }

  // ─── Layer Utilities ──────────────────────────────────────────────────────

  function getParentArtboard(layer) {
    var parent = layer.parent;
    while (parent) {
      if (parent.constructor.name === "LayerSet" && isArtboard(parent)) return parent;
      parent = parent.parent;
    }
    return null;
  }

  // Find a direct child layer by name inside a LayerSet
  function findLayerByName(layerSet, name) {
    for (var i = 0; i < layerSet.layers.length; i++) {
      if (layerSet.layers[i].name === name) return layerSet.layers[i];
    }
    return null;
  }

  // Recursively collect all layer names inside a LayerSet
  function collectLayerNames(layerSet, namesMap) {
    for (var i = 0; i < layerSet.layers.length; i++) {
      var l = layerSet.layers[i];
      namesMap[l.name] = true;
      if (l.typename === "LayerSet") collectLayerNames(l, namesMap);
    }
  }

  // Find a layer by name recursively
  function findLayerRecursive(layerSet, name) {
    for (var i = 0; i < layerSet.layers.length; i++) {
      var l = layerSet.layers[i];
      if (l.name === name) return l;
      if (l.typename === "LayerSet") {
        var found = findLayerRecursive(l, name);
        if (found) return found;
      }
    }
    return null;
  }

  // ─── Copy Logic ───────────────────────────────────────────────────────────

  function copyLayerToMatchingArtboards(sourceLayer, sourceArtboard, allArtboards) {
    var sourceRect = getArtboardRect(sourceArtboard);
    if (!sourceRect) return { count: 0, error: "Could not read source artboard rect." };

    var size      = artboardSize(sourceRect);
    var srcBounds = sourceLayer.bounds;
    var relX      = srcBounds[0].value - sourceRect.left;
    var relY      = srcBounds[1].value - sourceRect.top;

    var count = 0;
    for (var i = 0; i < allArtboards.length; i++) {
      var ab = allArtboards[i];
      if (ab.id === sourceArtboard.id) continue;

      var rect = getArtboardRect(ab);
      if (!rect) continue;

      var abSize = artboardSize(rect);
      if (abSize.w !== size.w || abSize.h !== size.h) continue;

      var duped      = sourceLayer.duplicate(ab, ElementPlacement.PLACEATBEGINNING);
      var dupBounds  = duped.bounds;
      var targetLeft = rect.left + relX;
      var targetTop  = rect.top  + relY;

      duped.translate(
        targetLeft - dupBounds[0].value,
        targetTop  - dupBounds[1].value
      );
      count++;
    }
    return { count: count, error: null };
  }

  // ─── Get All Artboards in Document ───────────────────────────────────────

  function getAllArtboards() {
    var result = [];
    for (var i = 0; i < doc.layers.length; i++) {
      if (isArtboard(doc.layers[i])) result.push(doc.layers[i]);
    }
    return result;
  }

  // ─── Get Selected Layers via Action Manager ───────────────────────────────

  function getSelectedLayers() {
    var selected = [];
    try {
      var ref  = new ActionReference();
      ref.putEnumerated(charIDToTypeID("Dcmn"), charIDToTypeID("Ordn"), charIDToTypeID("Trgt"));
      var desc = executeActionGet(ref);
      var list = desc.getList(stringIDToTypeID("targetLayers"));
      for (var i = 0; i < list.count; i++) {
        var idx = list.getReference(i);
        // Resolve layer by index
        var lRef = new ActionReference();
        lRef.putIndex(charIDToTypeID("Lyr "), idx.getIndex() + 1);
        var lDesc = executeActionGet(lRef);
        var layerId = lDesc.getInteger(stringIDToTypeID("layerID"));
        // Match to doc layer
        for (var j = 0; j < doc.layers.length; j++) {
          if (doc.layers[j].id === layerId) {
            selected.push(doc.layers[j]);
            break;
          }
        }
      }
    } catch (e) {}
    return selected;
  }

  // ─── Dialog: Multi-Artboard Mode ─────────────────────────────────────────

  function showMultiArtboardDialog(selectedArtboards, allArtboards) {
    // Collect all layer names across selected artboards
    var namesMap = {};
    for (var i = 0; i < selectedArtboards.length; i++) {
      collectLayerNames(selectedArtboards[i], namesMap);
    }

    var namesList = [];
    for (var key in namesMap) {
      if (namesMap.hasOwnProperty(key)) namesList.push(key);
    }
    namesList.sort();

    if (namesList.length === 0) {
      alert("No layers found inside the selected artboards.");
      return;
    }

    // Build preview data
    function buildPreview(layerName) {
      var lines = [];
      var totalCopies = 0;
      for (var i = 0; i < selectedArtboards.length; i++) {
        var ab   = selectedArtboards[i];
        var rect = getArtboardRect(ab);
        if (!rect) continue;

        var layer = findLayerRecursive(ab, layerName);
        if (!layer) {
          lines.push("  \u26A0 \"" + ab.name + "\" \u2014 layer not found, will skip");
          continue;
        }

        var size    = artboardSize(rect);
        var matches = 0;
        for (var j = 0; j < allArtboards.length; j++) {
          if (allArtboards[j].id === ab.id) continue;
          var r2 = getArtboardRect(allArtboards[j]);
          if (!r2) continue;
          var s2 = artboardSize(r2);
          if (s2.w === size.w && s2.h === size.h) matches++;
        }
        totalCopies += matches;
        lines.push("  \u2022 \"" + ab.name + "\" (" + size.w + "\xD7" + size.h + ") \u2192 " + matches + " other artboard" + (matches !== 1 ? "s" : ""));
      }
      lines.push("");
      lines.push("Total copies to be made: " + totalCopies);
      return lines.join("\n");
    }

    // ── Build Dialog ──
    var dlg = new Window("dialog", "Copy Layer to Matching Artboards");
    dlg.orientation = "column";
    dlg.alignChildren = ["fill", "top"];
    dlg.spacing = 12;
    dlg.margins = 18;

    // Layer selector
    var selectorGroup = dlg.add("group");
    selectorGroup.orientation = "row";
    selectorGroup.alignChildren = ["left", "center"];
    selectorGroup.add("statictext", undefined, "Layer to copy:");
    var dropdown = selectorGroup.add("dropdownlist", undefined, namesList);
    dropdown.selection = 0;
    dropdown.preferredSize.width = 220;

    // Preview panel
    var previewPanel = dlg.add("panel", undefined, "Preview");
    previewPanel.alignChildren = ["fill", "top"];
    previewPanel.margins = 12;
    var previewText = previewPanel.add("statictext", undefined, "", { multiline: true });
    previewText.preferredSize = [360, 120];

    function updatePreview() {
      if (dropdown.selection) {
        previewText.text = buildPreview(dropdown.selection.text);
      }
    }

    dropdown.onChange = updatePreview;
    updatePreview();

    // Buttons
    var btnGroup = dlg.add("group");
    btnGroup.orientation = "row";
    btnGroup.alignment = "right";
    var cancelBtn = btnGroup.add("button", undefined, "Cancel", { name: "cancel" });
    var runBtn    = btnGroup.add("button", undefined, "Run",    { name: "ok" });

    cancelBtn.onClick = function () { dlg.close(); };

    runBtn.onClick = function () {
      if (!dropdown.selection) { alert("Please select a layer."); return; }
      var layerName  = dropdown.selection.text;
      var totalCount = 0;
      var skipped    = 0;

      for (var i = 0; i < selectedArtboards.length; i++) {
        var ab    = selectedArtboards[i];
        var layer = findLayerRecursive(ab, layerName);
        if (!layer) { skipped++; continue; }

        var result = copyLayerToMatchingArtboards(layer, ab, allArtboards);
        totalCount += result.count;
      }

      dlg.close();

      var msg = "Done! Copied \"" + layerName + "\" to " + totalCount + " artboard" + (totalCount !== 1 ? "s" : "") + ".";
      if (skipped > 0) msg += "\n(" + skipped + " selected artboard" + (skipped !== 1 ? "s" : "") + " did not contain that layer and were skipped.)";
      alert(msg);
    };

    dlg.show();
  }

  // ─── Main Entry Point ─────────────────────────────────────────────────────

  var allArtboards    = getAllArtboards();
  var selectedLayers  = getSelectedLayers();

  // Determine mode
  var selectedArtboards = [];
  for (var i = 0; i < selectedLayers.length; i++) {
    if (isArtboard(selectedLayers[i])) selectedArtboards.push(selectedLayers[i]);
  }

  // ── Mode A: Single layer selected ──
  if (selectedArtboards.length === 0) {
    var sourceLayer = doc.activeLayer;
    if (!sourceLayer) { alert("No layer selected."); return; }

    var sourceArtboard = getParentArtboard(sourceLayer);
    if (!sourceArtboard) { alert("Selected layer must be inside an artboard."); return; }

    var result = copyLayerToMatchingArtboards(sourceLayer, sourceArtboard, allArtboards);
    if (result.error) { alert(result.error); return; }

    var rect   = getArtboardRect(sourceArtboard);
    var size   = artboardSize(rect);
    return;
  }

  // ── Mode B: Artboards selected ──
  showMultiArtboardDialog(selectedArtboards, allArtboards);

})();