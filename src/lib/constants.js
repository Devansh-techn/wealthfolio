export const CURRENCIES = [
  { code: 'INR', symbol: '₹', label: 'Indian Rupee', locale: 'en-IN' },
  { code: 'USD', symbol: '$', label: 'US Dollar', locale: 'en-US' },
  { code: 'EUR', symbol: '€', label: 'Euro', locale: 'de-DE' },
  { code: 'GBP', symbol: '£', label: 'British Pound', locale: 'en-GB' },
];
export const CURRENCY_CODES = CURRENCIES.map((c) => c.code);

export const ASSET_TYPES = ['Stock', 'ETF', 'Mutual Fund', 'Crypto', 'Cash', 'Real Estate', 'Gold', 'Bond', 'Other'];
export const ASSET_TYPE_LABELS = {
  Stock: 'Stocks',
  ETF: 'ETFs',
  'Mutual Fund': 'Mutual Funds',
  Crypto: 'Crypto',
  Cash: 'Cash',
  'Real Estate': 'Real Estate',
  Gold: 'Gold',
  Bond: 'Bonds',
  Other: 'Other',
};
// Types whose price can be fetched from a market data provider.
export const MARKET_PRICEABLE_TYPES = ['Stock', 'ETF', 'Mutual Fund', 'Crypto', 'Gold', 'Bond'];

export const TRANSACTION_TYPES = ['BUY', 'SELL', 'DEPOSIT', 'WITHDRAWAL', 'DIVIDEND', 'FEE'];
export const QUANTITY_TYPES = ['BUY', 'SELL', 'DEPOSIT', 'WITHDRAWAL'];
export const ADD_TYPES = ['BUY', 'DEPOSIT'];
export const REMOVE_TYPES = ['SELL', 'WITHDRAWAL'];

export const RISK_PREFERENCES = ['conservative', 'moderate', 'aggressive'];
export const GOAL_TYPES = ['House', 'Car', 'Education', 'Emergency Fund', 'Retirement', 'Travel', 'Custom'];
export const LIABILITY_TYPES = ['Home Loan', 'Car Loan', 'Personal Loan', 'Education Loan', 'Credit Card', 'Other'];

export const EXPENSE_CATEGORIES = [
  'Housing', 'Groceries', 'Transport', 'Utilities', 'Dining', 'Health', 'Insurance',
  'Education', 'Entertainment', 'Shopping', 'Travel', 'EMI / Loans', 'Subscriptions', 'Other',
];
export const INCOME_CATEGORIES = ['Salary', 'Business', 'Freelance', 'Rental', 'Interest', 'Dividends', 'Gift', 'Other'];

export const SESSION_FLAG = 'wf.session-expired';
