import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Terminal, Cpu, Wifi, Zap, Video, CloudUpload, Play, AlertCircle, X, Check, ArrowRight, Settings, Server, ChevronRight } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from './ui/dialog';
import { cn } from '../lib/utils';
import { Button } from './ui/button';

export function HardwareSetupGuide({ variant = "button", children }: { variant?: "button" | "icon" | "custom", children?: React.ReactElement }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger
        render={
          variant === "custom" && children ? (
            children
          ) : variant === "icon" ? (
            <Button variant="outline" size="icon" className="h-[38px] w-[38px] border-[#14B8A6]/40 text-[#14B8A6] hover:bg-[#14B8A6]/20 rounded-xl bg-[#FFFFFF]/50 dark:bg-[#040404]/50 backdrop-blur-md shadow-[0_0_15px_rgba(20,184,166,0.15)] hover:shadow-[0_0_25px_rgba(20,184,166,0.3)] transition-all group relative overflow-hidden shrink-0 outline-none focus:ring-2 focus:ring-[#14B8A6]" title="View Hardware Setup Guide" />
          ) : (
            <Button variant="outline" size="sm" className="h-8 gap-2 border-[#14B8A6]/40 text-[#14B8A6] hover:bg-[#14B8A6]/10 text-xs font-bold tracking-wider uppercase shadow-[0_0_10px_rgba(20,184,166,0.1)] hover:shadow-[0_0_20px_rgba(20,184,166,0.2)] transition-all group outline-none focus:ring-2 focus:ring-[#14B8A6]" />
          )
        }
      >
        {variant === "custom" && children ? null : variant === "icon" ? (
           <>
             <div className="absolute inset-0 bg-gradient-to-tr from-[#14B8A6]/0 via-[#14B8A6]/20 to-[#14B8A6]/0 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
             <Cpu size={20} className="relative z-10 group-hover:scale-110 group-hover:rotate-[15deg] transition-transform duration-300 drop-shadow-[0_0_5px_rgba(20,184,166,0.5)]" />
           </>
        ) : (
           <>
             <Cpu size={14} className="group-hover:rotate-12 group-hover:scale-110 transition-transform duration-300" /> View Setup Guide
           </>
        )}
      </DialogTrigger>
      <DialogContent className="!w-[95vw] sm:!max-w-[95vw] xl:!max-w-[1200px] max-h-[90vh] overflow-y-auto bg-[#040404] border-[#1A2A1A] text-white p-0 rounded-3xl gap-0 shadow-[0_0_100px_rgba(20,184,166,0.2)] !flex !flex-col">
        <div className="sticky top-0 z-50 bg-[#040404]/80 backdrop-blur-xl border-b border-[#1A2A1A] p-6 flex justify-between items-center">
            <div>
              <DialogTitle className="text-2xl font-bold tracking-tight text-white flex items-center gap-3">
                 <Cpu className="text-[#14B8A6]" size={28} /> ESP32-CAM AI Plant Monitoring Setup
              </DialogTitle>
              <p className="text-gray-400 text-sm mt-1 uppercase tracking-widest font-mono">Live Stream + Capture + AI Analysis Architecture</p>
            </div>
        </div>

        <div className="p-6 grid grid-cols-1 md:grid-cols-3 xl:grid-cols-4 gap-6 bg-dots">
          
          {/* HARDWARE CONNECTIONS */}
          <div className="md:col-span-2 xl:col-span-2 space-y-6">
             <div className="bg-[#0A0A0A] border border-[#14B8A6]/30 rounded-3xl p-6 relative overflow-hidden group">
                 <div className="absolute top-0 right-0 w-32 h-32 bg-[#14B8A6]/10 rounded-full blur-3xl" />
                 <h3 className="text-[#14B8A6] text-sm font-bold tracking-widest uppercase mb-6 flex items-center gap-2">
                    <span className="bg-[#14B8A6]/20 px-2 py-0.5 rounded text-[#14B8A6]">1</span> ESP32-CAM Connections
                 </h3>
                 <div className="grid grid-cols-2 gap-8 items-center">
                    <div className="space-y-3 font-mono text-xs">
                        <div className="flex justify-between items-center bg-[#111] border border-[#222] p-2 rounded-lg">
                           <span className="text-red-500 font-bold px-2 py-1 bg-red-500/10 rounded">5V</span>
                           <ArrowRight size={14} className="opacity-40" />
                           <span className="text-red-500">5V (Power)</span>
                        </div>
                        <div className="flex justify-between items-center bg-[#111] border border-[#222] p-2 rounded-lg">
                           <span className="text-gray-400 font-bold px-2 py-1 bg-white/10 rounded">GND</span>
                           <ArrowRight size={14} className="opacity-40" />
                           <span className="text-gray-400">GND</span>
                        </div>
                        <div className="flex justify-between items-center bg-[#111] border border-[#222] p-2 rounded-lg">
                           <span className="text-amber-500 font-bold px-2 py-1 bg-amber-500/10 rounded">U0R (RX)</span>
                           <ArrowRight size={14} className="opacity-40" />
                           <span className="text-amber-500">TX (Programmer)</span>
                        </div>
                        <div className="flex justify-between items-center bg-[#111] border border-[#222] p-2 rounded-lg">
                           <span className="text-blue-500 font-bold px-2 py-1 bg-blue-500/10 rounded">U0T (TX)</span>
                           <ArrowRight size={14} className="opacity-40" />
                           <span className="text-blue-500">RX (Programmer)</span>
                        </div>
                        <div className="mt-4 p-3 bg-red-500/10 border border-red-500/20 rounded-xl">
                            <span className="text-red-400 font-bold flex items-center gap-2 mb-2">
                               <AlertCircle size={14} /> Flash Mode
                            </span>
                            <div className="flex justify-between items-center bg-[#111] p-2 rounded-lg">
                               <span className="text-green-400 font-bold">GPIO 0</span>
                               <ArrowRight size={14} className="opacity-40" />
                               <span className="text-gray-400">GND</span>
                            </div>
                            <p className="opacity-70 mt-2">Short GPIO 0 to GND while uploading code. Remove after upload and press RESET.</p>
                        </div>
                    </div>
                    <div className="relative aspect-square bg-[#111] border border-[#222] rounded-2xl flex items-center justify-center overflow-hidden">
                       <Cpu size={64} className="text-[#333]" />
                       <div className="absolute inset-0 bg-[url('https://transparenttextures.com/patterns/black-scales.png')] opacity-20" />
                        <div className="absolute bottom-4 left-0 right-0 text-center text-[10px] uppercase font-bold tracking-widest text-[#666]">ESP32-CAM Module</div>
                    </div>
                 </div>
             </div>

             <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-[#0A0A0A] border border-[#8B5CF6]/30 rounded-3xl p-6 relative">
                    <h3 className="text-[#8B5CF6] text-sm font-bold tracking-widest uppercase mb-4 flex items-center gap-2">
                        <span className="bg-[#8B5CF6]/20 px-2 py-0.5 rounded text-[#8B5CF6]">2</span> Power Supply
                    </h3>
                    <div className="flex items-start gap-4">
                        <Zap size={32} className="text-[#8B5CF6] shrink-0" />
                        <div>
                           <p className="text-white font-bold mb-1">5V 2A Adapter Recommended</p>
                           <p className="text-xs text-gray-400 leading-relaxed">The camera draws significant current during Wi-Fi transmission. Using a weak power supply leads to brownout resets and corrupted images.</p>
                        </div>
                    </div>
                </div>

                <div className="bg-[#0A0A0A] border border-[#F59E0B]/30 rounded-3xl p-6 relative">
                    <h3 className="text-[#F59E0B] text-sm font-bold tracking-widest uppercase mb-4 flex items-center gap-2">
                        <span className="bg-[#F59E0B]/20 px-2 py-0.5 rounded text-[#F59E0B]">3</span> Code Setup
                    </h3>
                    <div className="bg-[#111] p-3 rounded-xl border border-[#222] font-mono text-[10px] text-gray-300 overflow-x-auto space-y-2">
                        <div>
                          <span className="text-blue-400">const char*</span> ssid = <span className="text-green-400">"WIFI_NAME"</span>;
                        </div>
                        <div>
                          <span className="text-blue-400">const char*</span> pass = <span className="text-green-400">"PASSWORD"</span>;
                        </div>
                        <div className="pt-2 border-t border-[#333]">
                           <span className="text-gray-500">// Your Server URL (if using external API view)</span><br/>
                           <span className="text-blue-400">String</span> server = <span className="text-green-400">"http://x.x.x.x:3000"</span>;
                        </div>
                    </div>
                </div>
             </div>
          </div>

          {/* SYSTEM ARCHITECTURE & WORKFLOW */}
          <div className="md:col-span-1 xl:col-span-2 space-y-6">
              
              <div className="bg-[#0A0A0A] border border-[#3B82F6]/30 rounded-3xl p-6 relative h-full flex flex-col">
                 <h3 className="text-[#3B82F6] text-sm font-bold tracking-widest uppercase mb-6 flex items-center gap-2">
                    <span className="bg-[#3B82F6]/20 px-2 py-0.5 rounded text-[#3B82F6]">4</span> System Architecture
                 </h3>
                 <div className="flex-1 flex flex-col justify-center space-y-6 px-4">
                     
                     <div className="flex items-center gap-4">
                        <div className="w-16 h-16 bg-[#111] rounded-2xl border border-[#222] flex items-center justify-center shrink-0">
                           <Video className="text-gray-400" />
                        </div>
                        <div className="flex-1">
                           <h4 className="font-bold text-sm">ESP32-CAM</h4>
                           <p className="text-xs text-gray-500 font-mono mt-1">Live Video Stream 📸</p>
                        </div>
                     </div>

                     <div className="flex ml-8 border-l border-dashed border-[#333] h-6" />

                     <div className="flex items-center gap-4">
                        <div className="w-16 h-16 bg-[#111] rounded-2xl border border-[#222] flex items-center justify-center shrink-0">
                           <Wifi className="text-blue-400" />
                        </div>
                        <div className="flex-1">
                           <h4 className="font-bold text-sm">Wi-Fi Router</h4>
                           <p className="text-xs text-gray-500 font-mono mt-1">Local Network Transfer</p>
                        </div>
                     </div>

                     <div className="flex ml-8 border-l border-dashed border-[#333] h-6" />

                     <div className="flex items-center gap-4">
                        <div className="w-16 h-16 bg-gradient-to-br from-[#10B981]/20 to-emerald-900/20 rounded-2xl border border-[#10B981]/40 flex items-center justify-center shrink-0 shadow-[0_0_15px_rgba(16,185,129,0.2)]">
                           <Server className="text-[#10B981]" />
                        </div>
                        <div className="flex-1">
                           <h4 className="font-bold text-sm text-[#10B981]">AI Server / Dashboard</h4>
                           <p className="text-xs text-gray-500 font-mono mt-1">Capture → Analyze → Store</p>
                        </div>
                     </div>

                 </div>
              </div>
          </div>

          {/* QUICK SETUP GUIDE & TROUBLESHOOTING */}
          <div className="md:col-span-3 xl:col-span-4 grid grid-cols-1 lg:grid-cols-2 gap-6">
              
              <div className="bg-[#0A0A0A] border border-[#222] rounded-3xl p-6">
                 <h3 className="text-white text-sm font-bold tracking-widest uppercase mb-4 flex items-center gap-2">
                    <Play size={16} className="text-white" /> Quick Setup Guide
                 </h3>
                 <div className="flex flex-wrap gap-2 text-xs font-mono">
                    <div className="flex items-center gap-2 bg-[#111] p-3 rounded-xl border border-[#222] flex-1 min-w-[150px]">
                       <span className="text-[#14B8A6] font-bold text-lg">1</span>
                       <span className="opacity-80">Install ESP32 Board in Arduino IDE</span>
                    </div>
                    <div className="flex items-center gap-2 bg-[#111] p-3 rounded-xl border border-[#222] flex-1 min-w-[150px]">
                       <span className="text-[#14B8A6] font-bold text-lg">2</span>
                       <span className="opacity-80">Select "AI Thinker ESP32-CAM"</span>
                    </div>
                    <div className="flex items-center gap-2 bg-[#111] p-3 rounded-xl border border-[#222] flex-1 min-w-[150px]">
                       <span className="text-[#14B8A6] font-bold text-lg">3</span>
                       <span className="opacity-80">Update WiFi & Server Code</span>
                    </div>
                    <div className="flex items-center gap-2 bg-[#111] p-3 rounded-xl border border-[#222] flex-1 min-w-[150px]">
                       <span className="text-[#14B8A6] font-bold text-lg">4</span>
                       <span className="opacity-80">Upload Code (GND to GPIO 0)</span>
                    </div>
                    <div className="flex items-center gap-2 bg-[#111] p-3 rounded-xl border border-[#222] flex-1 min-w-[150px]">
                       <span className="text-[#14B8A6] font-bold text-lg">5</span>
                       <span className="opacity-80">Open BOTANIX Dashboard</span>
                    </div>
                 </div>
              </div>

              <div className="bg-red-500/5 border border-red-500/20 rounded-3xl p-6">
                 <h3 className="text-red-400 text-sm font-bold tracking-widest uppercase mb-4 flex items-center gap-2">
                    <AlertCircle size={16} /> Troubleshooting
                 </h3>
                 <ul className="space-y-3 text-sm text-gray-300">
                    <li className="flex gap-3">
                       <div className="w-1.5 h-1.5 rounded-full bg-red-400 mt-1.5 shrink-0" />
                       <p><strong className="text-white">Camera not working / Brownout?</strong> Ensure you have a solid 5V 2A power supply. USB from PC is often not enough.</p>
                    </li>
                    <li className="flex gap-3">
                       <div className="w-1.5 h-1.5 rounded-full bg-red-400 mt-1.5 shrink-0" />
                       <p><strong className="text-white">Upload failed (Timed out waiting for packet)?</strong> Check if GPIO 0 is properly connected to GND and you pressed the RESET button.</p>
                    </li>
                    <li className="flex gap-3">
                       <div className="w-1.5 h-1.5 rounded-full bg-red-400 mt-1.5 shrink-0" />
                       <p><strong className="text-white">CORS Errors on stream?</strong> The ESP32 code needs CORS headers enabled for the stream, or you must route it through a server proxy.</p>
                    </li>
                 </ul>
              </div>

          </div>

        </div>
      </DialogContent>
    </Dialog>
  );
}
