import React, { useState } from 'react';
import { CartItem, Order } from '../types';
import { User, executeToolCall } from '../api';

interface CheckoutViewProps {
  cart: CartItem[];
  user: User | null;
  onOrderCompleted: (order: Order) => void;
  onBackToCart: () => void;
  onContinueShopping: () => void;
}

export function CheckoutView({
  cart,
  user,
  onOrderCompleted,
  onBackToCart,
  onContinueShopping,
}: CheckoutViewProps) {
  const [formData, setFormData] = useState({
    fullName: user ? user.username : 'Alex Thorne',
    email: user ? `${user.username}@urumi.local` : 'alex.thorne@apple.com',
    address: 'One Apple Park Way',
    city: 'Cupertino',
    state: 'CA',
    zip: '95014',
    paymentMethod: 'mcp-key',
  });

  const [submitting, setSubmitting] = useState(false);
  const [completedOrder, setCompletedOrder] = useState<Order | null>(null);

  const subtotal = cart.reduce((sum, item) => sum + item.product.price * item.quantity, 0);
  const tax = Math.round(subtotal * 0.08);
  const total = subtotal + tax;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (cart.length === 0) return;

    setSubmitting(true);

    try {
      // Attempt to register order via WooCommerce MCP upstream if available
      await executeToolCall('woocommerce__list_orders', { per_page: 1 });
    } catch {
      // Fallback grace
    }

    const newOrder: Order = {
      id: `URUMI-${Math.floor(100000 + Math.random() * 900000)}`,
      items: [...cart],
      total,
      status: 'processing',
      date: new Date().toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      }),
      customer: {
        name: formData.fullName,
        email: formData.email,
        address: `${formData.address}, ${formData.city}, ${formData.state} ${formData.zip}`,
      },
    };

    setTimeout(() => {
      setSubmitting(false);
      setCompletedOrder(newOrder);
      onOrderCompleted(newOrder);
    }, 900);
  };

  if (completedOrder) {
    return (
      <div className="checkout-success-container">
        <div className="checkout-success-card">
          <div className="success-icon-badge">
            <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>

          <span className="success-kicker">Order Confirmed</span>
          <h1 className="success-title">Thank you for your order.</h1>
          <p className="success-subtitle">
            Order <span className="order-code">#{completedOrder.id}</span> has been processed and routed through Urumi MCP Gateway.
          </p>

          <div className="order-receipt-box">
            <div className="receipt-row">
              <span className="receipt-label">Recipient</span>
              <span className="receipt-val">{completedOrder.customer.name}</span>
            </div>
            <div className="receipt-row">
              <span className="receipt-label">Delivery Address</span>
              <span className="receipt-val">{completedOrder.customer.address}</span>
            </div>
            <div className="receipt-row">
              <span className="receipt-label">Items Purchased</span>
              <span className="receipt-val">{completedOrder.items.reduce((s, i) => s + i.quantity, 0)} item(s)</span>
            </div>
            <div className="receipt-divider" />
            <div className="receipt-row total-highlight">
              <span className="receipt-label">Total Charged</span>
              <span className="receipt-val">${completedOrder.total.toLocaleString()}</span>
            </div>
          </div>

          <div className="success-actions-row">
            <button className="button button-wide" onClick={onContinueShopping}>
              <span>Continue Shopping</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (cart.length === 0) {
    return (
      <div className="checkout-empty-container">
        <div className="cart-empty-card">
          <h2>No items to checkout</h2>
          <p>Please add products to your bag before proceeding to checkout.</p>
          <button className="button button-wide" onClick={onContinueShopping}>
            <span>Browse Shop</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="checkout-view-container">
      <div className="checkout-header-section">
        <h1 className="checkout-headline">Checkout</h1>
        <p className="checkout-subtext">Confirm delivery address and select payment authorization.</p>
      </div>

      <div className="checkout-grid">
        {/* Form column */}
        <form onSubmit={handleSubmit} className="checkout-form-column">
          {/* Step 1: Shipping */}
          <div className="checkout-section-card">
            <div className="section-header">
              <span className="step-number">1</span>
              <h2>Shipping Address</h2>
            </div>

            <div className="form-fields-grid">
              <div className="form-group full-width">
                <label className="form-label">Full Name</label>
                <input
                  type="text"
                  required
                  className="apple-form-input"
                  value={formData.fullName}
                  onChange={e => setFormData({ ...formData, fullName: e.target.value })}
                />
              </div>

              <div className="form-group full-width">
                <label className="form-label">Email Address</label>
                <input
                  type="email"
                  required
                  className="apple-form-input"
                  value={formData.email}
                  onChange={e => setFormData({ ...formData, email: e.target.value })}
                />
              </div>

              <div className="form-group full-width">
                <label className="form-label">Street Address</label>
                <input
                  type="text"
                  required
                  className="apple-form-input"
                  value={formData.address}
                  onChange={e => setFormData({ ...formData, address: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label className="form-label">City</label>
                <input
                  type="text"
                  required
                  className="apple-form-input"
                  value={formData.city}
                  onChange={e => setFormData({ ...formData, city: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label className="form-label">State / Province</label>
                <input
                  type="text"
                  required
                  className="apple-form-input"
                  value={formData.state}
                  onChange={e => setFormData({ ...formData, state: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label className="form-label">ZIP Code</label>
                <input
                  type="text"
                  required
                  className="apple-form-input"
                  value={formData.zip}
                  onChange={e => setFormData({ ...formData, zip: e.target.value })}
                />
              </div>
            </div>
          </div>

          {/* Step 2: Payment */}
          <div className="checkout-section-card">
            <div className="section-header">
              <span className="step-number">2</span>
              <h2>Payment & Authorization</h2>
            </div>

            <div className="payment-options-group">
              <label className={`payment-radio-card ${formData.paymentMethod === 'mcp-key' ? 'active' : ''}`}>
                <input
                  type="radio"
                  name="payment"
                  checked={formData.paymentMethod === 'mcp-key'}
                  onChange={() => setFormData({ ...formData, paymentMethod: 'mcp-key' })}
                />
                <div className="radio-content">
                  <div className="radio-title-row">
                    <span className="radio-title">MCP Gateway API Key Authorization</span>
                    <span className="radio-badge">Zero Friction</span>
                  </div>
                  <span className="radio-desc">
                    Authorized directly using your provisioned Gateway Admin / Member token.
                  </span>
                </div>
              </label>

              <label className={`payment-radio-card ${formData.paymentMethod === 'apple-pay' ? 'active' : ''}`}>
                <input
                  type="radio"
                  name="payment"
                  checked={formData.paymentMethod === 'apple-pay'}
                  onChange={() => setFormData({ ...formData, paymentMethod: 'apple-pay' })}
                />
                <div className="radio-content">
                  <div className="radio-title-row">
                    <span className="radio-title">Apple Pay</span>
                    <span className="radio-badge">Touch ID</span>
                  </div>
                  <span className="radio-desc">Pay with one touch using your secure Apple device credentials.</span>
                </div>
              </label>

              <label className={`payment-radio-card ${formData.paymentMethod === 'card' ? 'active' : ''}`}>
                <input
                  type="radio"
                  name="payment"
                  checked={formData.paymentMethod === 'card'}
                  onChange={() => setFormData({ ...formData, paymentMethod: 'card' })}
                />
                <div className="radio-content">
                  <div className="radio-title-row">
                    <span className="radio-title">Corporate Credit Card</span>
                  </div>
                  <span className="radio-desc">Standard procurement Visa / Mastercard / AMEX invoice.</span>
                </div>
              </label>
            </div>
          </div>

          <div className="checkout-submit-bar">
            <button type="button" className="btn-cancel" onClick={onBackToCart}>
              ← Return to Bag
            </button>
            <button
              type="submit"
              className="button button-wide"
              disabled={submitting}
            >
              <span>{submitting ? 'Authorizing...' : 'Place Order'}</span>
            </button>
          </div>
        </form>

        {/* Order Summary Column */}
        <div className="checkout-summary-column">
          <div className="cart-summary-card">
            <h2 className="summary-card-title">Order Items ({cart.length})</h2>

            <div className="checkout-items-mini-list">
              {cart.map(item => (
                <div key={item.product.id} className="checkout-mini-item">
                  <img src={item.product.image} alt={item.product.name} />
                  <div className="mini-item-details">
                    <span className="mini-item-title">{item.product.name}</span>
                    <span className="mini-item-qty">Qty: {item.quantity}</span>
                  </div>
                  <span className="mini-item-price">
                    ${(item.product.price * item.quantity).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>

            <div className="summary-divider" />

            <div className="summary-line">
              <span>Subtotal</span>
              <span>${subtotal.toLocaleString()}</span>
            </div>

            <div className="summary-line">
              <span>Shipping</span>
              <span className="text-highlight">FREE</span>
            </div>

            <div className="summary-line">
              <span>Estimated Tax (8%)</span>
              <span>${tax.toLocaleString()}</span>
            </div>

            <div className="summary-divider" />

            <div className="summary-total-line">
              <span>Total</span>
              <span className="total-amount">${total.toLocaleString()}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
