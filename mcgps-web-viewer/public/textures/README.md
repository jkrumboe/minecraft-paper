# Minecraft Textures

This directory should contain Minecraft block textures extracted from the Minecraft 1.20.4 JAR file.

## How to Extract Textures from Minecraft JAR

### Method 1: Using 7-Zip or WinRAR (Windows)

1. Locate your Minecraft installation:
   - Windows: `%APPDATA%\.minecraft\versions\1.20.4\1.20.4.jar`
   - macOS: `~/Library/Application Support/minecraft/versions/1.20.4/1.20.4.jar`
   - Linux: `~/.minecraft/versions/1.20.4/1.20.4.jar`

2. Open the JAR file with 7-Zip or WinRAR

3. Navigate to: `assets/minecraft/textures/block/`

4. Extract all PNG files to this directory (`mcgps-web-viewer/public/textures/`)

### Method 2: Using Command Line (Linux/macOS)

```bash
# Navigate to your Minecraft directory
cd ~/.minecraft/versions/1.20.4/

# Extract textures using unzip
unzip -j 1.20.4.jar "assets/minecraft/textures/block/*" -d /path/to/mcgps-web-viewer/public/textures/
```

### Method 3: Using Command Line (Windows)

```powershell
# Navigate to your Minecraft directory
cd $env:APPDATA\.minecraft\versions\1.20.4\

# Extract using PowerShell (requires 7-Zip installed)
& "C:\Program Files\7-Zip\7z.exe" e 1.20.4.jar "assets/minecraft/textures/block/*" -o"C:\path\to\mcgps-web-viewer\public\textures\" -r
```

## Required Textures

The viewer will automatically load textures for all Minecraft blocks. Key textures include:

- Grass blocks: `grass_block_top.png`, `grass_block_side.png`, `grass_block_side_overlay.png`
- Stone variants: `stone.png`, `cobblestone.png`, `deepslate.png`, etc.
- Ores: `coal_ore.png`, `iron_ore.png`, `diamond_ore.png`, etc.
- Wood types: `oak_log.png`, `birch_planks.png`, etc.
- Liquids: `water_still.png`, `lava_still.png`
- Leaves: `oak_leaves.png`, `spruce_leaves.png`, etc.

## Animation Support

The viewer automatically animates water and lava by detecting animated texture files (textures with multiple frames stacked vertically).

**Current Implementation:** Animations are detected automatically from PNG dimensions. The viewer checks if height > width to identify animated textures.

**Optional mcmeta files:** For future enhancements, you can also extract `.mcmeta` files which contain animation configuration:

```bash
unzip -j 1.20.4.jar "assets/minecraft/textures/block/*.mcmeta" -d /path/to/mcgps-web-viewer/public/textures/
```

Animated textures that work automatically:
- `water_still.png` - Water animation (32 frames)
- `lava_still.png` - Lava animation (20 frames)
- Portal, fire, and other animated blocks (when added)

**Note:** Currently, `.mcmeta` files are not parsed. Animation timing is configured in the code. Future versions may add full `.mcmeta` support.

## Fallback Behavior

If textures are not present, the viewer will use procedural (generated) textures as a fallback. However, real Minecraft textures provide:

- **Authentic Look**: Exact match to vanilla Minecraft
- **Animations**: Flowing water and lava
- **Detail**: Better visual fidelity
- **Consistency**: Same textures as in-game

## Legal Note

Minecraft textures are property of Mojang Studios/Microsoft. Only extract and use textures from your own legally purchased copy of Minecraft. Do not redistribute the texture files.
