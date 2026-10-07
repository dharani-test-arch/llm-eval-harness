import type { Metrics } from './metrics';

export type Thresholds = {
  accuracy: number;
  abstentionAccuracy: number;
  hallucinationRate: number;
  citationFaithfulness: number;
  formatValidRate: number;
  consistency: number;
  reliability: number;
};

export type GateResult = {
  name: keyof Thresholds;
  actual: number;
  threshold: number;
  /** "min" = actual must be at least the threshold; "max" = at most. */
  direction: 'min' | 'max';
  passed: boolean;
};

export function evaluateGates(m: Metrics, t: Thresholds): GateResult[] {
  const gate = (name: keyof Thresholds, actual: number, direction: 'min' | 'max'): GateResult => ({
    name,
    actual,
    threshold: t[name],
    direction,
    passed: direction === 'min' ? actual >= t[name] : actual <= t[name],
  });
  return [
    gate('accuracy', m.accuracy.value, 'min'),
    gate('abstentionAccuracy', m.abstentionAccuracy.value, 'min'),
    gate('hallucinationRate', m.hallucinationRate, 'max'),
    gate('citationFaithfulness', m.citationFaithfulness, 'min'),
    gate('formatValidRate', m.formatValidRate, 'min'),
    gate('consistency', m.consistency, 'min'),
    gate('reliability', m.reliability, 'min'),
  ];
}
