import React, { useState, useEffect, useRef } from 'react';
import { useStoreValue, useStoreTable, store } from '../lib/store';
import { useMqtt } from '../lib/mqtt';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '../components/ui/dialog';
import { Settings, Sun, Lightbulb, CloudRain, Droplet, Battery, BatteryMedium, BatteryLow, Power, Wind, Fan, Settings2, Activity, Video, RadioReceiver, Zap, Flame, Snowflake, Home, Thermometer, ThermometerSun, ThermometerSnowflake, Leaf, Bot, Calendar, Play } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '../lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import { SettingsPanel } from '../components/SettingsPanel';
import { HarvestWidget } from '../components/HarvestWidget';
import { DataSourceBadge } from '../components/DataSourceBadge';
import { CameraStream } from '../components/CameraStream';
import { hardwareService } from '../lib/hardwareService';

function CircularGauge({ value, max, unit, label, colorStops, gradientId }: any) {
  const radius = 36;
  const circumference = 2 * Math.PI * radius;
  const clampedValue = Math.min(Math.max(value, 0), max);
  const strokeDashoffset = circumference - (clampedValue / max) * circumference;

  return (
    <div className="flex flex-col items-center justify-center space-y-2">
      <div className="relative w-32 h-32 flex items-center justify-center">
        <svg className="w-full h-full transform -rotate-90 drop-shadow-md" viewBox="0 0 100 100">
          <defs>
            <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
              {colorStops.map((stop: any, i: number) => (
                <stop key={i} offset={stop.offset} stopColor={stop.color} />
              ))}
            </linearGradient>
          </defs>
          <circle cx="50" cy="50" r={radius} className="stroke-gray-200 dark:stroke-[#111111]" strokeWidth="6" fill="none" />
          <motion.circle 
            cx="50" cy="50" r={radius} 
            stroke={`url(#${gradientId})`} 
            strokeWidth="6" 
            fill="none" 
            strokeLinecap="round"
            initial={{ strokeDashoffset: circumference }}
            animate={{ strokeDashoffset }}
            transition={{ type: "spring", stiffness: 50, damping: 15 }}
            style={{ strokeDasharray: circumference }} 
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <motion.span 
            key={value}
            initial={{ scale: 1.05 }}
            animate={{ scale: 1 }}
            className="text-2xl font-mono font-bold text-shadow-neon text-[#10B981]"
          >
            {Number(value).toFixed(1)}
          </motion.span>
          <span className="text-xs opacity-60 font-semibold uppercase">{unit}</span>
        </div>
      </div>
      <span className="text-[10px] font-medium opacity-80 uppercase tracking-wider font-mono">{label}</span>
    </div>
  );
}

function DeviceToggle({ label, stateKey, topic, icon: Icon, extraIcon: ExtraIcon, statusActive = 'ACTIVE', statusIdle = 'IDLE' }: any) {
  const active = useStoreValue(stateKey, false);
  const { publish, status } = useMqtt();
  const [interlockWarning, setInterlockWarning] = useState<string | null>(null);

  const toggle = async () => {
    try {
      const newState = !active;
      
      // Map stateKey to hardware device
      let res: { success: boolean; message: string; interlockTriggered?: boolean } | null = null;
      if (stateKey === 'roofActive') {
        res = await hardwareService.setRoof(newState ? 'open' : 'close');
      } else if (stateKey === 'pumpActive') {
        res = await hardwareService.setOverride('pump', newState ? 'on' : 'off');
      } else if (stateKey === 'fanActive' || stateKey === 'peltierFan1Active' || stateKey === 'peltierFan2Active') {
        res = await hardwareService.setOverride('fan', newState ? 'on' : 'off');
      } else if (stateKey === 'heaterActive') {
        res = await hardwareService.setOverride('heater', newState ? 'on' : 'off');
      } else if (stateKey === 'peltierActive') {
        res = await hardwareService.setOverride('peltier', newState ? 'on' : 'off');
      } else if (stateKey === 'lightActive') {
        res = await hardwareService.setOverride('light', newState ? 'on' : 'off');
      }

      if (res && res.interlockTriggered) {
        setInterlockWarning(res.message);
        setTimeout(() => setInterlockWarning(null), 4000);
        store.setRow('activityLog', Date.now().toString(), {
          timestamp: new Date().toISOString(),
          type: 'alert',
          message: `🚨 ${res.message}`
        });
        return;
      }

      store.setValue(stateKey, newState);
      store.setRow('activityLog', Date.now().toString(), {
        timestamp: new Date().toISOString(),
        type: 'info',
        message: `${label} manually switched ${newState ? 'ON' : 'OFF'} by user.`,
        topic
      });

      if (status !== 'demo') {
        publish(topic, newState ? 'ON' : 'OFF');
      }
    } catch (e: any) {
      console.error(e);
      setInterlockWarning(e.message || 'Command failed to execute');
      setTimeout(() => setInterlockWarning(null), 3000);
    }
  };

  return (
    <div className="space-y-1.5">
      <button 
        onClick={toggle}
        className="w-full text-left flex items-center justify-between p-4 rounded-2xl bg-[#FFFFFF] dark:bg-[#040404] border border-[#D1E8D1] dark:border-[#1A2A1A] backdrop-blur-sm group hover:border-[#10B981]/50 dark:hover:border-[#10B981]/50 transition-all cursor-pointer"
      >
        <div className="flex items-center gap-4">
          <div className={cn("p-2.5 rounded-xl transition-colors duration-500", active ? "bg-gradient-to-br from-[#10B981]/20 to-[#059669]/20 text-[#10B981] shadow-[0_0_15px_rgba(16,185,129,0.2)]" : "bg-black/5 dark:bg-[#080808] text-gray-400 group-hover:text-gray-300 border border-transparent group-hover:border-[#1A2A1A]")}>
            <Icon size={24} />
          </div>
          <div className="flex flex-col">
            <span className="font-semibold text-sm tracking-tight">{label}</span>
            <div className="flex items-center gap-1.5 mt-0.5">
              <div className={cn("w-1.5 h-1.5 rounded-full", active ? "bg-[#10B981] animate-pulse" : "bg-gray-400 opacity-50")}></div>
              <span className={cn("text-[10px] uppercase font-mono tracking-wider font-bold", active ? "text-[#10B981]" : "text-gray-500")}>
                {active ? statusActive : statusIdle}
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {ExtraIcon && <ExtraIcon active={active} />}
          <div 
            className={cn(
              "relative inline-flex h-8 w-14 items-center rounded-full transition-colors duration-300 shadow-inner",
              active ? "bg-gradient-to-r from-[#10B981] to-[#059669]" : "bg-[#F0F0F0] dark:bg-[#080808] border border-[#D1E8D1] dark:border-[#1A2A1A]"
            )}
          >
            <motion.span 
              layout
              className={cn(
                "inline-block h-6 w-6 rounded-full bg-white shadow-md flex items-center justify-center pointer-events-none transition-all duration-300",
                active ? "ml-7" : "ml-1"
              )}
            />
          </div>
        </div>
      </button>

      {interlockWarning && (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          className="p-2.5 rounded-xl bg-amber-500/15 border border-amber-500/40 text-amber-400 text-xs font-mono leading-tight flex items-start gap-2"
        >
          <span className="shrink-0 text-sm">🛡️</span>
          <span>{interlockWarning}</span>
        </motion.div>
      )}
    </div>
  );
}

const AnimatedRoofIcon = ({ active }: { active: boolean }) => (
  <div className="relative w-8 h-8 flex items-center justify-center">
    <Home size={20} className={cn("transition-colors duration-500", active ? "text-[#10B981]" : "text-gray-400")} />
    <motion.div 
      initial={false}
      animate={{ y: active ? -8 : 0, rotate: active ? -20 : 0, opacity: active ? 1 : 0 }}
      className="absolute top-0 right-0"
    >
      <div className="w-4 h-1 bg-[#10B981] rounded-full shadow-[0_0_5px_rgba(16,185,129,0.5)]" />
    </motion.div>
  </div>
);

export default function ControlCenter() {
  const temp = useStoreValue('temperature', 24.5);
  const humidity = useStoreValue('humidity', 62);
  const soilMoisture = useStoreValue('soilMoisture', 48);
  const sunlight = useStoreValue('sunlight', 650);
  const growLight = useStoreValue('growLight', 380);
  const rain = useStoreValue('rain', false);
  const waterLevel = useStoreValue('waterLevel', 76);
  const batteryVoltage = useStoreValue('batteryVoltage', 12.3);
  const rainGaugeLevel = useStoreValue('rainGaugeLevel', 25);
  const logTable = useStoreTable('activityLog');
  
  const climateAgent = useStoreValue('agent_ClimateAgent_enabled', true);
  const irrigationAgent = useStoreValue('agent_IrrigationAgent_enabled', true);
  const visionAgent = useStoreValue('agent_VisionAgent_enabled', false);
  const harvestAgent = useStoreValue('agent_HarvestAgent_enabled', false);
  const alertAgent = useStoreValue('agent_AlertAgent_enabled', false);

  const climateAgentLastRun = useStoreValue('agent_ClimateAgent_lastRun', 'Never');
  const irrigationAgentLastRun = useStoreValue('agent_IrrigationAgent_lastRun', 'Never');
  const visionAgentLastRun = useStoreValue('agent_VisionAgent_lastRun', 'Never');
  const harvestAgentLastRun = useStoreValue('agent_HarvestAgent_lastRun', 'Never');
  const alertAgentLastRun = useStoreValue('agent_AlertAgent_lastRun', 'Never');
  
  const camUrl = useStoreValue('cameraUrl', import.meta.env.VITE_ESP32_CAM_STREAM_URL || '');
  
  const [activeMediaTab, setActiveMediaTab] = useState<'stream' | 'diagram'>('stream');
  const logContainerRef = useRef<HTMLDivElement>(null);

  const pendingActions = useStoreTable('pendingActions') || {};
  const pendingActionsEntries = Object.entries(pendingActions).sort(([, a]: any, [, b]: any) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  const latestPendingAction = pendingActionsEntries.length > 0 ? pendingActionsEntries[0] : null;

  const { publish, status } = useMqtt();

  const handleApprove = (id: string, actionData: any) => {
      // Execute the command
      publish(actionData.topic, actionData.payload);
      // Log to activity log
      store.setRow('activityLog', Date.now().toString() + id, {
         timestamp: new Date().toISOString(),
         type: 'info',
         message: `🤖 EDEN proposed: ${actionData.action} — ${actionData.reason}. ✅ Approved by user.`
      });
      // Remove from pending
      store.delRow('pendingActions', id);
  };

  const handleDecline = (id: string, actionData: any) => {
      store.setRow('activityLog', Date.now().toString() + id, {
         timestamp: new Date().toISOString(),
         type: 'info',
         message: `🤖 EDEN proposed: ${actionData.action} — ${actionData.reason}. ❌ Declined by user.`
      });
      store.delRow('pendingActions', id);
  };

  useEffect(() => {
    if (logContainerRef.current) {
        logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logTable]);

  const activityEntries = Object.entries(logTable || {})
    .sort(([, a]: any, [, b]: any) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
    .slice(-50); // Ascending order, taking the last 50 entries so bottom is newest

  const getLogIcon = (msg: string) => {
    if (msg.includes('📸')) return "📸";
    if (msg.includes('🌾')) return "🌾";
    if (msg.includes('🤖')) return "🤖";
    if (msg.includes('🚨')) return "🚨";
    if (msg.includes('💧')) return "💧";
    
    const l = msg.toLowerCase();
    if (l.includes('heater')) return "🔥";
    if (l.includes('peltier')) return "❄️";
    if (l.includes('fan')) return "💨";
    if (l.includes('pump')) return "💧";
    if (l.includes('light')) return "💡";
    if (l.includes('roof')) return "🏠";
    if (l.includes('temp')) return "🌡️";
    if (l.includes('humid')) return "💧";
    if (l.includes('rain')) return "🌧️";
    if (msg.includes('EDEN')) return "🤖";
    return "⚡";
  };

  const getLogColor = (type: string) => {
    if (type === 'error' || type === 'alert') return 'text-red-500 bg-red-500/10 border-red-500/20';
    if (type === 'warning') return 'text-amber-500 bg-amber-500/10 border-amber-500/20';
    return 'text-[#10B981] bg-[#10B981]/10 border-[#10B981]/20';
  };

  const activeAgentsCount = [climateAgent, irrigationAgent, visionAgent, harvestAgent, alertAgent].filter(Boolean).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between z-20 relative">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="opacity-70 text-sm mt-1 uppercase tracking-[0.05em] font-sans text-[10px]">Command & Control Hub</p>
        </div>
        <SettingsPanel />
      </div>

      {/* Real Hardware / Simulated / Cached / Disconnected Banner */}
      <DataSourceBadge variant="banner" />

      <AnimatePresence>
        {latestPendingAction && (
          <motion.div 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="bg-gradient-to-r from-amber-500/20 to-amber-600/10 border-l-4 border-amber-500 rounded-xl p-4 flex items-center justify-between shadow-lg sticky top-4 z-50 backdrop-blur-xl"
          >
            <div className="flex items-center gap-4">
               <div className="bg-amber-500/20 p-2 rounded-full text-amber-600 dark:text-amber-400">
                  <Bot size={24} />
               </div>
               <div>
                  <h3 className="font-bold text-amber-900 dark:text-amber-100 flex items-center gap-2">
                     EDEN Recommendation <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-amber-500/20 tracking-wider">ACTION REQUIRED</span>
                  </h3>
                  <p className="text-sm opacity-80 text-amber-900 dark:text-amber-200 mt-1">EDEN wants to take action: <strong>{(latestPendingAction[1] as any).action}</strong></p>
               </div>
            </div>
            <div className="flex gap-2">
               <Button onClick={() => handleDecline(latestPendingAction[0], latestPendingAction[1])} variant="outline" className="border-amber-500/30 text-red-500 hover:bg-red-500/10">
                  Decline
               </Button>
               <Button onClick={() => handleApprove(latestPendingAction[0], latestPendingAction[1])} className="bg-[#10B981] hover:bg-[#059669] text-white">
                  Approve
               </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <Card className={cn("border bg-[#FFFFFF]/80 dark:bg-[#080808]/80 backdrop-blur-xl rounded-3xl shadow-sm hover:shadow-md transition-all duration-500 relative overflow-hidden group", pendingActionsEntries.length > 0 ? "border-[#10B981] shadow-[0_0_20px_rgba(16,185,129,0.15)]" : "border-[#10B981]/20 dark:border-white/5")}>
        <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-[#10B981]" />
        {pendingActionsEntries.length > 0 && <div className="absolute inset-0 bg-[#10B981]/[0.02] animate-pulse pointer-events-none" />}
        <CardHeader className="pb-3 border-b border-[#D1E8D1] dark:border-[#1A2A1A]">
          <div className="text-[10px] w-max font-bold font-sans uppercase tracking-[0.05em] flex items-center gap-2 text-[#808080]">
            <Bot size={14} className="text-[#10B981]" /> EDEN'S RECOMMENDATIONS
            {pendingActionsEntries.length > 0 && (
               <span className="ml-2 bg-[#10B981] text-white px-2 py-0.5 rounded-full text-[10px]">
                 {pendingActionsEntries.length} PENDING
               </span>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-4 flex flex-col gap-3">
          {pendingActionsEntries.length === 0 ? (
             <div className="text-center opacity-50 py-6 text-sm flex flex-col items-center gap-2">
                <Bot size={24} className="opacity-40" />
                No pending recommendations. EDEN is monitoring.
             </div>
          ) : (
             <div className="space-y-3">
                {pendingActionsEntries.map(([id, action]: any) => (
                   <div key={id} className="border border-[#D1E8D1] dark:border-[#1A2A1A] rounded-2xl p-4 bg-white dark:bg-[#040404] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 relative overflow-hidden">
                      {action.isCritical && <div className="absolute top-0 right-0 w-16 h-16 bg-red-500/10 blur-2xl" />}
                      <div className="flex-1 space-y-1 z-10">
                         <div className="flex items-center gap-2 mb-2">
                           <span className="text-[10px] uppercase font-mono tracking-widest font-bold opacity-60 flex items-center gap-1"><Bot size={12}/> {action.agent}</span>
                           <span className="text-[10px] uppercase font-mono opacity-40">{format(new Date(action.timestamp), 'HH:mm:ss')}</span>
                           {action.isCritical && <span className="bg-red-500 text-white text-[9px] font-mono px-1.5 py-0.5 rounded uppercase tracking-wider animate-pulse">CRITICAL</span>}
                         </div>
                         <h4 className="font-bold text-sm flex items-center gap-2"><Zap size={14} className="text-amber-500" /> {action.action}</h4>
                         <p className="text-xs opacity-70 flex items-center gap-2"><Activity size={12} className="text-[#10B981]" /> {action.reason}</p>
                      </div>
                      <div className="flex items-center gap-2 w-full sm:w-auto z-10 shrink-0">
                         <Button onClick={() => handleDecline(id, action)} variant="outline" className="flex-1 sm:flex-none border-[#D1E8D1] dark:border-[#1A2A1A] text-gray-500 hover:text-red-500 hover:bg-red-500/10 hover:border-red-500/30">
                            Decline
                         </Button>
                         <Button onClick={() => handleApprove(id, action)} className="flex-1 sm:flex-none bg-[#10B981] hover:bg-[#059669] text-white">
                            Approve
                         </Button>
                      </div>
                   </div>
                ))}
             </div>
          )}
        </CardContent>
      </Card>

      <HarvestWidget />

      <div className="columns-1 sm:columns-2 lg:columns-3 gap-6 space-y-6">
        
        {/* Core Environment */}
        <Card id="tour-env-gauges" className="break-inside-avoid border border-[#10B981]/20 dark:border-white/5 bg-[#FFFFFF]/80 dark:bg-[#080808]/80 backdrop-blur-xl rounded-3xl shadow-sm hover:shadow-md transition-shadow relative overflow-hidden group">
          <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-[#10B981]" />
          <CardHeader className="pb-0 border-b border-transparent">
            <div className="text-[10px] w-max font-bold font-sans uppercase tracking-[0.05em] flex items-center gap-2 text-[#808080]">
              <Activity size={14} className="text-[#10B981]" /> ENVIRONMENT
            </div>
          </CardHeader>
          <CardContent className="pt-6 pb-8 space-y-6">
            <div className="flex justify-around items-start">
              <div className="flex flex-col items-center gap-4 border border-[#D1E8D1] dark:border-[#1A2A1A] bg-[#F8FAF8] dark:bg-[#040404] p-4 rounded-3xl">
                <CircularGauge 
                  value={temp} max={50} unit="°C" label="Temperature" 
                  gradientId="tempGrad"
                  colorStops={[{ offset: "0%", color: "#10B981" }, { offset: "100%", color: "#34D399" }]} 
                />
                <div className="flex gap-4">
                   <div className="flex flex-col items-center gap-1.5">
                      <ThermometerSnowflake size={14} className={temp < 18 ? "text-blue-500" : "text-gray-400"} />
                      <span className={cn("text-[9px] font-mono tracking-widest uppercase font-bold", temp < 18 ? "text-blue-500" : "text-[#10B981]")}>
                        {temp < 18 ? "Cold" : "Normal"}
                      </span>
                   </div>
                   <div className="flex flex-col items-center gap-1.5">
                      <ThermometerSun size={14} className={temp > 30 ? "text-red-500" : "text-gray-400"} />
                      <span className={cn("text-[9px] font-mono tracking-widest uppercase font-bold", temp > 30 ? "text-red-500" : "text-[#10B981]")}>
                        {temp > 30 ? "Hot" : "Normal"}
                      </span>
                   </div>
                </div>
              </div>
              <div className="flex flex-col items-center gap-4 border border-[#D1E8D1] dark:border-[#1A2A1A] bg-[#F8FAF8] dark:bg-[#040404] p-4 rounded-3xl">
                <CircularGauge 
                  value={humidity} max={100} unit="%" label="Humidity" 
                  gradientId="humGrad"
                  colorStops={[{ offset: "0%", color: "#3B82F6" }, { offset: "100%", color: "#2DD4BF" }]} 
                />
                 <div className="flex gap-4">
                   <div className="flex flex-col items-center gap-1.5">
                      <Leaf size={14} className={humidity < 40 ? "text-amber-500" : "text-gray-400"} />
                      <span className={cn("text-[9px] font-mono tracking-widest uppercase font-bold", humidity < 40 ? "text-amber-500" : "text-[#10B981]")}>
                        {humidity < 40 ? "Dry" : "Normal"}
                      </span>
                   </div>
                   <div className="flex flex-col items-center gap-1.5">
                      <Droplet size={14} className={humidity > 80 ? "text-blue-500" : "text-gray-400"} />
                      <span className={cn("text-[9px] font-mono tracking-widest uppercase font-bold", humidity > 80 ? "text-blue-500" : "text-[#10B981]")}>
                        {humidity > 80 ? "Wet" : "Normal"}
                      </span>
                   </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Water System */}
        <Card id="tour-water-system" className="break-inside-avoid border border-[#3B82F6]/20 dark:border-white/5 bg-[#FFFFFF]/80 dark:bg-[#080808]/80 backdrop-blur-xl rounded-3xl shadow-sm hover:shadow-md transition-shadow relative overflow-hidden group">
          <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-[#3B82F6]" />
           <CardHeader className="pb-0 border-b border-transparent">
             <div className="text-[10px] w-max font-bold font-sans uppercase tracking-[0.05em] flex items-center gap-2 text-[#808080]">
              <Droplet size={14} className="text-[#3B82F6]" /> WATER SYSTEM
            </div>
          </CardHeader>
          <CardContent className="space-y-8 pt-6 pb-6">
            <div className="space-y-3">
              <div className="flex justify-between text-sm font-semibold">
                <span className="opacity-80 text-xs font-mono tracking-wider uppercase">Soil Moisture</span>
                <motion.span key={soilMoisture} initial={{scale: 1.1}} animate={{scale: 1}} className="font-mono text-[#10B981]">{soilMoisture}%</motion.span>
              </div>
              <div className="h-4 bg-[#F8FAF8] dark:bg-[#040404] rounded-full overflow-hidden relative shadow-inner flex items-center border border-[#D1E8D1] dark:border-[#1A2A1A]">
                <motion.div 
                  className="absolute top-0 left-0 bottom-0 bg-gradient-to-r from-[#10B981] to-[#34D399]" 
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.min(100, Math.max(0, soilMoisture))}%` }}
                  transition={{ type: "spring", stiffness: 50 }}
                >
                  <div className="absolute inset-0 opacity-50 animate-wave w-[200%] bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyMCIgaGVpZ2h0PSIyMCI+PGNpcmNsZSBjeD0iMiIgY3k9IjIiIHI9IjIiIGZpbGw9IndoaXRlIiBvcGFjaXR5PSIwLjIiLz48L3N2Zz4=')]" />
                </motion.div>
              </div>
            </div>
            
             <div className="flex justify-between items-stretch gap-4 h-28">
               {/* Vertical Water Level */}
               <div className="flex items-center gap-4 flex-1 bg-[#F8FAF8] dark:bg-[#040404] rounded-2xl p-3 border border-[#D1E8D1] dark:border-[#1A2A1A]">
                 <div className="w-6 h-full bg-[#E0E0E0] dark:bg-[#1A1A1A] rounded-full overflow-hidden relative shadow-[inset_0_2px_4px_rgba(0,0,0,0.1)] flex flex-col justify-end">
                    <motion.div 
                      className="w-full bg-gradient-to-t from-[#2563EB] to-[#60A5FA] relative overflow-hidden" 
                      initial={{ height: 0 }}
                      animate={{ height: `${Math.min(100, Math.max(0, waterLevel))}%` }}
                      transition={{ type: "spring", stiffness: 50 }}
                    >
                      <div className="absolute top-0 left-0 right-0 h-4 bg-white/20 animate-wave w-[200%]" style={{ transformOrigin: 'top left' }} />
                    </motion.div>
                 </div>
                 <div className="flex flex-col justify-center">
                   <div className="text-[10px] font-mono uppercase tracking-[0.2em] opacity-60 font-bold mb-1">Reservoir</div>
                   <motion.div key={waterLevel} initial={{scale: 1.1}} animate={{scale:1}} className="text-xl font-mono font-bold text-[#3B82F6]">{waterLevel}%</motion.div>
                 </div>
               </div>

                {/* Rain Gauge */}
                <div className={cn(
                  "flex-1 rounded-2xl flex flex-col justify-center px-4 py-3 transition-colors duration-500 relative overflow-hidden border gap-2",
                  rain ? "bg-[#3B82F6]/10 border-[#3B82F6]/30" : "bg-[#F8FAF8] dark:bg-[#040404] border-[#D1E8D1] dark:border-[#1A2A1A]"
                )}>
                  <div className="flex flex-col gap-0.5 relative z-10 w-full mb-1">
                     <span className="text-[10px] uppercase font-mono tracking-wider font-bold opacity-60">Rain Status</span>
                     <div className="flex items-center gap-2 w-full mt-1">
                       <CloudRain size={16} className={cn("shrink-0 transition-colors duration-500", rain ? "text-[#3B82F6] animate-pulse" : "text-gray-400")} />
                       <div className={cn("text-[9px] uppercase font-mono tracking-widest font-bold leading-tight", rain ? "text-[#3B82F6] animate-pulse" : "opacity-30")}>
                          {rain ? "Rain Detected" : "No Rain"}
                       </div>
                     </div>
                  </div>
                  
                  <div className="text-[10px] uppercase font-mono tracking-wider font-bold opacity-60 relative z-10">Rain Gauge</div>
                  <div className="flex items-baseline gap-2 relative z-10">
                     <motion.div key={rainGaugeLevel} initial={{scale:1.1}} animate={{scale:1}} className={cn("text-2xl font-mono font-bold w-[4ch]", rain ? "text-[#3B82F6]" : "")}>{Number(rainGaugeLevel).toFixed(0)}%</motion.div>
                  </div>
                  {/* Gauge fill background */}
                  <motion.div 
                    className="absolute bottom-0 left-0 right-0 bg-[#3B82F6]/20 transition-all duration-1000"
                    initial={{ height: 0 }}
                    animate={{ height: `${rainGaugeLevel}%` }}
                  />
                  {rain && <div className="absolute inset-0 animate-pulse pointer-events-none opacity-30 bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0IiBoZWlnaHQ9IjQiPjxyZWN0IHdpZHRoPSIxIiBoZWlnaHQ9IjIiIGZpbGw9IiMzQjgyRjYiIG9wYWNpdHk9IjAuNSIvPjwvc3ZnPg==')]" />}
                </div>
             </div>
           </CardContent>
         </Card>

        {/* Lighting */}
        <Card className="break-inside-avoid border border-[#F59E0B]/20 dark:border-white/5 bg-[#FFFFFF]/80 dark:bg-[#080808]/80 backdrop-blur-xl rounded-3xl shadow-sm hover:shadow-md transition-shadow relative overflow-hidden group">
          <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-[#F59E0B]" />
           <CardHeader className="pb-0 border-b border-transparent">
             <div className="text-[10px] w-max font-bold font-sans uppercase tracking-[0.05em] flex items-center gap-2 text-[#808080]">
               <Zap size={14} className="text-amber-500" /> LIGHTING
             </div>
           </CardHeader>
           <CardContent className="grid grid-cols-2 gap-4 pt-6 pb-6">
             <div className="bg-[#F8FAF8] dark:bg-[#040404] p-5 rounded-2xl flex flex-col items-center text-center relative overflow-hidden group border border-[#D1E8D1] dark:border-[#1A2A1A]">
               <Sun size={32} className="text-amber-500 mb-3 transition-opacity duration-300" style={{ opacity: 0.3 + (sunlight/1000)*0.7 }} />
               <motion.div key={sunlight} initial={{scale:1.1}} animate={{scale:1}} className="text-xl font-mono font-bold">{sunlight}</motion.div>
               <div className="text-[10px] uppercase font-mono opacity-50 font-bold tracking-[0.2em] mt-1 text-amber-500">Lux</div>
               <div className="text-[10px] uppercase font-mono tracking-widest font-bold mt-1 opacity-60">Sunlight</div>
               <div className="absolute inset-0 bg-amber-500 blur-3xl rounded-full mix-blend-screen pointer-events-none transition-opacity duration-300" style={{ opacity: (sunlight/1000)*0.15 }} />
             </div>
             
             <div className="bg-[#F8FAF8] dark:bg-[#040404] p-5 rounded-2xl flex flex-col items-center text-center relative overflow-hidden border border-[#D1E8D1] dark:border-[#1A2A1A]">
               <Lightbulb size={32} className="text-[#10B981] mb-3 transition-opacity duration-300" style={{ opacity: 0.3 + (growLight/600)*0.7 }} />
               <motion.div key={growLight} initial={{scale:1.1}} animate={{scale:1}} className="text-xl font-mono font-bold">{growLight}</motion.div>
               <div className="text-[10px] uppercase font-mono opacity-50 font-bold tracking-[0.2em] mt-1 text-[#10B981]">Lux</div>
               <div className="text-[10px] uppercase font-mono tracking-widest font-bold mt-1 opacity-60">Grow Light</div>
               <div className="absolute inset-0 bg-[#10B981] blur-3xl rounded-full mix-blend-screen pointer-events-none transition-opacity duration-300" style={{ opacity: (growLight/600)*0.15 }} />
             </div>
           </CardContent>
         </Card>

         {/* Power Section */}
         <Card className="break-inside-avoid border border-[#D1E8D1] dark:border-[#1A2A1A] bg-[#FFFFFF]/80 dark:bg-[#080808]/80 backdrop-blur-xl rounded-3xl shadow-sm hover:shadow-md transition-shadow relative overflow-hidden">
           <CardContent className="p-5">
             <div className="flex items-center justify-between">
               <div className="flex items-center gap-4">
                 <div className={cn("p-2 rounded-xl border border-black/5 dark:border-white/5", 
                   Math.round(((batteryVoltage - 10.5) / (12.6 - 10.5)) * 100) > 60 ? "bg-green-500/10 text-green-500 border-green-500/20" : 
                   Math.round(((batteryVoltage - 10.5) / (12.6 - 10.5)) * 100) >= 30 ? "bg-amber-500/10 text-amber-500 border-amber-500/20" : 
                   "bg-red-500/10 text-red-500 border-red-500/20"
                 )}>
                   {Math.round(((batteryVoltage - 10.5) / (12.6 - 10.5)) * 100) > 60 ? <Battery size={24} /> : 
                    Math.round(((batteryVoltage - 10.5) / (12.6 - 10.5)) * 100) >= 30 ? <BatteryMedium size={24} /> : 
                    <BatteryLow size={24} />}
                 </div>
                 <div>
                   <div className="font-bold text-sm tracking-wide uppercase opacity-70">Battery</div>
                   <motion.div key={batteryVoltage} initial={{opacity:0}} animate={{opacity:1}} className="text-[11px] opacity-60 font-mono mt-0.5">{Number(batteryVoltage).toFixed(2)}v DC</motion.div>
                 </div>
               </div>
               <div className="flex flex-col items-end w-24">
                 <motion.div key={batteryVoltage} initial={{scale:1.1}} animate={{scale:1}} className="text-xl font-mono font-bold">
                   {Math.min(100, Math.max(0, Math.round(((batteryVoltage - 10.5) / (12.6 - 10.5)) * 100)))}%
                 </motion.div>
                 <div className="w-full h-1 bg-black/10 dark:bg-[#333] rounded-full overflow-hidden mt-2 relative">
                   <div className={cn("h-full absolute left-0 top-0 transition-all duration-500", 
                       Math.round(((batteryVoltage - 10.5) / (12.6 - 10.5)) * 100) > 60 ? "bg-green-500" : 
                       Math.round(((batteryVoltage - 10.5) / (12.6 - 10.5)) * 100) >= 30 ? "bg-amber-500" : 
                       "bg-red-500"
                     )}
                     style={{ width: `${Math.min(100, Math.max(0, Math.round(((batteryVoltage - 10.5) / (12.6 - 10.5)) * 100)))}%` }} />
                 </div>
               </div>
             </div>
           </CardContent>
         </Card>

         {/* Camera Feed & Logo Group */}
         <div className="break-inside-avoid space-y-6">
           <Card className="border border-[#14B8A6]/20 dark:border-white/5 bg-[#FFFFFF]/80 dark:bg-[#080808]/80 backdrop-blur-xl rounded-3xl shadow-sm hover:shadow-md transition-shadow flex flex-col relative overflow-hidden group">
             <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-[#14B8A6]" />
             <CardHeader className="pb-3 border-b border-[#D1E8D1] dark:border-[#1A2A1A] flex flex-col">
               <div className="flex flex-row items-center justify-between w-full">
                 <div className="text-[10px] w-max font-bold font-sans uppercase tracking-[0.05em] flex items-center gap-2 text-[#808080]">
                   <Video size={14} className="text-[#14B8A6]" /> ESP32-CAM STREAM
                 </div>
                 <div className="flex items-center gap-2 text-[10px] font-bold text-red-500 animate-pulse font-mono tracking-[0.2em] bg-red-500/10 px-3 py-1.5 rounded-full">
                   <div className="w-2 h-2 rounded-full bg-red-500" /> LIVE
                 </div>
               </div>
             </CardHeader>
             <CardContent className="flex-1 p-5 pt-3 flex flex-col gap-4">
               <CameraStream showControls={true} />
             </CardContent>
           </Card>

           <div className="w-full pb-4">
             <Dialog>
               <DialogTrigger render={<button type="button" className="relative w-full cursor-pointer block p-0 bg-transparent border-0 outline-none hover:scale-[1.01] transition-transform group" />}>
                 <img 
                   src="https://i.imgur.com/pIYgcNO.png" 
                   alt="ESP32 CAM Setup Diagram" 
                   className="w-full h-40 md:h-64 rounded-3xl shadow-[0_0_30px_rgba(16,185,129,0.3)] group-hover:shadow-[0_0_50px_rgba(16,185,129,0.5)] object-contain bg-black/5 dark:bg-[#050505] p-2 object-center transition-shadow border border-[#14B8A6]/20"
                 />
                 <div className="absolute inset-0 bg-black/20 group-hover:bg-black/10 transition-colors rounded-3xl flex items-center justify-center">
                   <div className="bg-black/60 backdrop-blur-md px-4 py-2 rounded-xl border border-white/10 text-white text-xs font-bold uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-opacity">
                     View Setup Diagram
                   </div>
                 </div>
               </DialogTrigger>
               <DialogContent className="max-w-[95vw] md:max-w-5xl bg-[#111] border-[#333] p-1 overflow-hidden shadow-2xl rounded-2xl">
                 <DialogHeader className="sr-only">
                   <DialogTitle>Setup Diagram</DialogTitle>
                 </DialogHeader>
                 <img src="https://i.imgur.com/pIYgcNO.png" alt="Setup Diagram" className="w-full h-auto max-h-[85vh] object-contain rounded-xl" />
               </DialogContent>
             </Dialog>
           </div>
         </div>

         {/* Device Controls Section */}
         <Card id="tour-device-controls" className="break-inside-avoid border border-[#8B5CF6]/20 dark:border-white/5 bg-[#FFFFFF]/80 dark:bg-[#080808]/80 backdrop-blur-xl rounded-3xl shadow-sm hover:shadow-md transition-shadow flex flex-col overflow-hidden relative group">
          <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-[#8B5CF6]" />
           <CardHeader className="pb-3 border-b border-[#D1E8D1] dark:border-[#1A2A1A] bg-black/5 dark:bg-transparent">
             <div className="text-[10px] w-max font-bold font-sans uppercase tracking-[0.05em] flex items-center gap-2 text-[#808080]">
              <Power size={14} className="text-[#8B5CF6]" /> DEVICE CONTROLS
            </div>
          </CardHeader>
          <CardContent className="pt-6 pb-6 overflow-y-auto max-h-[600px] custom-scrollbar space-y-8">
            {/* Heating & Cooling */}
            <div className="space-y-3">
               <div className="text-[10px] flex items-center gap-2 uppercase font-mono tracking-widest font-bold opacity-40 mb-2">
                 <Thermometer size={12} /> Heating & Cooling
               </div>
               <div className="grid grid-cols-1 gap-4">
                 <DeviceToggle label="Heater" stateKey="heaterActive" topic="greenhouse/control/heater" icon={Flame} />
                 <DeviceToggle label="Peltier Module" stateKey="peltierActive" topic="greenhouse/control/peltier" icon={Snowflake} />
               </div>
            </div>
            
            {/* Ventilation */}
            <div className="space-y-3">
               <div className="text-[10px] flex items-center gap-2 uppercase font-mono tracking-widest font-bold opacity-40 mb-2">
                 <Wind size={12} /> Ventilation
               </div>
               <div className="grid grid-cols-1 gap-4">
                 <DeviceToggle label="Circulation Fan" stateKey="fanActive" topic="greenhouse/control/fan" icon={Wind} />
                 <DeviceToggle label="Peltier Fan 1" stateKey="peltierFan1Active" topic="greenhouse/control/peltier_fan1" icon={Fan} />
                 <DeviceToggle label="Peltier Fan 2" stateKey="peltierFan2Active" topic="greenhouse/control/peltier_fan2" icon={Fan} />
               </div>
            </div>

            {/* Irrigation */}
            <div className="space-y-3">
               <div className="text-[10px] flex items-center gap-2 uppercase font-mono tracking-widest font-bold opacity-40 mb-2">
                 <Droplet size={12} /> Irrigation
               </div>
               <DeviceToggle label="Water Pump" stateKey="pumpActive" topic="greenhouse/control/pump" icon={Droplet} />
            </div>

            {/* Lighting */}
            <div className="space-y-3">
               <div className="text-[10px] flex items-center gap-2 uppercase font-mono tracking-widest font-bold opacity-40 mb-2">
                 <Lightbulb size={12} /> Lighting
               </div>
               <DeviceToggle label="Grow Light" stateKey="lightActive" topic="greenhouse/control/light" icon={Lightbulb} />
            </div>

            {/* Structure */}
            <div className="space-y-3">
               <div className="text-[10px] flex items-center gap-2 uppercase font-mono tracking-widest font-bold opacity-40 mb-2">
                 <Home size={12} /> Structure
               </div>
               <DeviceToggle label="Automated Roof" stateKey="roofActive" topic="greenhouse/control/roof" icon={Home} extraIcon={AnimatedRoofIcon} statusActive="OPEN" statusIdle="CLOSED" />
            </div>
          </CardContent>
        </Card>

        {/* AI Agents Panel */}
        <Card className="break-inside-avoid border border-[#D1E8D1] dark:border-[#1A2A1A] bg-[#FFFFFF]/80 dark:bg-[#080808]/80 backdrop-blur-xl rounded-3xl shadow-sm hover:shadow-md transition-shadow overflow-hidden flex flex-col relative group" >
            <CardHeader className="pb-3 border-b border-[#D1E8D1] dark:border-[#1A2A1A] flex flex-row items-center justify-between">
              <div className="text-[10px] w-max font-bold font-sans uppercase tracking-[0.05em] flex items-center gap-2 text-[#808080]">
                 <Bot size={14} className="text-[#10B981]"/> EDEN AI AGENTS
              </div>
              <div className="text-[10px] font-bold font-mono tracking-[0.2em] px-2 py-1 rounded bg-[#10B981]/10 text-[#10B981]">
                 ACTIVE: {activeAgentsCount}/5
              </div>
            </CardHeader>
            <CardContent className="p-4 flex flex-col gap-2">
                 <Label className="flex items-center justify-between p-3 border border-[#D1E8D1] dark:border-[#1A2A1A] rounded-xl cursor-pointer hover:bg-[#F8FAF8] dark:hover:bg-[#040404] transition-colors">
                   <div className="flex items-center gap-3">
                     <input type="checkbox" checked={climateAgent} onChange={e => store.setValue('agent_ClimateAgent_enabled', e.target.checked)} className="accent-[#10B981] w-4 h-4 cursor-pointer" /> 
                     <div>
                       <div className="font-bold text-sm">Climate Agent</div>
                       <div className="text-[10px] font-mono opacity-50">Last Run: {climateAgentLastRun !== 'Never' ? new Date(climateAgentLastRun as string).toLocaleTimeString() : 'Never'}</div>
                     </div>
                   </div>
                   <Bot size={16} className={climateAgent ? "text-[#10B981]" : "text-gray-400"} />
                 </Label>

                 <Label className="flex items-center justify-between p-3 border border-[#D1E8D1] dark:border-[#1A2A1A] rounded-xl cursor-pointer hover:bg-[#F8FAF8] dark:hover:bg-[#040404] transition-colors">
                   <div className="flex items-center gap-3">
                     <input type="checkbox" checked={irrigationAgent} onChange={e => store.setValue('agent_IrrigationAgent_enabled', e.target.checked)} className="accent-[#10B981] w-4 h-4 cursor-pointer" /> 
                     <div>
                       <div className="font-bold text-sm">Irrigation Agent</div>
                       <div className="text-[10px] font-mono opacity-50">Last Run: {irrigationAgentLastRun !== 'Never' ? new Date(irrigationAgentLastRun as string).toLocaleTimeString() : 'Never'}</div>
                     </div>
                   </div>
                   <Bot size={16} className={irrigationAgent ? "text-[#10B981]" : "text-gray-400"} />
                 </Label>

                 <Label className="flex items-center justify-between p-3 border border-[#D1E8D1] dark:border-[#1A2A1A] rounded-xl cursor-pointer hover:bg-[#F8FAF8] dark:hover:bg-[#040404] transition-colors">
                   <div className="flex items-center gap-3">
                     <input type="checkbox" checked={visionAgent} onChange={e => store.setValue('agent_VisionAgent_enabled', e.target.checked)} className="accent-[#10B981] w-4 h-4 cursor-pointer" /> 
                     <div>
                       <div className="font-bold text-sm">Vision Agent</div>
                       <div className="text-[10px] font-mono opacity-50">Last Run: {visionAgentLastRun !== 'Never' ? new Date(visionAgentLastRun as string).toLocaleTimeString() : 'Never'}</div>
                     </div>
                   </div>
                   <Bot size={16} className={visionAgent ? "text-[#10B981]" : "text-gray-400"} />
                 </Label>

                 <Label className="flex items-center justify-between p-3 border border-[#D1E8D1] dark:border-[#1A2A1A] rounded-xl cursor-pointer hover:bg-[#F8FAF8] dark:hover:bg-[#040404] transition-colors">
                   <div className="flex items-center gap-3">
                     <input type="checkbox" checked={harvestAgent} onChange={e => store.setValue('agent_HarvestAgent_enabled', e.target.checked)} className="accent-[#10B981] w-4 h-4 cursor-pointer" /> 
                     <div>
                       <div className="font-bold text-sm">Harvest Agent</div>
                       <div className="text-[10px] font-mono opacity-50">Last Run: {harvestAgentLastRun !== 'Never' ? new Date(harvestAgentLastRun as string).toLocaleTimeString() : 'Never'}</div>
                     </div>
                   </div>
                   <Bot size={16} className={harvestAgent ? "text-[#10B981]" : "text-gray-400"} />
                 </Label>

                 <Label className="flex items-center justify-between p-3 border border-[#D1E8D1] dark:border-[#1A2A1A] rounded-xl cursor-pointer hover:bg-[#F8FAF8] dark:hover:bg-[#040404] transition-colors">
                   <div className="flex items-center gap-3">
                     <input type="checkbox" checked={alertAgent} onChange={e => store.setValue('agent_AlertAgent_enabled', e.target.checked)} className="accent-[#10B981] w-4 h-4 cursor-pointer" /> 
                     <div>
                       <div className="font-bold text-sm">Alert Agent</div>
                       <div className="text-[10px] font-mono opacity-50">Last Run: {alertAgentLastRun !== 'Never' ? new Date(alertAgentLastRun as string).toLocaleTimeString() : 'Never'}</div>
                     </div>
                   </div>
                   <Bot size={16} className={alertAgent ? "text-[#10B981]" : "text-gray-400"} />
                 </Label>
            </CardContent>
          </Card>

      </div>

      {/* Activity Log */}
      <Card className="border border-[#10B981]/20 dark:border-white/5 bg-[#FFFFFF]/80 dark:bg-[#080808]/80 backdrop-blur-xl rounded-3xl shadow-sm hover:shadow-md transition-shadow overflow-hidden flex flex-col h-[500px] relative group w-full">
        <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-[#10B981]" />
        <CardHeader className="pb-4 border-b border-[#D1E8D1] dark:border-[#1A2A1A] bg-black/5 dark:bg-transparent shrink-0">
          <div className="text-[10px] w-max font-bold font-sans uppercase tracking-[0.05em] flex items-center gap-2 text-[#808080]">
            <RadioReceiver size={14} className="text-[#10B981]" /> ACTIVITY LOG
          </div>
        </CardHeader>
        <CardContent className="p-0 flex-1 relative overflow-hidden">
            <div ref={logContainerRef} className="absolute inset-0 overflow-y-auto px-6 py-4 space-y-4 font-mono text-[11px] custom-scrollbar scroll-smooth">
              <div className="absolute left-[39px] top-6 bottom-6 w-px bg-gradient-to-b from-transparent via-black/10 dark:via-white/10 to-transparent" />
              <AnimatePresence initial={false}>
                {activityEntries.length === 0 ? (
                  <motion.div initial={{opacity:0}} animate={{opacity:1}} className="text-center opacity-40 py-12 italic text-xs tracking-wider">Awaiting system activity...</motion.div>
                ) : (
                  activityEntries.map(([id, entry]: any) => (
                    <motion.div 
                      key={id}
                      initial={{ opacity: 0, x: 20, scale: 0.95 }}
                      animate={{ opacity: 1, x: 0, scale: 1 }}
                      transition={{ duration: 0.3 }}
                      className="flex items-start gap-4 relative z-10 group"
                    >
                      <div className={cn("w-10 h-10 shrink-0 rounded-2xl border flex items-center justify-center text-sm shadow-sm transition-transform duration-300 bg-white dark:bg-[#080808]", getLogColor(entry.type))}>
                        {getLogIcon(entry.message)}
                      </div>
                      <div className="flex-1 min-w-0 bg-[#FFFFFF] dark:bg-[#040404] border border-[#10B981]/20 dark:border-white/5 rounded-2xl px-5 py-4 group-hover:border-[#10B981]/50 group-hover:shadow-[0_4px_24px_-4px_rgba(16,185,129,0.1)] transition-all duration-300">
                        <div className="flex items-center justify-between gap-2 mb-2">
                          <span className="opacity-50 uppercase tracking-widest font-mono font-bold text-[10px]">
                            {format(new Date(entry.timestamp), 'MMM dd · HH:mm:ss')}
                          </span>
                          <span className={cn(
                            "font-bold uppercase tracking-widest px-2 py-0.5 rounded text-[9px]",
                            entry.type === 'error' ? 'text-red-500 bg-red-500/10' :
                            entry.type === 'warning' ? 'text-amber-500 bg-amber-500/10' :
                            'text-[#10B981] bg-[#10B981]/10'
                          )}>{entry.type}</span>
                        </div>
                        <div className="opacity-90 leading-relaxed font-sans font-medium text-[13px]">
                          {entry.message.replace(/^[📸🌾🤖🚨💧]\s*/, '').includes(':') ? (
                            <>
                              <span className="font-bold text-[#10B981]">{entry.message.replace(/^[📸🌾🤖🚨💧]\s*/, '').split(':')[0]}</span>:
                              <span className="opacity-80">{entry.message.replace(/^[📸🌾🤖🚨💧]\s*/, '').substring(entry.message.replace(/^[📸🌾🤖🚨💧]\s*/, '').indexOf(':') + 1)}</span>
                            </>
                          ) : (
                            entry.message.replace(/^[📸🌾🤖🚨💧]\s*/, '')
                          )}
                        </div>
                      </div>
                    </motion.div>
                  ))
                )}
              </AnimatePresence>
            </div>
        </CardContent>
      </Card>
    </div>
  );
}
