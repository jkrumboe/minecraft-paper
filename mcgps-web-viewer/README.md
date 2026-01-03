# McGPS Web Viewer

Real-time 3D visualization of Minecraft player positions from the McGpsTelemetry plugin.

## Features

✨ **Real-time Updates** - Uses Server-Sent Events (SSE) to stream player positions  
🎮 **3D Visualization** - Three.js powered 3D world with authentic Minecraft textures  
🧱 **Procedural Block Textures** - Grass, dirt, stone, ores, wood, leaves, and 100+ block types  
👤 **Player Skins** - Fetches real player skins from Mojang's Session Server API  
🎥 **Multiple Camera Modes** - Free cam, 2D top-down, first-person, and third-person views  
📦 **Chunk-based Rendering** - Efficient world streaming with frustum culling  
🌍 **Multi-world Support** - Overworld, Nether, and End dimensions  
📊 **Player Inventory** - View health, food, XP, armor, and full inventory  
🔄 **Smooth Interpolation** - Fluid player movement between updates  
💾 **Persistent Caching** - World state persists across refreshes and restarts (see [CHUNK_CACHE.md](CHUNK_CACHE.md))  

## Quick Start

### 1. Install Dependencies
```bash
cd mcgps-web-viewer
npm install
```

### 2. Start the Server
```bash
npm start
```

### 3. Open in Browser
Navigate to: **http://localhost:3000**

## Requirements

- Node.js 14 or higher
- Docker running with `minecraft-paper` container
- McGpsTelemetry plugin installed and running on the Minecraft server

## How It Works

1. **Server** (`server.js`):
   - Tails Docker logs using `docker logs -f minecraft-paper`
   - Parses JSON telemetry lines from McGpsTelemetry plugin
   - Streams parsed data to connected browsers via SSE

2. **Frontend** (`public/index.html`):
   - Uses Three.js for 3D rendering
   - Receives real-time updates via SSE connection
   - Displays players as colored capsules with direction indicators
   - Shows position trails and coordinate information

## Controls

### Camera Modes
- **2D Button** - Top-down orthographic view
- **Free Cam Button** - Default flying camera (active by default)
- **First Person Button** - View through a player's eyes
- **Third Person Button** - GTA-style follow camera behind player

### Free Cam Controls
- **WASD**: Move forward/back/left/right
- **Space**: Move up
- **Shift**: Move down
- **Mouse Drag**: Rotate camera

### 2D Mode Controls
- **WASD**: Pan the view
- **Space/Shift**: Zoom in/out
- **Mouse Drag**: Pan the view

### Player Interaction
- **Click on Player**: Open inventory panel
- **ESC**: Exit first/third person mode, close modals

## API Endpoints

- `GET /` - Web interface
- `GET /telemetry-stream` - SSE stream of player updates
- `GET /api/players` - JSON of all current player positions with skin data
- `GET /api/players/:uuid/skin` - Get skin URL and model type for a player
- `GET /api/players/:uuid/history` - Position history for a specific player
- `GET /api/cache/stats` - Get chunk cache statistics
- `POST /api/cache/clear` - Clear chunk cache (optionally specify `?world=world_name`)

## Customization

### Change Port
Edit `server.js` line 15:
```javascript
const PORT = 3000;
```

### Adjust Trail Length
Edit `public/index.html` line 299:
```javascript
if (player.trailPoints.length > 50) {  // Change 50 to desired length
```

### Modify Player Colors
Edit `public/index.html` line 186:
```javascript
const playerColors = [0x00ffff, 0xff00ff, 0xffff00, 0xff8800, 0x00ff00, 0xff0088];
```

## Troubleshooting

**"Failed to start docker logs"**
- Ensure Docker is running
- Verify the container is named `minecraft-paper`
- Check with: `docker ps -a`

**No telemetry appearing**
- Ensure McGpsTelemetry plugin is installed
- Check Minecraft server logs: `docker logs minecraft-paper`
- Verify players are online and moving

**Connection lost/reconnecting**
- Server automatically reconnects to Docker logs
- Browser automatically reconnects to SSE stream
- Check that the Minecraft server container is running

## License

MIT
