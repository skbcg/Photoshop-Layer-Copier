// Copy Layer to Matching Artboards - Enhanced
// - Single layer selected: copies to all same-size artboards (original behavior)
// - Multiple artboards selected: scope dialog (this doc / open docs / folder), then
//   multi-select layer picker (dialog stays open so you can copy additional layers)

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

  function getLayerTransformBounds(layer) {
    try {
      if (layer.boundsNoEffects) return layer.boundsNoEffects;
    } catch (e) {}
    return layer.bounds;
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

  function selectLayerById(layerId) {
    var ref = new ActionReference();
    ref.putIdentifier(charIDToTypeID("Lyr "), layerId);
    var desc = new ActionDescriptor();
    desc.putReference(charIDToTypeID("null"), ref);
    desc.putBoolean(charIDToTypeID("MkVs"), false);
    executeAction(charIDToTypeID("slct"), desc, DialogModes.NO);
  }

  function copyLayerEffectsBetweenDocuments(sourceLayer, targetLayer, targetDoc) {
    try {
      app.activeDocument = doc;
      selectLayerById(sourceLayer.id);
      executeAction(stringIDToTypeID("copyEffects"), new ActionDescriptor(), DialogModes.NO);

      app.activeDocument = targetDoc;
      selectLayerById(targetLayer.id);
      executeAction(stringIDToTypeID("pasteEffects"), new ActionDescriptor(), DialogModes.NO);
      return true;
    } catch (e) {
      return false;
    }
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

  // If a same-named layer exists in the artboard, remove it and return where
  // the replacement should be inserted (same parent / stack position when possible).
  // Returns { removed: bool, container: LayerSet|Artboard, relative: Layer|null, placement: ElementPlacement }
  function prepareReplaceSlot(artboard, layerName) {
    var existing = findLayerRecursive(artboard, layerName);
    if (!existing) {
      return {
        removed: false,
        container: artboard,
        relative: null,
        placement: ElementPlacement.PLACEATBEGINNING
      };
    }

    var parent = existing.parent;
    var siblings = parent.layers;
    var idx = -1;
    for (var i = 0; i < siblings.length; i++) {
      if (siblings[i].id === existing.id) { idx = i; break; }
    }

    // Layer below the existing one (higher index = lower in the stack)
    var below = (idx >= 0 && idx + 1 < siblings.length) ? siblings[idx + 1] : null;
    existing.remove();

    if (below) {
      return {
        removed: true,
        container: parent,
        relative: below,
        placement: ElementPlacement.PLACEBEFORE
      };
    }
    return {
      removed: true,
      container: parent,
      relative: null,
      placement: ElementPlacement.PLACEATBEGINNING
    };
  }

  function duplicateIntoSlot(sourceLayer, artboard, layerName, replaceExisting) {
    if (replaceExisting) {
      var slot = prepareReplaceSlot(artboard, layerName);
      if (slot.relative) {
        return {
          layer: sourceLayer.duplicate(slot.relative, slot.placement),
          replaced: slot.removed
        };
      }
      return {
        layer: sourceLayer.duplicate(slot.container, slot.placement),
        replaced: slot.removed
      };
    }
    return {
      layer: sourceLayer.duplicate(artboard, ElementPlacement.PLACEATBEGINNING),
      replaced: false
    };
  }

  // ─── Copy Logic ───────────────────────────────────────────────────────────

  function copyLayerToMatchingArtboards(sourceLayer, sourceArtboard, allArtboards, replaceExisting) {
    var sourceRect = getArtboardRect(sourceArtboard);
    if (!sourceRect) return { count: 0, replaced: 0, error: "Could not read source artboard rect." };

    var size      = artboardSize(sourceRect);
    var srcBounds = getLayerTransformBounds(sourceLayer);
    var relX      = srcBounds[0].value - sourceRect.left;
    var relY      = srcBounds[1].value - sourceRect.top;
    var layerName = sourceLayer.name;

    var count = 0;
    var replaced = 0;
    for (var i = 0; i < allArtboards.length; i++) {
      var ab = allArtboards[i];
      if (ab.id === sourceArtboard.id) continue;

      var rect = getArtboardRect(ab);
      if (!rect) continue;

      var abSize = artboardSize(rect);
      if (abSize.w !== size.w || abSize.h !== size.h) continue;

      var placed     = duplicateIntoSlot(sourceLayer, ab, layerName, replaceExisting);
      var duped      = placed.layer;
      if (placed.replaced) replaced++;
      var dupBounds  = getLayerTransformBounds(duped);
      var targetLeft = rect.left + relX;
      var targetTop  = rect.top  + relY;

      duped.translate(
        targetLeft - dupBounds[0].value,
        targetTop  - dupBounds[1].value
      );
      count++;
    }
    return { count: count, replaced: replaced, error: null };
  }

  // ─── Get All Artboards in Document ───────────────────────────────────────

  function getAllArtboards(targetDoc) {
    var d = targetDoc || doc;
    var result = [];
    for (var i = 0; i < d.layers.length; i++) {
      if (isArtboard(d.layers[i])) result.push(d.layers[i]);
    }
    return result;
  }

  // ─── Cross-Document Copy ──────────────────────────────────────────────────

  // Copies the named layer from every selected source artboard into matching-size
  // artboards in targetDoc. All copies share ONE embedded smart object (the first
  // cross-doc duplicate), then every additional placement is a within-doc duplicate
  // so they remain linked to each other inside the target document.
  function moveIntoSlot(layer, artboard, layerName, replaceExisting) {
    if (replaceExisting) {
      var slot = prepareReplaceSlot(artboard, layerName);
      if (slot.relative) {
        layer.move(slot.relative, slot.placement);
      } else {
        layer.move(slot.container, slot.placement);
      }
      return slot.removed;
    }
    layer.move(artboard, ElementPlacement.PLACEATBEGINNING);
    return false;
  }

  function copyLayersToDocument(selectedArtboards, layerName, targetDoc, replaceExisting) {
    // Gather all target artboards while targetDoc is active
    app.activeDocument = targetDoc;
    var targetArtboards = getAllArtboards(targetDoc);

    // Build source candidates first; then map exactly one candidate per target artboard.
    // This avoids duplicate copies when multiple selected source artboards share a size.
    var sourceCandidates = [];
    var placements       = [];
    var skipped          = 0;
    var replaced         = 0;

    for (var i = 0; i < selectedArtboards.length; i++) {
      app.activeDocument = doc;
      var ab    = selectedArtboards[i];
      var layer = findLayerRecursive(ab, layerName);
      if (!layer) { skipped++; continue; }

      var sourceRect = getArtboardRect(ab);
      if (!sourceRect) continue;
      var size      = artboardSize(sourceRect);
      var srcBounds = getLayerTransformBounds(layer);
      var relX      = srcBounds[0].value - sourceRect.left;
      var relY      = srcBounds[1].value - sourceRect.top;

      var srcW = srcBounds[2].value - srcBounds[0].value;
      var srcH = srcBounds[3].value - srcBounds[1].value;

      sourceCandidates.push({
        sourceLayer: layer,
        sourceArtboardName: ab.name,
        sizeKey: sizeKey(size.w, size.h),
        relX: relX,
        relY: relY,
        srcWidth: srcW,
        srcHeight: srcH
      });
    }

    app.activeDocument = targetDoc;
    for (var k = 0; k < targetArtboards.length; k++) {
      var targetAb = targetArtboards[k];
      var rect = getArtboardRect(targetAb);
      if (!rect) continue;

      var targetSize = artboardSize(rect);
      var targetKey = sizeKey(targetSize.w, targetSize.h);

      var candidates = [];
      for (var c = 0; c < sourceCandidates.length; c++) {
        if (sourceCandidates[c].sizeKey === targetKey) candidates.push(sourceCandidates[c]);
      }
      if (candidates.length === 0) continue;

      // Prefer the source artboard with the same name as the target artboard.
      var chosen = candidates[0];
      for (var m = 0; m < candidates.length; m++) {
        if (candidates[m].sourceArtboardName === targetAb.name) {
          chosen = candidates[m];
          break;
        }
      }

      placements.push({
        sourceLayer: chosen.sourceLayer,
        targetArtboard: targetAb,
        rect: rect,
        relX: chosen.relX,
        relY: chosen.relY,
        srcWidth: chosen.srcWidth,
        srcHeight: chosen.srcHeight
      });
    }

    if (placements.length === 0) return { count: 0, skipped: skipped, replaced: 0 };

    // Cross-doc duplicate ONCE — establishes a new embedded SO in targetDoc
    app.activeDocument = doc;
    var baseLayer = placements[0].sourceLayer.duplicate(targetDoc);

    // Place the base layer in the first target artboard (replace same-named layer if opted in)
    app.activeDocument = targetDoc;
    if (moveIntoSlot(baseLayer, placements[0].targetArtboard, layerName, replaceExisting)) replaced++;
    var bb = getLayerTransformBounds(baseLayer);
    var baseW = bb[2].value - bb[0].value;
    var baseH = bb[3].value - bb[1].value;
    baseLayer.translate(
      placements[0].rect.left + placements[0].relX - bb[0].value,
      placements[0].rect.top  + placements[0].relY - bb[1].value
    );
    // Correct for any resolution-caused scale change on the cross-doc duplicate
    if (baseW > 0 && baseH > 0) {
      baseLayer.resize(
        (placements[0].srcWidth  / baseW) * 100,
        (placements[0].srcHeight / baseH) * 100,
        AnchorPosition.TOPLEFT
      );
    }
    copyLayerEffectsBetweenDocuments(placements[0].sourceLayer, baseLayer, targetDoc);

    // Every subsequent placement duplicates from baseLayer within targetDoc — linked copy.
    // Each copy is then resized to match its own source layer's dimensions, so different
    // artboard sizes get the correct scale while still sharing one embedded smart object.
    for (var p = 1; p < placements.length; p++) {
      app.activeDocument = targetDoc;
      var slot = replaceExisting
        ? prepareReplaceSlot(placements[p].targetArtboard, layerName)
        : { removed: false, container: placements[p].targetArtboard, relative: null, placement: ElementPlacement.PLACEATBEGINNING };
      if (slot.removed) replaced++;

      var duped = slot.relative
        ? baseLayer.duplicate(slot.relative, slot.placement)
        : baseLayer.duplicate(slot.container, slot.placement);

      var db = getLayerTransformBounds(duped);
      duped.translate(
        placements[p].rect.left + placements[p].relX - db[0].value,
        placements[p].rect.top  + placements[p].relY - db[1].value
      );
      // Resize from the duplicate's current dimensions to this placement's source dimensions.
      var dupW = db[2].value - db[0].value;
      var dupH = db[3].value - db[1].value;
      if (dupW > 0 && dupH > 0) {
        duped.resize(
          (placements[p].srcWidth  / dupW) * 100,
          (placements[p].srcHeight / dupH) * 100,
          AnchorPosition.TOPLEFT
        );
      }
      copyLayerEffectsBetweenDocuments(placements[p].sourceLayer, duped, targetDoc);
    }

    return { count: placements.length, skipped: skipped, replaced: replaced };
  }

  // ─── Folder File Enumeration ──────────────────────────────────────────────

  function getPSDFiles(folder) {
    var files  = folder.getFiles();
    var result = [];
    for (var i = 0; i < files.length; i++) {
      if (files[i] instanceof File) {
        var n = files[i].name.toLowerCase();
        if (n.match(/\.(psd|psb)$/)) result.push(files[i]);
      }
    }
    return result;
  }

  // ─── Scope Dialog ─────────────────────────────────────────────────────────

  function showScopeDialog() {
    var dlg = new Window("dialog", "Copy Scope");
    dlg.orientation  = "column";
    dlg.alignChildren = ["fill", "top"];
    dlg.spacing  = 10;
    dlg.margins  = 18;

    dlg.add("statictext", undefined, "Where should the layer be copied?");
    var r1 = dlg.add("radiobutton", undefined, "This document only");
    var r2 = dlg.add("radiobutton", undefined, "All open documents");
    dlg.add("radiobutton", undefined, "All files in a folder\u2026");
    r1.value = true;

    var btnGroup  = dlg.add("group");
    btnGroup.alignment = "right";
    var cancelBtn = btnGroup.add("button", undefined, "Cancel", { name: "cancel" });
    var nextBtn   = btnGroup.add("button", undefined, "Next",   { name: "ok" });

    var result = null;
    cancelBtn.onClick = function () { dlg.close(); };
    nextBtn.onClick = function () {
      if (r1.value) {
        result = "current";
        dlg.close();
      } else if (r2.value) {
        result = "open";
        dlg.close();
      } else {
        var folder = Folder.selectDialog("Choose a folder of PSD files");
        if (!folder) return; // user cancelled folder picker — keep dialog open
        result = folder;
        dlg.close();
      }
    };

    dlg.show();
    return result; // null if cancelled via Cancel button
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

  function showMultiArtboardDialog(selectedArtboards, allArtboards, scope) {
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

      if (scope === "current") {
        // ── This document: show per-artboard breakdown ──
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

      } else if (scope === "open") {
        // ── All open documents ──
        var otherDocs = 0;
        for (var d = 0; d < app.documents.length; d++) {
          if (app.documents[d].id !== doc.id) otherDocs++;
        }
        lines.push("Scope: all open documents");
        lines.push("Other open documents: " + otherDocs);
        lines.push("");
        lines.push("Layer \"" + layerName + "\" will be copied into");
        lines.push("matching-size artboards in each document.");

      } else {
        // ── Folder ──
        var psdFiles = getPSDFiles(scope);
        lines.push("Scope: folder  \u2014  " + scope.name);
        lines.push("PSD/PSB files found: " + psdFiles.length);
        lines.push("");
        lines.push("Layer \"" + layerName + "\" will be copied into");
        lines.push("matching-size artboards in each file.");
        lines.push("Files will be saved automatically.");
      }

      return lines.join("\n");
    }

    // ── Build Dialog ──
    var dlg = new Window("dialog", "Copy Layer to Matching Artboards");
    dlg.orientation = "column";
    dlg.alignChildren = ["fill", "top"];
    dlg.spacing = 12;
    dlg.margins = 18;

    // Layer selector (multi-select list — Cmd/Ctrl-click or Shift-click)
    dlg.add("statictext", undefined, "Layers to copy: (Cmd/Ctrl or Shift-click for multiple)");
    var layerList = dlg.add("listbox", undefined, namesList, { multiselect: true });
    layerList.preferredSize = [360, 140];
    if (layerList.items.length > 0) layerList.selection = 0;

    // Replace option
    var replaceCb = dlg.add(
      "checkbox",
      undefined,
      "Replace existing layers with the same name"
    );
    replaceCb.value = false;
    replaceCb.helpTip = "If a target artboard already has a layer with this exact name, delete it and put the new copy in its place.";

    // Preview panel
    var previewPanel = dlg.add("panel", undefined, "Preview");
    previewPanel.alignChildren = ["fill", "top"];
    previewPanel.margins = 12;
    var previewText = previewPanel.add("statictext", undefined, "", { multiline: true });
    previewText.preferredSize = [360, 120];

    // Status line (keeps dialog open after each run)
    var statusText = dlg.add("statictext", undefined, "");
    statusText.preferredSize = [360, 18];

    function getSelectedLayerNames() {
      var names = [];
      var sel = layerList.selection;
      if (!sel) return names;
      // ScriptUI returns a single ListItem for one selection, an Array for multiple
      if (sel instanceof Array) {
        for (var i = 0; i < sel.length; i++) names.push(sel[i].text);
      } else {
        names.push(sel.text);
      }
      return names;
    }

    function updatePreview() {
      var names = getSelectedLayerNames();
      if (names.length === 0) {
        previewText.text = "Select one or more layers above.";
        return;
      }
      var replaceNote = replaceCb.value
        ? "\n\nReplace ON \u2014 same-named layers in targets will be overwritten."
        : "";
      if (names.length === 1) {
        previewText.text = buildPreview(names[0]) + replaceNote;
        return;
      }
      // Multi-select: short summary for each selected layer
      var lines = ["Selected " + names.length + " layers:"];
      for (var i = 0; i < names.length; i++) {
        lines.push("");
        lines.push("\u2014 " + names[i] + " \u2014");
        lines.push(buildPreview(names[i]));
      }
      previewText.text = lines.join("\n") + replaceNote;
    }

    layerList.onChange = updatePreview;
    replaceCb.onClick = updatePreview;
    updatePreview();

    // Buttons
    var btnGroup = dlg.add("group");
    btnGroup.orientation = "row";
    btnGroup.alignment = "right";
    var closeBtn = btnGroup.add("button", undefined, "Close", { name: "cancel" });
    var runBtn   = btnGroup.add("button", undefined, "Copy",  { name: "ok" });

    closeBtn.onClick = function () { dlg.close(); };

    // Copy one layer name into the current scope; returns a short status string
    function copyOneLayer(layerName) {
      var totalCount = 0;
      var skipped    = 0;
      var replaced   = 0;
      var replaceExisting = replaceCb.value;

      if (scope === "current") {
        for (var i = 0; i < selectedArtboards.length; i++) {
          var ab    = selectedArtboards[i];
          var layer = findLayerRecursive(ab, layerName);
          if (!layer) { skipped++; continue; }
          var result = copyLayerToMatchingArtboards(layer, ab, allArtboards, replaceExisting);
          totalCount += result.count;
          replaced   += result.replaced;
        }
        var msg = "Copied \"" + layerName + "\" to " + totalCount + " artboard" + (totalCount !== 1 ? "s" : "") + ".";
        if (replaced > 0) msg += " Replaced " + replaced + ".";
        if (skipped > 0) msg += " (" + skipped + " skipped)";
        return msg;

      } else if (scope === "open") {
        var docErrors = 0;
        for (var d = 0; d < app.documents.length; d++) {
          var targetDoc = app.documents[d];
          if (targetDoc.id === doc.id) continue;
          try {
            var r = copyLayersToDocument(selectedArtboards, layerName, targetDoc, replaceExisting);
            totalCount += r.count;
            skipped    += r.skipped;
            replaced   += r.replaced;
          } catch (e) { docErrors++; }
        }
        var msg = "Copied \"" + layerName + "\" to " + totalCount + " artboard" + (totalCount !== 1 ? "s" : "") + " across open docs.";
        if (replaced > 0) msg += " Replaced " + replaced + ".";
        if (skipped > 0) msg += " (" + skipped + " skipped)";
        if (docErrors > 0) msg += " (" + docErrors + " error" + (docErrors !== 1 ? "s" : "") + ")";
        return msg;

      } else {
        // Folder
        var psdFiles    = getPSDFiles(scope);
        var filesDone   = 0;
        var failedNames = [];
        if (psdFiles.length === 0) {
          return "No PSD or PSB files found in the selected folder.";
        }
        var sourceFilePath = (doc.fullName) ? doc.fullName.fsName : null;
        var prevDialogs = app.displayDialogs;
        app.displayDialogs = DialogModes.NO;
        for (var f = 0; f < psdFiles.length; f++) {
          if (sourceFilePath && psdFiles[f].fsName === sourceFilePath) continue;
          var targetDoc = null;
          try {
            targetDoc = app.open(psdFiles[f]);
            var r = copyLayersToDocument(selectedArtboards, layerName, targetDoc, replaceExisting);
            totalCount += r.count;
            skipped    += r.skipped;
            replaced   += r.replaced;
            targetDoc.close(SaveOptions.SAVECHANGES);
            filesDone++;
          } catch (e) {
            failedNames.push(psdFiles[f].name);
            if (targetDoc) {
              try { targetDoc.close(SaveOptions.DONOTSAVECHANGES); } catch (e2) {}
            }
          }
        }
        app.displayDialogs = prevDialogs;
        var msg = "\"" + layerName + "\": " + filesDone + "/" + psdFiles.length + " files, " + totalCount + " artboard" + (totalCount !== 1 ? "s" : "") + ".";
        if (replaced > 0) msg += " Replaced " + replaced + ".";
        if (skipped > 0) msg += " (" + skipped + " skipped)";
        if (failedNames.length > 0) msg += " Failed: " + failedNames.join(", ");
        return msg;
      }
    }

    runBtn.onClick = function () {
      var names = getSelectedLayerNames();
      if (names.length === 0) {
        statusText.text = "Please select at least one layer.";
        return;
      }

      runBtn.enabled = false;
      closeBtn.enabled = false;
      statusText.text = "Working\u2026";
      dlg.update();

      var summaries = [];
      for (var n = 0; n < names.length; n++) {
        statusText.text = "Copying " + (n + 1) + " of " + names.length + ": " + names[n] + "\u2026";
        dlg.update();
        summaries.push(copyOneLayer(names[n]));
      }

      // Keep dialog open so another selection can be copied immediately
      if (names.length === 1) {
        statusText.text = summaries[0];
      } else {
        statusText.text = "Done — copied " + names.length + " layers. Select more or Close.";
        // Full breakdown in a single alert so details aren't lost
        alert(summaries.join("\n"));
      }

      runBtn.enabled = true;
      closeBtn.enabled = true;
      app.activeDocument = doc;
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

    var result = copyLayerToMatchingArtboards(sourceLayer, sourceArtboard, allArtboards, false);
    if (result.error) { alert(result.error); return; }

    var rect   = getArtboardRect(sourceArtboard);
    var size   = artboardSize(rect);
    return;
  }

  // ── Mode B: Artboards selected ──
  var scope = showScopeDialog();
  if (scope !== null) {
    showMultiArtboardDialog(selectedArtboards, allArtboards, scope);
  }

})();