'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { CandidatePlan, ChangePlan, NetworkProject, PlanChange, PlanEvidenceStamp, PlanRevisionStamp, ScenarioPatch } from '@infratwin/model';
import { acceptAllCandidateChanges, acceptCandidateChange, addPlanChange, changePlanHash, changePlanEvidenceStamp, changePlanRevisionStamp, cloneProject, compileChangePlanToScenarioPatch, createChangePlan, discardCandidateProposals, isPlanEvidenceFresh, isPlanRevisionFresh, modelHash, rejectCandidateChange, removePlanChange, renameChangePlan, setCandidateProposals, setChangePlanStatus, setPlanConstraint, setPlanLinkLocked, setPlanNodeLocked } from '@infratwin/model';
import { analyzeBottleneck, analyzeChangePlan, compareCandidate, detectComputeCapabilities, proposeCapacityMitigation, runLinkContingenciesAsync, runScenarioCapacityAnalysis, type BottleneckAnalysis, type CandidateComparison, type ChangePlanAnalysis, type ComputeCapabilities, type ContingencyAnalysis, type ContingencyProgress, type ContingencyRunOptions, type ContingencyWorkerLike, type EvidenceRef, type CapacityAnalysis } from '@infratwin/evidence';
import { getScenarioDefinition, listBundledScenarios, loadScenario, type BundledScenarioId, type ScenarioDefinition } from '@infratwin/scenarios';
import { estimateCapacityMILP, estimateTrafficAllocationLP } from '@infratwin/optimizer';
import type { CapacityOptimizationResult, CapacityPlanRequirements, CandidateVerification, TrafficAllocationResult } from '@infratwin/optimizer';
import { CollaborativeWorkspaceService, type PublishedVerification, type WorkspaceActivityEvent, type WorkspaceSelection } from '../../../packages/application/src/index.ts';
import { optimizeCapacityInBrowser, optimizeRoutingInBrowser, probeBrowserOptimizer, verifyCandidateInBrowser } from '../lib/optimizer-client';
import { analyzeChangePlanInBrowserWorker } from '../lib/analysis-client';
import { analysisExecutionProfile, createAnalysisAuthorityToken, isAnalysisAuthorityTokenCurrent, n1ExecutionPolicy, N1_ENGINE_HARD_CAP, type CapacityExecutionMode } from '../lib/analysis-execution';
import { APP_DESTINATIONS, ANALYSIS_TABS, semanticStateFingerprint, type AppDestination, type AnalysisTab } from '../lib/application-shell';
import { ChangePlanPanel } from './change-plan-panel';
import { PlanHistory } from './plan-history';
import { UpgradeProfileEditor } from './upgrade-profile-editor';
import { ScenarioSelector } from './scenario-selector';
import { TopologyCanvas } from './topology-canvas';
import { ImportNetworkDialog } from './import-network-dialog';
import { applyUpgradeProfile } from '../lib/upgrade-catalog';
import { registerCollaborativeTools, type ModelContextLike, type ToolActivityEvent, type WebMCPRegistration } from '@infratwin/webmcp';

function pct(value: number): string { return `${Math.round(value * 10) / 10}%`; }
function gbps(value: number): string { return `${Math.round(value * 100) / 100} Gbps`; }
function shortHash(value: string): string { return value.includes(':') ? value.split(':')[1].slice(0, 8) : value.slice(0, 8); }
function clonePlan(plan: ChangePlan): ChangePlan { return JSON.parse(JSON.stringify(plan)) as ChangePlan; }
function allRouteLinks(route: CapacityAnalysis['routing']['routes'][number] | undefined): string[] { return route ? Object.keys(route.linkFractions).filter((linkId) => route.linkFractions[linkId] > 0).sort() : []; }
function createBrowserWorker(): ContingencyWorkerLike { return new Worker(new URL('../workers/contingency.worker.ts', import.meta.url), { type: 'module' }) as unknown as ContingencyWorkerLike; }
function pendingCapacityAnalysis(project: NetworkProject): CapacityAnalysis { const linkLoadsGbps = Object.fromEntries(project.links.map((link) => [link.id, 0])) as Record<string, number>; const linkUtilizationPct = Object.fromEntries(project.links.map((link) => [link.id, 0])) as Record<string, number>; return { snapshot: project, routing: { mode: project.routingProfile.mode, routes: [], linkLoadsGbps, linkUtilizationPct, peakUtilizationPct: 0, unroutedDemandIds: [] }, result: { id: `pending:${project.id}`, type: 'capacity', verdict: 'CANCELLED', modelHash: '', scenarioHash: 'pending', solver: { id: 'not-run', version: '3.5c' }, assumptions: [], metrics: { pending: true }, violations: [], witnesses: [], runtimeMs: 0 } }; }
const VIOLATION_RENDER_BATCH_SIZE = 200;
const networkTemplates = listBundledScenarios();
type SelectedScenarioId = BundledScenarioId | 'imported';
const initialCompute: ComputeCapabilities = { workerSupported: false, hardwareConcurrency: 1, recommendedWorkerCount: 1, sharedArrayBufferSupported: false, crossOriginIsolated: false, executionMode: 'async-fallback' };
const initialProject = loadScenario('continental-service-network');

export function useWorkbenchStage5(scope: any) {
  const { project, plan, publishedPlanAnalysis, analysisFresh, analysis, progress, compiledPlanPatch, selectedCanonicalLink, snapshot, selectedCanonicalDemand, routeByDemand, settingsLinkId, optimizerStatus, designState } = scope;
  const canRunResilience = project.links.some((link: any) => link.available !== false);
  const optimizerReady = optimizerStatus === 'ready' || optimizerStatus === 'running';
  const authority: 'DRAFT' | 'PASS' | 'FAIL' | 'STALE' = publishedPlanAnalysis ? (analysisFresh ? publishedPlanAnalysis.verdict : 'STALE') : 'DRAFT';
  const peak = analysis.routing.peakUtilizationPct;
  const primaryFailure = analysis.result.violations[0]?.linkId ?? analysis.result.violations[0]?.demandId ?? null;
  const progressLabel = progress ? `${progress.completed}/${progress.total} · ${pct(progress.percentage)}` : 'idle';
  const regionCount = new Set(project.nodes.map((node: any) => node.region).filter(Boolean)).size;
  const n1Policy = useMemo(() => n1ExecutionPolicy(project), [project]);
  const eligibleN1 = n1Policy.eligibleScenarios;
  const routingLpEstimate = useMemo(() => estimateTrafficAllocationLP(project), [project]);
  const capacityMilpEstimate = useMemo(() => estimateCapacityMILP(project, { includeBaseline: true, targetUtilizationPct: plan.constraints.targetUtilizationPct, budgetCostUnits: plan.constraints.budgetCostUnits ?? undefined, scenarioPatches: plan.changes.length ? [compiledPlanPatch] : [] }), [project, plan.constraints.targetUtilizationPct, plan.constraints.budgetCostUnits, plan.changes.length, compiledPlanPatch]);
  const n1Guidance = n1Policy.guidance;
  const selectedSnapshotLink = selectedCanonicalLink ? snapshot.links.find((link: any) => link.id === selectedCanonicalLink.id) : undefined;
  const selectedRoute = selectedCanonicalDemand ? routeByDemand.get(selectedCanonicalDemand.id) : undefined;
  const settingsLink = project.links.find((link: any) => link.id === settingsLinkId);
  const currentDesignState = designState && isPlanEvidenceFresh(designState.stamp, project, plan) ? designState : null;
  const selectedDesignVariant = currentDesignState?.variants.find((variant:any) => variant.id === currentDesignState.selectedVariantId) ?? currentDesignState?.variants[0] ?? null;
  const selectedDesignAllocations = selectedCanonicalDemand && selectedDesignVariant ? selectedDesignVariant.allocations.filter((row:any) => row.scenarioId === 'baseline' && row.demandId === selectedCanonicalDemand.id && row.flowGbps > 1e-8) : [];
  const selectedDesignRoutes = selectedCanonicalDemand && selectedDesignVariant ? selectedDesignAllocations.map((row:any) => { const path = (selectedDesignVariant.candidatePathSet.pathsByScenarioDemand[`${row.scenarioHash}:${selectedCanonicalDemand.id}`] ?? []).find((item:any) => item.id === row.pathId); return { ...row, fraction: selectedCanonicalDemand.bandwidthGbps > 0 ? row.flowGbps / selectedCanonicalDemand.bandwidthGbps : 0, linkIds: path?.linkIds ?? [] }; }) : [];
  const canCompareDesignVariants = analysisFresh && publishedPlanAnalysis?.verdict === 'FAIL' && (plan.constraints.allowedMitigationActions?.routingChanges ?? true);
  const analysisStatusLabel = authority === 'DRAFT' ? 'Plan has not been analyzed.' : authority === 'STALE' ? 'Plan changed since the last analysis.' : authority === 'PASS' ? 'No modeled violations.' : `${analysis.result.violations.length} violation${analysis.result.violations.length === 1 ? '' : 's'} · Peak ${pct(peak)}`;
  Object.assign(scope, { canRunResilience, optimizerReady, authority, peak, primaryFailure, progressLabel, regionCount, n1Policy, eligibleN1, routingLpEstimate, capacityMilpEstimate, n1Guidance, selectedSnapshotLink, selectedRoute, settingsLink, currentDesignState, selectedDesignVariant, selectedDesignAllocations, selectedDesignRoutes, canCompareDesignVariants, analysisStatusLabel });
}
