import Stripe from 'stripe';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

  try {
    const { email, team_size, pack, promo_code } = req.body || {};
    const team = Math.max(1, parseInt(team_size || '1', 10));
    const packKey = (pack || 'essentiel').toLowerCase();

    // 1) Client (retrouver ou créer)
    let customer = (await stripe.customers.list({ email, limit: 1 })).data[0];
    if (!customer) customer = await stripe.customers.create({ email });

    // 2) Mémoriser les choix sur le Customer
    await stripe.customers.update(customer.id, {
      metadata: {
        pack: packKey,
        team_size: String(team),
        promo_code: promo_code || ''
      },
      description: `Choix devis: pack=${packKey}, users=${team}, promo=${promo_code || '-'}`
    });

    // 3) Lignes du devis = tes PRICES Stripe
    const items = [
      { price: process.env.PRICE_ID_USERS, quantity: team } // tiering 90/20 géré par Stripe
    ];
    if (packKey === 'essentiel' && process.env.PRICE_ID_PACK_ESSENTIEL) {
      items.push({ price: process.env.PRICE_ID_PACK_ESSENTIEL, quantity: team });
    }
    if (packKey === 'pro') {
      items.push({ price: process.env.PRICE_ID_PACK_PRO, quantity: team });
    }
    if (packKey === 'entreprise') {
      items.push({ price: process.env.PRICE_ID_PACK_ENTREPRISE, quantity: team });
    }

    // 4) Promo code (facultatif)
    let discounts;
    if (promo_code) {
      const promo = (await stripe.promotionCodes.list({ code: promo_code, active: true, limit: 1 })).data[0];
      if (promo) discounts = [{ promotion_code: promo.id }];
    }

    // 5) Créer le devis
    const quote = await stripe.quotes.create({
      customer: customer.id,
      line_items: items,
      ...(process.env.TAX_RATE_20_ID ? { default_tax_rates: [process.env.TAX_RATE_20_ID] } : {}),
      discounts,
      metadata: { pack: packKey, team_size: String(team), promo_code: promo_code || '' }
    });

    // 6) Finaliser pour obtenir l'URL hébergée
    const finalized = await stripe.quotes.finalizeQuote(quote.id);

    // 7) Retourner l'URL pour rediriger l'utilisateur
    res.status(200).json({ url: finalized.url });
  } catch (e) {
    console.error('create-quote error', e);
    res.status(500).json({ error: e.message });
  }
}
