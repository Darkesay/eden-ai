# EDENS AI — Python Greenhouse Edge Gateway

The **EDENS AI Edge Gateway** is an optional lightweight daemon designed for agricultural IoT deployments where on-site buffering and local camera relaying are desired.

## Features
- **Local Camera Relay**: Retrieves photographs from private LAN cameras (e.g., `http://10.87.237.36/photo`) and uploads them to EDENS AI Cloud (`POST /api/camera/upload`).
- **Resilient Offline Buffering**: When cellular or broadband connection fails, sensor telemetry is queued locally in SQLite (`gateway_buffer.db`).
- **Automatic Replay**: Flushes backlogged readings in FIFO order as soon as cloud reachability is re-established.
- **Local MQTT Integration**: Can subscribe to local sensor networks using Eclipse Paho MQTT.
- **Host Diagnostics**: Reports gateway uptime, CPU load, and buffer status to the cloud.

## Quick Start (Raspberry Pi / Linux)

### 1. Install Dependencies
```bash
cd gateway
pip3 install -r requirements.txt
```

### 2. Configure
Copy `config.example.json` to `config.json` and edit:
```bash
cp config.example.json config.json
nano config.json
```
Alternatively, configure via environment variables:
```bash
export EDENS_BACKEND_URL="https://edens-ai.onrender.com"
export EDENS_GREENHOUSE_ID="gh_zone_1"
export EDENS_CAMERA_KEY="edcam_xxxxxxxxxxxxxxxx"
export CAMERA_PHOTO_URL="http://10.87.237.36/photo"
```

### 3. Run
```bash
python3 edens_edge_gateway.py config.json
```

## Local MQTT Broker Requirements (Optional)

If your local greenhouse sensors broadcast over MQTT (`"mqtt_enabled": true`), a local broker must be running on the gateway (or reachable on the local farm network):
```bash
sudo apt update
sudo apt install mosquitto mosquitto-clients
sudo systemctl enable mosquitto
sudo systemctl start mosquitto
```
*Note: If local microcontrollers send data via direct HTTP or you are only using the gateway to relay a private camera (`/photo`), set `"mqtt_enabled": false` in `config.json`.*

## Cloud Uplink & Render Architecture
1. **Primary Protocol:** HTTPS REST (`POST /api/telemetry/upload` and `POST /api/camera/upload`). This works 100% reliably through Render's TLS reverse proxy without opening custom firewall ports.
2. **WebSocket MQTT Transport:** If MQTT client streaming is required, connect via secure WebSockets to `wss://edens-ai.onrender.com/api/iot/mqtt-ws`. Render does NOT expose arbitrary raw TCP ports (such as raw port 1883).
3. **Authentication:** The gateway attaches the provisioned `X-Hardware-Key` or `X-Camera-Key` in the HTTP headers. Unauthenticated requests are rejected (fail-closed) by the server.

