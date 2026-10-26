import React, { useState } from 'react';
import { useStoreTable, store } from '../lib/store';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '../components/ui/dialog';
import { Copy, Check, Fingerprint, Calendar, Cpu, Network, Plus, Server, Terminal, Settings, Wifi, Radio, Plug } from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Endpoint Fleet</h1>
          <p className="opacity-70 text-sm mt-1">Manage connected IoT sensors and actuators</p>
        </div>
        
        <Button onClick={() => setModalOpen(true)} className="bg-[#10B981] hover:bg-[#059669] text-black font-semibold h-10 px-4 rounded-xl gap-2">
            <Plus size={18} /> Provision Node
        </Button>
        <Dialog open={modalOpen} onOpenChange={setModalOpen}>
          <DialogContent className="bg-[#FFFFFF] dark:bg-[#080808] border-[#D1E8D1] dark:border-[#1A2A1A]">
            <DialogHeader>
              <DialogTitle>Provision New Endpoint Node</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
               <div className="space-y-2">
                <label className="text-sm font-medium opacity-80">Node Identifier Alias</label>
                <Input 
                  placeholder="e.g. ESP32-Sector-7"
                  value={newDeviceName} 
                  onChange={(e) => setNewDeviceName(e.target.value)}
                  className="bg-[#F8FAF8] dark:bg-[#040404] border-[#D1E8D1] dark:border-[#1A2A1A]"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium opacity-80">Hardware Type</label>
                <select 
                  value={newDeviceType}
                  onChange={(e) => setNewDeviceType(e.target.value)}
                  className="flex h-10 w-full rounded-md border border-[#D1E8D1] dark:border-[#1A2A1A] bg-[#F8FAF8] dark:bg-[#040404] px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {DEVICE_TYPES.map(type => (
                    <option key={type.id} value={type.id}>{type.name}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium opacity-80">Connection Method</label>
                <select 
                  value={newDeviceConnection}
                  onChange={(e) => setNewDeviceConnection(e.target.value)}
                  className="flex h-10 w-full rounded-md border border-[#D1E8D1] dark:border-[#1A2A1A] bg-[#F8FAF8] dark:bg-[#040404] px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {CONNECTION_METHODS.map(method => (
                    <option key={method.id} value={method.id}>{method.name}</option>
                  ))}
                </select>
              </div>

            </div>
            <Button onClick={registerDevice} disabled={!newDeviceName.trim()} className="w-full bg-[#10B981] text-black hover:bg-[#059669]">
              Generate Keys & Register
            </Button>
          </DialogContent>
        </Dialog>
      </div>

      <Dialog open={instructionsModalOpen} onOpenChange={setInstructionsModalOpen}>
        <DialogContent className="max-w-2xl bg-[#FFFFFF] dark:bg-[#080808] border-[#D1E8D1] dark:border-[#1A2A1A] max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>M2M Connection Guide</DialogTitle>
          </DialogHeader>
          {registeredDevice && (
            <div className="space-y-6 py-4">
              <div className="flex items-start gap-4 p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400">
                <Settings size={24} className="shrink-0 mt-1" />
                <div className="text-sm">
                  <p className="font-bold mb-1">Store your Identity Token securely</p>
                  <p>You will not be able to view this full token again. If it is lost, you must decommission this node and provision a new one.</p>
                </div>
              </div>

              <div className="space-y-4">
                <h3 className="font-bold tracking-tight">Code Integration</h3>
                <p className="text-sm opacity-80">
                   Use the following boilerplate code to connect your {DEVICE_TYPES.find(t => t.id === registeredDevice.type)?.name || 'Device'} to the BOTANIX telemetry mesh via {CONNECTION_METHODS.find(m => m.id === registeredDevice.connectionMethod)?.name || 'WiFi'}.
                </p>
                <div className="relative">
                  <pre className="p-4 rounded-xl bg-[#F8FAF8] dark:bg-[#040404] border border-[#D1E8D1] dark:border-[#1A2A1A] text-xs font-mono overflow-x-auto text-[#1A2A1A] dark:text-[#E2E8F0]">
                    <code>{getCodeSnippet(registeredDevice)}</code>
                  </pre>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={() => copyToken(getCodeSnippet(registeredDevice), 'snippet')}
                    className="absolute top-2 right-2 h-8 bg-[#FFFFFF] dark:bg-[#080808] border-[#D1E8D1] dark:border-[#1A2A1A]"
                  >
                    {copiedId === 'snippet' ? <Check size={14} className="mr-2 text-green-500" /> : <Copy size={14} className="mr-2" />}
                    Copy Code
                  </Button>
                </div>
              </div>

              <Button onClick={() => setInstructionsModalOpen(false)} className="w-full bg-[#10B981] text-black hover:bg-[#059669]">
                I have saved this code
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {devices.map(([id, device]: any) => {
          const Icon = getDeviceIcon(device.type);
          const MethodIcon = getConnectionIcon(device.connectionMethod);
          
          const isRecentlySeen = device.lastSeen && !Number.isNaN(new Date(device.lastSeen).getTime()) && (new Date().getTime() - new Date(device.lastSeen).getTime() < 15000);
          
          return (
            <Card key={id} className="border-[#D1E8D1] dark:border-[#1A2A1A] bg-[#FFFFFF] dark:bg-[#080808] shadow-[0_4px_24px_-4px_rgba(0,0,0,0.05)] hover:scale-[1.01] transition-transform duration-300 flex flex-col">
              <CardHeader className="pb-3 border-b border-[#D1E8D1] dark:border-[#1A2A1A]">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-[#F8FAF8] dark:bg-[#040404] rounded-lg border border-[#D1E8D1] dark:border-[#1A2A1A]">
                      <Icon size={20} className="text-[#10B981]" />
                    </div>
                    <div>
                      <CardTitle className="text-lg">{device.name}</CardTitle>
                      <div className="text-xs opacity-60 mt-0.5 flex gap-2 items-center">
                        <span className="capitalize">{DEVICE_TYPES.find(t => t.id === device.type)?.name || 'ESP32 (Legacy)'}</span>
                        <span>•</span>
                        <span className="capitalize flex items-center gap-1">
                          <MethodIcon size={10} />
                          {CONNECTION_METHODS.find(m => m.id === device.connectionMethod)?.name || 'WiFi'}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                     <span className="relative flex h-3 w-3" title={isRecentlySeen ? "Connected" : "Offline"}>
                       {isRecentlySeen && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>}
                       <span className={cn("relative inline-flex rounded-full h-3 w-3", isRecentlySeen ? "bg-green-500" : "bg-gray-400 dark:bg-gray-600")}></span>
                     </span>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-4 space-y-4 flex-1 flex flex-col">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-xs uppercase opacity-60 font-semibold tracking-wider">
                    <Fingerprint size={14} /> Identity Token (MQTT)
                  </div>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 bg-[#F8FAF8] dark:bg-[#040404] p-2 rounded border border-[#D1E8D1] dark:border-[#1A2A1A] text-xs font-mono break-all text-amber-600 dark:text-amber-400">
                       {device.token.substring(0, 8)}••••••••••••••••••••{device.token.substring(24, 32)}
                    </code>
                    <Button 
                      variant="outline" 
                      size="icon" 
                      onClick={() => {
                        setRegisteredDevice(device);
                        setInstructionsModalOpen(true);
                      }}
                      className="shrink-0 bg-transparent border-[#D1E8D1] dark:border-[#1A2A1A]"
                      title="View Connection Guide"
                    >
                      <Terminal size={16} />
                    </Button>
                    <Button 
                      variant="outline" 
                      size="icon" 
                      onClick={() => copyToken(device.token, id)}
                      className="shrink-0 bg-transparent border-[#D1E8D1] dark:border-[#1A2A1A]"
                    >
                      {copiedId === id ? <Check size={16} className="text-green-500" /> : <Copy size={16} />}
                    </Button>
                  </div>
                </div>

                <div className="space-y-1 mt-auto pt-4">
                  <div className="flex items-center gap-2 text-xs uppercase opacity-60 font-semibold tracking-wider">
                    <Calendar size={14} /> Last Seen
                  </div>
                  <div className="text-sm font-mono opacity-80">
                     {device.lastSeen && !Number.isNaN(new Date(device.lastSeen).getTime()) ? formatDistanceToNow(new Date(device.lastSeen), { addSuffix: true }) : 'Never'}
                  </div>
                </div>

                <div className="pt-4 border-t border-[#D1E8D1] dark:border-[#1A2A1A] mt-auto flex gap-2">
                  <Button onClick={() => removeDevice(id)} variant="ghost" className="w-full text-red-500 hover:bg-red-500/10 hover:text-red-600">
                     {confirmRemoveId === id ? 'Click Again to Confirm Removal' : 'Decommission Node'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}

        {devices.length === 0 && (
           <div className="col-span-full border-2 border-dashed border-[#D1E8D1] dark:border-[#1A2A1A] rounded-2xl p-12 text-center flex flex-col items-center justify-center opacity-70">
              <Network size={48} className="mb-4 opacity-50" />
              <h3 className="text-xl font-bold mb-2">No active endpoints</h3>
              <p className="max-w-md mx-auto">Provision an endpoint node to securely connect IoT hardware to the EDENS AI telemetry mesh.</p>
           </div>
        )}
      </div>
    </div>
  );
}

