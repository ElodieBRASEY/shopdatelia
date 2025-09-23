import Stripe from 'stripe';

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

  let email, team_size, pack, promo_code;

  if (req.method === 'GET') {
    const q = req.query || {};
    email = q.email;
    team_size = q.team_size;
    pack = q.pack;
    promo_code = q.promo_code;
  } else {
    const contentType = req.headers['content-type'] || '';
    if (contentType.includes('application/json')) {
      ({ email, team_size, pack, promo_code } = req.body || {});
    } else if (contentType.includes('application/x-www-form-urlencoded')) {
      const bodyStr = await new Promise((resolve) => {
        let data = ''; req.on('data',(c)=>data+=c); req.on('end',()=>resolve(data));
      });
      const params = Object.fromEntries(new URLSearchParams(bodyStr));
      email = params.email; team_size = params.team_size; pack = params.pack; promo_code = params.promo_code;
    } else {
      ({ email, team_size, pack, promo_code } = req.body || {});
    }
  }

  const team = Math.max(1, parseInt(team_size || '1', 10));

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'setup',
      customer_creation: 'always',
      customer_email: email || undefined,
      success_url: `${process.env.WEB_BASE_URL || 'https://datelia.ai'}/merci`,
      cancel_url:   `${process.env.WEB_BASE_URL || 'https://datelia.ai'}/annule`,
      payment_method_types: ['card'],
      metadata: {
        team_size: String(team),
        pack: (pack || '').toLowerCase(),
        promo_code: promo_code || ''
      }
    });

    res.writeHead(303, { Location: session.url });
    res.end();
  } catch (err) {
    console.error(err);
    res.status(500).send('Failed to create checkout session');
  }
}
