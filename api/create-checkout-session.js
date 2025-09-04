import Stripe from 'stripe';

const ALLOW_ORIGIN = '*'; // tu peux mettre "https://datelia.ai" si tu veux restreindre

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', ALLOW_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });
    const { email, team_size, docs_per_month } = req.body || {};

    const team = Math.max(1, parseInt(team_size || 1, 10));
    const docs = Math.max(0, parseInt(docs_per_month || 0, 10));

    const session = await stripe.checkout.sessions.create({
      mode: 'setup',                 // on enregistre la CB, pas de débit
      customer_creation: 'always',
      customer_email: email || undefined,
      success_url: `${process.env.WEB_BASE_URL || 'https://datelia.ai'}/merci`,
      cancel_url:   `${process.env.WEB_BASE_URL || 'https://datelia.ai'}/annule`,
      payment_method_types: ['card'],
      metadata: { team_size: String(team), docs_per_month: String(docs) },
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to create checkout session' });
  }
}
