/** #162 current-work definition, independent of snoozing and waiting. */
export const OPERATOR_CAPACITY_MAX = 1000;
export type OperatorAvailability = 'available' | 'unavailable';
export type OperatorCapacityInput = Readonly<{ expectedRevision:number; availability:OperatorAvailability; assignmentCeiling:number }>;
export type CapacityOverride = Readonly<{ reason:string }>;
export type OperatorCapacity = Readonly<{ userId:string; revision:number; availability:OperatorAvailability | null;
  assignmentCeiling:number | null; currentWork:number | null; status:'available'|'unconfigured'|'unavailable';
  definitionVersion:'2026-09-11.3'; asOf:string }>;
