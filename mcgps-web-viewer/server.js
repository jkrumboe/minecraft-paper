/**
 * McGPS Web Viewer - Real-time 3D Player Tracking
 * 
 * This server:
 * 1. Tails Docker logs from the minecraft-paper container
 * 2. Parses JSON telemetry lines from McGpsTelemetry plugin
 * 3. Serves a 3D web interface
 * 4. Streams telemetry updates to browsers via Server-Sent Events (SSE)
 * 
 * Usage:
 *   npm install
 *   npm start
 *   Open http://localhost:3000
 */

const express = require('express');
const { spawn } = require('child_process');
const path = require('path');

const app = express();
const PORT = 3000;

// Store recent player positions (keep last 100 per player)
const playerData = new Map();
const MAX_HISTORY = 100;

// Active SSE clients
const clients = new Set();

// Serve static files from public directory
app.use(express.static('public'));

/**
 * SSE endpoint - streams telemetry to browsers
 */
app.get('/telemetry-stream', (req, res) => {
    // Set SSE headers
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
    });

    // Add client to set
    clients.add(res);

    // Send current player data on connect
    const currentData = {};
    playerData.forEach((history, uuid) => {
        if (history.length > 0) {
            currentData[uuid] = history[history.length - 1];
        }
    });
    
    res.write(`data: ${JSON.stringify({ type: 'init', players: currentData })}\n\n`);

    // Remove client on disconnect
    req.on('close', () => {
        clients.delete(res);
    });
});

/**
 * Broadcast telemetry to all connected clients
 */
function broadcastTelemetry(data) {
    const message = `data: ${JSON.stringify({ type: 'update', player: data })}\n\n`;
    
    clients.forEach(client => {
        try {
            client.write(message);
        } catch (err) {
            clients.delete(client);
        }
    });
}

/**
 * Start tailing Docker logs and parse telemetry
 */
function startLogTailing() {
    console.log('Starting Docker log tail for minecraft-paper...');
    
    // Spawn docker logs process
    const docker = spawn('docker', ['logs', '-f', '--tail', '0', 'minecraft-paper']);
    
    let buffer = '';
    
    docker.stdout.on('data', (data) => {
        buffer += data.toString();
        const lines = buffer.split('\n');
        
        // Keep last incomplete line in buffer
        buffer = lines.pop() || '';
        
        // Process complete lines
        lines.forEach(line => {
            parseTelemetryLine(line);
        });
    });
    
    docker.stderr.on('data', (data) => {
        // Docker logs can come through stderr too
        buffer += data.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        
        lines.forEach(line => {
            parseTelemetryLine(line);
        });
    });
    
    docker.on('error', (err) => {
        console.error('Failed to start docker logs:', err.message);
        console.error('Make sure Docker is running and minecraft-paper container exists.');
        process.exit(1);
    });
    
    docker.on('close', (code) => {
        console.log(`Docker logs process exited with code ${code}`);
        console.log('Reconnecting in 5 seconds...');
        setTimeout(startLogTailing, 5000);
    });
}

/**
 * Parse a log line and extract telemetry JSON
 */
function parseTelemetryLine(line) {
    // Look for JSON objects in the line
    const jsonMatch = line.match(/\{[^}]*"ts":\d+[^}]*\}/);
    
    if (jsonMatch) {
        try {
            const data = JSON.parse(jsonMatch[0]);
            
            // Validate it's telemetry data
            if (data.ts && data.uuid && data.x !== undefined) {
                storeTelemetry(data);
                broadcastTelemetry(data);
            }
        } catch (err) {
            // Not valid JSON, ignore
        }
    }
}

/**
 * Store telemetry in memory (limited history)
 */
function storeTelemetry(data) {
    const uuid = data.uuid;
    
    if (!playerData.has(uuid)) {
        playerData.set(uuid, []);
    }
    
    const history = playerData.get(uuid);
    history.push(data);
    
    // Trim history if too long
    if (history.length > MAX_HISTORY) {
        history.shift();
    }
}

/**
 * API endpoint to get all player data
 */
app.get('/api/players', (req, res) => {
    const result = {};
    
    playerData.forEach((history, uuid) => {
        if (history.length > 0) {
            result[uuid] = history[history.length - 1];
        }
    });
    
    res.json(result);
});

/**
 * API endpoint to get player history
 */
app.get('/api/players/:uuid/history', (req, res) => {
    const uuid = req.params.uuid;
    const history = playerData.get(uuid) || [];
    res.json(history);
});

// Start server
app.listen(PORT, () => {
    console.log(`╔════════════════════════════════════════════════════╗`);
    console.log(`║  McGPS Web Viewer - Real-time Player Tracking     ║`);
    console.log(`╚════════════════════════════════════════════════════╝`);
    console.log();
    console.log(`🌐 Server running at: http://localhost:${PORT}`);
    console.log(`📊 Open in browser to see real-time 3D player positions`);
    console.log();
    console.log(`Monitoring Docker container: minecraft-paper`);
    console.log(`Press Ctrl+C to stop`);
    console.log();
    
    startLogTailing();
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\nShutting down gracefully...');
    process.exit(0);
});
