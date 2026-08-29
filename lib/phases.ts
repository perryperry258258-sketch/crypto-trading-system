import { CapitalState, Phase } from "./types";

// 資金階段定義（規格書第十七節：資金越大，單筆風險應該逐步降低）
export const PHASES: Phase[] = [
  { index: 0, from: 5_000, to: 10_000, maxRiskPct: 2.0, label: "Phase 0" },
  { index: 1, from: 10_000, to: 50_000, maxRiskPct: 1.5, label: "Phase 1" },
  { index: 2, from: 50_000, to: 100_000, maxRiskPct: 1.0, label: "Phase 2" },
  { index: 3, from: 100_000, to: 1_000_000, maxRiskPct: 1.0, label: "Phase 3" },
  { index: 4, from: 1_000_000, to: 10_000_000, maxRiskPct: 0.75, label: "Phase 4" },
  { index: 5, from: 10_000_000, to: 100_000_000, maxRiskPct: 0.5, label: "Phase 5" },
  { index: 6, from: 100_000_000, to: 300_000_000, maxRiskPct: 0.35, label: "Phase 6" },
  { index: 7, from: 300_000_000, to: null, maxRiskPct: 0.25, label: "Phase 7" },
];

export function getPhaseForCapital(capital: number): Phase {
  for (const p of PHASES) {
    if (capital >= p.from && (p.to === null || capital < p.to)) return p;
  }
  // 低於 Phase 0 起點，仍視為 Phase 0（風控最嚴格不會更寬鬆）
  if (capital < PHASES[0].from) return PHASES[0];
  return PHASES[PHASES.length - 1];
}

export function computeCapitalState(currentCapital: number, peakCapital: number): CapitalState {
  const phase = getPhaseForCapital(currentCapital);
  const nextTarget = phase.to;
  const progressPct = nextTarget
    ? Math.max(0, Math.min(100, ((currentCapital - phase.from) / (nextTarget - phase.from)) * 100))
    : 100;

  const peak = Math.max(peakCapital, currentCapital);
  const drawdownPct = peak > 0 ? ((peak - currentCapital) / peak) * 100 : 0;

  // 規格書第十八節：獲利保護 PROFIT LOCK SYSTEM
  let profitLockLevel: CapitalState["profitLockLevel"] = "NORMAL";
  if (drawdownPct >= 20) profitLockLevel = "PROTECT_MODE";
  else if (drawdownPct >= 15) profitLockLevel = "HIGH_RISK_BAN";
  else if (drawdownPct >= 10) profitLockLevel = "REDUCE_RISK";

  return {
    currentCapital,
    peakCapital: peak,
    drawdownPct,
    phase,
    nextTarget,
    progressPct,
    profitLockLevel,
  };
}

// 根據 Phase 基礎風險 + 獲利保護狀態，計算「本次交易實際允許的最大風險 %」
export function effectiveMaxRiskPct(state: CapitalState): number {
  const base = state.phase.maxRiskPct;
  switch (state.profitLockLevel) {
    case "PROTECT_MODE":
      return 0; // 禁止新交易，僅可管理既有部位
    case "HIGH_RISK_BAN":
      return Math.min(base, 0.5);
    case "REDUCE_RISK":
      return base * 0.6;
    default:
      return base;
  }
}

// 倉位計算器（規格書第十節）
// positionSize = 最大允許損失 ÷ 停損距離(%)
export function calcPositionSize(params: {
  capital: number;
  riskPct: number; // 單筆風險 %，例如 1 表示 1%
  entryPrice: number;
  stopLossPrice: number;
}): { maxLossAmount: number; stopDistancePct: number; positionSize: number } {
  const { capital, riskPct, entryPrice, stopLossPrice } = params;
  const maxLossAmount = capital * (riskPct / 100);
  const stopDistancePct = Math.abs((entryPrice - stopLossPrice) / entryPrice) * 100;
  const positionSize = stopDistancePct > 0 ? maxLossAmount / (stopDistancePct / 100) : 0;
  return { maxLossAmount, stopDistancePct, positionSize };
}
