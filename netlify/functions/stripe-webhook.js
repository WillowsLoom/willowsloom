const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const SUPA_URL = process.env.SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY; // Use service key for server-side writes

async function deductInventory(cartItems) {
  if (!cartItems || !cartItems.length) return;

  // Fetch all products from Supabase
  const res = await fetch(`${SUPA_URL}/rest/v1/products?select=id,sku,qty,variations,status`, {
    headers: {
      'apikey': SUPA_KEY,
      'Authorization': `Bearer ${SUPA_KEY}`
    }
  });

  if (!res.ok) {
    console.error('Failed to fetch products:', await res.text());
    return;
  }

  const products = await res.json();

  for (const item of cartItems) {
    const sku = item.sku;
    if (!sku || sku === 'N/A') continue;

    // Find product by SKU
    const product = products.find(p => p.sku === sku);
    if (!product) {
      console.log(`Product not found for SKU: ${sku}`);
      continue;
    }

    const qtyToDeduct = item.qty || 1;

    // Check if it's a variation item (name contains " — ")
    const isVariation = item.name && item.name.includes(' — ');

    if (isVariation && product.variations) {
      // Parse variations and find the matching one by name
      let variations = product.variations;
      if (typeof variations === 'string') {
        try { variations = JSON.parse(variations); } catch(e) { variations = []; }
      }

      // Try to match variation by name segment
      const varNamePart = item.name.split(' — ').slice(1).join(' — ').split(' — Size')[0].trim();
      const updatedVars = variations.map(v => {
        if (v.name && v.name.trim() === varNamePart) {
          const newQty = Math.max(0, (parseInt(v.qty) || 0) - qtyToDeduct);
          console.log(`Deducting variation ${v.name}: ${v.qty} -> ${newQty}`);
          return { ...v, qty: newQty };
        }
        return v;
      });

      // Update Supabase variations
      const patch = await fetch(`${SUPA_URL}/rest/v1/products?id=eq.${product.id}`, {
        method: 'PATCH',
        headers: {
          'apikey': SUPA_KEY,
          'Authorization': `Bearer ${SUPA_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({
          variations: JSON.stringify(updatedVars),
          updated_at: new Date().toISOString()
        })
      });

      if (patch.ok) {
        console.log(`✓ Variation inventory updated for SKU: ${sku}`);
      } else {
        console.error(`✗ Failed to update variation for SKU: ${sku}`, await patch.text());
      }

    } else {
      // Regular product — deduct qty
      const newQty = Math.max(0, (parseInt(product.qty) || 0) - qtyToDeduct);
      const newStatus = newQty === 0 ? 'Out of Stock' : newQty <= 2 ? 'Low Stock' : 'In Stock';

      console.log(`Deducting ${sku}: ${product.qty} -> ${newQty}`);

      const patch = await fetch(`${SUPA_URL}/rest/v1/products?id=eq.${product.id}`, {
        method: 'PATCH',
        headers: {
          'apikey': SUPA_KEY,
          'Authorization': `Bearer ${SUPA_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({
          qty: newQty,
          status: newStatus,
          updated_at: new Date().toISOString()
        })
      });

      if (patch.ok) {
        console.log(`✓ Inventory updated for SKU: ${sku} → qty: ${newQty}, status: ${newStatus}`);
      } else {
        console.error(`✗ Failed to update inventory for SKU: ${sku}`, await patch.text());
      }
    }
  }
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const sig = event.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(event.body, sig, webhookSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
  }

  // Only handle successful payments
  if (stripeEvent.type === 'payment_intent.succeeded') {
    const paymentIntent = stripeEvent.data.object;
    console.log(`Payment succeeded: ${paymentIntent.id}, amount: $${paymentIntent.amount / 100}`);

    // Parse cart from metadata
    let cartItems = [];
    try {
      const cartJson = paymentIntent.metadata.cart_json;
      if (cartJson) cartItems = JSON.parse(cartJson);
    } catch (e) {
      console.error('Failed to parse cart from metadata:', e);
    }

    if (cartItems.length) {
      await deductInventory(cartItems);
    } else {
      console.log('No cart data in payment intent metadata');
    }
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ received: true })
  };
};
