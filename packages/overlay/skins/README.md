# TokenPal Mascot Skin System

TokenPal supports customizable 2D animated mascot skins via sprite sheets. Skins can be bundled within the package or loaded dynamically from the user's personal directory (`~/.tokenpal/skins/`).

---

## 1. Directory Structure

A skin lives in its own directory:
- **Built-in skins:** `packages/overlay/skins/<name>/`
- **User skins:** `~/.tokenpal/skins/<name>/`

Each skin folder requires two files:
1. `skin.json` — metadata, frame sizing, and animation ranges.
2. `spritesheet.png` (or the filename specified in `skin.json`) — transparent PNG containing all sprite frames.

Example:
```
~/.tokenpal/skins/my-fox/
├── skin.json
└── spritesheet.png
```

---

## 2. `skin.json` Specification

```json
{
  "name": "My Custom Mascot",
  "author": "Artist Name (@handle)",
  "license": "CC-BY-4.0",
  "frameSize": {
    "width": 32,
    "height": 32
  },
  "fps": 8,
  "spriteSheet": "spritesheet.png",
  "supportsTint": true,
  "animations": {
    "idle": { "from": 0, "to": 3 },
    "walk": { "from": 4, "to": 7 },
    "sleep": { "from": 8, "to": 11 },
    "alert": { "from": 12, "to": 15 },
    "happy": { "from": 16, "to": 19 }
  }
}
```

### Fields

| Field | Type | Description |
|---|---|---|
| `name` | string | Human-readable name displayed in the Customize window. |
| `author` | string | Artist or creator credit. |
| `license` | string | Open license (e.g. `CC0-1.0`, `CC-BY-4.0`, `MIT`). |
| `frameSize` | `{ width: number, height: number }` | Pixel dimensions of a single animation frame. |
| `fps` | number | Playback framerate for animations. Capped at 18 FPS by TokenPal engine. |
| `spriteSheet` | string | Relative path to the sprite sheet PNG (defaults to `spritesheet.png`). |
| `supportsTint` | boolean (optional) | Whether the skin supports color tints and palette swaps. |
| `animations` | object | Required animation ranges for each guardian state. |

### Animation State Mapping

The TokenPal watcher maps guardian states to mascot animations:

| Mascot Animation | Trigger Condition |
|---|---|
| `idle` | Quota is healthy (Green state, no active alerts). |
| `walk` | Roaming mode is active (mascot moves along screen edges). |
| `sleep` | Periodic rest state during extended periods of healthy inactivity. |
| `alert` | Active alert condition (`single_request_high`, `projected_exhaustion`, Yellow/Red state). |
| `happy` | Model switch notice, cost summary update, or successful turn acknowledgment. |

Animation ranges can be specified either as `{ "from": start, "to": end }` or as an explicit array of frame indices `[0, 1, 2, 1]`.

---

## 3. License & Credit Requirements

When contributing skins or importing community sprite sheets:
1. **Permissive Open Licenses Only**: All bundled skins must be licensed under permissive licenses such as CC0, CC-BY, or MIT.
2. **Strict Prohibition on Copyrighted Characters**: Do NOT import or bundle copyrighted characters or trademarks (e.g., Nintendo, Pokémon, Sanrio, Disney, anime IP, or commercial video game characters). Only original pixel art or public domain/licensed sprites are accepted.
3. **Attribution**: Always attribute original artists in `skin.json` under `"author"`. If adapting CC-BY work, include source URL and license terms.

---

## 4. How to Add a Real Sprite Sheet

1. Export your animation frames as a transparent PNG grid or horizontal strip where every cell equals `frameSize.width` by `frameSize.height`.
2. Place frames sequentially: `idle` frames first, followed by `walk`, `sleep`, `alert`, and `happy`.
3. Create `skin.json` pointing to your sprite sheet and defining frame indices.
4. Place the folder into `~/.tokenpal/skins/<name>/`.
5. Open the TokenPal Customize window (`tokenpal` tray menu -> **Customize...** or right-click mascot -> **Customize...**) and select your skin from the dropdown!
