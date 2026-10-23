export const ACCOUNT_TYPES = [
  { value: 'savings', label: 'Savings' }, { value: 'current', label: 'Current' }, { value: 'salary', label: 'Salary' },
  { value: 'overdraft', label: 'Overdraft / credit line' }, { value: 'other', label: 'Other' },
];
export const accountTypeLabel = (v) => ACCOUNT_TYPES.find((t) => t.value === v)?.label ?? v;
