import React from 'react';
import { CartItem } from '../types';

interface CartViewProps {
  cart: CartItem[];
  onUpdateQuantity: (productId: string | number, delta: number) => void;
  onRemoveItem: (productId: string | number) => void;
  onClearCart: () => void;
  onProceedToCheckout: () => void;
  onContinueShopping: () => void;
}

export function CartView({
  cart,
  onUpdateQuantity,
  onRemoveItem,
  onClearCart,
  onProceedToCheckout,
  onContinueShopping,
}: CartViewProps) {
  const subtotal = cart.reduce((sum, item) => sum + item.product.price * item.quantity, 0);
  const estimatedTax = Math.round(subtotal * 0.08); // 8% sales tax
  const total = subtotal + estimatedTax;

  if (cart.length === 0) {
    return (
      <div className="cart-empty-container">
        <div className="cart-empty-card">
          <div className="cart-empty-icon-circle">
            <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
              <line x1="3" y1="6" x2="21" y2="6" />
              <path d="M16 10a4 4 0 0 1-8 0" />
            </svg>
          </div>
          <h2 className="empty-cart-title">Your Bag is empty.</h2>
          <p className="empty-cart-subtitle">
            Explore our curated hardware and Model Context Protocol devices to start building your workspace.
          </p>
          <button className="button button-wide" onClick={onContinueShopping}>
            <span>Continue Shopping</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="cart-view-container">
      <div className="cart-header-section">
        <h1 className="cart-headline">Review your Bag.</h1>
        <p className="cart-subtext">Free shipping and free returns on all orders.</p>
      </div>

      <div className="cart-content-grid">
        {/* Cart items column */}
        <div className="cart-items-column">
          <div className="cart-items-list">
            {cart.map(item => (
              <div key={item.product.id} className="cart-item-row">
                <div className="cart-item-media">
                  <img src={item.product.image} alt={item.product.name} />
                </div>

                <div className="cart-item-details">
                  <div className="cart-item-top">
                    <span className="cart-item-category">{item.product.category}</span>
                    <h3 className="cart-item-title">{item.product.name}</h3>
                    <p className="cart-item-desc">{item.product.short_description || item.product.description.slice(0, 80) + '...'}</p>
                  </div>

                  <div className="cart-item-bottom">
                    {/* Quantity modifier */}
                    <div className="cart-qty-control">
                      <button
                        className="qty-btn"
                        onClick={() => onUpdateQuantity(item.product.id, -1)}
                        title="Decrease quantity"
                      >
                        −
                      </button>
                      <span className="qty-value">{item.quantity}</span>
                      <button
                        className="qty-btn"
                        onClick={() => onUpdateQuantity(item.product.id, 1)}
                        title="Increase quantity"
                      >
                        +
                      </button>
                    </div>

                    <button
                      className="cart-remove-btn"
                      onClick={() => onRemoveItem(item.product.id)}
                    >
                      Remove
                    </button>
                  </div>
                </div>

                <div className="cart-item-price-column">
                  <span className="cart-item-total">
                    ${(item.product.price * item.quantity).toLocaleString()}
                  </span>
                  {item.quantity > 1 && (
                    <span className="cart-item-unit-price">
                      ${item.product.price.toLocaleString()} each
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="cart-actions-bar">
            <button className="text-link-btn" onClick={onClearCart}>
              Clear Entire Bag
            </button>
            <button className="text-link-btn" onClick={onContinueShopping}>
              ← Add more items
            </button>
          </div>
        </div>

        {/* Order summary column */}
        <div className="cart-summary-column">
          <div className="cart-summary-card">
            <h2 className="summary-card-title">Order Summary</h2>

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
              <span>${estimatedTax.toLocaleString()}</span>
            </div>

            <div className="summary-divider" />

            <div className="summary-total-line">
              <span>Total</span>
              <span className="total-amount">${total.toLocaleString()}</span>
            </div>

            <div className="summary-checkout-cta">
              <button
                className="button button-wide"
                onClick={onProceedToCheckout}
              >
                <span>Check Out</span>
              </button>
            </div>

            <div className="summary-guarantee-box">
              <div className="guarantee-item">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="1" y="3" width="15" height="13" />
                  <polygon points="16 8 20 8 23 11 23 16 16 16 16 8" />
                  <circle cx="5.5" cy="18.5" r="2.5" />
                  <circle cx="18.5" cy="18.5" r="2.5" />
                </svg>
                <span>Fast, contactless delivery</span>
              </div>
              <div className="guarantee-item">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
                <span>Hardware verified by MCP Gateway</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
