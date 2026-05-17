const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { amount, currency, cart, customerEmail, customerName } = JSON.parse(event.body);

    if (!amount || amount < 50) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Invalid amount' })
      };
    }

    // Build line item description for Stripe metadata
    const itemSummary = cart.map(function(c) {
      return `${c.name} (SKU: ${c.sku || 'N/A'}) x${c.qty || 1} @ $${c.price}`;
    }).join(' | ');

    // Create or retrieve Stripe customer
    let customerId = null;
    if (customerEmail) {
      // Check if customer already exists
      const existing = await stripe.customers.list({
        email: customerEmail,
        limit: 1
      });

      if (existing.data.length > 0) {
        // Customer exists — use them
        customerId = existing.data[0].id;
        // Update name if we have it
        if (customerName) {
          await stripe.customers.update(customerId, { name: customerName });
        }
      } else {
        // Create new customer
        const customer = await stripe.customers.create({
          email: customerEmail,
          name: customerName || '',
          metadata: {
            source: 'willowsloomjewelry.com',
            first_order_items: itemSummary.slice(0, 500)
          }
        });
        customerId = customer.id;
      }
    }

    // Build payment intent params
    const intentParams = {
      amount: Math.round(amount),
      currency: currency || 'usd',
      automatic_payment_methods: { enabled: true },
      metadata: {
        order_items: itemSummary.slice(0, 500),
        item_count: cart.length,
        cart_json: JSON.stringify(cart).slice(0, 500)
      }
    };

    // Attach customer if we have one
    if (customerId) {
      intentParams.customer = customerId;
      intentParams.receipt_email = customerEmail;
    }

    const paymentIntent = await stripe.paymentIntents.create(intentParams);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientSecret: paymentIntent.client_secret,
        customerId: customerId
      })
    };

  } catch (err) {
    console.error('create-payment-intent error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};
