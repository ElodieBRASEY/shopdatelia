import Stripe from 'stripe';

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });
    const { customerId, team_size, docs_per_month, trial_start_iso } = req.body || {};

    if (!customerId || !trial_start_iso) {
      return res.status(400).json({ error: 'customerId and trial_start_iso are required' });
    }

    const team = Math.max(1, parseInt(team_size || 1, 10));
    const docs = Math.max(0, parseInt(docs_per_month || 0, 10));
    const docsQty = Math.ceil(docs / 100);

    const trialStart = new Date(trial_start_iso);
    if (isNaN(trialStart.getTime())) {
      return res.status(400).json({ error: 'Invalid trial_start_iso' });
    }
    const trialEndTs = Math.floor((trialStart.getTime() + 14 * 24 * 60 * 60 * 1000) / 1000);

    const paymentMethods = await stripe.paymentMethods.list({
      customer: customerId,
      type: 'card',
    });
    const defaultPM = paymentMethods.data?.[0]?.id;

    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      items: [
        { price: process.env.PRICE_ID_USERS, quantity: team },
        ...(docsQty > 0 ? [{ price: process.env.PRICE_ID_DOCS, quantity: docsQty }] : []),
      ],
      trial_end: trialEndTs,
      default_payment_method: defaultPM,
      proration_behavior: 'create_prorations',
      metadata: {
        team_size: String(team),
        docs_per_month: String(docs),
        trial_start_iso: String(trial_start_iso),
      },
    });

    return res.status(200).json({ ok: true, subscriptionId: subscription.id, trial_end: trialEndTs });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to create subscription' });
  }
}
