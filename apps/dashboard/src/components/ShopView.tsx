import React, { useState, useEffect } from 'react';
import { Product } from '../types';
import { executeToolCall, User } from '../api';

interface ShopViewProps {
  onAddToCart: (product: Product) => void;
  user: User | null;
  onNavigateToCart: () => void;
}

export function ShopView({ onAddToCart, user, onNavigateToCart }: ShopViewProps) {
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [syncing, setSyncing] = useState<boolean>(false);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);
  const [addedNotice, setAddedNotice] = useState<string | null>(null);

  // New product modal state
  const [showAddModal, setShowAddModal] = useState<boolean>(false);
  const [newProductName, setNewProductName] = useState('');
  const [newProductPrice, setNewProductPrice] = useState('499');
  const [newProductDesc, setNewProductDesc] = useState('');
  const [newProductCategory, setNewProductCategory] = useState('Hardware');
  const [creatingProduct, setCreatingProduct] = useState(false);

  // Sync with WooCommerce MCP tools on mount or button click
  const syncWithWooCommerce = async () => {
    setSyncing(true);
    setSyncStatus('Connecting to WooCommerce MCP upstream...');
    try {
      const result = await executeToolCall('woocommerce__list_products', { per_page: 20 });
      if (result && Array.isArray(result) && result.length > 0) {
        // Map real WooCommerce products to the existing card design.
        const mapped: Product[] = result.map((item: any, idx: number) => ({
          id: item.id || `woo-${idx}`,
          name: item.name || 'WooCommerce Product',
          price: Number(item.price || item.regular_price || 0),
          regular_price: String(item.regular_price || item.price || 99),
          description: item.description?.replace(/<[^>]*>?/gm, '') || 'WooCommerce synced product',
          category: item.categories?.[0]?.name || 'Hardware',
          image: item.images?.[0]?.src || '',
          stock_status: item.stock_status || 'instock',
          features: ['WooCommerce Verified', 'MCP Gateway Integrated'],
          tag: 'WooCommerce'
        }));
        setProducts(mapped);
        setSyncStatus(`Loaded ${mapped.length} products from WooCommerce.`);
      } else {
        setProducts([]);
        setSyncStatus('WooCommerce returned no products.');
      }
    } catch (err) {
      setProducts([]);
      setSyncStatus(err instanceof Error ? err.message : 'WooCommerce is unreachable.');
    } finally {
      setSyncing(false);
      setTimeout(() => setSyncStatus(null), 4000);
    }
  };

  const handleCreateProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProductName.trim()) return;
    setCreatingProduct(true);
    try {
      await executeToolCall('woocommerce__create_product', {
        name: newProductName.trim(),
        regular_price: newProductPrice.trim(),
        description: newProductDesc.trim() || 'Created via Urumi MCP Dashboard',
        status: 'publish',
      });
    } catch (error) {
      setSyncStatus(error instanceof Error ? error.message : 'Product creation failed.');
      setCreatingProduct(false);
      return;
    }

    const created: Product = {
      id: Date.now(),
      name: newProductName.trim(),
      price: Number(newProductPrice) || 299,
      regular_price: newProductPrice,
      description: newProductDesc || 'Custom provisioned MCP peripheral device.',
      category: newProductCategory,
      image: '',
      stock_status: 'instock',
      features: ['Custom Provisioned', 'Active Node'],
      tag: 'New'
    };

    await syncWithWooCommerce();
    setCreatingProduct(false);
    setShowAddModal(false);
    setNewProductName('');
    setNewProductDesc('');
    setAddedNotice(`Product "${created.name}" created and published!`);
    setTimeout(() => setAddedNotice(null), 3500);
  };

  const categories = ['All', ...new Set(products.map(p => p.category))];

  const filteredProducts = products.filter(p => {
    const matchesCat = selectedCategory === 'All' || p.category === selectedCategory;
    const matchesSearch = p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          p.description.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCat && matchesSearch;
  });

  const handleAdd = (product: Product) => {
    onAddToCart(product);
    setAddedNotice(`Added "${product.name}" to Cart.`);
    setTimeout(() => setAddedNotice(null), 3000);
  };

  return (
    <div className="shop-view-container">
      {/* Toast notification */}
      {addedNotice && (
        <div className="apple-toast-notice">
          <span>{addedNotice}</span>
          <button className="toast-action-btn" onClick={onNavigateToCart}>
            View Cart →
          </button>
        </div>
      )}

      {/* Hero Section */}
      <section className="shop-hero">
        <span className="apple-kicker">Store</span>
        <h1 className="apple-hero-headline">
          The best way to buy the <br />
          <span className="gradient-text">products you love.</span>
        </h1>
        <p className="apple-hero-subtext">
          Engineered for zero-latency Model Context Protocol execution, WooCommerce intelligence, and enterprise hardware management.
        </p>

        {/* Action bar */}
        <div className="shop-controls-bar">
          <div className="search-input-wrapper">
            <svg viewBox="0 0 24 24" width="16" height="16" className="search-icon">
              <circle cx="11" cy="11" r="8" fill="none" stroke="currentColor" strokeWidth="2" />
              <path d="m21 21-4.35-4.35" fill="none" stroke="currentColor" strokeWidth="2" />
            </svg>
            <input
              type="text"
              className="apple-search-input"
              placeholder="Search products, models, or specs..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
          </div>

          <div className="shop-actions-group">
            <button
              className="button button-action"
              onClick={syncWithWooCommerce}
              disabled={syncing}
              title="Query upstream WooCommerce MCP server"
            >
              <svg className="icon" viewBox="0 0 24 24">
                <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" fill="none" stroke="currentColor" strokeWidth="2" />
                <path d="M3 3v5h5" fill="none" stroke="currentColor" strokeWidth="2" />
                <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" fill="none" stroke="currentColor" strokeWidth="2" />
                <path d="M21 21v-5h-5" fill="none" stroke="currentColor" strokeWidth="2" />
              </svg>
              <span>{syncing ? 'Syncing...' : 'Sync MCP'}</span>
            </button>

            {user?.role === 'admin' && (
              <button
                className="button button-action"
                onClick={() => setShowAddModal(true)}
              >
                <svg className="icon" viewBox="0 0 24 24">
                  <path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" strokeWidth="2" />
                </svg>
                <span>+ Product</span>
              </button>
            )}
          </div>
        </div>

        {syncStatus && <div className="sync-status-badge">{syncStatus}</div>}

        {/* Category Pills */}
        <div className="category-pills-row">
          {categories.map(cat => (
            <button
              key={cat}
              className={`category-pill ${selectedCategory === cat ? 'active' : ''}`}
              onClick={() => setSelectedCategory(cat)}
            >
              {cat}
            </button>
          ))}
        </div>
      </section>

      {/* Product Grid */}
      <section className="products-grid-section">
        {filteredProducts.length === 0 ? (
          <div className="empty-catalog-card">
            <h3>No products found</h3>
            <p>Try refining your search terms or reset the category filter.</p>
            <button className="button" onClick={() => { setSearchQuery(''); setSelectedCategory('All'); }}>
              <span>Reset</span>
            </button>
          </div>
        ) : (
          <div className="apple-product-grid">
            {filteredProducts.map(product => (
              <div key={product.id} className="apple-product-card">
                <div className="product-media-container">
                  {product.tag && <span className="product-tag-badge">{product.tag}</span>}
                  {product.image && <img src={product.image} alt={product.name} className="product-img" loading="lazy" />}
                </div>

                <div className="product-info-container">
                  <span className="product-category-label">{product.category}</span>
                  <h3 className="product-name">{product.name}</h3>
                  <p className="product-description">{product.description}</p>

                  <ul className="product-features-list">
                    {product.features.slice(0, 3).map((feat, i) => (
                      <li key={i}>{feat}</li>
                    ))}
                  </ul>

                  <div className="product-footer-row">
                    <div className="product-price-box">
                      <span className="price-currency">$</span>
                      <span className="price-amount">{product.price.toLocaleString()}</span>
                    </div>

                    {/* Button using SalladShooter Uiverse style */}
                    <button
                      className="button"
                      onClick={() => handleAdd(product)}
                      title={`Add ${product.name} to cart`}
                    >
                      <svg className="icon" viewBox="0 0 24 24">
                        <circle cx="9" cy="21" r="1" />
                        <circle cx="20" cy="21" r="1" />
                        <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
                      </svg>
                      <span>Buy</span>
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Admin New Product Modal */}
      {showAddModal && (
        <div className="apple-modal-overlay" onClick={() => setShowAddModal(false)}>
          <div className="apple-modal-card" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Publish WooCommerce Product</h2>
              <button className="modal-close-btn" onClick={() => setShowAddModal(false)}>✕</button>
            </div>
            <form onSubmit={handleCreateProduct}>
              <div className="form-group">
                <label className="form-label">Product Name</label>
                <input
                  type="text"
                  required
                  className="apple-form-input"
                  placeholder="e.g. Urumi Neural Accelerator Hub"
                  value={newProductName}
                  onChange={e => setNewProductName(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Price (USD)</label>
                <input
                  type="number"
                  required
                  className="apple-form-input"
                  placeholder="299"
                  value={newProductPrice}
                  onChange={e => setNewProductPrice(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Category</label>
                <select
                  className="apple-form-input"
                  value={newProductCategory}
                  onChange={e => setNewProductCategory(e.target.value)}
                >
                  <option value="Hardware">Hardware</option>
                  <option value="Displays">Displays</option>
                  <option value="Peripherals">Peripherals</option>
                  <option value="Sensors">Sensors</option>
                  <option value="Audio">Audio</option>
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Technical Description</label>
                <textarea
                  className="apple-form-input"
                  rows={3}
                  placeholder="Describe hardware specs and MCP capability..."
                  value={newProductDesc}
                  onChange={e => setNewProductDesc(e.target.value)}
                />
              </div>

              <div className="modal-actions-footer">
                <button type="button" className="btn-cancel" onClick={() => setShowAddModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="button" disabled={creatingProduct}>
                  <span>{creatingProduct ? 'Publishing...' : 'Publish'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
