# Texture System Implementation Guide

This document explains the texture rendering and animation system implemented in McGPS Web Viewer.

## Overview

The viewer now supports both procedural (generated) and real Minecraft textures with animation support for water, lava, and other animated blocks. The system is inspired by BlueMap's texture animation approach.

## Architecture

### 1. Texture Loading System

**Location:** `public/index.html` (lines ~1232-1262)

```javascript
function loadRealTexture(internalName)
```

- Asynchronously loads PNG textures from `/textures/` directory
- Falls back to procedural textures if file not found
- Configures textures with nearest-neighbor filtering for pixel-perfect look
- Tracks which textures loaded successfully vs. fallback

### 2. Texture Mapping

**Location:** `public/index.html` (lines ~845-1226)

```javascript
const TEXTURE_FILE_MAP = { ... }
```

- Maps internal texture names to Minecraft filename conventions
- Supports 200+ block types including:
  - Natural terrain (grass, dirt, stone variants)
  - Ores (coal, iron, gold, diamond, etc.)
  - Wood types (oak, birch, spruce, etc.)
  - Liquids (water, lava)
  - Special blocks (glass, leaves, etc.)

### 3. Material Creation

**Location:** `public/index.html` (lines ~3019-3065)

```javascript
Object.entries(blockTextures).forEach(([name, texture]) => { ... })
```

Features:
- Creates Three.js materials for each texture
- Applies transparency for water, glass, ice
- Adds emissive glow for lava, glowstone
- Applies biome color tinting for grass, leaves, water
- Configures double-sided rendering for leaves

### 4. Animation System

**Location:** `public/index.html` (lines ~3075-3160)

#### TextureAnimation Class

```javascript
class TextureAnimation {
    constructor(textureName, config)
    init(texture)
    update(delta, material)
}
```

**Key features:**
- Detects animated textures by aspect ratio (height > width)
- Calculates frame count from image dimensions
- Updates texture Y-offset each frame to show current animation frame
- Supports configurable frame timing
- Handles interpolation for smooth animations

#### Animation Configuration

```javascript
const ANIMATED_TEXTURES = {
    water: {
        enabled: true,
        frametime: 1,      // Minecraft ticks per frame
        interpolate: true   // Smooth frame transitions
    },
    lava: {
        enabled: true,
        frametime: 2,       // Slower animation
        interpolate: true
    }
}
```

#### Animation Update Loop

**Location:** `public/index.html` (line ~4888)

```javascript
function updateTextureAnimations() {
    // Called every frame in animate()
    // Updates all animated texture offsets
}
```

## How Animated Textures Work

### Minecraft's Animation Format

In Minecraft, animated textures are stored as vertical strips:
- Each frame is stacked vertically in the PNG
- All frames have the same width (typically 16px)
- Height = width × frame_count

Example:
- `water_still.png`: 16×512 pixels = 32 frames
- `lava_still.png`: 16×320 pixels = 20 frames

### Our Implementation

1. **Detection**: When texture loads, check if height > width
2. **Frame Calculation**: `frames = height / width`
3. **Frame Height**: `frameHeight = 1 / frames` (in texture coordinates)
4. **Animation**: Update `texture.offset.y = frameIndex * frameHeight`

This approach:
- ✓ Works with any frame count
- ✓ No shader modifications needed
- ✓ Efficient (just offset updates)
- ✓ Compatible with Three.js material system

## Texture Atlas Support

The system supports multi-face textures:

```javascript
grass_block: {
    top: 'grass_block_top',
    bottom: 'dirt',
    side: 'grass_block_side'
}
```

Each face can use a different texture, allowing for proper block rendering.

## Performance Optimizations

1. **Nearest-Neighbor Filtering**: Preserves pixel-art aesthetic without blur
2. **Texture Reuse**: Materials share texture instances
3. **Throttled Updates**: Animation updates only when needed
4. **Lazy Loading**: Textures load asynchronously without blocking
5. **Fallback Strategy**: Procedural textures load immediately, real textures override

## Biome Color Tinting

**Location:** `public/index.html` (lines ~3007-3056)

```javascript
const BIOME_COLORS = {
    grass: new THREE.Color(0x7CBD6B),
    foliage: new THREE.Color(0x59AE30),
    water: new THREE.Color(0x3F76E4),
    // ...
}
```

Applied to:
- Grass blocks and grass items
- Leaves (with specific colors for birch, spruce)
- Water surfaces

This matches Minecraft's biome-dependent coloring system.

## Future Enhancements

Potential improvements for the texture system:

1. **MCMETA Support**: Parse `.mcmeta` files for custom animation configurations
2. **Shader-Based Animation**: Use custom shaders for interpolation between frames
3. **Dynamic Texture Loading**: Load textures on-demand as chunks appear
4. **Texture Packs**: Support for resource pack-style texture overrides
5. **More Animations**: Portal, fire, enchanting table book, etc.
6. **Connected Textures**: Support for OptiFine-style connected textures
7. **Texture Variants**: Random texture variations (grass, stone, etc.)

## Testing

To test the texture system:

1. **Without real textures** (default):
   - Viewer uses procedural textures
   - Water and lava are static (not animated)
   - All blocks render with generated textures

2. **With real textures**:
   - Extract textures from `minecraft.jar` to `public/textures/`
   - Viewer automatically uses real textures
   - Animated textures (water, lava) animate automatically
   - Console shows which textures loaded

Check browser console for logs:
```
✓ Generated procedural block textures: 50
🎨 Attempting to load real Minecraft textures...
✓ Loaded 120 real textures: [...]
✓ Animated texture detected: water (32 frames)
✓ Animated texture detected: lava (20 frames)
```

## References

- [BlueMap Texture Animation](https://github.com/BlueMap-Minecraft/BlueMap/blob/master/common/webapp/src/js/map/TextureAnimation.js)
- [Minecraft Wiki - Resource Pack](https://minecraft.wiki/w/Resource_pack)
- [Three.js Texture Documentation](https://threejs.org/docs/#api/en/textures/Texture)

## License Note

Minecraft textures are property of Mojang Studios/Microsoft. Users must extract textures from their own legally purchased copy of Minecraft. Do not redistribute texture files.
