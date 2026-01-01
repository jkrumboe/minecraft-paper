# McGPS Web Viewer

Real-time 3D visualization of Minecraft player positions from the McGpsTelemetry plugin.

## Features

✨ **Real-time Updates** - Uses Server-Sent Events (SSE) to stream player positions  
🎮 **3D Visualization** - Three.js powered 3D world with player avatars  
🎨 **Color-coded Players** - Each player gets a unique color  
📍 **Position Trails** - See the path each player has taken  
📊 **Player List** - Live coordinates and player count  
🎯 **Interactive Controls** - Rotate, pan, and zoom the camera  

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

- **Mouse Drag**: Rotate camera
- **Right Click + Drag**: Pan camera
- **Scroll Wheel**: Zoom in/out
- **R Key**: Reset camera to default position

## API Endpoints

- `GET /` - Web interface
- `GET /telemetry-stream` - SSE stream of player updates
- `GET /api/players` - JSON of all current player positions
- `GET /api/players/:uuid/history` - Position history for a specific player

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
