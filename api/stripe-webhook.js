import Stripe from 'stripe';
import { Resend } from 'resend';

export const config = { api: { bodyParser: false } };

// -- lire le corps brut (obligatoire pour vérifier la signature)
function buffer(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });
  const buf = await buffer(req);
  const sig = req.headers['stripe-signature'];
  let event;

  // petit log diag visible dans Vercel > Logs
  console.log('diag:webhook', {
    hasSigHeader: !!sig,
    envIsLive: (process.env.STRIPE_SECRET_KEY || '').startsWith('sk_live_'),
    hasWebhookSecret: !!process.env.STRIPE_WEBHOOK_SECRET,
  });

  try {
    event = stripe.webhooks.constructEvent(buf, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed.', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    // -----------------------------
    // ✅ ICI: on traite la fin du Checkout (mode setup)
    // -----------------------------
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;

      // valeurs saisies sur /checkout.html et passées via /api/create-checkout-session-direct
      const pack = session?.metadata?.pack || '';
      const teamSize = session?.metadata?.team_size || '';

      // on stocke ces infos sur le Customer pour les retrouver plus tard
      if (session.customer) {
        await stripe.customers.update(session.customer, {
          metadata: {
            pack,
            team_size: String(teamSize || ''),
          },
          description: `Choix checkout: pack=${pack || '-'}, users=${teamSize || '-'}`,
        });
      }

      // (optionnel) Email d’onboarding automatique avec Calendly si RESEND_API_KEY est posé
      if (process.env.RESEND_API_KEY && process.env.CALENDLY_LINK) {
        // retrouver l'email côté session/customer
        let email =
          session.customer_details?.email ||
          (session.customer ? (await stripe.customers.retrieve(session.customer))?.email : null);

        if (email) {
          const resend = new Resend(process.env.RESEND_API_KEY);
          await resend.emails.send({
            from: process.env.SENDER_EMAIL || 'hello@datelia.ai',
            to: email,
            subject: 'Datelia — Réservez votre onboarding (essai 14 jours)',
            html: `
              <p>Bonjour,</p>
              <p>Merci pour votre inscription à Datelia. Pour activer votre <b>essai gratuit de 14 jours</b>, merci de réserver votre <b>rendez-vous d’onboarding (48h ouvrées)</b> :</p>
              <p><a href="${process.env.CALENDLY_LINK}" target="_blank" rel="noopener">Réserver mon onboarding</a></p>
              <p><i>⚠️ Votre période d’essai démarre après le rendez-vous.</i></p>
              <p>Pour toute question ou résiliation : <a href="mailto:${process.env.SUPPORT_EMAIL || 'support@datelia.ai'}">${process.env.SUPPORT_EMAIL || 'support@datelia.ai'}</a>.</p>
              <p>— L’équipe Datelia</p>
            `,
          });
        }
      }
    }
    // -----------------------------

    res.json({ received: true });
  } catch (err) {
    console.error('Webhook handler error', err);
    res.status(500).send('Webhook handler error');
  }
}
