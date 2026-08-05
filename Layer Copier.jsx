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
  function findLayerRecursive(layerSet, name, excludeId) {
    for (var i = 0; i < layerSet.layers.length; i++) {
      var l = layerSet.layers[i];
      if (l.name === name && l.id !== excludeId) return l;
      if (l.typename === "LayerSet") {
        var found = findLayerRecursive(l, name, excludeId);
        if (found) return found;
      }
    }
    return null;
  }

  function findLayerByIdRecursive(container, layerId) {
    for (var i = 0; i < container.layers.length; i++) {
      var layer = container.layers[i];
      if (layer.id === layerId) return layer;
      if (layer.typename === "LayerSet") {
        var found = findLayerByIdRecursive(layer, layerId);
        if (found) return found;
      }
    }
    return null;
  }

  function removeLayerById(layerId) {
    var ref = new ActionReference();
    ref.putIdentifier(charIDToTypeID("Lyr "), layerId);
    var desc = new ActionDescriptor();
    desc.putReference(charIDToTypeID("null"), ref);
    executeAction(charIDToTypeID("Dlt "), desc, DialogModes.NO);
  }

  // If a same-named layer exists, keep it alive as the insertion reference.
  // Deleting first can invalidate sibling DOM objects in Photoshop. Callers insert
  // the replacement before this layer, then delete the old layer by its stable ID.
  function prepareReplaceSlot(artboard, layerName, excludeId) {
    var existing = findLayerRecursive(artboard, layerName, excludeId);
    if (!existing) {
      return {
        existingId: null,
        container: artboard,
        relative: null,
        placement: ElementPlacement.PLACEATBEGINNING
      };
    }

    return {
      existingId: existing.id,
      container: existing.parent,
      relative: existing,
      placement: ElementPlacement.PLACEBEFORE
    };
  }

  function duplicateIntoSlot(sourceLayer, artboard, layerName, replaceExisting) {
    if (replaceExisting) {
      var slot = prepareReplaceSlot(artboard, layerName);
      var duplicated;
      if (slot.relative) {
        duplicated = sourceLayer.duplicate(slot.relative, slot.placement);
      } else {
        duplicated = sourceLayer.duplicate(slot.container, slot.placement);
      }
      if (slot.existingId !== null) {
        var duplicatedId = duplicated.id;
        removeLayerById(slot.existingId);
        duplicated = findLayerByIdRecursive(app.activeDocument, duplicatedId);
        if (!duplicated) throw new Error("Could not reacquire replacement layer.");
      }
      return {
        layer: duplicated,
        replaced: slot.existingId !== null
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

  function getLayerSectionExpanded(layerId) {
    try {
      var property = stringIDToTypeID("layerSectionExpanded");
      var ref = new ActionReference();
      ref.putProperty(stringIDToTypeID("property"), property);
      ref.putIdentifier(stringIDToTypeID("layer"), layerId);
      return executeActionGet(ref).getBoolean(property);
    } catch (e) {
      return null;
    }
  }

  function setLayerSectionExpanded(layerId, expanded) {
    try {
      var ref = new ActionReference();
      ref.putProperty(
        stringIDToTypeID("property"),
        stringIDToTypeID("layerSectionExpanded")
      );
      ref.putIdentifier(stringIDToTypeID("layer"), layerId);

      var desc = new ActionDescriptor();
      desc.putReference(stringIDToTypeID("null"), ref);
      desc.putBoolean(stringIDToTypeID("to"), expanded);
      executeAction(stringIDToTypeID("set"), desc, DialogModes.NO);
    } catch (e) {}
  }

  function captureLayerSectionStates(container, states) {
    states = states || [];
    for (var i = 0; i < container.layers.length; i++) {
      var layer = container.layers[i];
      if (layer.typename !== "LayerSet") continue;

      var expanded = getLayerSectionExpanded(layer.id);
      if (expanded !== null) {
        states.push({ id: layer.id, expanded: expanded });
      }
      captureLayerSectionStates(layer, states);
    }
    return states;
  }

  function restoreLayerSectionStates(targetDoc, states) {
    app.activeDocument = targetDoc;
    for (var i = 0; i < states.length; i++) {
      setLayerSectionExpanded(states[i].id, states[i].expanded);
    }
  }

  // ─── Cross-Document Copy ──────────────────────────────────────────────────

  // Copies the named layer from every selected source artboard into matching-size
  // artboards in targetDoc. All copies share ONE embedded smart object (the first
  // cross-doc duplicate), then every additional placement is a within-doc duplicate
  // so they remain linked to each other inside the target document.
  function moveIntoSlot(layer, artboard, layerName, replaceExisting) {
    if (replaceExisting) {
      // A cross-document duplicate can initially land inside this artboard.
      // Exclude the incoming layer so it is not mistaken for the old copy.
      var slot = prepareReplaceSlot(artboard, layerName, layer.id);
      if (slot.relative) {
        layer.move(slot.relative, slot.placement);
      } else {
        layer.move(slot.container, slot.placement);
      }
      return {
        layer: layer,
        replacedId: slot.existingId
      };
    }
    layer.move(artboard, ElementPlacement.PLACEATBEGINNING);
    return { layer: layer, replacedId: null };
  }

  function copyLayersToDocument(selectedArtboards, layerName, targetDoc, replaceExisting) {
    // Gather all target artboards while targetDoc is active
    app.activeDocument = targetDoc;
    var targetSectionStates = captureLayerSectionStates(targetDoc);
    var targetArtboards = getAllArtboards(targetDoc);

    // Build source candidates first; then map exactly one candidate per target artboard.
    // This avoids duplicate copies when multiple selected source artboards share a size.
    var sourceCandidates = [];
    var placements       = [];
    var skipped          = 0;
    var replaced         = 0;
    var replacementIds   = [];

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
        targetArtboardId: targetAb.id,
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
    var firstTargetArtboard = findLayerByIdRecursive(targetDoc, placements[0].targetArtboardId);
    if (!firstTargetArtboard) throw new Error("Could not reacquire first target artboard.");
    var movedBase = moveIntoSlot(baseLayer, firstTargetArtboard, layerName, replaceExisting);
    baseLayer = movedBase.layer;
    if (movedBase.replacedId !== null) {
      replacementIds.push(movedBase.replacedId);
      replaced++;
    }
    var baseLayerId = baseLayer.id;
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
      baseLayer = findLayerByIdRecursive(targetDoc, baseLayerId);
      if (!baseLayer) throw new Error("Could not reacquire base layer.");
      var targetArtboard = findLayerByIdRecursive(targetDoc, placements[p].targetArtboardId);
      if (!targetArtboard) throw new Error("Could not reacquire target artboard.");
      var slot = replaceExisting
        ? prepareReplaceSlot(targetArtboard, layerName)
        : { existingId: null, container: targetArtboard, relative: null, placement: ElementPlacement.PLACEATBEGINNING };

      var duped = slot.relative
        ? baseLayer.duplicate(slot.relative, slot.placement)
        : baseLayer.duplicate(slot.container, slot.placement);
      if (slot.existingId !== null) {
        replacementIds.push(slot.existingId);
        replaced++;
      }

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

    // Deleting layers invalidates Photoshop DOM objects in some builds. Wait until
    // all copies are fully positioned and styled, then remove the old layers by ID.
    app.activeDocument = targetDoc;
    for (var oldIndex = 0; oldIndex < replacementIds.length; oldIndex++) {
      removeLayerById(replacementIds[oldIndex]);
    }
    restoreLayerSectionStates(targetDoc, targetSectionStates);

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

  function formatError(error) {
    var details = [];
    if (error.number !== undefined) details.push("error " + error.number);
    if (error.line !== undefined) details.push("line " + error.line);

    var message = error.message || error.description || error.toString();
    if (message) details.push(message);

    return details.join(", ");
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
        var failedDetails = [];
        if (psdFiles.length === 0) {
          return "No PSD or PSB files found in the selected folder.";
        }
        var sourceFilePath = (doc.fullName) ? doc.fullName.fsName : null;
        var prevDialogs = app.displayDialogs;
        app.displayDialogs = DialogModes.NO;
        for (var f = 0; f < psdFiles.length; f++) {
          if (sourceFilePath && psdFiles[f].fsName === sourceFilePath) continue;
          var targetDoc = null;
          var phase = "opening file";
          try {
            targetDoc = app.open(psdFiles[f]);
            phase = "copying layer";
            var r = copyLayersToDocument(selectedArtboards, layerName, targetDoc, replaceExisting);
            totalCount += r.count;
            skipped    += r.skipped;
            replaced   += r.replaced;
            phase = "saving file";
            targetDoc.close(SaveOptions.SAVECHANGES);
            filesDone++;
          } catch (e) {
            failedNames.push(psdFiles[f].name);
            failedDetails.push(
              psdFiles[f].name + " (" + phase + "): " + formatError(e)
            );
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
        if (failedDetails.length > 0) {
          alert("Photoshop reported:\n\n" + failedDetails.join("\n\n"));
        }
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
      app.activeDocument = doc;
      var sourceSectionStates = captureLayerSectionStates(doc);
      for (var n = 0; n < names.length; n++) {
        statusText.text = "Copying " + (n + 1) + " of " + names.length + ": " + names[n] + "\u2026";
        dlg.update();
        summaries.push(copyOneLayer(names[n]));
      }
      restoreLayerSectionStates(doc, sourceSectionStates);

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