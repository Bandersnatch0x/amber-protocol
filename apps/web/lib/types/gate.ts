export type GateStatus = 'pending' | 'approved' | 'rejected';

export interface Gate {
  gateId: string;
  sessionId: string;
  type: string;
  stage: string;
  description: string;
  status: GateStatus;
  triggeredAt: string;
  resolvedAt?: string;
  resolvedBy?: string;
  reason?: string;
}

export interface GateFilters {
  sessionId?: string;
  status?: GateStatus;
}

export interface GateDecision {
  decision: 'approved' | 'rejected';
  reason?: string;
  resolvedAt: string;
  resolvedBy: string;
}
