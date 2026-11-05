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

## Running as a systemd Service (Auto-Start on Boot)

Create `/etc/systemd/system/edens-gateway.service`:
```ini
[Unit]
Description=EDENS AI Greenhouse Edge Gateway
After=network.target

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/eden-ai/gateway
ExecStart=/usr/bin/python3 /home/pi/eden-ai/gateway/edens_edge_gateway.py /home/pi/eden-ai/gateway/config.json
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl daemon-reload
sudo systemctl enable edens-gateway
sudo systemctl start edens-gateway
sudo systemctl status edens-gateway
```
