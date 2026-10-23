// Deterministic, offline categorisation from the description only. No merchant names are invented and nothing leaves the browser.
export const CATEGORIES = ['Food and Dining', 'Shopping', 'Travel', 'Bills and Utilities', 'Rent', 'Healthcare', 'Entertainment', 'Education', 'Transfers', 'Investments', 'Salary and Income', 'Other', 'Adjustment'];
export const USER_CATEGORIES = CATEGORIES.filter((c) => c !== 'Adjustment');

const DEBIT_RULES = [
  ['Investments', /\b(zerodha|groww|upstox|angel ?one|icici ?direct|hdfc ?sec|5paisa|smallcase|mutual ?fund|sip|nps|ppf|demat|nse clearing|indian clearing|ccil|kuvera|paytm money)\b/i],
  ['Rent', /\b(rent|landlord|house rent|pg rent)\b/i],
  ['Bills and Utilities', /\b(electricity|bescom|msedcl|tneb|tata power|adani electricity|water bill|lpg|indane|bharat gas|broadband|airtel|jio|vodafone|bsnl|recharge|dth|tata ?play|postpaid|prepaid|insurance|lic|premium|billdesk|bbps|credit card bill)\b/i],
  ['Food and Dining', /\b(swiggy|zomato|restaurant|cafe|coffee|starbucks|dominos|pizza|mcdonald|kfc|burger|bakery|dining|eatery|blinkit|bigbasket|zepto|instamart|grocer(y|ies)|dunzo|haldiram|chai)\b/i],
  ['Shopping', /\b(amazon|flipkart|myntra|ajio|meesho|nykaa|reliance retail|dmart|d-mart|shopping|lifestyle|decathlon|croma|ikea|tata cliq)\b/i],
  ['Travel', /\b(uber|ola|rapido|irctc|makemytrip|goibibo|redbus|indigo|air india|vistara|spicejet|akasa|fastag|petrol|fuel|hpcl|bpcl|iocl|indian oil|cleartrip|yatra|ixigo|metro)\b/i],
  ['Healthcare', /\b(hospital|pharmacy|apollo|medplus|1mg|pharmeasy|netmeds|clinic|diagnostic|doctor|dental|medical)\b/i],
  ['Entertainment', /\b(netflix|prime video|hotstar|spotify|youtube|bookmyshow|pvr|inox|steam|sony ?liv|zee5|cinema|movie|jiocinema)\b/i],
  ['Education', /\b(school|college|university|tuition|udemy|coursera|byju|unacademy|coaching|upgrad|exam fee)\b/i],
  ['Transfers', /\b(own account|self transfer|to self|transfer to own)\b/i],
];
const CREDIT_RULES = [
  ['Salary and Income', /\b(salary|payroll|sal cr|wages|stipend|interest|int\.? ?pd|int credit|dividend)\b/i],
  ['Investments', /\b(zerodha|groww|upstox|redemption|mutual ?fund|mf redemption)\b/i],
  ['Transfers', /\b(own account|self transfer|from self)\b/i],
];

export function categorize(description, type) {
  const rules = type === 'credit' ? CREDIT_RULES : DEBIT_RULES;
  const hit = rules.find(([, re]) => re.test(String(description ?? '')));
  return hit ? hit[0] : 'Other';
}
