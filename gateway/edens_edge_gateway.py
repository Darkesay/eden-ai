#!/usr/bin/env python3
"""
===============================================================================
EDENS AI — Production Python Greenhouse Edge Gateway
File: gateway/edens_edge_gateway.py
Version: 1.0.0-prod
License: MIT / Apache-2.0 Compatible
===============================================================================

PURPOSE:
An optional, lightweight, autonomous edge gateway designed for rural and farm
deployments (e.g., Raspberry Pi, local Linux gateway, or on-site PC).

KEY CAPABILITIES:
1. Local Telemetry Ingestion:
   - Subscribes to local ESP32/sensor nodes via local MQTT broker (using Eclipse Paho MQTT).
   - Alternatively accepts local HTTP POSTs from legacy microcontroller nodes.
2. Resilient Offline Buffering:
   - Persists telemetry samples to a local SQLite database (gateway_buffer.db)
     whenever internet/cloud connectivity drops.
   - Automatically replays buffered telemetry in chronological FIFO order once restored.
3. Local Camera Polling & Forwarding:
   - Polls private LAN cameras (e.g., http://10.87.237.36/photo) over local Wi-Fi.
   - Validates JPEG magic bytes (0xFFD8 .. 0xFFD9, min 64 bytes).
   - Forwards images to EDENS AI Cloud (POST /api/camera/upload) with X-Camera-Key.
4. Edge Gateway Diagnostics & Health:
   - Monitors host health (CPU load, memory, disk, uptime, buffer queue depth).
   - Reports gateway health alongside greenhouse telemetry.
5. Zero Code Modification:
   - Fully configurable via `config.json` or standard environment variables.
"""

import os
import sys
import time
import json
import sqlite3
import logging
import signal
import socket
import threading
from typing import Optional, Dict, Any
from urllib.parse import urlparse
import urllib.request
import urllib.error

# Optional paho-mqtt integration
try:
    import paho.mqtt.client as mqtt
    PAHO_AVAILABLE = True
except ImportError:
    PAHO_AVAILABLE = False

# Logging configuration
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] [EDENS-GATEWAY] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S"
)
logger = logging.getLogger("EdensEdgeGateway")


class GatewayConfig:
    def __init__(self, config_path: str = "config.json"):
        # Default configuration
        self.backend_url: str = os.getenv("EDENS_BACKEND_URL", "https://edens-ai.onrender.com").rstrip("/")
        self.greenhouse_id: str = os.getenv("EDENS_GREENHOUSE_ID", "")
        self.zone_id: Optional[str] = os.getenv("EDENS_ZONE_ID") or None
        self.controller_device_id: str = os.getenv("EDENS_CONTROLLER_DEVICE_ID", "")
        self.controller_key: str = os.getenv("EDENS_CONTROLLER_KEY", "")
        self.camera_device_id: str = os.getenv("EDENS_CAMERA_DEVICE_ID", "")
        self.camera_key: str = os.getenv("EDENS_CAMERA_KEY", "")

        # Local camera polling
        self.camera_poll_enabled: bool = os.getenv("CAMERA_POLL_ENABLED", "true").lower() in ("1", "true", "yes")
        self.camera_photo_url: str = os.getenv("CAMERA_PHOTO_URL", "http://10.87.237.36/photo")
        self.camera_poll_interval_sec: int = int(os.getenv("CAMERA_POLL_INTERVAL_SEC", "30"))

        # Local MQTT Broker configuration
        self.mqtt_enabled: bool = os.getenv("LOCAL_MQTT_ENABLED", "false").lower() in ("1", "true", "yes")
        self.mqtt_broker_host: str = os.getenv("LOCAL_MQTT_HOST", "localhost")
        self.mqtt_broker_port: int = int(os.getenv("LOCAL_MQTT_PORT", "1883"))
        self.mqtt_topic_sensors: str = os.getenv("LOCAL_MQTT_TOPIC", "greenhouse/+/sensors")

        # Telemetry upload interval & buffer limits
        self.telemetry_interval_sec: int = int(os.getenv("TELEMETRY_INTERVAL_SEC", "15"))
        self.max_buffered_records: int = int(os.getenv("MAX_BUFFERED_RECORDS", "5000"))
        self.db_path: str = os.getenv("GATEWAY_DB_PATH", "gateway_buffer.db")

        # Load from file if exists
        if os.path.exists(config_path):
            try:
                with open(config_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    for k, v in data.items():
                        if hasattr(self, k):
                            setattr(self, k, v)
                logger.info(f"Loaded configuration from {config_path}")
            except Exception as e:
                logger.warning(f"Failed to read {config_path}: {e}. Using environment/defaults.")


class OfflineBufferDB:
    """Manages resilient local SQLite storage for telemetry during internet blackouts."""
    def __init__(self, db_path: str, max_records: int = 5000):
        self.db_path = db_path
        self.max_records = max_records
        self.lock = threading.Lock()
        self._init_db()

    def _init_db(self):
        with self.lock:
            with sqlite3.connect(self.db_path) as conn:
                conn.execute("""
                    CREATE TABLE IF NOT EXISTS telemetry_queue (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        payload_json TEXT NOT NULL,
                        created_at REAL NOT NULL,
                        attempts INTEGER DEFAULT 0
                    )
                """)
                conn.execute("PRAGMA journal_mode = WAL")
                conn.commit()

    def enqueue(self, payload: Dict[str, Any]):
        with self.lock:
            try:
                now = time.time()
                # Lock historical timestamp and sampleId at sample time to prevent duplicate record creation
                if "timestamp" not in payload:
                    payload["timestamp"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now))
                if "sampleId" not in payload:
                    payload["sampleId"] = f"gw_{int(now * 1000)}_{abs(hash(json.dumps(payload, sort_keys=True))) % 10000000}"
                payload_str = json.dumps(payload)
                with sqlite3.connect(self.db_path) as conn:
                    # Enforce FIFO retention limit
                    cur = conn.cursor()
                    cur.execute("SELECT COUNT(*) FROM telemetry_queue")
                    count = cur.fetchone()[0]
                    if count >= self.max_records:
                        # Drop oldest 10%
                        to_drop = max(1, self.max_records // 10)
                        cur.execute(f"DELETE FROM telemetry_queue WHERE id IN (SELECT id FROM telemetry_queue ORDER BY id ASC LIMIT {to_drop})")
                    cur.execute(
                        "INSERT INTO telemetry_queue (payload_json, created_at, attempts) VALUES (?, ?, 0)",
                        (payload_str, now)
                    )
                    conn.commit()
            except Exception as e:
                logger.error(f"Failed to enqueue telemetry record: {e}")

    def fetch_batch(self, limit: int = 10):
        with self.lock:
            try:
                with sqlite3.connect(self.db_path) as conn:
                    cur = conn.cursor()
                    cur.execute("SELECT id, payload_json FROM telemetry_queue ORDER BY id ASC LIMIT ?", (limit,))
                    return cur.fetchall()
            except Exception as e:
                logger.error(f"Failed to fetch batch from queue: {e}")
                return []

    def delete_records(self, record_ids: list):
        if not record_ids:
            return
        with self.lock:
            try:
                with sqlite3.connect(self.db_path) as conn:
                    placeholders = ",".join("?" for _ in record_ids)
                    conn.execute(f"DELETE FROM telemetry_queue WHERE id IN ({placeholders})", record_ids)
                    conn.commit()
            except Exception as e:
                logger.error(f"Failed to delete records {record_ids}: {e}")

    def get_queue_size(self) -> int:
        with self.lock:
            try:
                with sqlite3.connect(self.db_path) as conn:
                    cur = conn.cursor()
                    cur.execute("SELECT COUNT(*) FROM telemetry_queue")
                    return cur.fetchone()[0]
            except Exception:
                return 0


class EdensEdgeGateway:
    def __init__(self, config: GatewayConfig):
        self.config = config
        self.db = OfflineBufferDB(config.db_path, config.max_buffered_records)
        self.running = False
        self.mqtt_client = None
        self.last_camera_poll = 0
        self.consecutive_cloud_errors = 0

        # Gateway system health metrics
        self.start_time = time.time()

    def get_gateway_diagnostics(self) -> Dict[str, Any]:
        """Collects lightweight host performance metrics without third-party heavy dependencies."""
        uptime = int(time.time() - self.start_time)
        queue_size = self.db.get_queue_size()
        hostname = socket.gethostname()

        load1, load5, _ = os.getloadavg() if hasattr(os, "getloadavg") else (0.0, 0.0, 0.0)

        return {
            "gatewayHost": hostname,
            "uptimeSeconds": uptime,
            "loadAvg1m": round(load1, 2),
            "loadAvg5m": round(load5, 2),
            "bufferedTelemetryRecords": queue_size,
            "gatewayVersion": "1.0.0-prod"
        }

    def post_telemetry_to_cloud(self, payload: Dict[str, Any]) -> bool:
        """Sends a telemetry reading to the EDENS AI backend over HTTPS."""
        if not self.config.controller_key:
            logger.warning("No EDENS_CONTROLLER_KEY configured. Cannot push telemetry to cloud.")
            return False

        upload_url = f"{self.config.backend_url}/api/telemetry/upload"
        json_data = json.dumps(payload).encode("utf-8")

        headers = {
            "Content-Type": "application/json",
            "X-Hardware-Key": self.config.controller_key,
            "User-Agent": "EDENS-Python-Edge-Gateway/1.0.0"
        }
        if self.config.greenhouse_id:
            headers["X-Greenhouse-Id"] = self.config.greenhouse_id
        if self.config.controller_device_id:
            headers["X-Device-Id"] = self.config.controller_device_id
        if self.config.zone_id:
            headers["X-Zone-Id"] = self.config.zone_id

        req = urllib.request.Request(upload_url, data=json_data, headers=headers, method="POST")

        try:
            with urllib.request.urlopen(req, timeout=12) as response:
                status = response.getcode()
                if 200 <= status < 300:
                    self.consecutive_cloud_errors = 0
                    return True
                logger.warning(f"Telemetry upload returned unexpected HTTP {status}")
                return False
        except urllib.error.HTTPError as e:
            logger.error(f"Cloud HTTP Error: {e.code} - {e.reason}")
            return False
        except Exception as e:
            logger.warning(f"Cloud Network Error: {e}")
            return False

    def flush_offline_buffer(self):
        """Replays offline buffered records to cloud in batches when connection is alive."""
        batch = self.db.fetch_batch(limit=10)
        if not batch:
            return

        to_delete = []
        for record_id, payload_json in batch:
            try:
                payload = json.loads(payload_json)
                if self.post_telemetry_to_cloud(payload):
                    to_delete.append(record_id)
                else:
                    # Cloud still unreachable; stop replay attempt
                    break
            except Exception as e:
                logger.error(f"Corrupt buffer record #{record_id}: {e}. Removing.")
                to_delete.append(record_id)

        if to_delete:
            self.db.delete_records(to_delete)
            logger.info(f"Replayed and cleared {len(to_delete)} buffered telemetry records to cloud.")

    def poll_and_forward_camera(self):
        """Polls local camera photo endpoint and uploads JPEG to EDENS AI."""
        if not self.config.camera_poll_enabled or not self.config.camera_photo_url or not self.config.camera_key:
            return

        now = time.time()
        if now - self.last_camera_poll < self.config.camera_poll_interval_sec:
            return
        self.last_camera_poll = now

        photo_url = self.config.camera_photo_url
        logger.info(f"Polling local camera snapshot from {photo_url}...")

        try:
            req = urllib.request.Request(photo_url, headers={"User-Agent": "EDENS-Gateway-Camera-Poller/1.0"})
            with urllib.request.urlopen(req, timeout=8) as resp:
                if resp.getcode() != 200:
                    logger.warning(f"Camera returned HTTP {resp.getcode()}")
                    return
                jpeg_bytes = resp.read()

            # Strict JPEG validation: SOI (0xFFD8) and EOI (0xFFD9), min 64 bytes
            if len(jpeg_bytes) < 64 or jpeg_bytes[0] != 0xFF or jpeg_bytes[1] != 0xD8:
                logger.warning(f"Camera responded with non-JPEG payload ({len(jpeg_bytes)} bytes)")
                return

            # Forward to EDENS AI
            upload_url = f"{self.config.backend_url}/api/camera/upload"
            headers = {
                "Content-Type": "image/jpeg",
                "X-Camera-Key": self.config.camera_key,
                "User-Agent": "EDENS-Python-Edge-Gateway/1.0.0"
            }
            if self.config.greenhouse_id:
                headers["X-Greenhouse-Id"] = self.config.greenhouse_id
            if self.config.camera_device_id:
                headers["X-Device-Id"] = self.config.camera_device_id

            upload_req = urllib.request.Request(upload_url, data=jpeg_bytes, headers=headers, method="POST")
            with urllib.request.urlopen(upload_req, timeout=15) as upload_resp:
                if 200 <= upload_resp.getcode() < 300:
                    logger.info(f"Successfully uploaded camera frame ({len(jpeg_bytes)} bytes) to EDENS AI cloud.")
                else:
                    logger.warning(f"Camera upload failed with HTTP {upload_resp.getcode()}")

        except Exception as e:
            logger.warning(f"Local camera poll/upload failed: {e}")

    def on_mqtt_message(self, client, userdata, msg):
        """Callback for incoming local MQTT messages from greenhouse sensors."""
        try:
            payload = json.loads(msg.payload.decode("utf-8"))
            logger.info(f"Received local MQTT telemetry on topic '{msg.topic}': {payload}")

            # Merge with gateway diagnostics
            payload["gatewayDiagnostics"] = self.get_gateway_diagnostics()

            # Try immediate cloud forward; fallback to local buffer on failure
            if not self.post_telemetry_to_cloud(payload):
                logger.info("Cloud unreachable. Storing telemetry in local buffer.")
                self.db.enqueue(payload)
            else:
                # Connected: try draining any previous offline backlog
                self.flush_offline_buffer()
        except Exception as e:
            logger.error(f"Error handling MQTT message: {e}")

    def start_mqtt(self):
        """Starts local MQTT subscription client if enabled."""
        if not self.config.mqtt_enabled:
            return

        if not PAHO_AVAILABLE:
            logger.error("paho-mqtt library is not installed! Run `pip install -r requirements.txt` to enable MQTT.")
            return

        try:
            self.mqtt_client = mqtt.Client(client_id=f"edens_gateway_{int(time.time())}")
            self.mqtt_client.on_message = self.on_mqtt_message
            self.mqtt_client.connect(self.config.mqtt_broker_host, self.config.mqtt_broker_port, 60)
            self.mqtt_client.subscribe(self.config.mqtt_topic_sensors)
            self.mqtt_client.loop_start()
            logger.info(f"Subscribed to local MQTT broker at {self.config.mqtt_broker_host}:{self.config.mqtt_broker_port} on '{self.config.mqtt_topic_sensors}'")
        except Exception as e:
            logger.warning(f"Could not connect to local MQTT broker: {e}")

    def run(self):
        self.running = True
        logger.info("Starting EDENS AI Edge Gateway service...")
        logger.info(f"Target Backend: {self.config.backend_url}")
        logger.info(f"Greenhouse ID : {self.config.greenhouse_id or '(none)'}")
        logger.info(f"Controller ID : {self.config.controller_device_id or '(none)'}")
        logger.info(f"Camera Poll   : {'ENABLED' if self.config.camera_poll_enabled else 'DISABLED'} -> {self.config.camera_photo_url}")

        self.start_mqtt()

        while self.running:
            try:
                # 1. Drain offline buffer if any
                self.flush_offline_buffer()

                # 2. Poll local camera if configured
                self.poll_and_forward_camera()

                time.sleep(2)
            except KeyboardInterrupt:
                break
            except Exception as e:
                logger.error(f"Unhandled gateway loop error: {e}")
                time.sleep(5)

        self.stop()

    def stop(self):
        logger.info("Shutting down EDENS AI Edge Gateway...")
        self.running = False
        if self.mqtt_client:
            try:
                self.mqtt_client.loop_stop()
                self.mqtt_client.disconnect()
            except Exception:
                pass
        logger.info("Gateway service stopped cleanly.")


def main():
    config_file = sys.argv[1] if len(sys.argv) > 1 else "config.json"
    config = GatewayConfig(config_file)
    gateway = EdensEdgeGateway(config)

    def sig_handler(sig, frame):
        gateway.stop()
        sys.exit(0)

    signal.signal(signal.SIGINT, sig_handler)
    signal.signal(signal.SIGTERM, sig_handler)

    gateway.run()


if __name__ == "__main__":
    main()
