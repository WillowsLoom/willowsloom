const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { amount, currency, cart } = JSON.parse(event.body);

    if (!amount || amount < 50) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Invalid amount' })
      };
    }

    // Build line item description for Stripe metadata
    const itemSummary = cart.map(function(c) {
      return `${c.name} (SKU: ${c.sku || 'N/A'}) x${c.qty} @ $${c.price}`;
    }).join(' | ');

    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount),
      currency: currency || 'usd',
      automatic_payment_methods: { enabled: true },
      metadata: {
        order_items: itemSummary.slice(0, 500), // Stripe metadata limit 500 chars
        item_count: cart.length,
        // Store full cart as JSON for webhook to use
        cart_json: JSON.stringify(cart).slice(0, 500)
      }
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientSecret: paymentIntent.client_secret })
    };

  } catch (err) {
    console.error('create-payment-intent error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};
