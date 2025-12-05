# Companion Template

Use this template to create a new AI companion for Yumi AI Web Pals.

## Quick Start

1. Copy this entire `_template` folder and rename it to your companion's slug (e.g., `my-companion`)
2. Edit `companion.json` with your companion's metadata
3. Edit `personality.json` with your companion's personality, traits, and capabilities
4. Add your Live2D model files to the `model/` directory
5. Add a 512x512 `preview.png` image
6. ZIP and upload to the Hub, or keep bundled for development

## File Structure

```
my-companion/
  companion.json      # Metadata (name, version, author, model config)
  personality.json    # Personality, traits, system prompt, capabilities
  preview.png         # 512x512 preview image
  model/
    model.model3.json # Live2D entry point
    model.moc3        # Compiled model
    model.physics3.json
    textures/
      texture_00.png
    expressions/
      exp_neutral.exp3.json
      exp_happy.exp3.json
      ...
```

## Configuration Files

### companion.json

| Field | Description |
|-------|-------------|
| `id` | Unique slug (lowercase, hyphens) |
| `name` | Display name |
| `version` | Semantic version (1.0.0) |
| `description` | Short description for marketplace |
| `author` | Creator name |
| `preview` | Preview image filename |
| `model.entry` | Path to Live2D model file |
| `model.scale` | Size multiplier (0.1-0.3) |
| `model.position` | Screen position |
| `tags` | Searchable tags |

### personality.json

| Field | Description |
|-------|-------------|
| `name` | Companion name (used in prompts) |
| `traits` | Personality traits array |
| `systemPrompt` | Core personality instructions |
| `voice` | TTS configuration |
| `expressions` | Expression mappings |
| `capabilities` | Plugin configuration |
| `examples` | Example conversations |

## Available Traits

Use these predefined traits in your `traits` array:

- `affectionate` - Shows genuine care and warmth
- `playful` - Uses light humor and gentle teasing
- `supportive` - Encourages and validates the user
- `attentive` - Remembers details and follows up
- `empathetic` - Understands and shares feelings
- `warm` - Creates comfortable, welcoming presence
- `curious` - Shows genuine interest in learning
- `encouraging` - Motivates and celebrates progress
- `analytical` - Breaks down complex topics
- `direct` - Gives straightforward answers

## Available Plugins

Configure which features your companion has in `capabilities.plugins`:

| Plugin | Description |
|--------|-------------|
| `search` | Web search for current information |
| `memory` | Remember user preferences and context |
| `vision` | Analyze screenshots and images |
| `tts` | Text-to-speech responses |

Example:
```json
{
  "capabilities": {
    "plugins": ["search", "memory", "vision", "tts"]
  }
}
```

A companion without a plugin configured will not have access to that feature.

## Expression Mappings

Map emotional states to your Live2D expressions:

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

The values should match your expression file names (without `exp_` prefix and `.exp3.json` suffix).

## Testing Locally

1. Place your companion folder in `apps/extension/public/companions/`
2. Update `apps/extension/src/lib/companions/loader.ts` to use your companion as default (optional)
3. Run `npm run build` and load the extension
4. Your companion should appear in the avatar selection

## Publishing to Hub

1. ZIP your companion folder
2. Upload via the Admin Dashboard or API
3. Users can install from the Companions Marketplace
