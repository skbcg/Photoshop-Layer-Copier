# Copy Layer to Matching Artboards

A Photoshop JSX script for designers working with **multi-set artboard documents** — display ads, social media kits, banner sets, and more. Copy a precisely-placed layer to every artboard that shares the same dimensions, instantly.

---

## The Problem

You're working on a display ad campaign with 3 sets of ads, each containing a 300×600, 728×90, and 160×600. You've painstakingly scaled and positioned a logo on each size in one set. Now you need it on the same size across all the other sets — in the **exact same position**.

Doing this manually means duplicating, moving between artboards, and nudging pixels until it looks right. For a 10-set campaign that's a lot of tedious, error-prone work.

---

## The Solution

This script automates it entirely. Select your layer (or artboards), run the script, and it handles the rest — preserving position relative to each target artboard's origin.

---

## Features

- ✅ **Two modes** — single layer or multi-artboard selection, auto-detected
- ✅ **Pixel-perfect placement** — position is preserved relative to each artboard's origin
- ✅ **Live preview dialog** — see exactly what will be copied before committing
- ✅ **Graceful skipping** — warns you if a layer isn't found in a selected artboard instead of erroring out
- ✅ **Works with any layer type** — smart objects, groups, pixel layers, adjustment layers
- ✅ **No dependencies** — pure JSX, no plugins required

---

## Installation

1. Download `Layer Copier.jsx`
2. Place it anywhere on your machine (or in Photoshop's `Scripts` folder for easier access)

**Optional — assign a keyboard shortcut:**
> Edit → Keyboard Shortcuts → Shortcuts For: Application Menus → File → Scripts → `Layer Copier`

---

## Usage

### Mode 1 — Single Layer (Quick Copy)

Best for: copying one already-placed layer to all same-size artboards.

1. In the **Layers panel**, select the layer you want to copy
2. Run the script via **File → Scripts → Browse**
3. Done — the layer is duplicated into every artboard with matching dimensions at the same relative position

> No dialog, no confirmation. It just runs.

---

### Mode 2 — Multiple Artboards (Multi-Size Batch Copy)

Best for: you've placed and scaled an asset correctly on one artboard per size, and want to push all of them out at once.

1. Manually place and scale your asset on **one artboard of each size** — get it looking exactly right
2. In the **Layers panel**, select all of those source artboards (one per size)
3. Run the script — a dialog appears

**The dialog:**

- **Layer dropdown** — lists every layer name found across your selected artboards
- **Live preview** — shows which artboards will receive copies and how many, updates as you change the selection
- Warns you if the chosen layer isn't found in one of the selected artboards
- Shows a total copy count before you run

4. Pick the layer, review the preview, click **Run**

---

## Example Workflow

```
Document structure:
├── Set A — 300×600    ← source artboard (logo placed here)
├── Set A — 728×90     ← source artboard (logo placed here)
├── Set A — 160×600    ← source artboard (logo placed here)
├── Set B — 300×600    ← will receive copy
├── Set B — 728×90     ← will receive copy
├── Set B — 160×600    ← will receive copy
├── Set C — 300×600    ← will receive copy
├── Set C — 728×90     ← will receive copy
└── Set C — 160×600    ← will receive copy
```

Select `Set A — 300×600`, `Set A — 728×90`, `Set A — 160×600` in the Layers panel → run script → pick "Logo" → 6 copies made instantly.

---

## Things to Know

| Scenario | Behavior |
|---|---|
| Layer name not found in a selected artboard | Skipped, reported in completion alert |
| No matching-size artboards exist | Alert with no changes made |
| Source artboard is also a matching size | Skipped (won't duplicate onto itself) |
| Layer is a group/folder | Entire group is duplicated |
| Scaling across different artboard sizes | Not supported — use Mode 2 to place manually per size |

### A note on scaling

This script intentionally does **not** auto-scale layers across different artboard dimensions. Scaling a logo from a 300×600 to a 728×90 involves creative decisions (proportional scale? anchor point? relative padding?) that are better made by a human. The recommended workflow is Mode 2 — place it right once per size, then let the script handle the copying.

### Layer effects & text

Photoshop does not scale layer effects (strokes, shadows, glows) or font sizes when transforming via script. If you plan to scale assets manually before running Mode 2, convert layers to **Smart Objects** first to avoid quality loss.

---

## Compatibility

| | |
|---|---|
| **Photoshop version** | CC 2015 and later (artboard support required) |
| **Platform** | macOS & Windows |
| **File type** | Works on any `.psd` with artboards |

---

## Contributing

Bug reports and PRs welcome. If you have an edge case (nested artboards, linked smart objects, etc.) open an issue with a description of your document structure.

---

## License

MIT — use it, modify it, ship it.
