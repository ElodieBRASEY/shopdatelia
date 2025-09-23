import Stripe from "stripe";
import { Resend } from "resend";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });
    const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
    const sender = process.env.SENDER_EMAIL || "hello@datelia.ai";
    const support = process.env.SUPPORT_EMAIL || "support@datelia.ai";

    const { email, team_size, pack, promo_code } = req.body || {};
    if (!email || !/.+@.+\..+/.test(email)) return res.status(400).json({ error: "Email invalide" });

    const team = Math.max(1, parseInt(team_size || "1", 10));
    const packKey = String(pack || "").toLowerCase(); // "essentiel" | "pro" | "entreprise"
    if (!["essentiel", "pro", "entreprise"].includes(packKey)) {
      return res.status(400).json({ error: "Pack manquant ou invalide" });
    }

    // 1) Client (création / réutilisation)
    let customer = (await stripe.customers.list({ email, limit: 1 })).data[0];
    if (!customer) customer = await stripe.customers.create({ email });

    // Mémorise les choix (utile pour tri côté Stripe)
    await stripe.customers.update(customer.id, {
      metadata: { pack: packKey, team_size: String(team), promo_code: promo_code || "" },
      description: `Devis demandé — pack=${packKey}, users=${team}, promo=${promo_code || "-"}`
    });

    // 2) Lignes devis à partir des variables Vercel
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

    // 3) Code promo (facultatif)
    let discounts;
    if (promo_code) {
      const pc = (await stripe.promotionCodes.list({ code: promo_code, active: true, limit: 1 })).data[0];
      if (pc) discounts = [{ promotion_code: pc.id }];
    }

    // 4) Crée + finalise le devis (sans paramètre "features")
    const quote = await stripe.quotes.create({
      customer: customer.id,
      line_items: items,
      ...(process.env.TAX_RATE_20_ID ? { default_tax_rates: [process.env.TAX_RATE_20_ID] } : {}),
      discounts,
      metadata: { pack: packKey, team_size: String(team), promo_code: promo_code || "" }
    });
    const finalized = await stripe.quotes.finalizeQuote(quote.id);

    // 5) Lien Dashboard (toujours disponible)
    const dashboardUrl = `https://dashboard.stripe.com/${finalized.livemode ? "" : "test/"}quotes/${finalized.id}`;
    const hostedUrl = finalized.url || null; // parfois absent selon les comptes

    // 6) Notification email (support + client)
    if (resend) {
      const html = `
        <div style="font-family:system-ui,Segoe UI,Roboto,Arial">
          <h2>Nouvelle demande de devis Datelia</h2>
          <p><b>Email client :</b> ${email}</p>
          <p><b>Utilisateurs :</b> ${team}</p>
          <p><b>Pack :</b> ${packKey}</p>
          <p><b>Code promo :</b> ${promo_code || "—"}</p>
          <p><b>Devis Stripe :</b> <a href="${dashboardUrl}" target="_blank" rel="noopener">${dashboardUrl}</a></p>
          ${hostedUrl ? `<p><b>Page publique du devis :</b> <a href="${hostedUrl}" target="_blank" rel="noopener">${hostedUrl}</a></p>` : `<p><i>Pas d’URL publique disponible pour ce compte.</i></p>`}
          <hr />
          <p>Le client va être redirigé vers la page "Merci" pour réserver l’onboarding.</p>
        </div>
      `;
      await resend.emails.send({
        from: sender,
        to: [support, email], // support + client
        subject: "Datelia — Demande de devis",
        html
      });
    }

    // 7) Réponse : ok + URL publique si dispo (sinon null)
    return res.status(200).json({ ok: true, url: hostedUrl, id: finalized.id, dashboardUrl });
  } catch (e) {
    console.error("create-quote error", e);
    return res.status(500).json({ error: e.message || "Erreur inconnue" });
  }
}
