export type AccountingProfile = {
  taxStatus: "non_vat_payer";
  exemptionNote: string;
  appliedOn: string;
  revision: number;
};

export type AccountingView = {
  profile: AccountingProfile | null;
  settings: { costBasis: string; handoverEnabled: boolean; allDeliveries: boolean };
};
