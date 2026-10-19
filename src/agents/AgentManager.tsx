import { useClimateAgent } from './ClimateAgent';
import { useIrrigationAgent } from './IrrigationAgent';
import { useVisionAgent } from './VisionAgent';
import { useHarvestAgent } from './HarvestAgent';
import { useAlertAgent } from './AlertAgent';

export function AgentManager() {
  useClimateAgent();
  useIrrigationAgent();
  useVisionAgent();
  useHarvestAgent();
  useAlertAgent();

  return null;
}
