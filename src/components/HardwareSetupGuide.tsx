import React, { useState } from 'react';
import { Terminal, Cpu, Wifi, Zap, Video, Play, AlertCircle, ArrowRight, Server } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from './ui/dialog';
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
            <Button variant="outline" size="icon" aria-label="View hardware setup guide" title="View hardware setup guide" />
          ) : (
            <Button size="sm" />
          )
        }
      >
        {variant === "custom" && children ? null : variant === "icon" ? (
           <Cpu size={18} aria-hidden="true" />
        ) : (
           <>
             <Cpu size={15} aria-hidden="true" /> View setup guide
           </>
        )}
      </DialogTrigger>
      <DialogContent className="flex max-h-[90vh] w-[95vw] flex-col gap-0 overflow-y-auto rounded-xl border border-border bg-popover p-0 text-popover-foreground sm:max-w-[1100px]">
        <div className="sticky top-0 z-50 flex items-center justify-between border-b border-border bg-popover px-6 py-5">
            <div>
              <DialogTitle className="flex items-center gap-3 text-[15px] font-semibold">
                 <Cpu className="text-muted-foreground" size={20} aria-hidden="true" /> ESP32-CAM plant monitoring setup
              </DialogTitle>
              <p className="mt-1 text-sm text-muted-foreground">Live stream, capture, and AI analysis architecture</p>
            </div>
        </div>

        <div className="grid grid-cols-1 gap-6 p-6 md:grid-cols-3 xl:grid-cols-4">
          {/* HARDWARE CONNECTIONS */}
          <div className="space-y-6 md:col-span-2">
             <div className="rounded-lg border border-border bg-card p-5">
                 <h3 className="mb-5 flex items-center gap-2 text-sm font-semibold text-foreground">
                    <span className="flex size-5 items-center justify-center text-xs font-medium text-muted-foreground">1</span> ESP32-CAM connections
                 </h3>
                 <div className="grid grid-cols-2 items-center gap-8">
                     <div className="space-y-3 font-mono text-xs">
                         <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/40 p-2">
                           <span className="rounded-md bg-destructive/10 px-2 py-1 font-medium text-destructive">5V</span>
                           <ArrowRight size={13} className="shrink-0 text-muted-foreground" aria-hidden="true" />
                           <span className="text-foreground">5V (Power)</span>
                         </div>
                         <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/40 p-2">
                           <span className="rounded-md bg-muted px-2 py-1 font-medium text-muted-foreground">GND</span>
                           <ArrowRight size={13} className="shrink-0 text-muted-foreground" aria-hidden="true" />
                           <span className="text-foreground">GND</span>
                         </div>
                         <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/40 p-2">
                           <span className="rounded-md bg-warning/10 px-2 py-1 font-medium text-warning">U0R (RX)</span>
                           <ArrowRight size={13} className="shrink-0 text-muted-foreground" aria-hidden="true" />
                           <span className="text-foreground">TX (Programmer)</span>
                         </div>
                         <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/40 p-2">
                           <span className="rounded-md bg-info/10 px-2 py-1 font-medium text-info">U0T (TX)</span>
                           <ArrowRight size={13} className="shrink-0 text-muted-foreground" aria-hidden="true" />
                           <span className="text-foreground">RX (Programmer)</span>
                         </div>
                         <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 p-3">
                             <span className="mb-2 flex items-center gap-2 font-semibold text-destructive">
                                <AlertCircle size={14} aria-hidden="true" /> Flash mode
                             </span>
                             <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-background p-2">
                               <span className="font-semibold text-success">GPIO 0</span>
                               <ArrowRight size={13} className="shrink-0 text-muted-foreground" aria-hidden="true" />
                               <span className="text-foreground">GND</span>
                             </div>
                             <p className="mt-2 text-xs text-muted-foreground">Short GPIO 0 to GND while uploading code. Remove after upload and press RESET.</p>
                         </div>
                     </div>
                     <div className="relative flex aspect-square items-center justify-center overflow-hidden rounded-lg border border-border bg-muted">
                       <Cpu size={64} className="text-muted-foreground/40" aria-hidden="true" />
                       <div className="absolute bottom-4 left-0 right-0 text-center text-xs font-medium text-muted-foreground">ESP32-CAM module</div>
                     </div>
                 </div>
             </div>

             <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                <div className="rounded-lg border border-border bg-card p-5">
                    <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-foreground">
                        <span className="flex size-5 items-center justify-center text-xs font-medium text-muted-foreground">2</span> Power supply
                    </h3>
                    <div className="flex items-start gap-4">
                        <Zap size={22} className="shrink-0 text-muted-foreground" aria-hidden="true" />
                        <div>
                           <p className="mb-1 text-sm font-semibold">5V 2A adapter recommended</p>
                           <p className="text-xs leading-relaxed text-muted-foreground">The camera draws significant current during Wi-Fi transmission. Using a weak power supply leads to brownout resets and corrupted images.</p>
                        </div>
                    </div>
                </div>

                <div className="rounded-lg border border-border bg-card p-5">
                    <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-foreground">
                        <span className="flex size-5 items-center justify-center text-xs font-medium text-muted-foreground">3</span> Code setup
                    </h3>
                    <div className="space-y-2 overflow-x-auto rounded-lg border border-border bg-muted/40 p-3 font-mono text-xs">
                        <div className="text-foreground">const char* ssid = "WIFI_NAME";</div>
                        <div className="text-foreground">const char* pass = "PASSWORD";</div>
                        <div className="border-t border-border pt-2">
                           <div className="text-muted-foreground">// Your Server URL (if using external API view)</div>
                           <div className="text-foreground">String server = "http://x.x.x.x:3000";</div>
                        </div>
                    </div>
                </div>
             </div>
          </div>

          {/* SYSTEM ARCHITECTURE & WORKFLOW */}
          <div className="space-y-6 md:col-span-1 xl:col-span-2">
              <div className="flex h-full flex-col rounded-lg border border-border bg-card p-5">
                 <h3 className="mb-5 flex items-center gap-2 text-sm font-semibold text-foreground">
                    <span className="flex size-5 items-center justify-center text-xs font-medium text-muted-foreground">4</span> System architecture
                 </h3>
                 <div className="flex flex-1 flex-col justify-center space-y-6 px-4">
                     <div className="flex items-center gap-4">
                        <div className="flex size-14 shrink-0 items-center justify-center rounded-lg border border-border bg-muted">
                           <Video size={20} className="text-muted-foreground" aria-hidden="true" />
                        </div>
                        <div className="flex-1">
                           <h4 className="text-sm font-semibold">ESP32-CAM</h4>
                           <p className="mt-1 text-xs text-muted-foreground">Live video stream</p>
                        </div>
                     </div>

                     <div className="ml-8 h-6 border-l border-dashed border-border" />

                     <div className="flex items-center gap-4">
                        <div className="flex size-14 shrink-0 items-center justify-center rounded-lg border border-border bg-muted">
                           <Wifi size={20} className="text-muted-foreground" aria-hidden="true" />
                        </div>
                        <div className="flex-1">
                           <h4 className="text-sm font-semibold">Wi-Fi router</h4>
                           <p className="mt-1 text-xs text-muted-foreground">Local network transfer</p>
                        </div>
                     </div>

                     <div className="ml-8 h-6 border-l border-dashed border-border" />

                     <div className="flex items-center gap-4">
                        <div className="flex size-14 shrink-0 items-center justify-center rounded-lg border border-brand/40 bg-accent">
                           <Server size={20} className="text-brand" aria-hidden="true" />
                        </div>
                        <div className="flex-1">
                           <h4 className="text-sm font-semibold text-brand">AI server / dashboard</h4>
                           <p className="mt-1 text-xs text-muted-foreground">Capture → Analyze → Store</p>
                        </div>
                     </div>
                 </div>
              </div>
          </div>

          {/* QUICK SETUP GUIDE & TROUBLESHOOTING */}
          <div className="grid grid-cols-1 gap-6 md:col-span-3 lg:grid-cols-2 xl:col-span-4">
              <div className="rounded-lg border border-border bg-card p-5">
                 <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-foreground">
                    <Play size={15} className="text-muted-foreground" aria-hidden="true" /> Quick setup guide
                 </h3>
                 <div className="flex flex-wrap gap-2 text-xs">
                    <div className="flex min-w-[150px] flex-1 items-center gap-2.5 rounded-lg border border-border bg-muted/40 p-3">
                       <span className="text-sm font-semibold text-muted-foreground">1</span>
                       <span className="text-foreground">Install ESP32 Board in Arduino IDE</span>
                    </div>
                    <div className="flex min-w-[150px] flex-1 items-center gap-2.5 rounded-lg border border-border bg-muted/40 p-3">
                       <span className="text-sm font-semibold text-muted-foreground">2</span>
                       <span className="text-foreground">Select "AI Thinker ESP32-CAM"</span>
                    </div>
                    <div className="flex min-w-[150px] flex-1 items-center gap-2.5 rounded-lg border border-border bg-muted/40 p-3">
                       <span className="text-sm font-semibold text-muted-foreground">3</span>
                       <span className="text-foreground">Update WiFi & server code</span>
                    </div>
                    <div className="flex min-w-[150px] flex-1 items-center gap-2.5 rounded-lg border border-border bg-muted/40 p-3">
                       <span className="text-sm font-semibold text-muted-foreground">4</span>
                       <span className="text-foreground">Upload code (GND to GPIO 0)</span>
                    </div>
                    <div className="flex min-w-[150px] flex-1 items-center gap-2.5 rounded-lg border border-border bg-muted/40 p-3">
                       <span className="text-sm font-semibold text-muted-foreground">5</span>
                       <span className="text-foreground">Open BOTANIX dashboard</span>
                    </div>
                 </div>
              </div>

              <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-5">
                 <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-destructive">
                    <AlertCircle size={15} aria-hidden="true" /> Troubleshooting
                 </h3>
                 <ul className="space-y-3 text-sm text-muted-foreground">
                     <li className="flex gap-3">
                        <div className="mt-1.5 size-1.5 shrink-0 rounded-full bg-destructive" aria-hidden="true" />
                        <p><strong className="text-foreground">Camera not working / Brownout?</strong> Ensure you have a solid 5V 2A power supply. USB from PC is often not enough.</p>
                    </li>
                    <li className="flex gap-3">
                       <div className="mt-1.5 size-1.5 shrink-0 rounded-full bg-destructive" aria-hidden="true" />
                       <p><strong className="text-foreground">Upload failed (Timed out waiting for packet)?</strong> Check if GPIO 0 is properly connected to GND and you pressed the RESET button.</p>
                    </li>
                    <li className="flex gap-3">
                       <div className="mt-1.5 size-1.5 shrink-0 rounded-full bg-destructive" aria-hidden="true" />
                       <p><strong className="text-foreground">CORS Errors on stream?</strong> The ESP32 code needs CORS headers enabled for the stream, or you must route it through a server proxy.</p>
                    </li>
                 </ul>
              </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
