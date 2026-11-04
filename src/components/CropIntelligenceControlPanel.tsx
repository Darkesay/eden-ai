import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Loader2,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Sprout,
  X
} from 'lucide-react';
import { apiFetch } from '../lib/auth';
import { parseApiJsonResponse } from '../lib/api';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { cn } from '../lib/utils';

interface CropIntelligenceControlPanelProps {
  greenhouseId: string;
  selectedZoneId?: string;
  isGuest: boolean;
  canManage: boolean;
  onUpdated?: () => void;
}

type PanelTab = 'standards' | 'recommendations' | 'authorization' | 'history';

const STAGE_LABELS: Record<string, string> = {
  germination: '01. Germination',
  seedling: '02. Seedling',
  vegetative: '03. Vegetative',
  flowering: '04. Flowering',
  fruiting: '05. Fruiting',
  harvest: '06. Harvest'
};

const MODE_DESCRIPTIONS: Record<
  string,
  { title: string; summary: string }
> = {
  mode_1_individual: {
    title: 'Mode 1 — Individual Farmer Approval',
    summary:
      'Every AI recommendation waits for your explicit approval, modification, or rejection before any action runs.'
  },
  mode_2_limited: {
    title: 'Mode 2 — Limited Bounded Automation',
    summary:
      'Pre-approved low-risk actions (such as bounded irrigation or fan pulses) run within your strict duration, cooldown, and operating-hour rules.'
  },
  mode_3_advanced: {
    title: 'Mode 3 — Advanced Multi-Zone Bounded Automation',
    summary:
      'Coordinated climate and irrigation rules across permitted zones within Tier 1 & Tier 2 safety boundaries. Simulation-locked in Phase 3.'
  }
};

export function CropIntelligenceControlPanel({
  greenhouseId,
  selectedZoneId = 'all',
  isGuest,
  canManage,
  onUpdated
}: CropIntelligenceControlPanelProps) {
  const [activeTab, setActiveTab] = useState<PanelTab>('standards');
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ tone: 'ok' | 'err' | 'warn'; text: string } | null>(null);

  const [catalog, setCatalog] = useState<any[]>([]);
  const [overview, setOverview] = useState<any | null>(null);

  // Crop & Stage selection form state
  const [selectedProfileId, setSelectedProfileId] = useState<string>('');
  const [selectedStage, setSelectedStage] = useState<string>('vegetative');
  const [plantingDate, setPlantingDate] = useState<string>('');

  // Proposed threshold override form state
  const [showProposeForm, setShowProposeForm] = useState(false);
  const [propTempMin, setPropTempMin] = useState<string>('');
  const [propTempMax, setPropTempMax] = useState<string>('');
  const [propSoilMin, setPropSoilMin] = useState<string>('');
  const [propSoilMax, setPropSoilMax] = useState<string>('');
  const [propNote, setPropNote] = useState<string>('');

  // Labeled Simulation Sandbox form state (never disguised as live hardware)
  const [showSandbox, setShowSandbox] = useState(false);
  const [simTemp, setSimTemp] = useState<number>(33.5);
  const [simHum, setSimHum] = useState<number>(82);
  const [simSoil, setSimSoil] = useState<number>(34);
  const [simWater, setSimWater] = useState<number>(72);
  const [simRain, setSimRain] = useState<boolean>(false);

  // Per-recommendation modify/rationale state
  const [modifyDurationMap, setModifyDurationMap] = useState<Record<string, number>>({});
  const [decisionNoteMap, setDecisionNoteMap] = useState<Record<string, string>>({});

  // Mode & Tier 2 safety form state
  const [authModeInput, setAuthModeInput] = useState<string>('mode_1_individual');
  const [t2MaxPulse, setT2MaxPulse] = useState<number>(45);
  const [t2MinWater, setT2MinWater] = useState<number>(15);
  const [t2MaxHeater, setT2MaxHeater] = useState<number>(28);
  const [t2Cooldown, setT2Cooldown] = useState<number>(900);
  const [t2DailyMax, setT2DailyMax] = useState<number>(600);

  // Bounded Automation Policy builder state
  const [polEquipment, setPolEquipment] = useState<string>('pump');
  const [polMode, setPolMode] = useState<string>('mode_2_limited');
  const [polMaxDuration, setPolMaxDuration] = useState<number>(40);
  const [polCooldown, setPolCooldown] = useState<number>(600);
  const [polDailyLimit, setPolDailyLimit] = useState<number>(360);
  const [polStartHour, setPolStartHour] = useState<number>(6);
  const [polEndHour, setPolEndHour] = useState<number>(19);

  // Emergency Stop state
  const [estopReasonInput, setEstopReasonInput] = useState<string>('Routine greenhouse inspection');
  const [confirmSafeReset, setConfirmSafeReset] = useState<boolean>(false);

  const loadData = useCallback(async () => {
    if (!greenhouseId) return;
    try {
      const zoneQuery =
        selectedZoneId && selectedZoneId !== 'all'
          ? `?zoneId=${encodeURIComponent(selectedZoneId)}`
          : '';
      const [catRes, ovRes] = await Promise.all([
        apiFetch('/api/crops/intelligence'),
        apiFetch(`/api/greenhouses/${greenhouseId}/intelligence-overview${zoneQuery}`)
      ]);
      const [catParsed, ovParsed] = await Promise.all([
        parseApiJsonResponse<any>(catRes),
        parseApiJsonResponse<any>(ovRes)
      ]);

      if (catParsed.ok && Array.isArray(catParsed.data?.crops)) {
        setCatalog(catParsed.data.crops);
      }

      if (ovParsed.ok && ovParsed.data?.success) {
        const d = ovParsed.data;
        setOverview(d);
        if (d.cropProfile?.id) {
          setSelectedProfileId(d.cropProfile.id);
        }
        if (d.greenhouseControlState?.activeGrowthStage) {
          setSelectedStage(d.greenhouseControlState.activeGrowthStage);
        }
        if (d.greenhouseControlState?.plantingDate) {
          setPlantingDate(d.greenhouseControlState.plantingDate);
        }
        if (d.greenhouseControlState?.authorizationMode) {
          setAuthModeInput(d.greenhouseControlState.authorizationMode);
        }
        const env = d.safetyStatus?.effectiveEnvelope?.policyDefaults;
        if (env) {
          setT2MaxPulse(Number(env.maxIndividualIrrigationPulseSeconds ?? 45));
          setT2MinWater(Number(env.waterLevelIrrigationLockPct ?? 15));
          setT2MaxHeater(Number(env.heaterOperatingLockTempC ?? 28));
          setT2Cooldown(Number(env.minPumpCooldownSeconds ?? 900));
          setT2DailyMax(Number(env.maxDailyCumulativePumpSeconds ?? 600));
        }
        const std = d.activeStageStandard;
        if (std) {
          setPropTempMin(String(std.tempMinC));
          setPropTempMax(String(std.tempMaxC));
          setPropSoilMin(String(std.soilMoistureMinPct));
          setPropSoilMax(String(std.soilMoistureMaxPct));
        }
      }
    } catch (err: any) {
      setBanner({
        tone: 'err',
        text: err?.message || 'Unable to load crop intelligence overview.'
      });
    } finally {
      setLoading(false);
    }
  }, [greenhouseId, selectedZoneId]);

  useEffect(() => {
    setLoading(true);
    loadData();
  }, [loadData]);

  const selectedCatalogProfile = useMemo(() => {
    return (
      catalog.find((c) => c.id === selectedProfileId) ||
      overview?.cropProfile ||
      null
    );
  }, [catalog, selectedProfileId, overview]);

  const handleSaveCropStage = async () => {
    if (!selectedCatalogProfile) return;
    setBusyAction('save-stage');
    setBanner(null);
    try {
      const res = await apiFetch(`/api/greenhouses/${greenhouseId}/crop-stage`, {
        method: 'PATCH',
        body: JSON.stringify({
          cropCode: selectedCatalogProfile.cropCode,
          variety: selectedCatalogProfile.variety,
          growthStage: selectedStage,
          plantingDate: plantingDate || undefined,
          zoneId: selectedZoneId !== 'all' ? selectedZoneId : undefined
        })
      });
      const parsed = await parseApiJsonResponse<any>(res);
      if (!parsed.ok || !parsed.data?.success) {
        setBanner({
          tone: 'err',
          text: !parsed.ok ? parsed.message : parsed.data?.message || 'Could not update crop stage.'
        });
        return;
      }
      setBanner({
        tone: 'ok',
        text: `Active crop set to ${parsed.data.profile.commonName} (${parsed.data.profile.variety}) — ${STAGE_LABELS[selectedStage] || selectedStage}.`
      });
      await loadData();
      onUpdated?.();
    } finally {
      setBusyAction(null);
    }
  };

  const handleProposeThresholds = async () => {
    setBusyAction('propose-std');
    setBanner(null);
    try {
      const thresholds: Record<string, number> = {};
      if (propTempMin.trim() !== '' && Number.isFinite(Number(propTempMin))) {
        thresholds.tempMinC = Number(propTempMin);
      }
      if (propTempMax.trim() !== '' && Number.isFinite(Number(propTempMax))) {
        thresholds.tempMaxC = Number(propTempMax);
      }
      if (propSoilMin.trim() !== '' && Number.isFinite(Number(propSoilMin))) {
        thresholds.soilMoistureMinPct = Number(propSoilMin);
      }
      if (propSoilMax.trim() !== '' && Number.isFinite(Number(propSoilMax))) {
        thresholds.soilMoistureMaxPct = Number(propSoilMax);
      }
      const res = await apiFetch(`/api/greenhouses/${greenhouseId}/crop-standards/propose`, {
        method: 'POST',
        body: JSON.stringify({
          zoneId: selectedZoneId !== 'all' ? selectedZoneId : null,
          cropProfileId: overview?.cropProfile?.id || null,
          thresholds,
          evidence: { note: propNote.trim() || 'Farmer proposed threshold refinement' }
        })
      });
      const parsed = await parseApiJsonResponse<any>(res);
      if (!parsed.ok || !parsed.data?.success) {
        setBanner({
          tone: 'err',
          text: !parsed.ok ? parsed.message : parsed.data?.message || 'Could not propose standard.'
        });
        return;
      }
      setShowProposeForm(false);
      setPropNote('');
      setBanner({
        tone: 'ok',
        text: `Proposed threshold version v${parsed.data.standardVersion.versionNumber} saved as pending. Active standards remain unchanged until you approve it.`
      });
      await loadData();
    } finally {
      setBusyAction(null);
    }
  };

  const handleReviewStandard = async (
    versionId: string,
    action: 'approve' | 'reject' | 'rollback'
  ) => {
    setBusyAction(`std-${versionId}-${action}`);
    setBanner(null);
    try {
      const res = await apiFetch(
        `/api/greenhouses/${greenhouseId}/crop-standards/${versionId}/review`,
        {
          method: 'POST',
          body: JSON.stringify({ action })
        }
      );
      const parsed = await parseApiJsonResponse<any>(res);
      if (!parsed.ok || !parsed.data?.success) {
        setBanner({
          tone: 'err',
          text: !parsed.ok ? parsed.message : parsed.data?.message || 'Review action failed.'
        });
        return;
      }
      setBanner({
        tone: 'ok',
        text:
          action === 'approve'
            ? 'Proposed crop threshold version approved and activated.'
            : action === 'reject'
              ? 'Proposed threshold change rejected. Approved standards unchanged.'
              : 'Rolled back crop thresholds cleanly.'
      });
      await loadData();
    } finally {
      setBusyAction(null);
    }
  };

  const handleEvaluateRecommendations = async (useSandbox: boolean) => {
    setBusyAction(useSandbox ? 'eval-sim' : 'eval-live');
    setBanner(null);
    try {
      const payload: Record<string, any> = {
        zoneId: selectedZoneId !== 'all' ? selectedZoneId : undefined
      };
      if (useSandbox) {
        payload.useSimulationSandbox = true;
        payload.simulationTelemetry = {
          temperature: Number(simTemp),
          humidity: Number(simHum),
          soilMoisture: Number(simSoil),
          waterLevel: Number(simWater),
          rain: Boolean(simRain)
        };
      }
      const res = await apiFetch(
        `/api/greenhouses/${greenhouseId}/recommendations/evaluate`,
        {
          method: 'POST',
          body: JSON.stringify(payload)
        }
      );
      const parsed = await parseApiJsonResponse<any>(res);
      if (!parsed.ok || !parsed.data?.success) {
        setBanner({
          tone: 'err',
          text: !parsed.ok ? parsed.message : parsed.data?.message || 'Evaluation failed.'
        });
        return;
      }
      const count = (parsed.data.recommendations || []).length;
      const autoCount = (parsed.data.autoExecutedSimulations || []).length;
      setBanner({
        tone: 'ok',
        text:
          count === 0
            ? `Evaluated ${parsed.data.dataSource} readings: all monitored conditions are within target ranges (0 physical commands sent).`
            : `Generated ${count} explainable recommendation(s) from ${parsed.data.dataSource} data${
                autoCount > 0 ? ` (${autoCount} bounded policy simulation(s) verified)` : ''
              }. 0 physical hardware commands sent.`
      });
      setActiveTab('recommendations');
      await loadData();
    } finally {
      setBusyAction(null);
    }
  };

  const handleDecision = async (
    recommendationId: string,
    decision: 'approve' | 'modify' | 'reject',
    defaultDuration: number
  ) => {
    setBusyAction(`dec-${recommendationId}-${decision}`);
    setBanner(null);
    try {
      const modifiedDurationSeconds =
        decision === 'modify'
          ? Number(modifyDurationMap[recommendationId] ?? defaultDuration)
          : undefined;
      const rationale = decisionNoteMap[recommendationId]?.trim() || undefined;

      const res = await apiFetch(
        `/api/greenhouses/${greenhouseId}/recommendations/${recommendationId}/decision`,
        {
          method: 'POST',
          body: JSON.stringify({
            decision,
            modifiedDurationSeconds,
            rationale
          })
        }
      );
      const parsed = await parseApiJsonResponse<any>(res);
      if (!parsed.ok || !parsed.data?.success) {
        setBanner({
          tone: res.status === 409 ? 'warn' : 'err',
          text: !parsed.ok
            ? parsed.message
            : parsed.data?.message || 'Action blocked by safety envelope.'
        });
        await loadData();
        return;
      }
      setBanner({
        tone: 'ok',
        text:
          decision === 'reject'
            ? 'Recommendation rejected and recorded in your decision history.'
            : `Recommendation ${decision}d and verified in Simulation Adapter (0 physical commands sent to hardware).`
      });
      await loadData();
    } finally {
      setBusyAction(null);
    }
  };

  const handleSaveAuthorizationMode = async () => {
    setBusyAction('save-mode');
    setBanner(null);
    try {
      const res = await apiFetch(`/api/greenhouses/${greenhouseId}/authorization-mode`, {
        method: 'PATCH',
        body: JSON.stringify({
          authorizationMode: authModeInput,
          policyDefaults: {
            maxIndividualIrrigationPulseSeconds: Number(t2MaxPulse),
            waterLevelIrrigationLockPct: Number(t2MinWater),
            heaterOperatingLockTempC: Number(t2MaxHeater),
            minPumpCooldownSeconds: Number(t2Cooldown),
            maxDailyCumulativePumpSeconds: Number(t2DailyMax)
          }
        })
      });
      const parsed = await parseApiJsonResponse<any>(res);
      if (!parsed.ok || !parsed.data?.success) {
        setBanner({
          tone: 'err',
          text: !parsed.ok
            ? parsed.message
            : parsed.data?.message || 'Tier 1 safety ceiling rejected these settings.'
        });
        return;
      }
      setBanner({
        tone: 'ok',
        text: `Saved ${MODE_DESCRIPTIONS[authModeInput]?.title || authModeInput} and Tier 2 safety limits.`
      });
      await loadData();
    } finally {
      setBusyAction(null);
    }
  };

  const handleCreatePolicy = async () => {
    setBusyAction('create-policy');
    setBanner(null);
    try {
      const res = await apiFetch(
        `/api/greenhouses/${greenhouseId}/authorization-policies`,
        {
          method: 'POST',
          body: JSON.stringify({
            zoneId: selectedZoneId !== 'all' ? selectedZoneId : null,
            mode: polMode,
            cropType: overview?.cropProfile?.commonName || '*',
            equipmentKey: polEquipment,
            permittedAction: '*',
            maxDurationSeconds: Number(polMaxDuration),
            cooldownSeconds: Number(polCooldown),
            maxDailyCumulativeSeconds: Number(polDailyLimit),
            operatingConditions: {
              startHourUtc: Number(polStartHour),
              endHourUtc: Number(polEndHour),
              allowRoofOpenDuringRain: false
            }
          })
        }
      );
      const parsed = await parseApiJsonResponse<any>(res);
      if (!parsed.ok || !parsed.data?.success) {
        setBanner({
          tone: 'err',
          text: !parsed.ok ? parsed.message : parsed.data?.message || 'Could not create policy.'
        });
        return;
      }
      setBanner({
        tone: 'ok',
        text: `Created bounded ${polEquipment} automation rule (${polMaxDuration}s max, ${polStartHour}:00–${polEndHour}:00 UTC).`
      });
      await loadData();
    } finally {
      setBusyAction(null);
    }
  };

  const handleRevokePolicy = async (policyId: string) => {
    setBusyAction(`revoke-${policyId}`);
    setBanner(null);
    try {
      const res = await apiFetch(
        `/api/greenhouses/${greenhouseId}/authorization-policies/${policyId}/revoke`,
        {
          method: 'POST',
          body: JSON.stringify({ rationale: 'Revoked by farmer in Control Panel' })
        }
      );
      const parsed = await parseApiJsonResponse<any>(res);
      if (parsed.ok && parsed.data?.success) {
        setBanner({ tone: 'ok', text: 'Automation rule revoked.' });
        await loadData();
      }
    } finally {
      setBusyAction(null);
    }
  };

  const handleToggleEmergencyStop = async (activate: boolean) => {
    setBusyAction('estop');
    setBanner(null);
    try {
      const res = await apiFetch(`/api/greenhouses/${greenhouseId}/emergency-stop`, {
        method: 'POST',
        body: JSON.stringify(
          activate
            ? { active: true, reason: estopReasonInput.trim() || 'Farmer activated Emergency Stop' }
            : { active: false, confirmReset: confirmSafeReset }
        )
      });
      const parsed = await parseApiJsonResponse<any>(res);
      if (!parsed.ok || !parsed.data?.success) {
        setBanner({
          tone: 'err',
          text: !parsed.ok ? parsed.message : parsed.data?.message || 'Emergency Stop update failed.'
        });
        return;
      }
      setConfirmSafeReset(false);
      setBanner({
        tone: activate ? 'warn' : 'ok',
        text: activate
          ? 'Emergency Stop engaged. All automated and recommended actions are locked.'
          : 'Emergency Stop cleared after safety confirmation.'
      });
      await loadData();
    } finally {
      setBusyAction(null);
    }
  };

  if (loading && !overview) {
    return (
      <section className="rounded-2xl border border-border bg-card p-6 flex items-center justify-center gap-2.5 text-muted-foreground">
        <Loader2 size={18} className="animate-spin text-primary" />
        <span className="text-xs font-medium">Loading Crop Intelligence &amp; Authorized Control...</span>
      </section>
    );
  }

  if (!overview) return null;

  const ctrlState = overview.greenhouseControlState || {};
  const estopActive = Boolean(ctrlState.emergencyStopActive);
  const stageStd = overview.activeStageStandard || {};
  const profile = overview.cropProfile || {};
  const telEval = overview.telemetryEvaluation || {};
  const tier1 = overview.safetyStatus?.effectiveEnvelope?.hardwareProtection || {};
  const activePolicies = (overview.policies || []).filter((p: any) => p.status === 'active');
  const pendingProposals = overview.pendingProposedVersions || [];
  const activeStdOverride = overview.activeStandardVersion || null;
  const persistedRecs: any[] = overview.recommendations || [];

  return (
    <section
      aria-label="Crop Intelligence and Farmer-Authorized Control"
      className="rounded-2xl border border-border bg-card p-4 sm:p-6 shadow-xs space-y-6"
    >
      {/* Top Header + Emergency Stop Control */}
      <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4 pb-5 border-b border-border">
        <div className="space-y-1.5 max-w-2xl">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="font-semibold text-primary flex items-center gap-1.5">
              <Sprout size={14} />
              Crop Intelligence &amp; Farmer-Authorized Control
            </span>
            <span aria-hidden="true">·</span>
            <span>Simulation Execution Only (0 Physical Commands Dispatched)</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">
              {MODE_DESCRIPTIONS[ctrlState.authorizationMode]?.title.split(' — ')[0] || 'Mode 1'}
            </span>
          </div>
          <h2 className="text-lg sm:text-xl font-bold tracking-tight text-foreground">
            {profile.commonName} ({profile.variety}) —{' '}
            {STAGE_LABELS[ctrlState.activeGrowthStage] || ctrlState.activeGrowthStage}
          </h2>
          <p className="text-xs text-muted-foreground leading-relaxed">
            EDENS AI recommends stage-specific actions using verified agronomic standards, checks Two-Tier safety locks, and requires your authorization before running closed-loop verification.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <Button
            type="button"
            variant="outline"
            onClick={() => loadData()}
            className="h-9 px-3 text-xs font-semibold cursor-pointer"
          >
            <RefreshCw size={13} className="mr-1.5" />
            Refresh
          </Button>
          {canManage && !estopActive && (
            <Button
              type="button"
              disabled={busyAction === 'estop'}
              onClick={() => handleToggleEmergencyStop(true)}
              className="h-9 px-3.5 bg-red-600 hover:bg-red-700 text-white text-xs font-semibold cursor-pointer"
            >
              <ShieldAlert size={14} className="mr-1.5" />
              Engage Emergency Stop
            </Button>
          )}
        </div>
      </div>

      {/* Emergency Stop Active Banner */}
      {estopActive && (
        <div className="rounded-xl border border-red-300 bg-red-50/90 dark:border-red-800/70 dark:bg-red-950/45 p-4 space-y-3">
          <div className="flex items-start gap-2.5">
            <ShieldAlert size={18} className="text-red-700 dark:text-red-300 shrink-0 mt-0.5" />
            <div className="space-y-1 text-xs">
              <p className="font-semibold text-sm text-red-950 dark:text-red-100">
                Emergency Stop Engaged — All Automated &amp; Recommended Actions Locked
              </p>
              <p className="text-red-900 dark:text-red-200">
                Reason: {ctrlState.emergencyStopReason || 'Activated by farmer'}
                {ctrlState.emergencyStopAt
                  ? ` · Activated ${new Date(ctrlState.emergencyStopAt).toLocaleTimeString()}`
                  : ''}
              </p>
            </div>
          </div>

          {canManage && (
            <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-red-200 dark:border-red-800/60">
              <label className="inline-flex items-center gap-2 text-xs text-red-950 dark:text-red-100 cursor-pointer">
                <input
                  type="checkbox"
                  checked={confirmSafeReset}
                  onChange={(e) => setConfirmSafeReset(e.target.checked)}
                  className="rounded border-red-400"
                />
                <span>I have inspected the greenhouse and verified equipment is safe to resume.</span>
              </label>
              <Button
                type="button"
                size="sm"
                disabled={!confirmSafeReset || busyAction === 'estop'}
                onClick={() => handleToggleEmergencyStop(false)}
                className="h-8 px-3 bg-red-700 hover:bg-red-800 text-white text-xs font-semibold cursor-pointer"
              >
                Confirm Safe &amp; Reset
              </Button>
            </div>
          )}
        </div>
      )}

      {isGuest && (
        <div className="rounded-xl border border-border bg-muted/40 px-4 py-3 text-xs text-muted-foreground">
          Guest sessions can explore all crop intelligence profiles and stage targets in read-only mode. Sign in with a Farmer account to change growth stages, approve recommendations, or manage safety policies.
        </div>
      )}

      {banner && (
        <div
          className={cn(
            'rounded-xl border px-4 py-3 text-xs flex items-center justify-between gap-3',
            banner.tone === 'ok'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-800/60 dark:bg-emerald-950/45 dark:text-emerald-100'
              : banner.tone === 'warn'
                ? 'border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-800/60 dark:bg-amber-950/45 dark:text-amber-100'
                : 'border-red-200 bg-red-50 text-red-950 dark:border-red-800/60 dark:bg-red-950/45 dark:text-red-100'
          )}
        >
          <span className="font-medium leading-relaxed">{banner.text}</span>
          <button
            type="button"
            onClick={() => setBanner(null)}
            className="opacity-75 hover:opacity-100 cursor-pointer shrink-0"
            aria-label="Dismiss notification"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Segmented Interactive View Selector */}
      <div className="flex flex-wrap items-center gap-1 p-1 rounded-xl bg-muted/60 border border-border w-fit">
        {(
          [
            { id: 'standards', label: '01. Crop & Stage Standards' },
            {
              id: 'recommendations',
              label: `02. Explainable Recommendations (${
                persistedRecs.filter((r) => r.status === 'pending').length
              })`
            },
            {
              id: 'authorization',
              label: `03. Authorization & Safety (${activePolicies.length})`
            },
            {
              id: 'history',
              label: `04. Decisions & Verification (${(overview.verifications || []).length})`
            }
          ] as { id: PanelTab; label: string }[]
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              'px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap',
              activeTab === tab.id
                ? 'bg-card text-foreground shadow-xs'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* =================================================================== */}
      {/* TAB 1: CROP, VARIETY, 6-STAGE STANDARDS & CONDITION GAP ANALYSIS     */}
      {/* =================================================================== */}
      {activeTab === 'standards' && (
        <div className="space-y-6">
          {/* Crop, Variety & Growth Stage Configuration Row */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end pb-6 border-b border-border">
            <div className="md:col-span-5 space-y-1.5">
              <label className="text-xs font-medium text-foreground" htmlFor="phase3-crop-select">
                Crop Species &amp; Variety
              </label>
              <select
                id="phase3-crop-select"
                value={selectedProfileId}
                disabled={!canManage}
                onChange={(e) => setSelectedProfileId(e.target.value)}
                className="w-full h-10 rounded-lg border border-border bg-background px-3 text-xs text-foreground"
              >
                {catalog.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.commonName} — {c.variety} ({c.scientificName})
                  </option>
                ))}
              </select>
            </div>

            <div className="md:col-span-3 space-y-1.5">
              <label className="text-xs font-medium text-foreground" htmlFor="phase3-stage-select">
                Active Growth Stage
              </label>
              <select
                id="phase3-stage-select"
                value={selectedStage}
                disabled={!canManage}
                onChange={(e) => setSelectedStage(e.target.value)}
                className="w-full h-10 rounded-lg border border-border bg-background px-3 text-xs text-foreground"
              >
                {(overview.growthStages || Object.keys(STAGE_LABELS)).map((st: string) => (
                  <option key={st} value={st}>
                    {STAGE_LABELS[st] || st}
                  </option>
                ))}
              </select>
            </div>

            <div className="md:col-span-2 space-y-1.5">
              <label className="text-xs font-medium text-foreground" htmlFor="phase3-planting-date">
                Planting Date
              </label>
              <Input
                id="phase3-planting-date"
                type="date"
                value={plantingDate}
                disabled={!canManage}
                onChange={(e) => setPlantingDate(e.target.value)}
                className="h-10 text-xs bg-background"
              />
            </div>

            <div className="md:col-span-2">
              <Button
                type="button"
                disabled={!canManage || busyAction === 'save-stage'}
                onClick={handleSaveCropStage}
                className="w-full h-10 bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold cursor-pointer"
              >
                {busyAction === 'save-stage' ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  'Save Crop & Stage'
                )}
              </Button>
            </div>
          </div>

          {/* Agronomic Provenance & Stage Requirements */}
          <div className="space-y-4 pb-6 border-b border-border">
            <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-foreground">
                  Environmental &amp; Root-Zone Requirements —{' '}
                  {STAGE_LABELS[stageStd.stageName] || stageStd.stageName}
                </h3>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground mt-1">
                  <span
                    className={cn(
                      'font-medium',
                      profile.validationStatus === 'verified'
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : 'text-amber-700 dark:text-amber-400'
                    )}
                  >
                    {profile.validationStatus === 'verified'
                      ? 'Verified Agronomic Reference'
                      : 'Provisional Polyhouse Adaptation'}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>{stageStd.sourceOrganization || 'FAO / NIHORT'}</span>
                  {profile.evidenceReferences?.[0]?.title && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>{profile.evidenceReferences[0].title}</span>
                    </>
                  )}
                  <span aria-hidden="true">·</span>
                  <span className="font-mono tabular-nums">
                    Published {stageStd.publicationDate || profile.evidenceReferences?.[0]?.publicationDate || '2021'}
                  </span>
                </div>
              </div>

              {canManage && (
                <button
                  type="button"
                  onClick={() => setShowProposeForm((prev) => !prev)}
                  className="text-xs font-semibold text-primary hover:underline underline-offset-4 cursor-pointer shrink-0"
                >
                  {showProposeForm ? 'Hide Threshold Proposal' : 'Propose Threshold Update'}
                </button>
              )}
            </div>

            {/* Clean Unboxed Agronomic Requirements Table */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-4 pt-2 text-xs">
              <div>
                <span className="text-muted-foreground">Air Temperature</span>
                <p className="text-sm font-semibold font-mono tabular-nums text-foreground mt-0.5">
                  {stageStd.tempMinC}–{stageStd.tempMaxC} °C
                </p>
                <span className="text-[11px] text-muted-foreground font-mono tabular-nums">
                  Optimal {stageStd.tempOptimalC} °C
                </span>
              </div>

              <div>
                <span className="text-muted-foreground">Relative Humidity</span>
                <p className="text-sm font-semibold font-mono tabular-nums text-foreground mt-0.5">
                  {stageStd.humidityMinPct}–{stageStd.humidityMaxPct}%
                </p>
                <span className="text-[11px] text-muted-foreground font-mono tabular-nums">
                  VPD {stageStd.vpdMinKpa}–{stageStd.vpdMaxKpa} kPa
                </span>
              </div>

              <div>
                <span className="text-muted-foreground">Soil Moisture</span>
                <p className="text-sm font-semibold font-mono tabular-nums text-foreground mt-0.5">
                  {stageStd.soilMoistureMinPct}–{stageStd.soilMoistureMaxPct}%
                </p>
                <span className="text-[11px] text-muted-foreground font-mono tabular-nums">
                  Expected stage: {stageStd.expectedDurationDays} days
                </span>
              </div>

              <div>
                <span className="text-muted-foreground">Root-Zone pH &amp; EC</span>
                <p className="text-sm font-semibold font-mono tabular-nums text-foreground mt-0.5">
                  pH {stageStd.phMin}–{stageStd.phMax}
                </p>
                <span className="text-[11px] text-muted-foreground font-mono tabular-nums">
                  EC {stageStd.ecMinMs}–{stageStd.ecMaxMs} dS/m
                </span>
              </div>

              <div>
                <span className="text-muted-foreground">Light &amp; Photoperiod</span>
                <p className="text-sm font-semibold font-mono tabular-nums text-foreground mt-0.5">
                  DLI {stageStd.lightDliMin}–{stageStd.lightDliMax} mol/m²/d
                </p>
                <span className="text-[11px] text-muted-foreground font-mono tabular-nums">
                  {stageStd.lightHoursMin}–{stageStd.lightHoursMax} hrs/day target
                </span>
              </div>

              <div className="col-span-2 sm:col-span-3">
                <span className="text-muted-foreground">Irrigation &amp; Nutrient Guidance</span>
                <p className="text-xs text-foreground leading-relaxed mt-0.5">
                  {stageStd.irrigationNotes}
                </p>
                <p className="text-[11px] text-muted-foreground mt-1 font-mono tabular-nums">
                  NPK Profile ({stageStd.nutrientRequirements?.npkRatio || 'Balanced'}): N{' '}
                  {stageStd.nutrientRequirements?.nitrogenPpm?.join('–')} ppm · P{' '}
                  {stageStd.nutrientRequirements?.phosphorusPpm?.join('–')} ppm · K{' '}
                  {stageStd.nutrientRequirements?.potassiumPpm?.join('–')} ppm · Ca{' '}
                  {stageStd.nutrientRequirements?.calciumPpm?.join('–')} ppm —{' '}
                  {stageStd.nutrientRequirements?.guidance}
                </p>
              </div>
            </div>

            {Array.isArray(stageStd.stressIndicators) && stageStd.stressIndicators.length > 0 && (
              <div className="pt-1 text-xs">
                <span className="font-medium text-foreground">Stage Stress &amp; Disease Watch: </span>
                <span className="text-muted-foreground">
                  {stageStd.stressIndicators.join(' · ')}
                </span>
              </div>
            )}

            {profile.riskProfile?.validationNote && (
              <p className="text-[11px] text-muted-foreground">{profile.riskProfile.validationNote}</p>
            )}

            {/* Propose Versioned Threshold Change Form */}
            {showProposeForm && canManage && (
              <div className="rounded-xl bg-muted/40 p-4 space-y-3 text-xs">
                <p className="font-semibold text-foreground">
                  Propose Custom Threshold Version (Requires Explicit Farmer Approval to Activate)
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  <div>
                    <label className="text-[11px] text-muted-foreground">Min Temp (°C)</label>
                    <Input
                      type="number"
                      step="0.5"
                      value={propTempMin}
                      onChange={(e) => setPropTempMin(e.target.value)}
                      className="h-8 text-xs bg-background mt-1"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-muted-foreground">Max Temp (°C)</label>
                    <Input
                      type="number"
                      step="0.5"
                      value={propTempMax}
                      onChange={(e) => setPropTempMax(e.target.value)}
                      className="h-8 text-xs bg-background mt-1"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-muted-foreground">Min Soil Moisture (%)</label>
                    <Input
                      type="number"
                      step="1"
                      value={propSoilMin}
                      onChange={(e) => setPropSoilMin(e.target.value)}
                      className="h-8 text-xs bg-background mt-1"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-muted-foreground">Max Soil Moisture (%)</label>
                    <Input
                      type="number"
                      step="1"
                      value={propSoilMax}
                      onChange={(e) => setPropSoilMax(e.target.value)}
                      className="h-8 text-xs bg-background mt-1"
                    />
                  </div>
                </div>
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                  <Input
                    value={propNote}
                    onChange={(e) => setPropNote(e.target.value)}
                    placeholder="Reason for threshold change (e.g., dry Harmattan afternoon adjustment)"
                    className="h-9 text-xs bg-background flex-1"
                  />
                  <Button
                    type="button"
                    size="sm"
                    disabled={busyAction === 'propose-std'}
                    onClick={handleProposeThresholds}
                    className="h-9 px-4 bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold cursor-pointer"
                  >
                    Submit Proposal
                  </Button>
                </div>
              </div>
            )}

            {/* Pending Proposed Versions & Active Version Override */}
            {(pendingProposals.length > 0 || activeStdOverride) && (
              <div className="space-y-2.5 pt-2">
                {activeStdOverride && (
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs py-2 border-t border-border">
                    <div className="text-muted-foreground">
                      <strong className="text-foreground">
                        Active Approved Custom Standard v{activeStdOverride.versionNumber}
                      </strong>{' '}
                      · Proposed by {activeStdOverride.proposedBy} ·{' '}
                      <span className="font-mono tabular-nums">
                        {JSON.stringify(activeStdOverride.thresholds)}
                      </span>
                    </div>
                  </div>
                )}

                {pendingProposals.map((pv: any) => (
                  <div
                    key={pv.id}
                    className="rounded-xl bg-muted/40 p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                  >
                    <div className="space-y-0.5">
                      <p className="font-semibold text-foreground">
                        Pending Threshold Proposal v{pv.versionNumber} (Not Yet Active)
                      </p>
                      <p className="text-muted-foreground font-mono tabular-nums">
                        Proposed by {pv.proposedBy} · {JSON.stringify(pv.thresholds)}
                      </p>
                    </div>
                    {canManage && (
                      <div className="flex items-center gap-2 shrink-0">
                        <Button
                          type="button"
                          size="sm"
                          disabled={busyAction === `std-${pv.id}-approve`}
                          onClick={() => handleReviewStandard(pv.id, 'approve')}
                          className="h-8 px-3 bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold cursor-pointer"
                        >
                          Approve Standard
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={busyAction === `std-${pv.id}-reject`}
                          onClick={() => handleReviewStandard(pv.id, 'reject')}
                          className="h-8 px-3 text-xs font-semibold cursor-pointer"
                        >
                          Reject Proposal
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Live Condition Gap Analysis */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <h3 className="text-sm font-semibold text-foreground">
                  Environmental Condition Gap Analysis
                </h3>
                <span className="text-muted-foreground" aria-hidden="true">
                  ·
                </span>
                <span className="font-mono tabular-nums text-muted-foreground">
                  Source: {telEval.dataSource || 'DISCONNECTED'}
                </span>
                {telEval.computedVpdKpa !== null && telEval.computedVpdKpa !== undefined && (
                  <>
                    <span className="text-muted-foreground" aria-hidden="true">
                      ·
                    </span>
                    <span className="font-mono tabular-nums text-foreground font-medium">
                      Computed VPD: {telEval.computedVpdKpa} kPa
                    </span>
                  </>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setShowSandbox((prev) => !prev)}
                  className="h-8 px-3 text-xs font-semibold cursor-pointer"
                >
                  {showSandbox ? 'Hide Simulation Sandbox' : 'Test in Simulation Sandbox'}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={busyAction === 'eval-live'}
                  onClick={() => handleEvaluateRecommendations(false)}
                  className="h-8 px-3.5 bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold cursor-pointer"
                >
                  {busyAction === 'eval-live' ? (
                    <Loader2 size={13} className="animate-spin mr-1.5" />
                  ) : null}
                  Evaluate Live Conditions
                </Button>
              </div>
            </div>

            {showSandbox && (
              <div className="rounded-xl bg-muted/40 p-4 space-y-3 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold text-foreground">
                    Labeled Simulation Sandbox — Explicitly Tagged SIMULATED (Never Stored as Hardware Data)
                  </p>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
                  <div>
                    <label className="text-[11px] text-muted-foreground">Air Temp (°C)</label>
                    <Input
                      type="number"
                      step="0.5"
                      value={simTemp}
                      onChange={(e) => setSimTemp(Number(e.target.value))}
                      className="h-8 text-xs bg-background mt-1"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-muted-foreground">Humidity (%)</label>
                    <Input
                      type="number"
                      step="1"
                      value={simHum}
                      onChange={(e) => setSimHum(Number(e.target.value))}
                      className="h-8 text-xs bg-background mt-1"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-muted-foreground">Soil Moisture (%)</label>
                    <Input
                      type="number"
                      step="1"
                      value={simSoil}
                      onChange={(e) => setSimSoil(Number(e.target.value))}
                      className="h-8 text-xs bg-background mt-1"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-muted-foreground">Water Tank (%)</label>
                    <Input
                      type="number"
                      step="1"
                      value={simWater}
                      onChange={(e) => setSimWater(Number(e.target.value))}
                      className="h-8 text-xs bg-background mt-1"
                    />
                  </div>
                  <div className="flex flex-col justify-end">
                    <label className="inline-flex items-center gap-2 h-8 text-xs text-foreground cursor-pointer">
                      <input
                        type="checkbox"
                        checked={simRain}
                        onChange={(e) => setSimRain(e.target.checked)}
                      />
                      <span>Rain Active</span>
                    </label>
                  </div>
                </div>
                <Button
                  type="button"
                  size="sm"
                  disabled={busyAction === 'eval-sim'}
                  onClick={() => handleEvaluateRecommendations(true)}
                  className="h-8 px-3.5 bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold cursor-pointer"
                >
                  Run Labeled Simulation Check
                </Button>
              </div>
            )}

            <div className="divide-y divide-border border-t border-border">
              {(telEval.conditionChecks || []).map((chk: any) => (
                <div
                  key={chk.metric}
                  className="py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 text-xs"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-foreground">
                      {chk.label || String(chk.metric).replace(/_/g, ' ')}
                    </span>
                    <span className="text-muted-foreground" aria-hidden="true">
                      ·
                    </span>
                    <span className="font-mono tabular-nums text-muted-foreground">
                      Target {chk.targetMin}–{chk.targetMax}
                      {chk.unit}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="font-mono tabular-nums font-semibold text-foreground">
                      {chk.observed !== null && chk.observed !== undefined
                        ? `${chk.observed}${chk.unit}`
                        : 'Unavailable'}
                    </span>
                    <span
                      className={cn(
                        'font-medium',
                        chk.status === 'within_target'
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : chk.status === 'unavailable'
                            ? 'text-muted-foreground'
                            : 'text-amber-700 dark:text-amber-400'
                      )}
                    >
                      {chk.status === 'within_target'
                        ? 'Within Target'
                        : chk.status === 'below_target'
                          ? 'Below Minimum'
                          : chk.status === 'above_target'
                            ? 'Above Maximum'
                            : 'Awaiting Sensor'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* TAB 2: 8-POINT EXPLAINABLE AI RECOMMENDATIONS & FARMER DECISIONS    */}
      {/* =================================================================== */}
      {activeTab === 'recommendations' && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-border">
            <div className="text-xs text-muted-foreground">
              Every recommendation answers 8 agronomic &amp; safety questions before requesting your authorization.
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  setActiveTab('standards');
                  setShowSandbox(true);
                }}
                className="h-8 px-3 text-xs font-semibold cursor-pointer"
              >
                Open Simulation Sandbox
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={busyAction === 'eval-live'}
                onClick={() => handleEvaluateRecommendations(false)}
                className="h-8 px-3.5 bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold cursor-pointer"
              >
                Evaluate Live Conditions
              </Button>
            </div>
          </div>

          {persistedRecs.length === 0 ? (
            <div className="py-8 text-center space-y-2 text-xs text-muted-foreground">
              <p className="text-sm font-semibold text-foreground">
                No Recorded Recommendations Yet
              </p>
              <p className="max-w-md mx-auto">
                Click &ldquo;Evaluate Live Conditions&rdquo; when your ESP32 controller reports readings, or run a clearly labeled Simulation Sandbox check on Tab 01 to inspect the 8-point recommendation workflow.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {persistedRecs.map((rec: any) => {
                const exp = rec.explanation || {};
                const act = rec.proposedAction || {};
                const defaultDur = Number(act.durationSeconds || 30);
                const modVal = modifyDurationMap[rec.id] ?? defaultDur;
                const isPending = rec.status === 'pending';

                return (
                  <div key={rec.id} className="py-5 first:pt-1 space-y-4">
                    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <span className="font-semibold text-foreground">{rec.agentName}</span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono tabular-nums">Source: {rec.dataSource}</span>
                          <span aria-hidden="true">·</span>
                          <span>
                            {rec.cropCode} ({rec.cropVariety}) — {rec.growthStage}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono tabular-nums">
                            Confidence {Math.round(Number(rec.confidenceScore || 0) * 100)}%
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="capitalize">Risk: {rec.riskLevel}</span>
                        </div>
                        <h3 className="text-sm sm:text-base font-semibold text-foreground">
                          {rec.observationSummary}
                        </h3>
                      </div>

                      <span className="text-xs font-mono tabular-nums font-medium text-muted-foreground shrink-0">
                        Status: {rec.status.toUpperCase()} · {rec.executionMode}
                      </span>
                    </div>

                    {/* All 8 Structured Explanation Points */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3 text-xs pt-1">
                      <div>
                        <p className="font-semibold text-foreground">1. What is happening</p>
                        <p className="text-muted-foreground leading-relaxed mt-0.5">
                          {exp.whatIsHappening || rec.observationSummary}
                        </p>
                      </div>
                      <div>
                        <p className="font-semibold text-foreground">
                          2. Sensor, crop &amp; stage evidence
                        </p>
                        <p className="text-muted-foreground leading-relaxed mt-0.5">
                          {exp.supportingEvidence || JSON.stringify(rec.evidence)}
                        </p>
                      </div>
                      <div>
                        <p className="font-semibold text-foreground">3. Recommended action</p>
                        <p className="text-muted-foreground leading-relaxed mt-0.5">
                          {exp.recommendedAction ||
                            `${act.commandType} on ${act.targetEquipment} for ${defaultDur}s`}
                        </p>
                      </div>
                      <div>
                        <p className="font-semibold text-foreground">4. Why it is recommended</p>
                        <p className="text-muted-foreground leading-relaxed mt-0.5">
                          {exp.whyRecommended || 'Maintains stage target band.'}
                        </p>
                      </div>
                      <div>
                        <p className="font-semibold text-foreground">
                          5. If no action is taken
                        </p>
                        <p className="text-muted-foreground leading-relaxed mt-0.5">
                          {exp.consequenceOfInaction || 'Crop stress may increase.'}
                        </p>
                      </div>
                      <div>
                        <p className="font-semibold text-foreground">6. Possible risks</p>
                        <p className="text-muted-foreground leading-relaxed mt-0.5">
                          {exp.possibleRisks || 'Bounded by Two-Tier safety interlocks.'}
                        </p>
                      </div>
                      <div>
                        <p className="font-semibold text-foreground">7. System confidence</p>
                        <p className="text-muted-foreground leading-relaxed mt-0.5">
                          {exp.systemConfidence ||
                            `${Math.round(Number(rec.confidenceScore || 0) * 100)}%`}
                        </p>
                      </div>
                      <div>
                        <p className="font-semibold text-foreground">8. Verification plan</p>
                        <p className="text-muted-foreground leading-relaxed mt-0.5">
                          {exp.verificationPlan ||
                            'Re-check greenhouse sensors after post-action window.'}
                        </p>
                      </div>
                    </div>

                    {/* Farmer Authorization Controls (Approve / Modify / Reject) */}
                    {isPending && canManage && (
                      <div className="rounded-xl bg-muted/40 p-3.5 flex flex-col lg:flex-row lg:items-center justify-between gap-3 text-xs">
                        <div className="flex flex-wrap items-center gap-2 flex-1">
                          <label className="text-muted-foreground whitespace-nowrap">
                            Duration (s):
                          </label>
                          <Input
                            type="number"
                            min={0}
                            max={600}
                            value={modVal}
                            onChange={(e) =>
                              setModifyDurationMap((prev) => ({
                                ...prev,
                                [rec.id]: Number(e.target.value)
                              }))
                            }
                            className="h-8 w-24 text-xs bg-background font-mono tabular-nums"
                          />
                          <Input
                            value={decisionNoteMap[rec.id] || ''}
                            onChange={(e) =>
                              setDecisionNoteMap((prev) => ({
                                ...prev,
                                [rec.id]: e.target.value
                              }))
                            }
                            placeholder="Optional farmer note or rejection reason"
                            className="h-8 text-xs bg-background flex-1 min-w-44"
                          />
                        </div>

                        <div className="flex flex-wrap items-center gap-2 shrink-0">
                          <Button
                            type="button"
                            size="sm"
                            disabled={Boolean(busyAction)}
                            onClick={() => handleDecision(rec.id, 'approve', defaultDur)}
                            className="h-8 px-3 bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold cursor-pointer"
                          >
                            <Check size={13} className="mr-1" />
                            Approve Simulation
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={Boolean(busyAction)}
                            onClick={() => handleDecision(rec.id, 'modify', defaultDur)}
                            className="h-8 px-3 text-xs font-semibold cursor-pointer"
                          >
                            Modify &amp; Approve
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={Boolean(busyAction)}
                            onClick={() => handleDecision(rec.id, 'reject', defaultDur)}
                            className="h-8 px-3 text-xs font-semibold cursor-pointer"
                          >
                            Reject
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* =================================================================== */}
      {/* TAB 3: 3-MODE AUTHORIZATION & TWO-TIER SAFETY ENVELOPE              */}
      {/* =================================================================== */}
      {activeTab === 'authorization' && (
        <div className="space-y-6">
          {/* Authorization Mode Selection */}
          <div className="space-y-3 pb-6 border-b border-border">
            <h3 className="text-sm font-semibold text-foreground">
              Farmer Authorization Mode (Modes 1–3)
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {Object.entries(MODE_DESCRIPTIONS).map(([modeKey, info]) => {
                const selected = authModeInput === modeKey;
                return (
                  <button
                    key={modeKey}
                    type="button"
                    disabled={!canManage}
                    onClick={() => setAuthModeInput(modeKey)}
                    className={cn(
                      'rounded-xl border p-4 text-left space-y-1.5 transition-colors cursor-pointer',
                      selected
                        ? 'border-primary bg-accent/50'
                        : 'border-border bg-background hover:bg-muted/30'
                    )}
                  >
                    <p className="text-xs font-semibold text-foreground">{info.title}</p>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      {info.summary}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Two-Tier Safety Envelope Comparison & Configuration */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 pb-6 border-b border-border">
            {/* Tier 1 Immutable Hardware Ceilings */}
            <div className="lg:col-span-5 space-y-3 text-xs">
              <div className="flex items-center gap-1.5 font-semibold text-foreground">
                <ShieldCheck size={15} className="text-primary" />
                <h4>Tier 1 — Immutable Hardware Protection Ceilings</h4>
              </div>
              <p className="text-muted-foreground leading-relaxed">
                Enforced on both the backend and ESP32 controller firmware. Farmer policies can be stricter than Tier 1, never looser.
              </p>
              <div className="divide-y divide-border border-t border-border font-mono tabular-nums">
                <div className="py-2 flex justify-between">
                  <span className="font-sans text-muted-foreground">Max Single Pump Pulse</span>
                  <span className="font-semibold text-foreground">
                    &le; {tier1.absoluteMaxIrrigationPulseSeconds ?? 120} s
                  </span>
                </div>
                <div className="py-2 flex justify-between">
                  <span className="font-sans text-muted-foreground">Water Tank Dry-Run Floor</span>
                  <span className="font-semibold text-foreground">
                    &ge; {tier1.absoluteMinWaterLevelPct ?? 10}%
                  </span>
                </div>
                <div className="py-2 flex justify-between">
                  <span className="font-sans text-muted-foreground">Heater Thermal Cutoff</span>
                  <span className="font-semibold text-foreground">
                    &le; {tier1.absoluteMaxHeaterTempC ?? 32} °C
                  </span>
                </div>
                <div className="py-2 flex justify-between">
                  <span className="font-sans text-muted-foreground">Sensor Freshness Lock</span>
                  <span className="font-semibold text-foreground">
                    &le; {tier1.staleTelemetryLockSeconds ?? 45} s
                  </span>
                </div>
                <div className="py-2 flex justify-between">
                  <span className="font-sans text-muted-foreground">Rain Roof Vent Lock</span>
                  <span className="font-semibold text-foreground">Always Locked Closed</span>
                </div>
                <div className="py-2 flex justify-between">
                  <span className="font-sans text-muted-foreground">24h Pump Runtime Used</span>
                  <span className="font-semibold text-foreground">
                    {overview.safetyStatus?.cumulativePumpSecondsLast24h ?? 0} s / 900 s
                  </span>
                </div>
              </div>
            </div>

            {/* Tier 2 Farmer-Configurable Policy Limits */}
            <div className="lg:col-span-7 space-y-3 text-xs">
              <h4 className="font-semibold text-foreground">
                Tier 2 — Your Stricter Farm Policy Defaults
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] text-muted-foreground">
                    Max Pump Pulse (s, Tier 1 max 120s)
                  </label>
                  <Input
                    type="number"
                    value={t2MaxPulse}
                    disabled={!canManage}
                    onChange={(e) => setT2MaxPulse(Number(e.target.value))}
                    className="h-9 text-xs bg-background mt-1 font-mono tabular-nums"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-muted-foreground">
                    Min Water Tank Lock (%, Tier 1 min 10%)
                  </label>
                  <Input
                    type="number"
                    value={t2MinWater}
                    disabled={!canManage}
                    onChange={(e) => setT2MinWater(Number(e.target.value))}
                    className="h-9 text-xs bg-background mt-1 font-mono tabular-nums"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-muted-foreground">
                    Heater Lock Temp (°C, Tier 1 max 32°C)
                  </label>
                  <Input
                    type="number"
                    value={t2MaxHeater}
                    disabled={!canManage}
                    onChange={(e) => setT2MaxHeater(Number(e.target.value))}
                    className="h-9 text-xs bg-background mt-1 font-mono tabular-nums"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-muted-foreground">
                    Pump Cooldown Between Pulses (s, min 300s)
                  </label>
                  <Input
                    type="number"
                    value={t2Cooldown}
                    disabled={!canManage}
                    onChange={(e) => setT2Cooldown(Number(e.target.value))}
                    className="h-9 text-xs bg-background mt-1 font-mono tabular-nums"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-muted-foreground">
                    Max 24h Cumulative Pump Runtime (s, max 900s)
                  </label>
                  <Input
                    type="number"
                    value={t2DailyMax}
                    disabled={!canManage}
                    onChange={(e) => setT2DailyMax(Number(e.target.value))}
                    className="h-9 text-xs bg-background mt-1 font-mono tabular-nums"
                  />
                </div>
              </div>
              {canManage && (
                <div className="pt-1">
                  <Button
                    type="button"
                    disabled={busyAction === 'save-mode'}
                    onClick={handleSaveAuthorizationMode}
                    className="h-9 px-4 bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold cursor-pointer"
                  >
                    Save Authorization Mode &amp; Safety Limits
                  </Button>
                </div>
              )}
            </div>
          </div>

          {/* Bounded Equipment Automation Rules (Modes 2 & 3) */}
          <div className="space-y-4 text-xs">
            <h3 className="text-sm font-semibold text-foreground">
              Permitted Equipment &amp; Operating-Hour Rules ({activePolicies.length} Active)
            </h3>

            {canManage && (
              <div className="grid grid-cols-2 sm:grid-cols-6 gap-2.5 items-end rounded-xl bg-muted/40 p-3.5">
                <div>
                  <label className="text-[11px] text-muted-foreground">Equipment</label>
                  <select
                    value={polEquipment}
                    onChange={(e) => setPolEquipment(e.target.value)}
                    className="w-full h-8 rounded-md border border-border bg-background px-2 text-xs mt-1"
                  >
                    <option value="pump">Water Pump</option>
                    <option value="fan">Air Fan</option>
                    <option value="roof">Roof Vent</option>
                    <option value="heater">Heater</option>
                    <option value="mister">Mister</option>
                    <option value="light">Grow Lights</option>
                  </select>
                </div>
                <div>
                  <label className="text-[11px] text-muted-foreground">Rule Mode</label>
                  <select
                    value={polMode}
                    onChange={(e) => setPolMode(e.target.value)}
                    className="w-full h-8 rounded-md border border-border bg-background px-2 text-xs mt-1"
                  >
                    <option value="mode_2_limited">Mode 2</option>
                    <option value="mode_3_advanced">Mode 3</option>
                  </select>
                </div>
                <div>
                  <label className="text-[11px] text-muted-foreground">Max Pulse (s)</label>
                  <Input
                    type="number"
                    value={polMaxDuration}
                    onChange={(e) => setPolMaxDuration(Number(e.target.value))}
                    className="h-8 text-xs bg-background mt-1 font-mono tabular-nums"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-muted-foreground">Start Hr (UTC)</label>
                  <Input
                    type="number"
                    min={0}
                    max={23}
                    value={polStartHour}
                    onChange={(e) => setPolStartHour(Number(e.target.value))}
                    className="h-8 text-xs bg-background mt-1 font-mono tabular-nums"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-muted-foreground">End Hr (UTC)</label>
                  <Input
                    type="number"
                    min={0}
                    max={23}
                    value={polEndHour}
                    onChange={(e) => setPolEndHour(Number(e.target.value))}
                    className="h-8 text-xs bg-background mt-1 font-mono tabular-nums"
                  />
                </div>
                <Button
                  type="button"
                  size="sm"
                  disabled={busyAction === 'create-policy'}
                  onClick={handleCreatePolicy}
                  className="h-8 px-3 bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold cursor-pointer"
                >
                  Create Rule
                </Button>
              </div>
            )}

            {activePolicies.length === 0 ? (
              <p className="text-muted-foreground">
                No bounded automation rules active. All actions require individual approval.
              </p>
            ) : (
              <div className="divide-y divide-border border-t border-border">
                {activePolicies.map((pol: any) => (
                  <div
                    key={pol.id}
                    className="py-2.5 flex flex-wrap items-center justify-between gap-2"
                  >
                    <div className="flex flex-wrap items-center gap-2 text-muted-foreground">
                      <span className="font-semibold text-foreground capitalize">
                        {pol.equipmentKey}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>{pol.mode}</span>
                      <span aria-hidden="true">·</span>
                      <span>Crop: {pol.cropType}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">
                        Max {pol.maxDurationSeconds}s · Cooldown {pol.cooldownSeconds}s · Daily{' '}
                        {pol.maxDailyCumulativeSeconds}s
                      </span>
                      {pol.operatingConditions?.startHourUtc !== undefined && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono tabular-nums">
                            Hours {pol.operatingConditions.startHourUtc}:00–
                            {pol.operatingConditions.endHourUtc}:00 UTC
                          </span>
                        </>
                      )}
                    </div>
                    {canManage && (
                      <button
                        type="button"
                        onClick={() => handleRevokePolicy(pol.id)}
                        className="text-red-700 dark:text-red-400 font-semibold hover:underline cursor-pointer"
                      >
                        Revoke
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* TAB 4: DECISION HISTORY & CLOSED-LOOP OUTCOME VERIFICATION          */}
      {/* =================================================================== */}
      {activeTab === 'history' && (
        <div className="space-y-6 text-xs">
          <div className="rounded-xl bg-muted/40 p-4 space-y-1.5">
            <p className="font-semibold text-foreground">
              Closed-Loop Verification Pipeline (Simulation Execution Adapter)
            </p>
            <p className="font-mono text-[11px] text-muted-foreground">
              {(overview.workflowStages || []).join(' → ')}
            </p>
            <p className="text-muted-foreground">
              Phase 3 hardware safety lock is active: every approved action is modeled, acknowledged, and verified in simulation with 0 physical actuator commands dispatched.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Outcome Verifications */}
            <div className="space-y-2.5">
              <h3 className="text-sm font-semibold text-foreground">
                Verified Action Outcomes ({(overview.verifications || []).length})
              </h3>
              {(overview.verifications || []).length === 0 ? (
                <p className="text-muted-foreground">
                  No verified outcomes yet. Approve a recommendation to run the full closed-loop simulation.
                </p>
              ) : (
                <div className="divide-y divide-border border-t border-border">
                  {(overview.verifications || []).map((v: any) => (
                    <div key={v.id} className="py-3 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-foreground">
                          Outcome: {v.outcomeStatus}
                        </span>
                        <span className="font-mono tabular-nums text-muted-foreground">
                          Effectiveness{' '}
                          {v.effectivenessScore !== null
                            ? `${Math.round(v.effectivenessScore * 100)}%`
                            : 'N/A'}{' '}
                          · {new Date(v.createdAt).toLocaleTimeString()}
                        </span>
                      </div>
                      <p className="font-mono tabular-nums text-[11px] text-muted-foreground">
                        Delta: {JSON.stringify(v.actualDelta)}
                      </p>
                      {v.notes && <p className="text-muted-foreground leading-relaxed">{v.notes}</p>}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Farmer Decision History */}
            <div className="space-y-2.5">
              <h3 className="text-sm font-semibold text-foreground">
                Farmer Decision Log ({(overview.decisions || []).length})
              </h3>
              {(overview.decisions || []).length === 0 ? (
                <p className="text-muted-foreground">No farmer authorization decisions logged yet.</p>
              ) : (
                <div className="divide-y divide-border border-t border-border">
                  {(overview.decisions || []).map((d: any) => (
                    <div key={d.id} className="py-3 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-foreground uppercase">
                          {d.decision}
                        </span>
                        <span className="font-mono tabular-nums text-muted-foreground">
                          {new Date(d.createdAt).toLocaleString()}
                        </span>
                      </div>
                      {d.rationale && <p className="text-muted-foreground">{d.rationale}</p>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
