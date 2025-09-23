import Stripe from 'stripe';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).send('Method Not Allowed');

  try {
    const { code } = req.query || {};
    if (!code) return res.status(400).json({ ok:false, error: 'Missing code' });

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });
    const promo = (await stripe.promotionCodes.list({ code, active: true, limit: 1 })).data[0];
    if (!promo) return res.status(200).json({ ok:true, found:false });

    const c = promo.coupon;
    res.status(200).json({
      ok: true,
      found: true,
      coupon: {
        id: c.id,
        percent_off: c.percent_off || null,
        amount_off: c.amount_off || null,
        currency: c.currency || 'eur',
        duration: c.duration
      }
    });
  } catch (e) {
    console.error('promo-lookup', e);
    res.status(500).json({ ok:false, error: e.message });
  }
}
