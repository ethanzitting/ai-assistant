export interface FinanceAuditStatus {
  auditId: string;
  startDate: string;
  endDate: string;
  status: "active" | "completed" | "cancelled";
  total: number;
  completed: number;
  remaining: number;
  changes: number;
}

export interface FinanceAuditStartResult {
  created: boolean;
  status: FinanceAuditStatus;
}
