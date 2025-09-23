import Stripe from "stripe";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

    const { email, team_size, pack, promo_code } = req.body || {};
    if (!email || !/.+@.+\..+/.test(email)) return res.status(400).json({ error: "Email invalide" });

    const team = Math.max(1, parseInt(team_size || "1", 10));
    const packKey = (pack || "").toLowerCase(); // "essentiel" | "pro" | "entreprise"
    if (!["essentiel","pro","entreprise"].includes(packKey)) {
      return res.status(400).json({ error: "Pack manquant ou invalide" });
    }

    // Client
    let customer = (await stripe.customers.list({ email, limit: 1 })).data[0];
    if (!customer) customer = await stripe.customers.create({ email });

    // Mémoriser les choix
    await stripe.customers.update(customer.id, {
      metadata: { pack: packKey, team_size: String(team), promo_code: promo_code || "" },
      description: `Choix devis: pack=${packKey}, users=${team}, promo=${promo_code || "-"}`
    });

    // Lignes du devis (variables Vercel)
    const items = [{ price: process.env.PRICE_ID_USERS, quantity: team }];
    if (packKey === "essentiel" && process.env.PRICE_ID_PACK_ESSENTIEL) {
      items.push({ price: process.env.PRICE_ID_PACK_ESSENTIEL, quantity: team });
    } else if (packKey === "pro") {
      items.push({ price: process.env.PRICE_ID_PACK_PRO, quantity: team });
    } else if (packKey === "entreprise") {
      items.push({ price: process.env.PRICE_ID_PACK_ENTREPRISE, quantity: team });
    }

    // Code promo optionnel
    let discounts;
    if (promo_code) {
      const pc = (await stripe.promotionCodes.list({ code: promo_code, active: true, limit: 1 })).data[0];
      if (pc) discounts = [{ promotion_code: pc.id }];
    }

    // Création + finalisation du devis
    const quote = await stripe.quotes.create({
      customer: customer.id,
      line_items: items,
      ...(process.env.TAX_RATE_20_ID ? { default_tax_rates: [process.env.TAX_RATE_20_ID] } : {}),
      discounts,
      metadata: { pack: packKey, team_size: String(team), promo_code: promo_code || "" }
    });
    const finalized = await stripe.quotes.finalizeQuote(quote.id);

    // URL du devis hébergé
    return res.status(200).json({ url: finalized.url });
  } catch (e) {
    console.error("create-quote error", e);
    return res.status(500).json({ error: e.message || "Erreur inconnue" });
  }
}
