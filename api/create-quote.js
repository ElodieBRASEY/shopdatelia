import Stripe from "stripe";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

    const { email, team_size, pack, promo_code } = req.body || {};
    if (!email || !/.+@.+\..+/.test(email)) {
      return res.status(400).json({ error: "Email invalide" });
    }

    const team = Math.max(1, parseInt(team_size || "1", 10));
    const packKey = String(pack || "").toLowerCase(); // "essentiel" | "pro" | "entreprise"
    if (!["essentiel", "pro", "entreprise"].includes(packKey)) {
      return res.status(400).json({ error: "Pack manquant ou invalide" });
    }

    // 1) Client
    let customer = (await stripe.customers.list({ email, limit: 1 })).data[0];
    if (!customer) customer = await stripe.customers.create({ email });

    // Mémoriser les choix (utile pour l'onboarding)
    await stripe.customers.update(customer.id, {
      metadata: { pack: packKey, team_size: String(team), promo_code: promo_code || "" },
      description: `Choix devis: pack=${packKey}, users=${team}, promo=${promo_code || "-"}`
    });

    // 2) Lignes du devis (IDs depuis Vercel)
    if (!process.env.PRICE_ID_USERS) {
      return res.status(500).json({ error: "PRICE_ID_USERS manquant dans Vercel" });
    }
    const items = [{ price: process.env.PRICE_ID_USERS, quantity: team }];

    if (packKey === "essentiel") {
      if (process.env.PRICE_ID_PACK_ESSENTIEL) {
        items.push({ price: process.env.PRICE_ID_PACK_ESSENTIEL, quantity: team });
      }
    } else if (packKey === "pro") {
      if (!process.env.PRICE_ID_PACK_PRO) {
        return res.status(500).json({ error: "PRICE_ID_PACK_PRO manquant dans Vercel" });
      }
      items.push({ price: process.env.PRICE_ID_PACK_PRO, quantity: team });
    } else if (packKey === "entreprise") {
      if (!process.env.PRICE_ID_PACK_ENTREPRISE) {
        return res.status(500).json({ error: "PRICE_ID_PACK_ENTREPRISE manquant dans Vercel" });
      }
      items.push({ price: process.env.PRICE_ID_PACK_ENTREPRISE, quantity: team });
    }

    // 3) Promo (facultative)
    let discounts;
    if (promo_code) {
      const pc = (await stripe.promotionCodes.list({ code: promo_code, active: true, limit: 1 })).data[0];
      if (pc) discounts = [{ promotion_code: pc.id }];
    }

    // 4) Créer le devis **avec acceptation en ligne** pour obtenir une URL publique
    const expiresAt = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 14; // expiration du devis dans 14 jours (à adapter)
    const quote = await stripe.quotes.create({
      customer: customer.id,
      line_items: items,
      ...(process.env.TAX_RATE_20_ID ? { default_tax_rates: [process.env.TAX_RATE_20_ID] } : {}),
      discounts,
      metadata: { pack: packKey, team_size: String(team), promo_code: promo_code || "" },
      features: { customer_acceptance: { type: "online" } }, // <-- le point clé pour avoir une URL
      expires_at: expiresAt
    });

    // 5) Finaliser le devis (génère la page d’acceptation)
    const finalized = await stripe.quotes.finalizeQuote(quote.id);

    // 6) Récupérer l'URL publique de la page de devis
    let publicUrl = finalized?.url || null;
    if (!publicUrl) {
      const again = await stripe.quotes.retrieve(finalized.id);
      publicUrl = again?.url || null;
    }

    if (!publicUrl) {
      return res.status(500).json({
        error: "Devis créé mais aucune URL publique n'a été retournée. Vérifiez que l’acceptation en ligne des devis (Quotes) est disponible sur votre compte."
      });
    }

    return res.status(200).json({ url: publicUrl, id: finalized.id });
  } catch (e) {
    console.error("create-quote error", e);
    return res.status(500).json({ error: e.message || "Erreur inconnue" });
  }
}
