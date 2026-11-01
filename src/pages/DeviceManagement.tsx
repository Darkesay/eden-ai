import React, { useState } from 'react';
import { useStoreTable, store } from '../lib/store';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Copy, Check, Fingerprint, Calendar, Cpu, Network, Plus, Server, Terminal, Settings, Wifi, Radio, Plug, ShieldAlert } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { cn } from '../lib/utils';

const DEVICE_TYPES = [
  { id: 'esp32', name: 'ESP32' },
  { id: 'esp8266', name: 'ESP8266' },
  { id: 'raspberrypi', name: 'Raspberry Pi' },
  { id: 'arduino', name: 'Arduino' },
  { id: 'linux', name: 'Linux Device' },
  { id: 'other', name: 'Other' },
];

const CONNECTION_METHODS = [
  { id: 'wifi', name: 'WiFi' },
  { id: 'ethernet', name: 'Ethernet' },
  { id: 'lora', name: 'LoRa' },
  { id: 'cellular', name: 'Cellular' },
];

export default function DeviceManagement() {
  const devicesTable = useStoreTable('registeredDevices') || {};
  const [newDeviceName, setNewDeviceName] = useState('');
  const [newDeviceType, setNewDeviceType] = useState('esp32');
  const [newDeviceConnection, setNewDeviceConnection] = useState('wifi');
  const [modalOpen, setModalOpen] = useState(false);
  const [instructionsModalOpen, setInstructionsModalOpen] = useState(false);
  const [registeredDevice, setRegisteredDevice] = useState<any>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);

  const generateToken = () => {
    if (window.crypto && window.crypto.getRandomValues) {
      return Array.from(crypto.getRandomValues(new Uint8Array(16)))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    }
    // Fallback for non-secure contexts
    return Array.from({ length: 16 })
      .map(() => Math.floor(Math.random() * 256).toString(16).padStart(2, '0'))
      .join('');
  };

  const registerDevice = () => {
    if (!newDeviceName.trim()) return;
    
    const token = generateToken();
    const newDevice = {
      name: newDeviceName,
      token,
      type: newDeviceType,
      connectionMethod: newDeviceConnection,
      registeredAt: new Date().toISOString(),
    };
    
    store.setRow('registeredDevices', Date.now().toString(), newDevice);
    
    setRegisteredDevice(newDevice);
    setNewDeviceName('');
    setNewDeviceType('esp32');
    setNewDeviceConnection('wifi');
    setModalOpen(false);
    setInstructionsModalOpen(true);
  };

  const copyToken = (token: string, id: string) => {
    navigator.clipboard.writeText(token);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const removeDevice = (id: string) => {
    if (confirmRemoveId === id) {
      store.delRow('registeredDevices', id);
      setConfirmRemoveId(null);
    } else {
      setConfirmRemoveId(id);
      setTimeout(() => setConfirmRemoveId((prev) => (prev === id ? null : prev)), 4000);
    }
  };

  const devices = Object.entries(devicesTable).sort(([, a]: any, [, b]: any) => {
    const timeA = a.registeredAt && !Number.isNaN(new Date(a.registeredAt).getTime()) ? new Date(a.registeredAt).getTime() : 0;
    const timeB = b.registeredAt && !Number.isNaN(new Date(b.registeredAt).getTime()) ? new Date(b.registeredAt).getTime() : 0;
    return timeB - timeA;
  });

  const getDeviceIcon = (type?: string) => {
    switch (type) {
      case 'raspberrypi': return Server;
      case 'linux': return Terminal;
      case 'other': return Settings;
      default: return Cpu;
    }
  };

  const getConnectionIcon = (method?: string) => {
    switch (method) {
      case 'wifi': return Wifi;
      case 'lora': return Radio;
      case 'cellular': return Network;
      default: return Plug;
    }
  };

  const getCodeSnippet = (device: any) => {
    if (!device) return '';
    const { token, name, type } = device;
    
    if (type === 'raspberrypi' || type === 'linux') {
      return `import paho.mqtt.client as mqtt
import json
import time

BROKER = "broker.hivemq.com"
PORT = 1883
DEVICE_ID = "${name}"
TOKEN = "${token}"
TOPIC_SENSORS = "greenhouse/sensors"

client = mqtt.Client(client_id=DEVICE_ID)
client.username_pw_set("device", TOKEN)
client.connect(BROKER, PORT, 60)

while True:
    data = {"temperature": 23.5, "humidity": 60.0}
    client.publish(TOPIC_SENSORS, json.dumps(data))
    time.sleep(5)`;
    }
    
    return `#include <WiFi.h>
#include <PubSubClient.h>

const char* ssid = "YOUR_WIFI_SSID";
const char* password = "YOUR_WIFI_PASSWORD";
const char* mqtt_server = "broker.hivemq.com";
const int mqtt_port = 1883;
const char* token = "${token}";

WiFiClient espClient;
PubSubClient client(espClient);

void setup() {
  Serial.begin(115200);
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) { delay(500); }
  client.setServer(mqtt_server, mqtt_port);
}

void loop() {
  if (!client.connected()) {
    client.connect("${name}", "device", token);
  }
  client.loop();
}`;
  };

  return (
    <div id="tour-device-management" className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Devices</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage the devices registered to your greenhouses and their connection keys.
          </p>
        </div>

        <Button onClick={() => setModalOpen(true)}>
          <Plus size={15} aria-hidden="true" /> Add device
        </Button>
      </div>

      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add device</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="device-name">Device name</Label>
              <Input
                id="device-name"
                placeholder="e.g. ESP32-Sector-7"
                value={newDeviceName} 
                onChange={(e) => setNewDeviceName(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="device-type">Hardware type</Label>
              <select 
                id="device-type"
                value={newDeviceType}
                onChange={(e) => setNewDeviceType(e.target.value)}
                className="flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1 text-sm transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                {DEVICE_TYPES.map(type => (
                  <option key={type.id} value={type.id}>{type.name}</option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="device-connection">Connection method</Label>
              <select 
                id="device-connection"
                value={newDeviceConnection}
                onChange={(e) => setNewDeviceConnection(e.target.value)}
                className="flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1 text-sm transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                {CONNECTION_METHODS.map(method => (
                  <option key={method.id} value={method.id}>{method.name}</option>
                ))}
              </select>
            </div>
          </div>
          <Button onClick={registerDevice} disabled={!newDeviceName.trim()} className="w-full">
            Create device and key
          </Button>
        </DialogContent>
      </Dialog>

      <Dialog open={instructionsModalOpen} onOpenChange={setInstructionsModalOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Device connection guide</DialogTitle>
          </DialogHeader>
          {registeredDevice && (
            <div className="space-y-6 py-2">
              <div className="flex items-start gap-3 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-warning">
                <ShieldAlert size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
                <div className="text-sm">
                  <p className="font-semibold">Save this device token now</p>
                  <p className="mt-0.5 text-muted-foreground">
                    You won’t be able to view the full token again. If you lose it, remove this
                    device and add it again to get a new token.
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                <h3 className="text-[13px] font-semibold">Connection code</h3>
                <p className="text-xs text-muted-foreground">
                  Use this starting code to connect your {DEVICE_TYPES.find(t => t.id === registeredDevice.type)?.name || 'Device'} over {CONNECTION_METHODS.find(m => m.id === registeredDevice.connectionMethod)?.name || 'WiFi'}.
                </p>
                <div className="relative">
                  <pre className="overflow-x-auto rounded-lg bg-muted/50 p-4 font-mono tabular text-xs">
                    <code>{getCodeSnippet(registeredDevice)}</code>
                  </pre>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={() => copyToken(getCodeSnippet(registeredDevice), 'snippet')}
                    className="absolute top-2 right-2"
                  >
                    {copiedId === 'snippet' ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
                    {copiedId === 'snippet' ? 'Copied' : 'Copy code'}
                  </Button>
                </div>
              </div>

              <Button onClick={() => setInstructionsModalOpen(false)} className="w-full">
                I’ve saved this code
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {devices.map(([id, device]: any) => {
          const Icon = getDeviceIcon(device.type);
          const MethodIcon = getConnectionIcon(device.connectionMethod);
          
          const isRecentlySeen = device.lastSeen && !Number.isNaN(new Date(device.lastSeen).getTime()) && (new Date().getTime() - new Date(device.lastSeen).getTime() < 15000);
          
          return (
            <Card key={id} className="flex flex-col">
              <CardHeader className="border-b border-border pb-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/50 text-muted-foreground">
                      <Icon size={16} aria-hidden="true" />
                    </span>
                    <div className="min-w-0">
                      <CardTitle className="truncate">{device.name}</CardTitle>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                        <span className="capitalize">{DEVICE_TYPES.find(t => t.id === device.type)?.name || 'ESP32 (Legacy)'}</span>
                        <span aria-hidden="true">·</span>
                        <span className="flex items-center gap-1 capitalize">
                          <MethodIcon size={12} aria-hidden="true" />
                          {CONNECTION_METHODS.find(m => m.id === device.connectionMethod)?.name || 'WiFi'}
                        </span>
                      </div>
                    </div>
                  </div>
                  <span
                    className={cn(
                      'shrink-0 rounded-md px-2 py-0.5 text-xs font-medium',
                      isRecentlySeen ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'
                    )}
                  >
                    {isRecentlySeen ? 'Online' : 'Offline'}
                  </span>
                </div>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col pt-4">
                <div className="space-y-1.5">
                  <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <Fingerprint size={13} aria-hidden="true" /> Device token (MQTT)
                  </span>
                  <div className="flex items-center gap-2">
                    <code className="min-w-0 flex-1 break-all rounded-lg bg-muted/50 px-2.5 py-1.5 font-mono tabular text-xs">
                      {device.token.substring(0, 8)}••••••••••••••••••••{device.token.substring(24, 32)}
                    </code>
                    <Button 
                      variant="outline" 
                      size="sm" 
                      onClick={() => {
                        setRegisteredDevice(device);
                        setInstructionsModalOpen(true);
                      }}
                      title="View connection guide"
                    >
                      <Terminal size={14} aria-hidden="true" /> Guide
                    </Button>
                    <Button 
                      variant="outline" 
                      size="sm" 
                      onClick={() => copyToken(device.token, id)}
                      title="Copy device token"
                    >
                      {copiedId === id ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
                      {copiedId === id ? 'Copied' : 'Copy'}
                    </Button>
                  </div>
                </div>

                <div className="mt-auto space-y-1 pt-4">
                  <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <Calendar size={13} aria-hidden="true" /> Last seen
                  </span>
                  <div className="text-sm text-muted-foreground">
                    {device.lastSeen && !Number.isNaN(new Date(device.lastSeen).getTime()) ? formatDistanceToNow(new Date(device.lastSeen), { addSuffix: true }) : 'Never'}
                  </div>
                </div>

                <div className="mt-4 flex gap-2 border-t border-border pt-3">
                  <Button onClick={() => removeDevice(id)} variant="destructive" className="w-full">
                    {confirmRemoveId === id ? 'Click again to confirm removal' : 'Remove device'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}

        {devices.length === 0 && (
           <div className="col-span-full flex flex-col items-center justify-center rounded-xl border border-dashed border-border p-12 text-center">
              <Network size={32} className="mb-4 text-muted-foreground" aria-hidden="true" />
              <h3 className="text-base font-semibold">No devices registered yet</h3>
              <p className="mt-1.5 max-w-md text-sm text-muted-foreground">
                Add a device to generate its connection token and pair your greenhouse hardware.
              </p>
           </div>
        )}
      </div>
    </div>
  );
}
