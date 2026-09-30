import React, { useState, useEffect } from 'react';
import { Store as StoreIcon, Package, Check, Clock, AlertTriangle, Key, Plus, RefreshCw, ChevronRight } from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import type { Store, Product, Order, StockRequest, Reservation } from '../types/index.ts';

interface SellerPortalProps {
  currentTab: string;
}

export const SellerPortal: React.FC<SellerPortalProps> = ({ currentTab }) => {
  const { user, getAuthHeaders } = useAuth();
  const [store, setStore] = useState<Store | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [stockRequests, setStockRequests] = useState<StockRequest[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [analytics, setAnalytics] = useState<{ totalRevenue: number; orderCount: number; pendingCount: number; lowStockCount: number }>({
    totalRevenue: 0, orderCount: 0, pendingCount: 0, lowStockCount: 0
  });

  const [loading, setLoading] = useState(true);
  const [statusUpdating, setStatusUpdating] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // New product modal state
  const [showAddModal, setShowAddModal] = useState(false);
  const [newProdName, setNewProdName] = useState('');
  const [newProdPrice, setNewProdPrice] = useState('');
  const [newProdStock, setNewProdStock] = useState('10');
  const [newProdCategory, setNewProdCategory] = useState('Dairy');

  const fetchSellerData = async () => {
    if (!user || user.role !== 'seller') return;
    try {
      const [storeRes, prodRes, ordersRes, reqRes, resvRes, anaRes] = await Promise.all([
        fetch('/api/seller/store', { headers: getAuthHeaders() }),
        fetch('/api/seller/products', { headers: getAuthHeaders() }),
        fetch('/api/seller/orders', { headers: getAuthHeaders() }),
        fetch('/api/seller/stock-requests', { headers: getAuthHeaders() }),
        fetch('/api/seller/reservations', { headers: getAuthHeaders() }),
        fetch('/api/seller/analytics', { headers: getAuthHeaders() })
      ]);

      if (storeRes.ok) {
        const d = await storeRes.json();
        setStore(d.store);
      }
      if (prodRes.ok) {
        const d = await prodRes.json();
        setProducts(d.products || []);
      }
      if (ordersRes.ok) {
        const d = await ordersRes.json();
        setOrders(d.orders || []);
      }
      if (reqRes.ok) {
        const d = await reqRes.json();
        setStockRequests(d.requests || []);
      }
      if (resvRes.ok) {
        const d = await resvRes.json();
        setReservations(d.reservations || []);
      }
      if (anaRes.ok) {
        const d = await anaRes.json();
        setAnalytics(d);
      }
    } catch (e) {
      console.error('Failed to fetch seller data:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSellerData();
  }, [user]);

  // Periodic poll so orders placed by customer appear in seller portal
  useEffect(() => {
    const interval = setInterval(fetchSellerData, 4000);
    return () => clearInterval(interval);
  }, [user]);

  const handleUpdateOrderStatus = async (orderId: string, nextStatus: string) => {
    setStatusUpdating(orderId);
    setActionNotice(null);
    try {
      const res = await fetch(`/api/seller/orders/${orderId}/status`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ status: nextStatus })
      });
      const data = await res.json();
      if (res.ok) {
        setActionNotice({
          text: `Order status moved to "${nextStatus.replace(/_/g, ' ')}" successfully!`,
          type: 'success'
        });
        fetchSellerData();
      } else {
        setActionNotice({ text: data.error || 'Failed to update order status', type: 'error' });
      }
    } catch (err: any) {
      setActionNotice({ text: err.message || 'Network error', type: 'error' });
    } finally {
      setStatusUpdating(null);
    }
  };

  const handleStockUpdate = async (productId: string, newStock: number) => {
    if (newStock < 0) return;
    try {
      const res = await fetch(`/api/seller/products/${productId}`, {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({ stock: newStock })
      });
      if (res.ok) {
        fetchSellerData();
      }
    } catch (e) {
      console.error('Failed to update stock:', e);
    }
  };

  const handleCreateProduct = async () => {
    if (!newProdName || !newProdPrice) return;
    try {
      const res = await fetch('/api/seller/products', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          name: newProdName,
          price: Number(newProdPrice),
          stock: Number(newProdStock) || 0,
          category: newProdCategory
        })
      });
      if (res.ok) {
        setShowAddModal(false);
        setNewProdName('');
        setNewProdPrice('');
        fetchSellerData();
        setActionNotice({ text: 'New product added to catalog!', type: 'success' });
      }
    } catch (e: any) {
      setActionNotice({ text: e.message, type: 'error' });
    }
  };

  const handleRespondStock = async (id: string, status: 'confirmed' | 'unavailable') => {
    try {
      const res = await fetch(`/api/seller/stock-requests/${id}`, {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          status,
          sellerResponse: status === 'confirmed' ? 'In stock and ready to pack!' : 'Currently sold out, new stock arriving tomorrow.'
        })
      });
      if (res.ok) {
        fetchSellerData();
        setActionNotice({ text: `Stock request marked as ${status}`, type: 'success' });
      }
    } catch (e: any) {
      setActionNotice({ text: e.message, type: 'error' });
    }
  };

  return (
    <div className="space-y-6">
      {/* Store Banner */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-700 shrink-0">
            <StoreIcon className="w-7 h-7" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold text-slate-900">{store?.name || 'Dwarka Fresh Mart'}</h1>
              <span className="text-xs font-semibold text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded">
                Store Open
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Shop 14-16, Vardhman City Mall, Sector 12, Dwarka, New Delhi 110078
            </p>
            <p className="text-xs text-slate-400 mt-0.5">
              Owner: Rahul Verma · Hours: 07:00 AM - 10:00 PM (Daily)
            </p>
          </div>
        </div>

        <button
          onClick={fetchSellerData}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5 text-slate-500" />
          Sync Live Data
        </button>
      </div>

      {actionNotice && (
        <div className={`p-3 rounded-lg text-xs font-medium flex items-center justify-between ${
          actionNotice.type === 'success' ? 'bg-emerald-50 text-emerald-900 border border-emerald-200' : 'bg-red-50 text-red-900 border border-red-200'
        }`}>
          <span>{actionNotice.text}</span>
          <button onClick={() => setActionNotice(null)} className="text-slate-500 hover:text-slate-900 ml-2">Dismiss</button>
        </div>
      )}

      {/* Real Performance Metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="p-4 bg-white border border-slate-200 rounded-xl shadow-xs">
          <span className="text-xs text-slate-500 block">Total Store Sales</span>
          <span className="text-xl font-extrabold text-slate-900 tabular-nums mt-1 block">
            ₹{analytics.totalRevenue}
          </span>
          <span className="text-[11px] text-emerald-600 font-medium mt-0.5 block">Persisted database orders</span>
        </div>

        <div className="p-4 bg-white border border-slate-200 rounded-xl shadow-xs">
          <span className="text-xs text-slate-500 block">Total Orders</span>
          <span className="text-xl font-extrabold text-slate-900 tabular-nums mt-1 block">
            {analytics.orderCount}
          </span>
          <span className="text-[11px] text-slate-400 mt-0.5 block">Lifetime orders</span>
        </div>

        <div className="p-4 bg-white border border-slate-200 rounded-xl shadow-xs">
          <span className="text-xs text-slate-500 block">Pending Orders</span>
          <span className="text-xl font-extrabold text-amber-600 tabular-nums mt-1 block">
            {analytics.pendingCount}
          </span>
          <span className="text-[11px] text-amber-700 mt-0.5 block">Needs store action</span>
        </div>

        <div className="p-4 bg-white border border-slate-200 rounded-xl shadow-xs">
          <span className="text-xs text-slate-500 block">Low Stock Alerts</span>
          <span className="text-xl font-extrabold text-red-600 tabular-nums mt-1 block">
            {analytics.lowStockCount}
          </span>
          <span className="text-[11px] text-slate-400 mt-0.5 block">Items with stock &le; 5</span>
        </div>
      </div>

      {/* Orders Tab */}
      {(currentTab === 'seller-orders' || currentTab === 'seller') && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-slate-900">
                Incoming Customer Orders &amp; Fulfilment Stepper
              </h2>
              <p className="text-xs text-slate-500">
                Accept order → Prepare → Pack → Mark Ready for Pickup to unlock the seller pickup code.
              </p>
            </div>
            <span className="text-xs font-semibold text-slate-500 tabular-nums">
              {orders.length} orders total
            </span>
          </div>

          {orders.length === 0 ? (
            <div className="p-12 text-center bg-white rounded-xl border border-slate-200">
              <Package className="w-10 h-10 text-slate-300 mx-auto mb-2" />
              <p className="text-sm font-semibold text-slate-700">No customer orders yet</p>
              <p className="text-xs text-slate-500 mt-1">
                Switch to Customer (Aarav Sharma) in the top bar to place an order for Amul Taaza Milk!
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {orders.map((order) => {
                const canAccept = order.status === 'placed';
                const canPrepare = order.status === 'accepted';
                const canPack = order.status === 'preparing';
                const canReadyPickup = order.status === 'packed';
                const isReadyOrBeyond = ['packed', 'ready_for_pickup', 'picked_up', 'out_for_delivery', 'delivered'].includes(order.status);

                return (
                  <div key={order.id} className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-100">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-mono font-bold text-slate-900">{order.order_number}</span>
                          <span className="text-slate-300">·</span>
                          <span className="text-xs font-semibold text-slate-700">Customer: {order.customer_name}</span>
                          {order.customer_phone && (
                            <span className="text-[11px] text-slate-400 font-mono">({order.customer_phone})</span>
                          )}
                        </div>
                        <span className="text-[11px] text-slate-400">
                          Order total: ₹{order.total} · Subtotal: ₹{order.subtotal}
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold uppercase px-2.5 py-1 rounded bg-slate-100 text-slate-800">
                          {order.status.replace(/_/g, ' ')}
                        </span>
                      </div>
                    </div>

                    {/* Order Items */}
                    <div className="py-3 divide-y divide-slate-100">
                      {order.items?.map(it => (
                        <div key={it.id} className="py-2 flex items-center justify-between text-xs">
                          <span className="font-semibold text-slate-800">{it.product_name} (×{it.quantity})</span>
                          <span className="font-bold text-slate-900 tabular-nums">₹{it.line_total}</span>
                        </div>
                      ))}
                    </div>

                    {/* CRITICAL: Seller Pickup Code Card */}
                    {isReadyOrBeyond && order.pickup_code && (
                      <div className="my-3 p-4 rounded-xl bg-amber-50 border border-amber-300 flex items-start gap-3">
                        <span className="p-2 rounded-lg bg-amber-600 text-white shrink-0">
                          <Key className="w-5 h-5" />
                        </span>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold uppercase tracking-wider text-amber-950">
                              Seller Parcel Pickup Code:
                            </span>
                            <span className="text-sm font-mono font-extrabold text-amber-900 bg-white px-2.5 py-0.5 rounded border border-amber-400 tracking-wider">
                              {order.pickup_code}
                            </span>
                          </div>
                          <p className="text-xs text-amber-800 mt-1">
                            Share this 4-digit code with NearBuy rider Arjun Kumar when they arrive at the store counter.
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Operational Action Buttons (State Machine) */}
                    <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3">
                      <div className="text-xs text-slate-500">
                        {order.status === 'placed' && 'Action: Review and accept order to begin fulfillment.'}
                        {order.status === 'accepted' && 'Action: Gather items from store shelves.'}
                        {order.status === 'preparing' && 'Action: Pack items into NearBuy parcel bag.'}
                        {order.status === 'packed' && 'Action: Place on pickup shelf & mark Ready for Pickup.'}
                        {order.status === 'ready_for_pickup' && 'Parcel is ready on counter. Awaiting rider pickup verification.'}
                        {order.status === 'picked_up' && 'Rider verified pickup code and collected parcel.'}
                        {order.status === 'out_for_delivery' && 'Rider is on the way to customer address.'}
                        {order.status === 'delivered' && '✓ Order delivered successfully to customer!'}
                      </div>

                      <div className="flex items-center gap-2">
                        {canAccept && (
                          <button
                            onClick={() => handleUpdateOrderStatus(order.id, 'accepted')}
                            disabled={statusUpdating === order.id}
                            className="px-4 py-1.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors cursor-pointer"
                          >
                            Accept Order
                          </button>
                        )}
                        {canPrepare && (
                          <button
                            onClick={() => handleUpdateOrderStatus(order.id, 'preparing')}
                            disabled={statusUpdating === order.id}
                            className="px-4 py-1.5 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors cursor-pointer"
                          >
                            Start Preparing
                          </button>
                        )}
                        {canPack && (
                          <button
                            onClick={() => handleUpdateOrderStatus(order.id, 'packed')}
                            disabled={statusUpdating === order.id}
                            className="px-4 py-1.5 text-xs font-bold text-white bg-purple-600 hover:bg-purple-700 rounded-lg transition-colors cursor-pointer"
                          >
                            Pack Items
                          </button>
                        )}
                        {canReadyPickup && (
                          <button
                            onClick={() => handleUpdateOrderStatus(order.id, 'ready_for_pickup')}
                            disabled={statusUpdating === order.id}
                            className="px-4 py-1.5 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-lg transition-colors cursor-pointer shadow-xs"
                          >
                            Mark Ready for Pickup
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Catalog & Inventory Tab */}
      {currentTab === 'seller-inventory' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-slate-900">Store Products &amp; Live Inventory</h2>
              <p className="text-xs text-slate-500">Update stock quantities, prices, or add new groceries.</p>
            </div>
            <button
              onClick={() => setShowAddModal(true)}
              className="px-3.5 py-1.5 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors flex items-center gap-1 shadow-xs"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Product
            </button>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold uppercase tracking-wider text-[11px]">
                  <tr>
                    <th className="py-3 px-4">Item Details</th>
                    <th className="py-3 px-4">Category</th>
                    <th className="py-3 px-4">Price (₹)</th>
                    <th className="py-3 px-4">Live Stock</th>
                    <th className="py-3 px-4 text-right">Quick Stock Controls</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {products.map(prod => (
                    <tr key={prod.id} className="hover:bg-slate-50/50">
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-3">
                          {prod.image && (
                            <img src={prod.image} alt="" className="w-10 h-10 object-cover rounded border border-slate-100 shrink-0" />
                          )}
                          <div>
                            <span className="font-bold text-slate-900 block">{prod.name}</span>
                            <span className="text-slate-400 text-[11px] line-clamp-1">{prod.description}</span>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-slate-600">{prod.category}</td>
                      <td className="py-3 px-4 font-bold text-slate-900 tabular-nums">₹{prod.price}</td>
                      <td className="py-3 px-4">
                        <span className={`font-bold tabular-nums px-2 py-0.5 rounded text-xs ${
                          prod.stock <= 5 ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-800'
                        }`}>
                          {prod.stock} units
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="inline-flex items-center gap-1.5 bg-slate-100 rounded p-1">
                          <button
                            onClick={() => handleStockUpdate(prod.id, prod.stock - 5)}
                            className="px-2 py-0.5 rounded bg-white text-slate-700 hover:bg-slate-200 font-bold text-[11px]"
                            title="Deduct 5"
                          >
                            -5
                          </button>
                          <button
                            onClick={() => handleStockUpdate(prod.id, prod.stock - 1)}
                            className="px-2 py-0.5 rounded bg-white text-slate-700 hover:bg-slate-200 font-bold text-[11px]"
                            title="Deduct 1"
                          >
                            -1
                          </button>
                          <span className="px-1 text-slate-500 font-semibold">|</span>
                          <button
                            onClick={() => handleStockUpdate(prod.id, prod.stock + 1)}
                            className="px-2 py-0.5 rounded bg-white text-slate-700 hover:bg-slate-200 font-bold text-[11px]"
                            title="Add 1"
                          >
                            +1
                          </button>
                          <button
                            onClick={() => handleStockUpdate(prod.id, prod.stock + 5)}
                            className="px-2 py-0.5 rounded bg-white text-slate-700 hover:bg-slate-200 font-bold text-[11px]"
                            title="Add 5"
                          >
                            +5
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Customer Inquiries & Requests */}
      {currentTab === 'seller-requests' && (
        <div className="space-y-4">
          <div>
            <h2 className="text-base font-bold text-slate-900">Customer Stock Checks &amp; Inquiries</h2>
            <p className="text-xs text-slate-500">Respond to customer stock check requests from the neighbourhood.</p>
          </div>

          {stockRequests.length === 0 ? (
            <div className="p-12 text-center bg-white rounded-xl border border-slate-200">
              <p className="text-xs text-slate-400">No customer stock inquiries currently pending.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {stockRequests.map(req => (
                <div key={req.id} className="p-4 bg-white border border-slate-200 rounded-xl shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
                  <div>
                    <span className="font-bold text-slate-900 block">{req.product_name}</span>
                    <span className="text-slate-500">
                      Customer asked for {req.requested_quantity} units · Customer: {req.customer_name}
                    </span>
                    {req.seller_response && (
                      <p className="text-slate-700 font-medium mt-1">Your reply: "{req.seller_response}"</p>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    {req.status === 'pending' ? (
                      <>
                        <button
                          onClick={() => handleRespondStock(req.id, 'confirmed')}
                          className="px-3 py-1.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors"
                        >
                          Confirm Available
                        </button>
                        <button
                          onClick={() => handleRespondStock(req.id, 'unavailable')}
                          className="px-3 py-1.5 text-xs font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
                        >
                          Mark Out of Stock
                        </button>
                      </>
                    ) : (
                      <span className={`font-bold px-2 py-0.5 rounded uppercase text-[11px] ${
                        req.status === 'confirmed' ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'
                      }`}>
                        {req.status}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Add Product Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-slate-200">
            <h3 className="text-base font-bold text-slate-900 mb-3">Add Product to Storefront</h3>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Product Name</label>
                <input
                  type="text"
                  placeholder="e.g. Amul Salted Butter 100g"
                  value={newProdName}
                  onChange={e => setNewProdName(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg outline-none focus:border-amber-600"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Price (₹)</label>
                  <input
                    type="number"
                    placeholder="e.g. 58"
                    value={newProdPrice}
                    onChange={e => setNewProdPrice(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg outline-none focus:border-amber-600"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Initial Stock</label>
                  <input
                    type="number"
                    value={newProdStock}
                    onChange={e => setNewProdStock(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg outline-none focus:border-amber-600"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Category</label>
                <select
                  value={newProdCategory}
                  onChange={e => setNewProdCategory(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg outline-none focus:border-amber-600 bg-white"
                >
                  <option value="Dairy">Dairy</option>
                  <option value="Staples & Grains">Staples &amp; Grains</option>
                  <option value="Bakery & Dairy">Bakery &amp; Dairy</option>
                  <option value="Oils & Ghee">Oils &amp; Ghee</option>
                  <option value="Snacks & Instant Food">Snacks &amp; Instant Food</option>
                  <option value="Beverages">Beverages</option>
                </select>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-4 mt-4 border-t border-slate-100">
              <button
                onClick={() => setShowAddModal(false)}
                className="px-3.5 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateProduct}
                className="px-4 py-2 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-lg transition-colors shadow-xs"
              >
                Publish to Store
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
