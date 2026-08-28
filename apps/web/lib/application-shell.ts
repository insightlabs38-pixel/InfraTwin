import { changePlanHash, modelHash, type ChangePlan, type NetworkProject } from '@infratwin/model';

export const APP_DESTINATIONS = ['network', 'analysis', 'plans', 'settings'] as const;
export type AppDestination = typeof APP_DESTINATIONS[number];

export const ANALYSIS_TABS = ['summary', 'routes', 'violations', 'contingencies', 'bottlenecks', 'evidence'] as const;
export type AnalysisTab = typeof ANALYSIS_TABS[number];

export interface ApplicationPresentationState {
  activeView: AppDestination;
  analysisTab: AnalysisTab;
  leftPanelCollapsed: boolean;
  rightPanelCollapsed: boolean;
  advancedOpen: boolean;
}

export function createApplicationPresentationState(): ApplicationPresentationState {
  return { activeView: 'network', analysisTab: 'summary', leftPanelCollapsed: false, rightPanelCollapsed: false, advancedOpen: false };
}

export function updateApplicationPresentationState(state: ApplicationPresentationState, patch: Partial<ApplicationPresentationState>): ApplicationPresentationState {
  return { ...state, ...patch };
}

export function semanticStateFingerprint(project: NetworkProject, plan: ChangePlan): { modelHash: string; planHash: string } {
  return { modelHash: modelHash(project), planHash: changePlanHash(plan) };
}
