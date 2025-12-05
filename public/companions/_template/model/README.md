# Live2D Model Files

Place your Live2D Cubism model files in this directory.

## Required Files

- `model.model3.json` - Main model definition file (entry point)
- `model.moc3` - Compiled model data
- `model.physics3.json` - Physics simulation settings (optional but recommended)
- `textures/texture_00.png` - Model texture(s)

## Optional Files

- `model.cdi3.json` - Display info
- `expressions/*.exp3.json` - Expression files for different emotions

## Expression Files

Create expression files in an `expressions/` subdirectory:

```
expressions/
  exp_neutral.exp3.json
  exp_happy.exp3.json
  exp_sad.exp3.json
  exp_thinking.exp3.json
  exp_surprised.exp3.json
```

The expression names should match what you configure in `personality.json`:

```json
{
  "expressions": {
    "default": "neutral",
    "onThinking": "thinking",
    "onHappy": "happy",
    "onSad": "sad"
  }
}
```

## Model Scale and Position

Configure in `companion.json`:

```json
{
  "model": {
    "entry": "model/model.model3.json",
    "scale": 0.15,
    "position": "bottom-right"
  }
}
```

- `scale`: Size multiplier (0.1-0.3 typical)
- `position`: "bottom-right", "bottom-left", "center"

## Resources

- [Live2D Cubism Editor](https://www.live2d.com/en/download/cubism/)
- [Live2D Sample Models](https://www.live2d.com/en/download/sample-data/)
