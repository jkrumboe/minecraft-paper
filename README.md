# McGPS - Minecraft GPS Tracking System

Real-time 3D web viewer for tracking player positions on a Minecraft Paper server.

![Minecraft Player Tracking](https://img.shields.io/badge/Minecraft-1.21.4-green) ![Paper](https://img.shields.io/badge/Server-Paper-blue) ![Docker](https://img.shields.io/badge/Docker-Supported-blue)

## What is this?

McGPS is a complete solution for visualizing Minecraft player activity in real-time through a web browser. Watch players move around your world in a 3D environment with authentic Minecraft textures and player skins.

### Features

- 🗺️ **Real-time 3D World** - Authentic Minecraft textures with animated water and lava
- 🎨 **Texture System** - Load real Minecraft textures or use procedural fallback
- 🌊 **Animated Blocks** - Flowing water and lava animations like vanilla Minecraft
- 👤 **Player Skins** - Fetches actual player skins from Mojang API
- 🎮 **Multiple Camera Modes** - Free cam, 2D top-down, first-person, and third-person views
- 📦 **Chunk-based Rendering** - Efficient world streaming around players
- 🌍 **Multi-world Support** - Overworld, Nether, and End dimensions
- 📊 **Player Inventory** - View player health, food, XP, and inventory contents
- 🔄 **Live Updates** - Server-Sent Events for instant position updates
- 💾 **Persistent Caching** - World state persists across WebUI refreshes and server restarts

## Components

| Component | Description |
|-----------|-------------|
| `mcgps-telemetry-plugin/` | Paper plugin that broadcasts player telemetry via server logs |
| `mcgps-web-viewer/` | Node.js web server + Three.js 3D frontend |
| `docker-compose.yml` | Docker setup for the Minecraft server |

## Quick Start

```bash
# 1. Start Minecraft server
docker-compose up -d

# 2. Build and install the telemetry plugin
cd mcgps-telemetry-plugin
./gradlew shadowJar
cp build/libs/*.jar ../data/plugins/
docker restart minecraft-paper

# 3. Start the web viewer
cd ../mcgps-web-viewer
npm install
npm start

# 4. Open browser
# http://localhost:3000
```

## Screenshots

The web viewer displays:
- Textured 3D terrain with grass, dirt, stone, ores, trees, and more
- Player models with their actual Minecraft skins
- Real-time position tracking with smooth interpolation
- Interactive inventory inspection

## Requirements

- Docker & Docker Compose
- Node.js 14+
- Minecraft Paper 1.21.4 server (included in docker-compose)

## License

MIT
