import type { GameState, PlotId } from "../types";

/** 광기의 진실까지 반영한 현재 루프의 실제 룰 목록. */
export function activeRulePlots(state: GameState): PlotId[] {
  const subPlots = state.scenario.subPlots;
  const extraPlot = state.scenario.scriptSpecified?.["Extra Plot"];
  const mainPlot = subPlots.includes("twistedTruth") &&
      (state.loop.specialGauge?.value ?? 0) >= 2 &&
      typeof extraPlot === "string"
    ? extraPlot
    : state.scenario.mainPlot;
  return [mainPlot, ...subPlots].filter(
    (plot, index, plots): plot is PlotId =>
      plot !== "" && plots.indexOf(plot) === index,
  );
}
