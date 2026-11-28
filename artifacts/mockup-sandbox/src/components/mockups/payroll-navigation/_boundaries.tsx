// These app-specific side effects are deliberately unavailable in the visual baseline.
export const useQueueDeletion = () => ({
  isPending: false,
  request: () => window.alert('Энэ бол зөвхөн загвар. Бодит бүртгэл өөрчлөгдөхгүй.'),
});
export const PayrollOpeningBalances = (_props: Record<string, unknown>) => null;
