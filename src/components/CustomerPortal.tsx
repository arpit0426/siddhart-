import React, { useState, useEffect } from 'react';
import { Search, MapPin, Plus, Minus, ShoppingBag, Clock, Check, AlertCircle, ShieldAlert, Sparkles, Send, Key } from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import type { Product, Store, Order, StockRequest, Reservation } from '../types/index.ts';

interface CustomerPortalProps {
  currentTab: string;
  onOrderPlaced: () => void;
  onAddToCart: (productId: string, qty: number) => void;
  cartItemsCount: Record<string, number>;
}

export const CustomerPortal: React.FC<CustomerPortalProps> = ({
  currentTab,
  onOrderPlaced,
  onAddToCart,
  cartItemsCount
}) => {
  const { user, getAuthHeaders, demoLogin } = useAuth();
  const [stores, setStores] = useState<Store[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [stockRequests, setStockRequests] = useState<StockRequest[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [loading, setLoading] = useState(true);
  const [actionMessage, setActionMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Stock check / Reservation modal state
  const [activeModal, setActiveModal] = useState<{ type: 'stock' | 'reserve'; product: Product } | null>(null);
  const [modalQty, setModalQty] = useState(1);
  const [modalSubmitting, setModalSubmitting] = useState(false);

  const fetchStoresAndProducts = async () => {
    try {
      const [storesRes, productsRes] = await Promise.all([
        fetch('/api/customer/stores'),
        fetch('/api/customer/products')
      ]);
      if (storesRes.ok) {
        const data = await storesRes.json();
        setStores(data.stores || []);
      }
      if (productsRes.ok) {
        const data = await productsRes.json();
        setProducts(data.products || []);
      }
    } catch (err) {
      console.error('Failed to fetch stores/products:', err);
    }
  };

  const fetchCustomerOrders = async () => {
    if (!user || user.role !== 'customer') return;
    try {
      const res = await fetch('/api/customer/orders', {
        headers: getAuthHeaders()
      });
      if (res.ok) {
        const data = await res.json();
        setOrders(data.orders || []);
      }
    } catch (err) {
      console.error('Failed to fetch orders:', err);
    }
  };

  const fetchCustomerRequests = async () => {
    if (!user || user.role !== 'customer') return;
    try {
      const [stockRes, resvRes] = await Promise.all([
        fetch('/api/customer/stock-requests', { headers: getAuthHeaders() }),
        fetch('/api/customer/reservations', { headers: getAuthHeaders() })
      ]);
      if (stockRes.ok) {
        const data = await stockRes.json();
        setStockRequests(data.requests || []);
      }
      if (resvRes.ok) {
        const data = await resvRes.json();
        setReservations(data.reservations || []);
      }
    } catch (err) {
      console.error('Failed to fetch customer requests:', err);
    }
  };

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchStoresAndProducts(), fetchCustomerOrders(), fetchCustomerRequests()]).finally(() => {
      setLoading(false);
    });
  }, [user]);

  // Periodic refresh so status changes from seller/rider appear automatically
  useEffect(() => {
    const interval = setInterval(() => {
      if (currentTab === 'orders') {
        fetchCustomerOrders();
      }
      fetchStoresAndProducts();
    }, 5000);
    return () => clearInterval(interval);
  }, [currentTab, user]);

  const handleStockOrReserveSubmit = async () => {
    if (!activeModal) return;
    if (!user) {
      await demoLogin('customer');
    }
    setModalSubmitting(true);
    try {
      const endpoint = activeModal.type === 'stock' ? '/api/customer/stock-requests' : '/api/customer/reservations';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          productId: activeModal.product.id,
          requestedQuantity: modalQty
        })
      });
      if (res.ok) {
        setActionMessage({
          text: activeModal.type === 'stock'
            ? `Stock check request for ${modalQty}x ${activeModal.product.name} sent to seller!`
            : `Reservation request for ${modalQty}x ${activeModal.product.name} sent to seller!`,
          type: 'success'
        });
        setActiveModal(null);
        setModalQty(1);
        fetchCustomerRequests();
      } else {
        const err = await res.json();
        setActionMessage({ text: err.error || 'Request failed', type: 'error' });
      }
    } catch (e: any) {
      setActionMessage({ text: e.message || 'Network error', type: 'error' });
    } finally {
      setModalSubmitting(false);
    }
  };

  const filteredProducts = products.filter(p => {
    const matchesSearch = p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          p.category.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          (p.store_name && p.store_name.toLowerCase().includes(searchQuery.toLowerCase()));
    const matchesCategory = selectedCategory === 'All' || p.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const categories = ['All', 'Dairy', 'Staples & Grains', 'Bakery & Dairy', 'Oils & Ghee', 'Snacks & Instant Food'];

  // Order status badge styling
  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'placed':
        return <span className="text-amber-800 font-semibold text-xs">Placed · Awaiting Seller</span>;
      case 'accepted':
        return <span className="text-blue-800 font-semibold text-xs">Accepted by Store</span>;
      case 'preparing':
        return <span className="text-indigo-800 font-semibold text-xs">Store Preparing Items</span>;
      case 'packed':
        return <span className="text-purple-800 font-semibold text-xs">Items Packed</span>;
      case 'ready_for_pickup':
        return <span className="text-orange-800 font-semibold text-xs">Ready for Rider Pickup</span>;
      case 'out_for_delivery':
        return <span className="text-blue-800 font-semibold text-xs animate-pulse">Out for Delivery</span>;
      case 'delivered':
        return <span className="text-emerald-800 font-semibold text-xs">Delivered Successfully</span>;
      default:
        return <span className="text-slate-700 font-semibold text-xs">{status}</span>;
    }
  };

  return (
    <div className="space-y-6">
      {actionMessage && (
        <div className={`p-3 rounded-lg text-xs font-medium flex items-center justify-between ${
          actionMessage.type === 'success' ? 'bg-emerald-50 text-emerald-900 border border-emerald-200' : 'bg-red-50 text-red-900 border border-red-200'
        }`}>
          <span>{actionMessage.text}</span>
          <button onClick={() => setActionMessage(null)} className="text-slate-500 hover:text-slate-900 ml-2">Dismiss</button>
        </div>
      )}

      {currentTab === 'discover' && (
        <>
          {/* Hero Banner */}
          <div className="relative rounded-2xl overflow-hidden bg-gradient-to-r from-emerald-800 to-teal-900 text-white p-6 sm:p-8 shadow-sm">
            <div className="relative z-10 max-w-2xl">
              <span className="text-xs uppercase tracking-widest text-emerald-300 font-bold mb-1 block">
                NearBuy Neighbourhood Commerce
              </span>
              <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight mb-2 text-white">
                What You Need, Already Nearby.
              </h1>
              <p className="text-emerald-100 text-sm mb-4 leading-relaxed">
                Order milk, atta, spices, and essentials directly from trusted neighbourhood grocers in Dwarka. Packed with care, delivered to your door with real verification.
              </p>

              {/* Search Bar */}
              <div className="relative flex items-center bg-white rounded-xl shadow-md text-slate-800 p-1.5 max-w-lg">
                <Search className="w-5 h-5 text-slate-400 ml-2.5 shrink-0" />
                <input
                  type="text"
                  placeholder="Search “Amul Taaza”, “Atta”, “Salt”, “Bread”..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full px-3 py-1.5 text-sm bg-transparent outline-none text-slate-900 placeholder:text-slate-400"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="text-xs text-slate-400 hover:text-slate-600 px-2"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Store Spotlight: Dwarka Fresh Mart */}
          <div className="border border-slate-200 rounded-xl bg-white p-5 shadow-xs">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <img
                  src="/src/assets/images/dwarka_mart_store_1790786007152.jpg"
                  alt="Dwarka Fresh Mart Storefront"
                  className="w-16 h-16 rounded-lg object-cover border border-slate-100 shrink-0"
                  referrerPolicy="no-referrer"
                />
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-bold text-slate-900">Dwarka Fresh Mart</h2>
                    <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                      Open Now
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 mt-0.5 flex items-center gap-1">
                    <MapPin className="w-3.5 h-3.5 text-slate-400" />
                    Shop 14-16, Vardhman City Mall, Sector 12, Dwarka, New Delhi 110078
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5 text-slate-400" />
                    07:00 AM - 10:00 PM (Daily) · Managed by Rahul Verma
                  </p>
                </div>
              </div>

              <div className="text-left sm:text-right shrink-0">
                <span className="text-xs font-semibold text-emerald-800 bg-emerald-50 px-2.5 py-1 rounded">
                  Flat ₹30 Delivery
                </span>
                <p className="text-[11px] text-slate-500 mt-1">Average delivery: 25-35 mins</p>
              </div>
            </div>
          </div>

          {/* Category Tabs */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
                  selectedCategory === cat
                    ? 'bg-slate-900 text-white shadow-xs'
                    : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* Products Grid */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-slate-900">
                Fresh Groceries &amp; Daily Staples ({filteredProducts.length} items)
              </h3>
              <span className="text-xs text-slate-500">Live inventory from database</span>
            </div>

            {filteredProducts.length === 0 ? (
              <div className="text-center py-12 bg-white rounded-xl border border-slate-200">
                <ShoppingBag className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                <p className="text-sm font-semibold text-slate-700">No products matching "{searchQuery}"</p>
                <p className="text-xs text-slate-500 mt-1">Try searching for Amul, Atta, Salt, Oil, or Bread.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {filteredProducts.map((product) => {
                  const inCartQty = cartItemsCount[product.id] || 0;
                  const isOutOfStock = product.stock <= 0;

                  return (
                    <div
                      key={product.id}
                      className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs hover:shadow-md transition-shadow flex flex-col justify-between"
                    >
                      <div>
                        {/* Product Image */}
                        <div className="relative aspect-[4/3] bg-slate-100 overflow-hidden">
                          {product.image ? (
                            <img
                              src={product.image}
                              alt={product.name}
                              className="w-full h-full object-cover"
                              referrerPolicy="no-referrer"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-slate-400">
                              <ShoppingBag className="w-8 h-8" />
                            </div>
                          )}

                          {isOutOfStock && (
                            <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-[2px] flex items-center justify-center">
                              <span className="bg-red-600 text-white text-xs font-bold px-2 py-1 rounded">
                                Out of Stock
                              </span>
                            </div>
                          )}

                          <div className="absolute top-2 right-2 bg-white/90 backdrop-blur-xs px-2 py-0.5 rounded text-[11px] font-semibold text-slate-700 shadow-2xs">
                            {product.store_name || 'Dwarka Mart'}
                          </div>
                        </div>

                        {/* Product Details */}
                        <div className="p-4 pb-2">
                          <span className="text-[11px] font-medium text-slate-500 uppercase tracking-wider block">
                            {product.category}
                          </span>
                          <h4 className="text-sm font-bold text-slate-900 mt-0.5 line-clamp-1">
                            {product.name}
                          </h4>
                          <p className="text-xs text-slate-500 mt-1 line-clamp-2 leading-relaxed">
                            {product.description}
                          </p>
                        </div>
                      </div>

                      {/* Footer: Price & Cart Action */}
                      <div className="p-4 pt-0 border-t border-slate-100 mt-3">
                        <div className="flex items-center justify-between pt-3">
                          <div>
                            <span className="text-base font-extrabold text-slate-900 tabular-nums">
                              ₹{product.price}
                            </span>
                            <span className="block text-[11px] text-slate-500 tabular-nums">
                              {product.stock > 0 ? `${product.stock} in stock` : 'Unavailable'}
                            </span>
                          </div>

                          {isOutOfStock ? (
                            <button
                              onClick={() => setActiveModal({ type: 'stock', product })}
                              className="px-2.5 py-1.5 text-xs font-medium text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-lg transition-colors"
                            >
                              Request Stock
                            </button>
                          ) : inCartQty > 0 ? (
                            <div className="flex items-center gap-2 bg-slate-100 rounded-lg p-1">
                              <button
                                onClick={() => onAddToCart(product.id, inCartQty - 1)}
                                className="w-6 h-6 rounded bg-white text-slate-700 hover:bg-slate-200 flex items-center justify-center font-bold text-xs"
                                aria-label="Decrease quantity"
                              >
                                <Minus className="w-3 h-3" />
                              </button>
                              <span className="text-xs font-bold px-1 tabular-nums">{inCartQty}</span>
                              <button
                                onClick={() => onAddToCart(product.id, inCartQty + 1)}
                                disabled={inCartQty >= product.stock}
                                className="w-6 h-6 rounded bg-white text-slate-700 hover:bg-slate-200 flex items-center justify-center font-bold text-xs disabled:opacity-40"
                                aria-label="Increase quantity"
                              >
                                <Plus className="w-3 h-3" />
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => onAddToCart(product.id, 1)}
                              className="px-3.5 py-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors flex items-center gap-1 shadow-xs"
                            >
                              <Plus className="w-3.5 h-3.5" />
                              Add
                            </button>
                          )}
                        </div>

                        {/* Secondary Quick Action: Reserve */}
                        {!isOutOfStock && (
                          <div className="mt-2.5 flex items-center justify-between text-[11px] text-slate-400 pt-2 border-t border-slate-50">
                            <button
                              onClick={() => setActiveModal({ type: 'reserve', product })}
                              className="hover:text-emerald-700 transition-colors"
                            >
                              Hold / Reserve item
                            </button>
                            <button
                              onClick={() => setActiveModal({ type: 'stock', product })}
                              className="hover:text-amber-700 transition-colors"
                            >
                              Ask Seller
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}

      {/* Orders Tab */}
      {currentTab === 'orders' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-slate-900">Your Placed Orders &amp; Delivery Verification</h2>
              <p className="text-xs text-slate-500">
                Track status in real-time. Share your delivery code with the NearBuy rider only upon arrival.
              </p>
            </div>
            <button
              onClick={fetchCustomerOrders}
              className="text-xs font-medium text-emerald-700 bg-emerald-50 px-3 py-1.5 rounded-lg border border-emerald-200 hover:bg-emerald-100"
            >
              Refresh Status
            </button>
          </div>

          {orders.length === 0 ? (
            <div className="text-center py-16 bg-white rounded-xl border border-slate-200">
              <ShoppingBag className="w-10 h-10 text-slate-300 mx-auto mb-2" />
              <h3 className="text-sm font-semibold text-slate-800">No orders placed yet</h3>
              <p className="text-xs text-slate-500 mt-1 mb-4">
                Add Amul Taaza Milk from Dwarka Fresh Mart to your cart to experience the complete delivery loop!
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {orders.map((order) => {
                const isDelivered = order.status === 'delivered';
                const isOutForDelivery = order.status === 'out_for_delivery';

                return (
                  <div key={order.id} className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-100">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-mono font-bold text-slate-900">{order.order_number}</span>
                          <span className="text-slate-300">·</span>
                          <span className="text-xs font-semibold text-slate-700">{order.store_name}</span>
                        </div>
                        <span className="text-[11px] text-slate-400">
                          Placed on {new Date(order.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}, {new Date(order.created_at).toLocaleDateString()}
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        {getStatusBadge(order.status)}
                      </div>
                    </div>

                    {/* CRITICAL: Customer Delivery Verification Code Banner */}
                    <div className={`mt-4 p-4 rounded-xl border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 ${
                      isDelivered 
                        ? 'bg-slate-50 border-slate-200' 
                        : 'bg-emerald-50/80 border-emerald-300'
                    }`}>
                      <div className="flex items-start gap-3">
                        <span className={`p-2 rounded-lg ${isDelivered ? 'bg-slate-200 text-slate-700' : 'bg-emerald-600 text-white'}`}>
                          <Key className="w-5 h-5" />
                        </span>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold uppercase tracking-wider text-slate-900">
                              Customer Delivery Verification Code:
                            </span>
                            <span className="text-sm font-mono font-extrabold text-emerald-900 bg-white px-2.5 py-0.5 rounded border border-emerald-400 tracking-wider">
                              {order.delivery_code}
                            </span>
                          </div>
                          <p className="text-xs text-slate-600 mt-1">
                            {isDelivered 
                              ? '✓ Delivery code was successfully verified by rider Arjun Kumar.' 
                              : 'Give this 4-digit code to rider Arjun Kumar when they arrive with your parcel.'}
                          </p>
                        </div>
                      </div>

                      <div className="text-left sm:text-right shrink-0">
                        <span className="text-xs font-bold text-slate-900">
                          {order.rider_name ? `Rider: ${order.rider_name}` : 'Awaiting Rider Assignment'}
                        </span>
                        {order.rider_phone && (
                          <span className="block text-[11px] text-slate-500 font-mono">
                            {order.rider_phone}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Order Items */}
                    <div className="mt-4 divide-y divide-slate-100">
                      {order.items?.map((item) => (
                        <div key={item.id} className="py-2.5 flex items-center justify-between text-xs">
                          <div className="flex items-center gap-3">
                            {item.product_image && (
                              <img src={item.product_image} alt="" className="w-10 h-10 rounded object-cover border border-slate-100" />
                            )}
                            <div>
                              <span className="font-semibold text-slate-900">{item.product_name}</span>
                              <span className="block text-slate-500">Qty: {item.quantity} × ₹{item.unit_price}</span>
                            </div>
                          </div>
                          <span className="font-bold text-slate-900 tabular-nums">₹{item.line_total}</span>
                        </div>
                      ))}
                    </div>

                    {/* Totals Breakdown */}
                    <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-600">
                      <div>
                        <span>Subtotal: ₹{order.subtotal}</span>
                        <span className="mx-2">·</span>
                        <span>Delivery Fee: ₹{order.delivery_fee}</span>
                        <span className="mx-2">·</span>
                        <span className="font-medium text-slate-700">Cash on Delivery</span>
                      </div>
                      <span className="text-sm font-extrabold text-slate-900 tabular-nums">
                        Total: ₹{order.total}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Stock Requests / Reservations Tab */}
      {currentTab === 'requests' && (
        <div className="space-y-6">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Customer Requests &amp; Holds</h2>
            <p className="text-xs text-slate-500">
              Track seller responses for stock checks and item holds.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Stock Checks */}
            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs">
              <h3 className="text-sm font-bold text-slate-900 mb-3 flex items-center justify-between">
                <span>Stock Check Requests</span>
                <span className="text-xs text-slate-500">{stockRequests.length} total</span>
              </h3>

              {stockRequests.length === 0 ? (
                <p className="text-xs text-slate-400 py-6 text-center">No active stock requests.</p>
              ) : (
                <div className="space-y-3">
                  {stockRequests.map((sr) => (
                    <div key={sr.id} className="p-3 rounded-lg border border-slate-100 bg-slate-50 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-slate-900">{sr.product_name}</span>
                        <span className={`text-[11px] font-bold uppercase px-1.5 py-0.5 rounded ${
                          sr.status === 'confirmed' ? 'bg-emerald-100 text-emerald-800' :
                          sr.status === 'unavailable' ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800'
                        }`}>
                          {sr.status}
                        </span>
                      </div>
                      <p className="text-slate-500 mt-1">Requested Qty: {sr.requested_quantity} · {sr.store_name}</p>
                      {sr.seller_response && (
                        <p className="text-slate-700 font-medium mt-1">Seller note: "{sr.seller_response}"</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Reservations */}
            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs">
              <h3 className="text-sm font-bold text-slate-900 mb-3 flex items-center justify-between">
                <span>Item Reservations</span>
                <span className="text-xs text-slate-500">{reservations.length} total</span>
              </h3>

              {reservations.length === 0 ? (
                <p className="text-xs text-slate-400 py-6 text-center">No reservations requested.</p>
              ) : (
                <div className="space-y-3">
                  {reservations.map((r) => (
                    <div key={r.id} className="p-3 rounded-lg border border-slate-100 bg-slate-50 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-slate-900">{r.product_name}</span>
                        <span className={`text-[11px] font-bold uppercase px-1.5 py-0.5 rounded ${
                          r.status === 'confirmed' ? 'bg-emerald-100 text-emerald-800' :
                          r.status === 'rejected' ? 'bg-red-100 text-red-800' : 'bg-blue-100 text-blue-800'
                        }`}>
                          {r.status}
                        </span>
                      </div>
                      <p className="text-slate-500 mt-1">Reserved Qty: {r.requested_quantity} · {r.store_name}</p>
                      {r.seller_response && (
                        <p className="text-slate-700 font-medium mt-1">Seller note: "{r.seller_response}"</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Stock Check / Reservation Modal */}
      {activeModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-slate-200">
            <h3 className="text-base font-bold text-slate-900 mb-1">
              {activeModal.type === 'stock' ? 'Request Stock Verification' : 'Hold / Reserve Item'}
            </h3>
            <p className="text-xs text-slate-500 mb-4">
              Send a real persisted inquiry to {activeModal.product.store_name || 'Dwarka Fresh Mart'}.
            </p>

            <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 mb-4 flex items-center gap-3">
              {activeModal.product.image && (
                <img src={activeModal.product.image} alt="" className="w-12 h-12 object-cover rounded" />
              )}
              <div>
                <span className="text-xs font-bold text-slate-900">{activeModal.product.name}</span>
                <span className="block text-xs font-extrabold text-emerald-700">₹{activeModal.product.price}</span>
              </div>
            </div>

            <div className="mb-4">
              <label className="block text-xs font-semibold text-slate-700 mb-1">Requested Quantity</label>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setModalQty(Math.max(1, modalQty - 1))}
                  className="w-8 h-8 rounded border border-slate-300 flex items-center justify-center text-slate-700"
                >
                  <Minus className="w-3.5 h-3.5" />
                </button>
                <span className="w-12 text-center text-sm font-bold">{modalQty}</span>
                <button
                  onClick={() => setModalQty(modalQty + 1)}
                  className="w-8 h-8 rounded border border-slate-300 flex items-center justify-center text-slate-700"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                onClick={() => setActiveModal(null)}
                className="px-3.5 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={handleStockOrReserveSubmit}
                disabled={modalSubmitting}
                className="px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors flex items-center gap-1.5"
              >
                <Send className="w-3.5 h-3.5" />
                {modalSubmitting ? 'Submitting...' : 'Send to Seller'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
