import Stripe from 'stripe';

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

  // Récupère les paramètres selon la méthode / content-type
  let email, team_size, docs_per_month;

  if (req.method === 'GET') {
    const q = req.query || {};
    email = q.email;
    team_size = q.team_size;
    docs_per_month = q.docs_per_month;
  } else {
    const contentType = req.headers['content-type'] || '';
    if (contentType.includes('application/json')) {
      ({ email, team_size, docs_per_month } = req.body || {});
    } else if (contentType.includes('application/x-www-form-urlencoded')) {
      // Parse body url-encoded
      const bodyStr = await new Promise((resolve) => {
        let data = '';
        req.on('data', (c) => (data += c));
        req.on('end', () => resolve(data));
      });
      const params = Object.fromEntries(new URLSearchParams(bodyStr));
      email = params.email;
      team_size = params.team_size;
      docs_per_month = params.docs_per_month;
    } else {
      ({ email, team_size, docs_per_month } = req.body || {});
    }
  }

  const team = Math.max(1, parseInt(team_size || '1', 10));
  const docs = Math.max(0, parseInt(docs_per_month || '0', 10));

  try {
    // Mode SETUP: on enregistre la carte, pas d’encaissement
    const session = await stripe.checkout.sessions.create({
      mode: 'setup',
      customer_creation: 'always',
      customer_email: email || undefined,
      success_url: `${process.env.WEB_BASE_URL || 'https://datelia.ai'}/merci`,
      cancel_url:   `${process.env.WEB_BASE_URL || 'https://datelia.ai'}/annule`,
      payment_method_types: ['card'],
      metadata: {
        team_size: String(team),
        docs_per_month: String(docs),
      },
    });

    // Redirige le navigateur vers Stripe Checkout
    res.writeHead(303, { Location: session.url });
    res.end();
  } catch (err) {
    console.error(err);
    res.status(500).send('Failed to create checkout session');
  }
}
