export type RadarRunOptions = {
  date: string;
  sourceNames?: string[];
  inputPath?: string;
  workspaceRoot?: string;
};

export type RadarRunResult = {
  summary: { date: string; sourcesAttempted: string[] };
  report: string;
};

export async function runRadar(options: RadarRunOptions): Promise<RadarRunResult> {
  return {
    summary: { date: options.date, sourcesAttempted: options.sourceNames ?? [] },
    report: "# 新词机会雷达\n",
  };
}
