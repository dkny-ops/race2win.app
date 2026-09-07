export type ClaimablePrize = {
  id: string;
  awardType: "weekly_tournament" | "weekly_shares";
  amountCents: number;
  claimDeadlineAt: string;
};

export type ClaimablePrizeResponse = {
  claims: ClaimablePrize[];
  canContactWhatsApp: boolean;
  eligibleBalanceCents: number;
};
