import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Settings2, Cpu, Leaf, Thermometer, Bot, Bell, Database, User, Trash2, Download } from 'lucide-react';
import { store, useStoreValue, useStoreTable } from '../lib/store';

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
      <DialogTrigger render={<Button variant="outline" className="gap-2 bg-[#FFFFFF]/50 dark:bg-[#040404]/50 border-[#D1E8D1] dark:border-[#1A2A1A] rounded-xl hover:bg-black/5 dark:hover:bg-white/5 backdrop-blur-md shadow-sm" />}>
         <Settings2 size={16} /> Configuration
      </DialogTrigger>
      <DialogContent className="bg-[#FFFFFF]/95 dark:bg-[#080808]/95 backdrop-blur-2xl border-[#D1E8D1] dark:border-[#1A2A1A] rounded-3xl max-w-2xl overflow-y-auto max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-2xl font-bold"><Settings2 size={24} /> System Configuration</DialogTitle>
        </DialogHeader>
        <div className="space-y-10 py-4 pb-20">
          
          {/* HARDWARE CONFIGURATION */}
          <section className="space-y-4">
            <h3 className="text-sm font-bold tracking-widest uppercase flex items-center gap-2 opacity-80 border-b border-[#D1E8D1] dark:border-[#1A2A1A] pb-2">
              <Cpu size={16} className="text-[#10B981]" /> Hardware Configuration
            </h3>
            <div className="grid grid-cols-2 gap-4">
               <div className="space-y-2">
                 <Label>MQTT Broker URL</Label>
                 <Input value={mqttUrl} onChange={e => setMqttUrl(e.target.value)} className="bg-[#F8FAF8] dark:bg-[#040404]" />
               </div>
               <div className="space-y-2">
                 <Label>MQTT Port</Label>
                 <Input value={mqttPort} onChange={e => setMqttPort(e.target.value)} className="bg-[#F8FAF8] dark:bg-[#040404]" />
               </div>
               <div className="space-y-2 col-span-2">
                 <Label>Network Type</Label>
                 <select value={networkType} onChange={e => setNetworkType(e.target.value)} className="flex h-10 w-full rounded-md border border-input bg-[#F8FAF8] dark:bg-[#040404] px-3 py-2 text-sm border-[#D1E8D1] dark:border-[#1A2A1A]">
                   <option value="wifi">WiFi</option>
                   <option value="lorawan">LoRaWAN</option>
                   <option value="cellular">Cellular</option>
                   <option value="ethernet">Ethernet</option>
                 </select>
               </div>
               <div className="space-y-2 col-span-2">
                 <Label>Camera 1 Stream URL</Label>
                 <Input value={cam1Url} onChange={e => setCam1Url(e.target.value)} className="bg-[#F8FAF8] dark:bg-[#040404]" />
               </div>
               <div className="space-y-2 col-span-2">
                 <Label>Camera 2 Stream URL (Optional)</Label>
                 <Input value={cam2Url} onChange={e => setCam2Url(e.target.value)} className="bg-[#F8FAF8] dark:bg-[#040404]" />
               </div>
               <div className="space-y-2 col-span-2">
                 <Label>Camera 3 Stream URL (Optional)</Label>
                 <Input value={cam3Url} onChange={e => setCam3Url(e.target.value)} className="bg-[#F8FAF8] dark:bg-[#040404]" />
               </div>
            </div>
          </section>

          {/* CROP & HARVEST */}
          <section className="space-y-4">
            <h3 className="text-sm font-bold tracking-widest uppercase flex items-center gap-2 opacity-80 border-b border-[#D1E8D1] dark:border-[#1A2A1A] pb-2">
              <Leaf size={16} className="text-[#10B981]" /> Crop & Harvest
            </h3>
            <div className="grid grid-cols-2 gap-4">
               <div className="space-y-2 col-span-2 sm:col-span-1">
                 <Label>Crop Type</Label>
                 <select value={cropType} onChange={e => setCropType(e.target.value)} className="flex h-10 w-full rounded-md border border-input bg-[#F8FAF8] dark:bg-[#040404] px-3 py-2 text-sm border-[#D1E8D1] dark:border-[#1A2A1A]">
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
                 <Label>Planting Date</Label>
                 <Input type="date" value={plantingDate} onChange={e => setPlantingDate(e.target.value)} className="bg-[#F8FAF8] dark:bg-[#040404]" />
               </div>
               <div className="space-y-2 col-span-2">
                 <Label>Notes & Observations</Label>
                 <textarea 
                   className="flex min-h-[80px] w-full rounded-md border border-input bg-[#F8FAF8] dark:bg-[#040404] px-3 py-2 text-sm border-[#D1E8D1] dark:border-[#1A2A1A] resize-none"
                   value={farmerNotes} 
                   onChange={e => setFarmerNotes(e.target.value)}
                   placeholder="Enter any notes about this batch..."
                 />
               </div>
            </div>
            {/* HARVEST HISTORY */}
            <div className="mt-6 pt-4 border-t border-[#D1E8D1] dark:border-[#1A2A1A]">
              <h4 className="text-xs font-bold uppercase tracking-widest opacity-80 mb-3">Harvest History</h4>
              <div className="bg-[#F8FAF8] dark:bg-[#040404] rounded-xl border border-[#D1E8D1] dark:border-[#1A2A1A] max-h-48 overflow-y-auto">
                 {(() => {
                    const history = store.getTable('harvestHistory');
                    const entries = history ? Object.values(history) as any[] : [];
                    if (entries.length === 0) {
                       return <div className="p-4 text-center text-sm opacity-50">No past harvests recorded.</div>;
                    }
                    return (
                       <table className="w-full text-xs text-left">
                          <thead className="bg-black/5 dark:bg-white/5 border-b border-[#D1E8D1] dark:border-[#1A2A1A]">
                             <tr>
                                <th className="px-3 py-2 font-semibold">Crop</th>
                                <th className="px-3 py-2 font-semibold">Planted</th>
                                <th className="px-3 py-2 font-semibold">Harvested</th>
                                <th className="px-3 py-2 font-semibold">Predicted</th>
                             </tr>
                          </thead>
                          <tbody>
                             {entries.sort((a,b) => b.harvestDate.localeCompare(a.harvestDate)).map((entry, idx) => (
                                <tr key={idx} className="border-b border-[#D1E8D1]/50 dark:border-[#1A2A1A]/50 last:border-0 hover:bg-black/5 dark:hover:bg-white/5 transition-colors">
                                   <td className="px-3 py-2 font-medium capitalize">{entry.cropType}</td>
                                   <td className="px-3 py-2 opacity-80">{entry.plantingDate}</td>
                                   <td className="px-3 py-2">{entry.harvestDate}</td>
                                   <td className="px-3 py-2 opacity-80">{entry.predictedDate}</td>
                                </tr>
                             ))}
                          </tbody>
                       </table>
                    );
                 })()}
              </div>
            </div>
          </section>

          {/* ENVIRONMENTAL THRESHOLDS */}
          <section className="space-y-4">
            <h3 className="text-sm font-bold tracking-widest uppercase flex items-center gap-2 opacity-80 border-b border-[#D1E8D1] dark:border-[#1A2A1A] pb-2">
              <Thermometer size={16} className="text-[#10B981]" /> Environmental Thresholds
            </h3>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
               <div className="space-y-2">
                 <Label>Temp Min (°C)</Label>
                 <Input type="number" value={tempMin} onChange={e => setTempMin(e.target.value)} className="bg-[#F8FAF8] dark:bg-[#040404]" />
               </div>
               <div className="space-y-2">
                 <Label>Temp Max (°C)</Label>
                 <Input type="number" value={tempMax} onChange={e => setTempMax(e.target.value)} className="bg-[#F8FAF8] dark:bg-[#040404]" />
               </div>
               <div className="space-y-2">
                 <Label>Hum. Min (%)</Label>
                 <Input type="number" value={humMin} onChange={e => setHumMin(e.target.value)} className="bg-[#F8FAF8] dark:bg-[#040404]" />
               </div>
               <div className="space-y-2">
                 <Label>Hum. Max (%)</Label>
                 <Input type="number" value={humMax} onChange={e => setHumMax(e.target.value)} className="bg-[#F8FAF8] dark:bg-[#040404]" />
               </div>
               <div className="space-y-2">
                 <Label>Soil Min (%)</Label>
                 <Input type="number" value={soilMin} onChange={e => setSoilMin(e.target.value)} className="bg-[#F8FAF8] dark:bg-[#040404]" />
               </div>
               <div className="space-y-2">
                 <Label>Soil Max (%)</Label>
                 <Input type="number" value={soilMax} onChange={e => setSoilMax(e.target.value)} className="bg-[#F8FAF8] dark:bg-[#040404]" />
               </div>
               <div className="space-y-2">
                 <Label>Light Min (lux)</Label>
                 <Input type="number" value={lightMin} onChange={e => setLightMin(e.target.value)} className="bg-[#F8FAF8] dark:bg-[#040404]" />
               </div>
               <div className="space-y-2">
                 <Label>Light Max (lux)</Label>
                 <Input type="number" value={lightMax} onChange={e => setLightMax(e.target.value)} className="bg-[#F8FAF8] dark:bg-[#040404]" />
               </div>
            </div>
          </section>

          {/* AUTOMATION & AI AGENTS */}
          <section className="space-y-4">
            <h3 className="text-sm font-bold tracking-widest uppercase flex items-center gap-2 opacity-80 border-b border-[#D1E8D1] dark:border-[#1A2A1A] pb-2">
              <Bot size={16} className="text-[#10B981]" /> Automation & AI Agents
            </h3>
            <div className="space-y-4">
               <div className="grid grid-cols-1 gap-4">
                 <div className="flex items-center justify-between p-3 border border-[#D1E8D1] dark:border-[#1A2A1A] rounded-xl bg-black/5 dark:bg-white/5">
                   <div className="flex items-center space-x-2">
                     <input type="checkbox" id="climate-agent" checked={climateAgent} onChange={e => setClimateAgent(e.target.checked)} className="rounded border-gray-300 text-[#10B981] focus:ring-[#10B981]" />
                     <Label htmlFor="climate-agent">Climate Agent (auto fan/heater)</Label>
                   </div>
                   <div className="flex items-center space-x-2">
                     <Label htmlFor="climate-auto-approve" className="text-xs opacity-70">Auto-Approve</Label>
                     <input type="checkbox" id="climate-auto-approve" checked={climateAutoApprove} onChange={e => setClimateAutoApprove(e.target.checked)} className="rounded border-gray-300 text-[#10B981] focus:ring-[#10B981]" />
                   </div>
                 </div>

                 <div className="flex items-center justify-between p-3 border border-[#D1E8D1] dark:border-[#1A2A1A] rounded-xl bg-black/5 dark:bg-white/5">
                   <div className="flex items-center space-x-2">
                     <input type="checkbox" id="irrigation-agent" checked={irrigationAgent} onChange={e => setIrrigationAgent(e.target.checked)} className="rounded border-gray-300 text-[#10B981] focus:ring-[#10B981]" />
                     <Label htmlFor="irrigation-agent">Irrigation Agent (auto watering)</Label>
                   </div>
                   <div className="flex items-center space-x-2">
                     <Label htmlFor="irrigation-auto-approve" className="text-xs opacity-70">Auto-Approve</Label>
                     <input type="checkbox" id="irrigation-auto-approve" checked={irrigationAutoApprove} onChange={e => setIrrigationAutoApprove(e.target.checked)} className="rounded border-gray-300 text-[#10B981] focus:ring-[#10B981]" />
                   </div>
                 </div>

                 <div className="flex items-center justify-between p-3 border border-[#D1E8D1] dark:border-[#1A2A1A] rounded-xl bg-black/5 dark:bg-white/5">
                   <div className="flex items-center space-x-2">
                     <input type="checkbox" id="vision-agent" checked={visionAgent} onChange={e => setVisionAgent(e.target.checked)} className="rounded border-gray-300 text-[#10B981] focus:ring-[#10B981]" />
                     <Label htmlFor="vision-agent">Vision Agent (auto scans)</Label>
                   </div>
                   <div className="flex items-center space-x-2">
                     <Label htmlFor="vision-auto-approve" className="text-xs opacity-70">Auto-Approve</Label>
                     <input type="checkbox" id="vision-auto-approve" checked={visionAutoApprove} onChange={e => setVisionAutoApprove(e.target.checked)} className="rounded border-gray-300 text-[#10B981] focus:ring-[#10B981]" />
                   </div>
                 </div>

                 <div className="flex items-center justify-between p-3 border border-[#D1E8D1] dark:border-[#1A2A1A] rounded-xl bg-black/5 dark:bg-white/5">
                   <div className="flex items-center space-x-2">
                     <input type="checkbox" id="harvest-agent" checked={harvestAgent} onChange={e => setHarvestAgent(e.target.checked)} className="rounded border-gray-300 text-[#10B981] focus:ring-[#10B981]" />
                     <Label htmlFor="harvest-agent">Harvest Agent (countdown)</Label>
                   </div>
                   <div className="flex items-center space-x-2">
                     <Label htmlFor="harvest-auto-approve" className="text-xs opacity-70">Auto-Approve</Label>
                     <input type="checkbox" id="harvest-auto-approve" checked={harvestAutoApprove} onChange={e => setHarvestAutoApprove(e.target.checked)} className="rounded border-gray-300 text-[#10B981] focus:ring-[#10B981]" />
                   </div>
                 </div>

                 <div className="flex items-center justify-between p-3 border border-[#D1E8D1] dark:border-[#1A2A1A] rounded-xl bg-black/5 dark:bg-white/5">
                   <div className="flex items-center space-x-2">
                     <input type="checkbox" id="alert-agent" checked={alertAgent} onChange={e => setAlertAgent(e.target.checked)} className="rounded border-gray-300 text-[#10B981] focus:ring-[#10B981]" />
                     <Label htmlFor="alert-agent">Alert Agent (notifications)</Label>
                   </div>
                   <div className="flex items-center space-x-2">
                     <Label htmlFor="alert-auto-approve" className="text-xs opacity-70">Auto-Approve</Label>
                     <input type="checkbox" id="alert-auto-approve" checked={alertAutoApprove} onChange={e => setAlertAutoApprove(e.target.checked)} className="rounded border-gray-300 text-[#10B981] focus:ring-[#10B981]" />
                   </div>
                 </div>
               </div>
               
               <div className="grid grid-cols-2 gap-4 mt-4">
                 <div className="space-y-2">
                   <Label>Agent Check Interval</Label>
                   <select value={checkInterval} onChange={e => setCheckInterval(e.target.value)} className="flex h-10 w-full rounded-md border border-input bg-[#F8FAF8] dark:bg-[#040404] px-3 py-2 text-sm border-[#D1E8D1] dark:border-[#1A2A1A]">
                     <option value="1">Every 1 minute</option>
                     <option value="5">Every 5 minutes</option>
                     <option value="15">Every 15 minutes</option>
                     <option value="30">Every 30 minutes</option>
                     <option value="60">Every 1 hour</option>
                   </select>
                 </div>
                 <div className="space-y-2">
                   <Label>Camera Auto-Scan Frequency</Label>
                   <select value={autoScanFrequency} onChange={e => setAutoScanFrequency(e.target.value)} className="flex h-10 w-full rounded-md border border-input bg-[#F8FAF8] dark:bg-[#040404] px-3 py-2 text-sm border-[#D1E8D1] dark:border-[#1A2A1A]">
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
          <section className="space-y-4">
            <h3 className="text-sm font-bold tracking-widest uppercase flex items-center gap-2 opacity-80 border-b border-[#D1E8D1] dark:border-[#1A2A1A] pb-2">
              <Bell size={16} className="text-[#10B981]" /> Notification Preferences
            </h3>
            <div className="space-y-4">
               <div className="flex items-center space-x-2">
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
                   className="rounded border-gray-300 text-[#10B981] focus:ring-[#10B981]" 
                 />
                 <Label htmlFor="browser-notifs">Enable Browser Notifications</Label>
               </div>
               <div className="grid grid-cols-3 gap-4">
                 <div className="space-y-2">
                   <Label>Alert Sensitivity</Label>
                   <select value={alertSensitivity} onChange={e => setAlertSensitivity(e.target.value)} className="flex h-10 w-full rounded-md border border-input bg-[#F8FAF8] dark:bg-[#040404] px-3 py-2 text-sm border-[#D1E8D1] dark:border-[#1A2A1A]">
                     <option value="low">Low (Critical only)</option>
                     <option value="medium">Medium</option>
                     <option value="high">High (All changes)</option>
                   </select>
                 </div>
                 <div className="space-y-2">
                   <Label>Quiet Hours Start</Label>
                   <Input type="time" value={quietHoursStart} onChange={e => setQuietHoursStart(e.target.value)} className="bg-[#F8FAF8] dark:bg-[#040404]" />
                 </div>
                 <div className="space-y-2">
                   <Label>Quiet Hours End</Label>
                   <Input type="time" value={quietHoursEnd} onChange={e => setQuietHoursEnd(e.target.value)} className="bg-[#F8FAF8] dark:bg-[#040404]" />
                 </div>
               </div>
            </div>
          </section>

          {/* USER PROFILE */}
          <section className="space-y-4">
            <h3 className="text-sm font-bold tracking-widest uppercase flex items-center gap-2 opacity-80 border-b border-[#D1E8D1] dark:border-[#1A2A1A] pb-2">
              <User size={16} className="text-[#10B981]" /> User Profile
            </h3>
            <div className="grid grid-cols-2 gap-4">
               <div className="space-y-2">
                 <Label>Farm Name</Label>
                 <Input value={farmName} onChange={e => setFarmName(e.target.value)} placeholder="e.g. Sunny Acres, Green Valley..." className="bg-[#F8FAF8] dark:bg-[#040404]" />
               </div>
               <div className="space-y-2">
                 <Label>Farmer Name</Label>
                 <Input value={farmerName} onChange={e => setFarmerName(e.target.value)} placeholder="e.g. John Doe" className="bg-[#F8FAF8] dark:bg-[#040404]" />
               </div>
               <div className="space-y-2">
                 <Label>Location / Region</Label>
                 <Input value={locationStr} onChange={e => setLocationStr(e.target.value)} placeholder="e.g. California, US" className="bg-[#F8FAF8] dark:bg-[#040404]" />
               </div>
               <div className="space-y-2">
                 <Label>Greenhouse Size</Label>
                 <select value={greenhouseSize} onChange={e => setGreenhouseSize(e.target.value)} className="flex h-10 w-full rounded-md border border-input bg-[#F8FAF8] dark:bg-[#040404] px-3 py-2 text-sm border-[#D1E8D1] dark:border-[#1A2A1A]">
                   <option value="small">Small (Backyard/Hobby)</option>
                   <option value="medium">Medium</option>
                   <option value="large">Large</option>
                   <option value="commercial">Commercial/Industrial</option>
                 </select>
               </div>
            </div>
          </section>

          {/* DATA & STORAGE */}
          <section className="space-y-4">
            <h3 className="text-sm font-bold tracking-widest uppercase flex items-center gap-2 opacity-80 border-b border-[#D1E8D1] dark:border-[#1A2A1A] pb-2">
              <Database size={16} className="text-[#10B981]" /> Data & Storage
            </h3>
            <div className="flex flex-col gap-4">
               <div className="bg-[#F8FAF8] dark:bg-[#040404] rounded-xl p-4 border border-[#D1E8D1] dark:border-[#1A2A1A] flex items-center justify-between">
                 <div>
                   <p className="font-bold">Local Storage Usage</p>
                   <p className="text-sm opacity-70">Estimated database size: {storageUsedKb} KB</p>
                 </div>
                 <Button onClick={handleExportData} variant="outline" className="gap-2 bg-white dark:bg-[#080808]">
                   <Download size={16} /> Export Data (CSV)
                 </Button>
               </div>
               <div className="grid grid-cols-2 gap-4">
                  <Button onClick={clearSensorHistory} variant="destructive" className="bg-red-500/10 text-red-500 hover:bg-red-500 hover:text-white border border-red-500/20">
                    <Trash2 size={16} className="mr-2" /> Clear Sensor History
                  </Button>
                  <Button onClick={clearAIHistory} variant="destructive" className="bg-red-500/10 text-red-500 hover:bg-red-500 hover:text-white border border-red-500/20">
                    <Trash2 size={16} className="mr-2" /> Clear AI History
                  </Button>
               </div>
            </div>
          </section>

          <Button onClick={() => window.dispatchEvent(new CustomEvent('replay-tour'))} variant="outline" className="w-full">
            Replay Onboarding Tour
          </Button>

        </div>
        
        {/* Global Save Button Fixed at Bottom */}
        <div className="absolute bottom-0 left-0 right-0 p-4 bg-[#FFFFFF]/90 dark:bg-[#080808]/90 backdrop-blur-md border-t border-[#D1E8D1] dark:border-[#1A2A1A] flex justify-end gap-2 rounded-b-3xl">
           <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
           <Button onClick={saveSettings} className="bg-[#10B981] hover:bg-[#059669] text-black font-bold h-10 px-8 rounded-xl shadow-lg shadow-[#10B981]/20">
              Save All Settings
           </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
