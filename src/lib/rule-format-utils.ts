/**
 * Human-readable formatting utilities for EMIS rule structures.
 */

import type { RangeBoundary, DateRange, SearchRestriction, LinkedRelationship } from './types';

const OPERATOR_MAP: Record<string, string> = {
  GTEQ: '>=',
  LTEQ: '<=',
  GT: '>',
  LT: '<',
  EQ: '=',
  GTE: '>=',
  LTE: '<=',
};

const FRIENDLY_OP: Record<string, string> = {
  GTEQ: 'at least',
  LTEQ: 'at most',
  GT: 'more than',
  LT: 'under',
  EQ: 'exactly',
  GTE: 'at least',
  LTE: 'at most',
};

const UNIT_LABELS: Record<string, string> = {
  DAY: 'day',
  WEEK: 'week',
  MONTH: 'month',
  QUARTER: 'quarter',
  YEAR: 'year',
  FISCALYEAR: 'fiscal year',
  DATE: '',
};

function pluralise(unit: string, count: number): string {
  const label = UNIT_LABELS[unit?.toUpperCase()] ?? unit?.toLowerCase() ?? '';
  if (!label) return '';
  return Math.abs(count) === 1 ? label : `${label}s`;
}

export function formatOperator(op: string): string {
  return OPERATOR_MAP[op?.toUpperCase()] ?? op ?? '';
}

function friendlyOp(op: string): string {
  return FRIENDLY_OP[op?.toUpperCase()] ?? formatOperator(op);
}

export function formatRangeBoundary(b: RangeBoundary | undefined): string {
  if (!b) return '';

  const op = formatOperator(b.operator || '');
  const val = b.value ?? '';
  const unit = b.unit?.toUpperCase() ?? '';
  const relation = b.relation?.toUpperCase();

  // Operator-only boundary with no value — skip
  if (!val && op) return '';

  if (relation === 'ABSOLUTE') {
    return `${op} ${val}`.trim();
  }

  // Named temporal variables: "Last", "This", "Next"
  if (['Last', 'This', 'Next'].includes(val)) {
    const unitLabel = UNIT_LABELS[unit] ?? unit.toLowerCase();
    return `${op} ${val} ${unitLabel}`.trim();
  }

  // Numeric relative: -6 MONTH -> "6 months ago"
  const num = parseInt(val, 10);
  if (!isNaN(num)) {
    const absNum = Math.abs(num);
    const unitLabel = pluralise(unit, absNum);
    if (num < 0) return `${op} ${absNum} ${unitLabel} ago`.trim();
    if (num === 0) return `${op} now`.trim();
    return `${op} ${absNum} ${unitLabel} ahead`.trim();
  }

  return `${op} ${val} ${unit}`.trim();
}

/**
 * Format a range boundary with human-friendly language for column filters.
 * Uses column context to produce natural descriptions.
 */
function friendlyBoundary(b: RangeBoundary | undefined, column?: string): string {
  if (!b) return '';
  const val = b.value ?? '';
  const unit = b.unit?.toUpperCase() ?? '';
  const relation = b.relation?.toUpperCase();
  const op = b.operator?.toUpperCase() ?? '';

  // Operator-only boundary with no value — unbounded constraint (e.g. "date must exist")
  if (!val && op) return '';

  if (relation === 'ABSOLUTE') {
    return `${friendlyOp(op)} ${val}`.trim();
  }

  // Named temporal: "Last", "This", "Next"
  if (['Last', 'This', 'Next'].includes(val)) {
    const unitLabel = UNIT_LABELS[unit] ?? unit.toLowerCase();
    return `${friendlyOp(op)} ${val} ${unitLabel}`.trim();
  }

  const num = parseInt(val, 10);
  if (!isNaN(num)) {
    const absNum = Math.abs(num);
    const unitLabel = pluralise(unit, absNum);
    const col = column?.toUpperCase() ?? '';
    const isAge = col === 'AGE';
    const isNumeric = col === 'NUMERIC_VALUE' || col === 'VALUE';

    if (isAge) {
      return `${friendlyOp(op)} ${absNum} ${unitLabel} old`;
    }

    if (isNumeric || !unit) {
      // Numeric column or no unit — plain threshold, not temporal
      return `${formatOperator(op)} ${val}`.trim();
    }

    // Date columns: relative offset from today
    // Operator determines direction relative to the offset point
    if (num < 0) {
      // Negative = past offset (e.g., -1 year = 1 year ago)
      // GT/GTEQ: dates after that point = "within the last X"
      // LT/LTEQ: dates before that point = "before X ago"
      if (op === 'LT') {
        return `before ${absNum} ${unitLabel} ago`;
      }
      if (op === 'LTEQ') {
        return `on or before ${absNum} ${unitLabel} ago`;
      }
      return `within the last ${absNum} ${unitLabel}`;
    }
    if (num === 0) return `${friendlyOp(op)} now`;
    // Positive = future offset
    // LT/LTEQ: dates before that point = "within the next X"
    // GT/GTEQ: dates after that point = "after X from now"
    if (op === 'GT') {
      return `after ${absNum} ${unitLabel} from now`;
    }
    if (op === 'GTEQ') {
      return `on or after ${absNum} ${unitLabel} from now`;
    }
    return `within the next ${absNum} ${unitLabel}`;
  }

  return `${friendlyOp(op)} ${val} ${unit}`.trim();
}

export function formatDateRange(r: DateRange | undefined): string {
  if (!r) return '';
  const fromStr = formatRangeBoundary(r.from);
  const toStr = formatRangeBoundary(r.to);

  if (fromStr && toStr) return `${fromStr} to ${toStr}`;
  return fromStr || toStr || '';
}

/**
 * Format a column filter range as a friendly description.
 * Accepts column name for context-sensitive formatting.
 */
export function formatColumnFilterRange(r: DateRange | undefined, column?: string): string {
  if (!r) return '';
  const fromStr = friendlyBoundary(r.from, column);
  const toStr = friendlyBoundary(r.to, column);

  if (fromStr && toStr) return `${fromStr} to ${toStr}`;
  return fromStr || toStr || '';
}

export function formatRestriction(r: SearchRestriction): string {
  return r.description || 'Unknown restriction';
}

/**
 * Format a date range for relationship context using friendly language.
 * Produces e.g. "on or after today", "within last 6 months" instead of raw ">= now".
 */
function formatRelationshipRange(r: DateRange | undefined): string {
  if (!r) return '';

  const parts: string[] = [];
  if (r.from) parts.push(formatRelBoundary(r.from));
  if (r.to) parts.push(formatRelBoundary(r.to));
  const nonEmpty = parts.filter(Boolean);
  return nonEmpty.join(' and ');
}

function formatRelBoundary(b: RangeBoundary): string {
  if (!b) return '';
  const val = b.value ?? '';
  const unit = b.unit?.toUpperCase() ?? '';
  const op = b.operator?.toUpperCase() ?? '';
  const relation = b.relation?.toUpperCase();

  if (!val && op) return '';

  const num = parseInt(val, 10);

  // In linked criteria, value=0 means "the parent record's date", not "today"
  if (!isNaN(num) && num === 0 && relation !== 'ABSOLUTE') {
    switch (op) {
      case 'GTEQ': case 'GTE': return 'on or after';
      case 'LTEQ': case 'LTE': return 'on or before';
      case 'GT': return 'after';
      case 'LT': return 'before';
      case 'EQ': return 'same as';
      default: return '';
    }
  }

  // Relative offset from parent record date
  if (!isNaN(num) && unit && relation !== 'ABSOLUTE') {
    const absNum = Math.abs(num);
    const unitLabel = pluralise(unit, absNum);
    const friendlyOpStr = FRIENDLY_OP[op] ?? formatOperator(op);
    if (num < 0) return `${friendlyOpStr} ${absNum} ${unitLabel} before`.trim();
    return `${friendlyOpStr} ${absNum} ${unitLabel} after`.trim();
  }

  // Fallback
  return formatRangeBoundary(b);
}

export function formatRelationship(r: LinkedRelationship | undefined): string {
  if (!r) return 'Linked criterion';

  const parent = r.parentColumn ?? '?';
  const child = r.childColumn ?? '?';

  const rangeDesc = formatRelationshipRange(r.rangeValue);

  if (parent === child) {
    // e.g. "DATE on or after parent record's DATE"
    return rangeDesc ? `${child} ${rangeDesc} parent record's ${parent}` : `Linked on ${parent}`;
  }
  return rangeDesc
    ? `${child} ${rangeDesc} parent record's ${parent}`
    : `${parent} linked to ${child}`;
}
