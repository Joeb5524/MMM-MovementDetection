# MMM-MovementDetection

`MMM-MovementDetection` is a MagicMirror module that watches a camera feed in the browser, estimates motion by comparing sampled video frames, dims the screen after a configurable idle period, and stores the last detected movement time on disk.

## Features

- Uses `getUserMedia` instead of native camera bindings, so there are no external module dependencies.
- Dims the configured DOM target when no movement is detected for a sustained period.
- Persists the last movement timestamp to `data/movement-state.json`.
- Appends movement events to `data/movement-events.jsonl`.
- Broadcasts `MMM_MOVEMENT_DETECTED`, `MMM_MOVEMENT_ACTIVE`, and `MMM_MOVEMENT_IDLE` notifications for other modules.

## Installation

Clone this repository into your MagicMirror `modules` directory:

```bash
cd ~/MagicMirror/modules
git clone github.com/joeb5524/MMM-MovementDetection
cd MMM-MovementDetection
npm install
```

Then add the module to `config/config.js`:

```js
{
  module: "MMM-MovementDetection",
  position: "top_right",
  config: {
    inactivityTimeoutMs: 300000,
    checkIntervalMs: 1000,
    dimBrightness: 0.2
  }
}
```

## Configuration

| Option | Default | Description |
| --- | --- | --- |
| `inactivityTimeoutMs` | `300000` | How long the mirror can stay motionless before the screen is dimmed. |
| `checkIntervalMs` | `1000` | How often to sample the camera feed. |
| `captureWidth` | `160` | Width of the downscaled analysis frame. |
| `captureHeight` | `120` | Height of the downscaled analysis frame. |
| `downSampleStride` | `4` | Pixel stride used when comparing frames. Increase to reduce CPU usage. |
| `pixelDifferenceThreshold` | `28` | Per-pixel luma delta required for a pixel to count as changed. |
| `changedPixelRatioThreshold` | `0.06` | Ratio of changed sampled pixels required to treat a frame as movement. |
| `movementLogCooldownMs` | `30000` | Minimum time between appended log entries while motion continues. State is still updated on every detection. |
| `dimBrightness` | `0.2` | CSS brightness value applied to the dim target while idle. |
| `dimTargetSelector` | `"body"` | CSS selector for the element that should be dimmed. |
| `logFileName` | `"data/movement-events.jsonl"` | Relative path, inside the module folder, for the append-only event log. |
| `stateFileName` | `"data/movement-state.json"` | Relative path, inside the module folder, for the latest movement state file. |
| `camera` | Browser constraints | Passed directly to `navigator.mediaDevices.getUserMedia`. |
| `showModuleStatus` | `true` | Show the status chip and camera state text in the module UI. |
| `showLastMovement` | `true` | Show the most recent detected movement timestamp in the module UI. |
| `showIdleSummary` | `true` | Show the idle timeout and time remaining before dimming. |
| `statusRefreshMs` | `10000` | UI refresh cadence for relative times. |
| `debug` | `false` | Log motion ratios to the MagicMirror browser log. |

## How It Works

1. The browser requests camera access with `getUserMedia`.
2. Each sample frame is resized and converted to grayscale luma values.
3. The current frame is compared to the previous frame.
4. If enough sampled pixels changed, the module marks movement as detected.
5. The node helper writes the newest movement timestamp to the state file and, subject to cooldown, appends a JSON line to the movement log.
6. If no movement is seen for `inactivityTimeoutMs`, the module applies a dimming class to the configured target.

## Notes

- The runtime hosting MagicMirror must have OS-level permission to access the camera.
- This module dims the DOM via CSS brightness. It does not power the monitor off.

## Verification

Run:

```bash
npm run check
```
