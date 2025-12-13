export type CheckStatus = "PENDING" | "VERIFIED" | "LATE";

export type CageCheck = {
  id: string;
  guildId: string;
  requesterId: string;
  targetId: string;
  reason?: string;
  createdAt: number;  // epoch ms
  dueAt: number;      // epoch ms
  status: CheckStatus;
  threadId: string;   // thread created for this check
  proofMessageId?: string;
  verifiedAt?: number;
};

export type SubState = {
  userId: string;
  guildId: string;
  consecutiveMisses: number;
  lastUpdated: number;
};
