// netlify/functions/create-payment-intent.js
// No npm install needed — uses plain fetch to call Stripe API directly

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { amount, currency, cart } = JSON.parse(event.body);

    if (!amount || amount < 50) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Invalid amount' }) };
    }

    const description = cart
      .map(item => `${item.name} × ${item.qty}`)
      .join(', ');

    // Call Stripe API directly — no library needed
    const params = new URLSearchParams({
      amount: amount,
      currency: currency || 'usd',
      'automatic_payment_methods[enabled]': 'true',
      description: `Willow's Loom: ${description}`.slice(0, 1000),
      'metadata[cart_summary]': description.slice(0, 500)
    });

    const response = await fetch('https://api.stripe.com/v1/payment_intents', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + process.env.STRIPE_SECRET_KEY,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params.toString()
    });

    const paymentIntent = await response.json();

    if (paymentIntent.error) {
      throw new Error(paymentIntent.error.message);
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ clientSecret: paymentIntent.client_secret })
    };

  } catch (error) {
    console.error('Stripe error:', error.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};
