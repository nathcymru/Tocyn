import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { dashboardApi } from '../api/client';

export type SlaCalendar = { timeZone: string; weekly: Record<string, Array<{ startMinute: number; endMinute: number }>>; exceptions: Array<{ date: string; intervals: Array<{ startMinute: number; endMinute: number }>}>; dst: { ambiguousLocalTime: 'earlier' | 'later' | 'both'; nonexistentLocalTime: 'next-valid' | 'previous-valid' | 'reject' } };
export type SlaPolicy = { revision: number; calendar: SlaCalendar; responseTargetMs: number | null; resolutionTargetMs: number | null; reopenPolicy: { response: 'continue' | 'restart'; resolution: 'continue' | 'restart' } };
export type SlaPolicyInput = Omit<SlaPolicy, 'revision'> & { expectedRevision: number };
export function useSlaPolicy() { return useQuery({ queryKey: ['sla-policy'], queryFn: () => dashboardApi.get<SlaPolicy>('/sla-policy') }); }
export function useUpdateSlaPolicy() { const queryClient = useQueryClient(); return useMutation({ mutationFn: (input: SlaPolicyInput) => dashboardApi.put<SlaPolicy>('/sla-policy', input), onSuccess: policy => queryClient.setQueryData(['sla-policy'], policy) }); }
