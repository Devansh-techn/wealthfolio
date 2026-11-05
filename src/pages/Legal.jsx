import { Link } from 'react-router-dom';

const PAGES = {
  disclaimer: {
    title: 'Financial disclaimer',
    body: [
      'WealthFolio is a portfolio-tracking and analytics tool. Nothing in it is investment, tax, accounting or legal advice, and nothing is an offer or solicitation to buy or sell any security.',
      'Market data comes from third-party providers, may be delayed (typically around 15 minutes for Indian exchanges), and can be incomplete or wrong. Exchange rates are reference rates and are not executable prices.',
      'Screener scores are produced by published, rule-based formulas from the data shown. They describe past and current data only; they do not predict future performance and carry no guarantee of any return. Any AI-generated explanation only restates the supplied metrics.',
      'Portfolio analytics are reconstructed from the transactions you enter and use current exchange rates for conversion. Accuracy depends on the completeness of your records. Past performance is not indicative of future results. All investing involves risk, including loss of principal.',
      'Consult a qualified, licensed adviser before making financial decisions.',
    ],
  },
  privacy: {
    title: 'Privacy',
    body: [
      'Your financial records are stored in a database protected by row-level security so that only your signed-in account can read or change them.',
      'We store the details needed to run the service: your account email, profile preferences, and the portfolio, transaction, goal, budget and watchlist data you enter. We do not sell your data.',
      'Symbols you view or hold are sent to market-data providers to fetch prices. Optional AI explanations send only the screener metrics shown on screen, never your holdings.',
      'You can delete your account and all associated data at any time from Settings.',
      'This page is a summary template; the operator of this deployment should replace it with a policy reviewed for their jurisdiction.',
    ],
  },
  terms: {
    title: 'Terms of service',
    body: [
      'WealthFolio is provided “as is”, without warranties of any kind. You are responsible for the accuracy of the data you enter and for your own investment decisions.',
      'You agree not to misuse the service, attempt to access other users’ data, or overload the platform.',
      'This page is a summary template; the operator of this deployment should replace it with terms reviewed for their jurisdiction.',
    ],
  },
};

export default function Legal({ page }) {
  const p = PAGES[page];
  return (
    <main className="auth-page legal-page" id="main">
      <article className="legal glass-panel">
        <Link to="/" className="auth-logo text-gradient">WealthFolio</Link>
        <h1 className="auth-title">{p.title}</h1>
        {p.body.map((t) => <p key={t} className="text-body">{t}</p>)}
        <Link to="/" className="link-sm">← Back to home</Link>
      </article>
    </main>
  );
}
