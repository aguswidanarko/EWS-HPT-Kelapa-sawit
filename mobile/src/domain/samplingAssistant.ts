// Sampling Assistant generalization (SPEC_V2.md section 4 Mobile: "Sampling Assistant: generalize
// supaya baca sampling_rule, bukan cuma hardcode UPDKS/Tikus/dst"). The row/grid GENERATOR itself
// already lived in domain/sensusEngines.ts's buildSamplingPlan() and was already fully data-driven
// (reads Blok.parameter_sampling_json, not hardcoded per-HPT) - V1 just never surfaced the other
// half of `sampling_rule`, the MINIMUM SAMPLE REQUIREMENT (e.g. Partenocarpi's FR-mandated
// "minimal 6 baris sensus/blok"), anywhere in the UI. This module closes that gap: it reads the
// locally-cached `sampling_rule` table (mirrors GET /api/formulas/sampling-rules, downloaded in
// sync/engine.ts downloadAll()) so a Yield Making form can warn the officer BEFORE submit if their
// sample is under the configured minimum - entirely data-driven, no per-indicator hardcoding here.
//
// Judgment call (documented per the task's "note what you did"): given the time budget, this file
// generalizes the MINIMUM-SAMPLE-WARNING half of the Sampling Assistant (the part SPEC_V2.md's
// example - Partenocarpi's "minimal 6 baris/blok" - actually calls for) rather than rewriting
// buildSamplingPlan()'s row/grid generator, which was already generic and unaffected by V2.

import { getSamplingRuleByHptId } from '../db/repo/masterRepo';
import type { SamplingRuleRow } from '../types';

export interface MinimumSampleCheck {
  rule: SamplingRuleRow | null;
  minimum: number | null;
  actual: number;
  /** true only when a minimum IS configured and actual falls short of it - null/no-rule never warns. */
  belowMinimum: boolean;
}

/** FR default used only when the device has never downloaded `sampling_rule` (first-run offline) -
 * matches SPEC_V2.md section 5's Partenocarpi row exactly ("minimal 6 baris sensus/blok"). Once
 * sync has run at least once, the real (admin-configurable) value from the server always wins. */
const OFFLINE_FALLBACK_MINIMUM: Record<string, number> = {
  PARTENOCARPI: 6,
};

export async function checkMinimumSample(hptId: number | null, hptCode: string | null, actual: number): Promise<MinimumSampleCheck> {
  const rule = hptId ? await getSamplingRuleByHptId(hptId) : null;
  const minimum = rule?.minimum_sample ?? (hptCode ? OFFLINE_FALLBACK_MINIMUM[hptCode] ?? null : null);
  return {
    rule,
    minimum,
    actual,
    belowMinimum: minimum !== null && actual < minimum,
  };
}
