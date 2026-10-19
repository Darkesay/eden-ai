import { useEffect, useRef } from 'react';
import { store } from '../lib/store';

export function useHarvestAgent() {
  const isRunning = useRef(false);

  useEffect(() => {
    const runAgent = async () => {
      const isEnabled = store.getValue('agent_HarvestAgent_enabled') ?? false;
      if (!isEnabled) return;
      if (isRunning.current) return;
      
      isRunning.current = true;
      try {
        const plantingDateStr = store.getValue('plantingDate') as string;
        const cropType = (store.getValue('cropType') as string) || 'tomato';
        
        let daysToHarvest = 70;
        if (cropType === 'lettuce') daysToHarvest = 45;
        if (cropType === 'pepper') daysToHarvest = 80;

        if (plantingDateStr) {
          const plantingDate = new Date(plantingDateStr);
          const now = new Date();
          const daysElapsed = Math.floor((now.getTime() - plantingDate.getTime()) / (1000 * 60 * 60 * 24));
          const daysRemaining = daysToHarvest - daysElapsed;
          
          store.setValue('agent_HarvestAgent_lastRun', now.toISOString());
          store.setValue('daysRemainingToHarvest', daysRemaining);
          
          store.setRow('activityLog', Date.now().toString() + 'ha', {
            timestamp: now.toISOString(),
            type: 'agent',
            message: `🌾 Harvest Agent: ${daysRemaining > 0 ? daysRemaining + ' days until harvest.' : 'Ready for harvest!'}`
          });
        }
      } catch (err) {
        console.error("HarvestAgent failed", err);
      } finally {
        isRunning.current = false;
      }
    };

    // run every hour for demo purposes (real would be daily)
    const interval = setInterval(runAgent, 3600000);
    setTimeout(runAgent, 10000); // 10s delay start
    return () => clearInterval(interval);
  }, []);
}
