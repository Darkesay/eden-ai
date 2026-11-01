import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Settings2, Cpu, Leaf, Thermometer, Bot, Bell, Database, User, Trash2, Download } from 'lucide-react';
import { store, useStoreValue, useStoreTable } from '../lib/store';

const selectCls =
  'flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50';

// Helper for exporting data
function downloadCSV(tableData: any, filename: string) {
  if (!tableData) return;
  const rows = Object.values(tableData);
  if (rows.length === 0) return;

  const headers = Object.keys(rows[0] as object).join(',');
  const csvRows = rows.map(row => Object.values(row as object).map(val => `"${val}"`).join(','));
  const csvContent = [headers, ...csvRows].join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.setAttribute("href", url);
  link.setAttribute("download", filename);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export function SettingsPanel() {
  const [open, setOpen] = useState(false);

  // 1. HARDWARE CONFIGURATION
  const [mqttUrl, setMqttUrl] = useState(store.getValue('mqttBrokerUrl') as string || 'wss://broker.emqx.io:8084/mqtt');
  const [mqttPort, setMqttPort] = useState(store.getValue('mqttPort') as string || '8883');
  const [cam1Url, setCam1Url] = useState(store.getValue('cameraUrl') as string || import.meta.env.VITE_ESP32_CAM_STREAM_URL || '');
  const [cam2Url, setCam2Url] = useState(store.getValue('camera2Url') as string || '');
  const [cam3Url, setCam3Url] = useState(store.getValue('camera3Url') as string || '');
  const [networkType, setNetworkType] = useState(store.getValue('networkType') as string || 'wifi');

  // 2. CROP & HARVEST SETTINGS
  const [cropType, setCropType] = useState(store.getValue('cropType') as string || 'tomato');
  const [plantingDate, setPlantingDate] = useState(store.getValue('plantingDate') as string || '');
  const [farmerNotes, setFarmerNotes] = useState(store.getValue('farmerNotes') as string || '');

  // 3. ENVIRONMENTAL THRESHOLDS
  const [tempMin, setTempMin] = useState(store.getValue('tempMinThreshold') as string || '18');
  const [tempMax, setTempMax] = useState(store.getValue('tempMaxThreshold') as string || '30');
  const [humMin, setHumMin] = useState(store.getValue('humMinThreshold') as string || '40');
  const [humMax, setHumMax] = useState(store.getValue('humMaxThreshold') as string || '80');
  const [soilMin, setSoilMin] = useState(store.getValue('soilMinThreshold') as string || '30');
  const [soilMax, setSoilMax] = useState(store.getValue('soilMaxThreshold') as string || '70');
  const [lightMin, setLightMin] = useState(store.getValue('lightMinThreshold') as string || '200');
  const [lightMax, setLightMax] = useState(store.getValue('lightMaxThreshold') as string || '1000');

  // 4. AUTOMATION & AI AGENTS
  const [climateAgent, setClimateAgent] = useState(store.getValue('agent_ClimateAgent_enabled') !== false);
  const [climateAutoApprove, setClimateAutoApprove] = useState(store.getValue('auto_approve_agent_ClimateAgent') === true);

  const [irrigationAgent, setIrrigationAgent] = useState(store.getValue('agent_IrrigationAgent_enabled') !== false);
  const [irrigationAutoApprove, setIrrigationAutoApprove] = useState(store.getValue('auto_approve_agent_IrrigationAgent') === true);

  const [visionAgent, setVisionAgent] = useState(store.getValue('agent_VisionAgent_enabled') !== false);
  const [visionAutoApprove, setVisionAutoApprove] = useState(store.getValue('auto_approve_agent_VisionAgent') === true);

  const [harvestAgent, setHarvestAgent] = useState(store.getValue('agent_HarvestAgent_enabled') !== false);
  const [harvestAutoApprove, setHarvestAutoApprove] = useState(store.getValue('auto_approve_agent_HarvestAgent') === true);

  const [alertAgent, setAlertAgent] = useState(store.getValue('agent_AlertAgent_enabled') !== false);
  const [alertAutoApprove, setAlertAutoApprove] = useState(store.getValue('auto_approve_agent_AlertAgent') === true);

  const [checkInterval, setCheckInterval] = useState(store.getValue('agentCheckInterval') as string || '5');
  const [autoScanFrequency, setAutoScanFrequency] = useState(store.getValue('autoScanFrequency') as string || '1');

  // 5. NOTIFICATION PREFERENCES
  const [browserNotifs, setBrowserNotifs] = useState(store.getValue('browserNotifs') !== false);
  const [alertSensitivity, setAlertSensitivity] = useState(store.getValue('alertSensitivity') as string || 'medium');
  const [quietHoursStart, setQuietHoursStart] = useState(store.getValue('quietHoursStart') as string || '22:00');
  const [quietHoursEnd, setQuietHoursEnd] = useState(store.getValue('quietHoursEnd') as string || '06:00');

  // 7. USER PROFILE
  const [farmName, setFarmName] = useState(store.getValue('farmName') as string || '');
  const [farmerName, setFarmerName] = useState(store.getValue('farmerName') as string || '');
  const [locationStr, setLocationStr] = useState(store.getValue('location') as string || '');
  const [greenhouseSize, setGreenhouseSize] = useState(store.getValue('greenhouseSize') as string || 'medium');

  const activityLog = useStoreTable('activityLog');
  const aiHistory = useStoreTable('aiAnalyses');
  const logLen = activityLog ? JSON.stringify(activityLog).length : 0;
  const aiLen = aiHistory ? JSON.stringify(aiHistory).length : 0;
  const storageUsedKb = Math.round((logLen + aiLen) / 1024);

  const saveSettings = () => {
    store.setValue('mqttBrokerUrl', mqttUrl);
    store.setValue('mqttPort', mqttPort);
    store.setValue('cameraUrl', cam1Url);
    store.setValue('camera2Url', cam2Url);
    store.setValue('camera3Url', cam3Url);
    store.setValue('networkType', networkType);

    store.setValue('cropType', cropType);
    store.setValue('plantingDate', plantingDate);
    store.setValue('farmerNotes', farmerNotes);

    store.setValue('tempMinThreshold', Number(tempMin));
    store.setValue('tempMaxThreshold', Number(tempMax));
    store.setValue('humMinThreshold', Number(humMin));
    store.setValue('humMaxThreshold', Number(humMax));
    store.setValue('soilMinThreshold', Number(soilMin));
    store.setValue('soilMaxThreshold', Number(soilMax));
    store.setValue('lightMinThreshold', Number(lightMin));
    store.setValue('lightMaxThreshold', Number(lightMax));

    store.setValue('agent_ClimateAgent_enabled', climateAgent);
    store.setValue('auto_approve_agent_ClimateAgent', climateAutoApprove);
    store.setValue('agent_IrrigationAgent_enabled', irrigationAgent);
    store.setValue('auto_approve_agent_IrrigationAgent', irrigationAutoApprove);
    store.setValue('agent_VisionAgent_enabled', visionAgent);
    store.setValue('auto_approve_agent_VisionAgent', visionAutoApprove);
    store.setValue('agent_HarvestAgent_enabled', harvestAgent);
    store.setValue('auto_approve_agent_HarvestAgent', harvestAutoApprove);
    store.setValue('agent_AlertAgent_enabled', alertAgent);
    store.setValue('auto_approve_agent_AlertAgent', alertAutoApprove);
    store.setValue('agentCheckInterval', checkInterval);
    store.setValue('autoScanFrequency', autoScanFrequency);

    store.setValue('browserNotifs', browserNotifs);
    store.setValue('alertSensitivity', alertSensitivity);
    store.setValue('quietHoursStart', quietHoursStart);
    store.setValue('quietHoursEnd', quietHoursEnd);

    store.setValue('farmName', farmName);
    store.setValue('farmerName', farmerName);
    store.setValue('location', locationStr);
    store.setValue('greenhouseSize', greenhouseSize);

    setOpen(false);
  };

  const handleExportData = () => {
     downloadCSV(activityLog, 'botanix_sensor_logs.csv');
  };

  const clearSensorHistory = () => {
    if (window.confirm("Clear all sensor logs and activity history?")) {
      store.delTable('activityLog');
    }
  };

  const clearAIHistory = () => {
    if (window.confirm("Clear all AI vision analysis history?")) {
      store.delTable('aiAnalyses');
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" className="gap-2" />}>
         <Settings2 size={16} className="text-muted-foreground" aria-hidden="true" /> Settings
      </DialogTrigger>
      <DialogContent className="max-w-2xl overflow-y-auto max-h-[90vh] pb-20">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg font-semibold">
            <Settings2 size={18} className="text-muted-foreground" aria-hidden="true" /> Settings
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-8">

          {/* HARDWARE CONFIGURATION */}
          <section className="space-y-4 border-b border-border pb-4">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <Cpu size={16} className="text-muted-foreground" aria-hidden="true" /> Hardware configuration
            </h3>
            <div className="grid grid-cols-2 gap-3">
               <div className="space-y-2">
                 <Label htmlFor="settings-mqtt-url">MQTT broker URL</Label>
                 <Input id="settings-mqtt-url" value={mqttUrl} onChange={e => setMqttUrl(e.target.value)} />
               </div>
               <div className="space-y-2">
                 <Label htmlFor="settings-mqtt-port">MQTT port</Label>
                 <Input id="settings-mqtt-port" value={mqttPort} onChange={e => setMqttPort(e.target.value)} className="font-mono tabular" />
               </div>
               <div className="space-y-2 col-span-2">
                 <Label htmlFor="settings-network-type">Network type</Label>
                 <select id="settings-network-type" value={networkType} onChange={e => setNetworkType(e.target.value)} className={selectCls}>
                   <option value="wifi">WiFi</option>
                   <option value="lorawan">LoRaWAN</option>
                   <option value="cellular">Cellular</option>
                   <option value="ethernet">Ethernet</option>
                 </select>
               </div>
               <div className="space-y-2 col-span-2">
                 <Label htmlFor="settings-cam-1-url">Camera 1 stream URL</Label>
                 <Input id="settings-cam-1-url" value={cam1Url} onChange={e => setCam1Url(e.target.value)} />
               </div>
               <div className="space-y-2 col-span-2">
                 <Label htmlFor="settings-cam-2-url">Camera 2 stream URL (optional)</Label>
                 <Input id="settings-cam-2-url" value={cam2Url} onChange={e => setCam2Url(e.target.value)} />
               </div>
               <div className="space-y-2 col-span-2">
                 <Label htmlFor="settings-cam-3-url">Camera 3 stream URL (optional)</Label>
                 <Input id="settings-cam-3-url" value={cam3Url} onChange={e => setCam3Url(e.target.value)} />
               </div>
            </div>
          </section>

          {/* CROP & HARVEST */}
          <section className="space-y-4 border-b border-border pb-4">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <Leaf size={16} className="text-muted-foreground" aria-hidden="true" /> Crop & harvest
            </h3>
            <div className="grid grid-cols-2 gap-3">
               <div className="space-y-2 col-span-2 sm:col-span-1">
                 <Label htmlFor="settings-crop-type">Crop type</Label>
                 <select id="settings-crop-type" value={cropType} onChange={e => setCropType(e.target.value)} className={selectCls}>
                   <option value="tomato">Tomato (70 days)</option>
                   <option value="pepper">Pepper (80 days)</option>
                   <option value="cucumber">Cucumber (55 days)</option>
                   <option value="lettuce">Lettuce (45 days)</option>
                   <option value="spinach">Spinach (40 days)</option>
                   <option value="kale">Kale (60 days)</option>
                   <option value="maize">Maize/Corn (90 days)</option>
                   <option value="rice">Rice (120 days)</option>
                   <option value="beans">Beans (65 days)</option>
                   <option value="onion">Onion (100 days)</option>
                   <option value="carrot">Carrot (75 days)</option>
                   <option value="cabbage">Cabbage (80 days)</option>
                   <option value="watermelon">Watermelon (85 days)</option>
                   <option value="okra">Okra (55 days)</option>
                   <option value="yam">Yam (270 days)</option>
                   <option value="cassava">Cassava (365 days)</option>
                 </select>
               </div>
               <div className="space-y-2 col-span-2 sm:col-span-1">
                 <Label htmlFor="settings-planting-date">Planting date</Label>
                 <Input id="settings-planting-date" type="date" value={plantingDate} onChange={e => setPlantingDate(e.target.value)} />
               </div>
               <div className="space-y-2 col-span-2">
                 <Label htmlFor="settings-farmer-notes">Notes & observations</Label>
                 <textarea
                   id="settings-farmer-notes"
                   className="flex min-h-[80px] w-full rounded-lg border border-input bg-background px-3 py-2 text-sm resize-none outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                   value={farmerNotes}
                   onChange={e => setFarmerNotes(e.target.value)}
                   placeholder="Enter any notes about this batch..."
                 />
               </div>
            </div>
            {/* HARVEST HISTORY */}
            <div className="mt-4 pt-4 border-t border-border">
              <h4 className="text-sm font-semibold mb-3">Harvest history</h4>
              <div className="bg-card rounded-lg border border-border max-h-48 overflow-y-auto">
                 {(() => {
                    const history = store.getTable('harvestHistory');
                    const entries = history ? Object.values(history) as any[] : [];
                    if (entries.length === 0) {
                       return <div className="p-4 text-center text-sm text-muted-foreground">No past harvests recorded.</div>;
                    }
                    return (
                       <div className="overflow-x-auto">
                          <table className="w-full min-w-[320px] text-xs text-left">
                             <thead className="bg-muted border-b border-border">
                                <tr>
                                   <th className="px-3 py-2 font-medium text-muted-foreground">Crop</th>
                                   <th className="px-3 py-2 font-medium text-muted-foreground">Planted</th>
                                   <th className="px-3 py-2 font-medium text-muted-foreground">Harvested</th>
                                   <th className="px-3 py-2 font-medium text-muted-foreground">Predicted</th>
                                </tr>
                             </thead>
                             <tbody>
                                {entries.sort((a,b) => b.harvestDate.localeCompare(a.harvestDate)).map((entry, idx) => (
                                   <tr key={idx} className="border-b border-border last:border-0 hover:bg-muted/50 transition-colors">
                                      <td className="px-3 py-2 font-medium capitalize">{entry.cropType}</td>
                                      <td className="px-3 py-2 text-muted-foreground">{entry.plantingDate}</td>
                                      <td className="px-3 py-2">{entry.harvestDate}</td>
                                      <td className="px-3 py-2 text-muted-foreground">{entry.predictedDate}</td>
                                   </tr>
                                ))}
                             </tbody>
                          </table>
                       </div>
                    );
                 })()}
              </div>
            </div>
          </section>

          {/* ENVIRONMENTAL THRESHOLDS */}
          <section className="space-y-4 border-b border-border pb-4">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <Thermometer size={16} className="text-muted-foreground" aria-hidden="true" /> Environmental thresholds
            </h3>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
               <div className="space-y-2">
                 <Label htmlFor="settings-temp-min">Temp min (°C)</Label>
                 <Input id="settings-temp-min" type="number" value={tempMin} onChange={e => setTempMin(e.target.value)} className="font-mono tabular" />
               </div>
               <div className="space-y-2">
                 <Label htmlFor="settings-temp-max">Temp max (°C)</Label>
                 <Input id="settings-temp-max" type="number" value={tempMax} onChange={e => setTempMax(e.target.value)} className="font-mono tabular" />
               </div>
               <div className="space-y-2">
                 <Label htmlFor="settings-hum-min">Humidity min (%)</Label>
                 <Input id="settings-hum-min" type="number" value={humMin} onChange={e => setHumMin(e.target.value)} className="font-mono tabular" />
               </div>
               <div className="space-y-2">
                 <Label htmlFor="settings-hum-max">Humidity max (%)</Label>
                 <Input id="settings-hum-max" type="number" value={humMax} onChange={e => setHumMax(e.target.value)} className="font-mono tabular" />
               </div>
               <div className="space-y-2">
                 <Label htmlFor="settings-soil-min">Soil min (%)</Label>
                 <Input id="settings-soil-min" type="number" value={soilMin} onChange={e => setSoilMin(e.target.value)} className="font-mono tabular" />
               </div>
               <div className="space-y-2">
                 <Label htmlFor="settings-soil-max">Soil max (%)</Label>
                 <Input id="settings-soil-max" type="number" value={soilMax} onChange={e => setSoilMax(e.target.value)} className="font-mono tabular" />
               </div>
               <div className="space-y-2">
                 <Label htmlFor="settings-light-min">Light min (lux)</Label>
                 <Input id="settings-light-min" type="number" value={lightMin} onChange={e => setLightMin(e.target.value)} className="font-mono tabular" />
               </div>
               <div className="space-y-2">
                 <Label htmlFor="settings-light-max">Light max (lux)</Label>
                 <Input id="settings-light-max" type="number" value={lightMax} onChange={e => setLightMax(e.target.value)} className="font-mono tabular" />
               </div>
            </div>
          </section>

          {/* AUTOMATION & AI AGENTS */}
          <section className="space-y-4 border-b border-border pb-4">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <Bot size={16} className="text-muted-foreground" aria-hidden="true" /> Automation & AI agents
            </h3>
            <div className="space-y-4">
               <div className="grid grid-cols-1 gap-3">
                 <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-muted/40 p-3">
                   <div className="flex items-center gap-2">
                     <input type="checkbox" id="climate-agent" checked={climateAgent} onChange={e => setClimateAgent(e.target.checked)} className="size-4 accent-primary cursor-pointer" />
                     <Label htmlFor="climate-agent">Climate agent (auto fan/heater)</Label>
                   </div>
                   <div className="flex items-center gap-2">
                     <Label htmlFor="climate-auto-approve" className="text-xs font-normal text-muted-foreground">Auto-approve</Label>
                     <input type="checkbox" id="climate-auto-approve" checked={climateAutoApprove} onChange={e => setClimateAutoApprove(e.target.checked)} className="size-4 accent-primary cursor-pointer" />
                   </div>
                 </div>

                 <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-muted/40 p-3">
                   <div className="flex items-center gap-2">
                     <input type="checkbox" id="irrigation-agent" checked={irrigationAgent} onChange={e => setIrrigationAgent(e.target.checked)} className="size-4 accent-primary cursor-pointer" />
                     <Label htmlFor="irrigation-agent">Irrigation agent (auto watering)</Label>
                   </div>
                   <div className="flex items-center gap-2">
                     <Label htmlFor="irrigation-auto-approve" className="text-xs font-normal text-muted-foreground">Auto-approve</Label>
                     <input type="checkbox" id="irrigation-auto-approve" checked={irrigationAutoApprove} onChange={e => setIrrigationAutoApprove(e.target.checked)} className="size-4 accent-primary cursor-pointer" />
                   </div>
                 </div>

                 <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-muted/40 p-3">
                   <div className="flex items-center gap-2">
                     <input type="checkbox" id="vision-agent" checked={visionAgent} onChange={e => setVisionAgent(e.target.checked)} className="size-4 accent-primary cursor-pointer" />
                     <Label htmlFor="vision-agent">Vision agent (auto scans)</Label>
                   </div>
                   <div className="flex items-center gap-2">
                     <Label htmlFor="vision-auto-approve" className="text-xs font-normal text-muted-foreground">Auto-approve</Label>
                     <input type="checkbox" id="vision-auto-approve" checked={visionAutoApprove} onChange={e => setVisionAutoApprove(e.target.checked)} className="size-4 accent-primary cursor-pointer" />
                   </div>
                 </div>

                 <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-muted/40 p-3">
                   <div className="flex items-center gap-2">
                     <input type="checkbox" id="harvest-agent" checked={harvestAgent} onChange={e => setHarvestAgent(e.target.checked)} className="size-4 accent-primary cursor-pointer" />
                     <Label htmlFor="harvest-agent">Harvest agent (countdown)</Label>
                   </div>
                   <div className="flex items-center gap-2">
                     <Label htmlFor="harvest-auto-approve" className="text-xs font-normal text-muted-foreground">Auto-approve</Label>
                     <input type="checkbox" id="harvest-auto-approve" checked={harvestAutoApprove} onChange={e => setHarvestAutoApprove(e.target.checked)} className="size-4 accent-primary cursor-pointer" />
                   </div>
                 </div>

                 <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-muted/40 p-3">
                   <div className="flex items-center gap-2">
                     <input type="checkbox" id="alert-agent" checked={alertAgent} onChange={e => setAlertAgent(e.target.checked)} className="size-4 accent-primary cursor-pointer" />
                     <Label htmlFor="alert-agent">Alert agent (notifications)</Label>
                   </div>
                   <div className="flex items-center gap-2">
                     <Label htmlFor="alert-auto-approve" className="text-xs font-normal text-muted-foreground">Auto-approve</Label>
                     <input type="checkbox" id="alert-auto-approve" checked={alertAutoApprove} onChange={e => setAlertAutoApprove(e.target.checked)} className="size-4 accent-primary cursor-pointer" />
                   </div>
                 </div>
               </div>

               <div className="grid grid-cols-2 gap-3">
                 <div className="space-y-2">
                   <Label htmlFor="settings-check-interval">Agent check interval</Label>
                   <select id="settings-check-interval" value={checkInterval} onChange={e => setCheckInterval(e.target.value)} className={selectCls}>
                     <option value="1">Every 1 minute</option>
                     <option value="5">Every 5 minutes</option>
                     <option value="15">Every 15 minutes</option>
                     <option value="30">Every 30 minutes</option>
                     <option value="60">Every 1 hour</option>
                   </select>
                 </div>
                 <div className="space-y-2">
                   <Label htmlFor="settings-auto-scan">Camera auto-scan frequency</Label>
                   <select id="settings-auto-scan" value={autoScanFrequency} onChange={e => setAutoScanFrequency(e.target.value)} className={selectCls}>
                     <option value="0.5">Every 30 mins</option>
                     <option value="1">Every 1 hour</option>
                     <option value="3">Every 3 hours</option>
                     <option value="6">Every 6 hours</option>
                     <option value="12">Every 12 hours</option>
                   </select>
                 </div>
               </div>
            </div>
          </section>

          {/* NOTIFICATION PREFERENCES */}
          <section className="space-y-4 border-b border-border pb-4">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <Bell size={16} className="text-muted-foreground" aria-hidden="true" /> Notification preferences
            </h3>
            <div className="space-y-4">
               <div className="flex items-center gap-2">
                 <input
                   type="checkbox"
                   id="browser-notifs"
                   checked={browserNotifs}
                   onChange={e => {
                     const isEnabled = e.target.checked;
                     setBrowserNotifs(isEnabled);
                     if (isEnabled && "Notification" in window && Notification.permission !== "granted") {
                        Notification.requestPermission();
                     }
                   }}
                   className="size-4 accent-primary cursor-pointer"
                 />
                 <Label htmlFor="browser-notifs">Enable browser notifications</Label>
               </div>
               <div className="grid grid-cols-3 gap-3">
                 <div className="space-y-2">
                   <Label htmlFor="settings-alert-sensitivity">Alert sensitivity</Label>
                   <select id="settings-alert-sensitivity" value={alertSensitivity} onChange={e => setAlertSensitivity(e.target.value)} className={selectCls}>
                     <option value="low">Low (critical only)</option>
                     <option value="medium">Medium</option>
                     <option value="high">High (all changes)</option>
                   </select>
                 </div>
                 <div className="space-y-2">
                   <Label htmlFor="settings-quiet-start">Quiet hours start</Label>
                   <Input id="settings-quiet-start" type="time" value={quietHoursStart} onChange={e => setQuietHoursStart(e.target.value)} className="font-mono tabular" />
                 </div>
                 <div className="space-y-2">
                   <Label htmlFor="settings-quiet-end">Quiet hours end</Label>
                   <Input id="settings-quiet-end" type="time" value={quietHoursEnd} onChange={e => setQuietHoursEnd(e.target.value)} className="font-mono tabular" />
                 </div>
               </div>
            </div>
          </section>

          {/* USER PROFILE */}
          <section className="space-y-4 border-b border-border pb-4">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <User size={16} className="text-muted-foreground" aria-hidden="true" /> User profile
            </h3>
            <div className="grid grid-cols-2 gap-3">
               <div className="space-y-2">
                 <Label htmlFor="settings-farm-name">Farm name</Label>
                 <Input id="settings-farm-name" value={farmName} onChange={e => setFarmName(e.target.value)} placeholder="e.g. Sunny Acres, Green Valley..." />
               </div>
               <div className="space-y-2">
                 <Label htmlFor="settings-farmer-name">Farmer name</Label>
                 <Input id="settings-farmer-name" value={farmerName} onChange={e => setFarmerName(e.target.value)} placeholder="e.g. John Doe" />
               </div>
               <div className="space-y-2">
                 <Label htmlFor="settings-location">Location / region</Label>
                 <Input id="settings-location" value={locationStr} onChange={e => setLocationStr(e.target.value)} placeholder="e.g. California, US" />
               </div>
               <div className="space-y-2">
                 <Label htmlFor="settings-greenhouse-size">Greenhouse size</Label>
                 <select id="settings-greenhouse-size" value={greenhouseSize} onChange={e => setGreenhouseSize(e.target.value)} className={selectCls}>
                   <option value="small">Small (backyard/hobby)</option>
                   <option value="medium">Medium</option>
                   <option value="large">Large</option>
                   <option value="commercial">Commercial/industrial</option>
                 </select>
               </div>
            </div>
          </section>

          {/* DATA & STORAGE */}
          <section className="space-y-4">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <Database size={16} className="text-muted-foreground" aria-hidden="true" /> Data & storage
            </h3>
            <div className="flex flex-col gap-3">
               <div className="rounded-lg border border-border bg-muted/40 p-4 flex items-center justify-between gap-4">
                 <div>
                   <p className="text-sm font-semibold">Local storage usage</p>
                   <p className="text-xs text-muted-foreground">Estimated database size: <span className="font-mono tabular">{storageUsedKb} KB</span></p>
                 </div>
                 <Button onClick={handleExportData} variant="outline" size="sm" className="gap-2">
                   <Download size={16} className="text-muted-foreground" aria-hidden="true" /> Export data (CSV)
                 </Button>
               </div>
               <div className="grid grid-cols-2 gap-3">
                  <Button onClick={clearSensorHistory} variant="destructive" size="sm" className="gap-2">
                    <Trash2 size={16} aria-hidden="true" /> Clear sensor history
                  </Button>
                  <Button onClick={clearAIHistory} variant="destructive" size="sm" className="gap-2">
                    <Trash2 size={16} aria-hidden="true" /> Clear AI history
                  </Button>
               </div>
            </div>
          </section>

          <Button onClick={() => window.dispatchEvent(new CustomEvent('replay-tour'))} variant="outline" className="w-full">
            Replay onboarding tour
          </Button>

        </div>

        {/* Global Save Button Fixed at Bottom */}
        <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-border bg-muted/50 flex justify-end gap-2">
           <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
           <Button onClick={saveSettings}>Save settings</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
