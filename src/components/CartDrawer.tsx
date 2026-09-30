import React, { useState, useEffect } from 'react';
import { X, Trash2, Plus, Minus, ShoppingBag, ArrowRight, ShieldCheck, CheckCircle2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import type { CartItem, CustomerAddress } from '../types/index.ts';

interface CartDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onOrderSuccess: () => void;
  onCartChange: () => void;
}

export const CartDrawer: React.FC<CartDrawerProps> = ({
  isOpen,
  onClose,
  onOrderSuccess,
  onCartChange
}) => {
  const { user, getAuthHeaders, demoLogin } = useAuth();
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [addresses, setAddresses] = useState<CustomerAddress[]>([]);
  const [selectedAddressId, setSelectedAddressId] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const fetchCartAndAddresses = async () => {
    if (!user || user.role !== 'customer') return;
    setLoading(true);
    try {
      const [cartRes, addrRes] = await Promise.all([
        fetch('/api/customer/cart', { headers: getAuthHeaders() }),
        fetch('/api/customer/addresses', { headers: getAuthHeaders() })
      ]);
      if (cartRes.ok) {
        const data = await cartRes.json();
        setCartItems(data.items || []);
      }
      if (addrRes.ok) {
        const addrData = await addrRes.json();
        setAddresses(addrData.addresses || []);
        if (addrData.addresses?.length > 0) {
          const defaultAddr = addrData.addresses.find((a: any) => a.is_default === 1);
          setSelectedAddressId(defaultAddr ? defaultAddr.id : addrData.addresses[0].id);
        }
      }
    } catch (err) {
      console.error('Failed to load cart/addresses:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchCartAndAddresses();
    }
  }, [isOpen, user]);

  const updateQuantity = async (productId: string, newQty: number) => {
    try {
      const res = await fetch('/api/customer/cart/items', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ productId, quantity: newQty })
      });
      if (res.ok) {
        fetchCartAndAddresses();
        onCartChange();
      } else {
        const err = await res.json();
        setError(err.error || 'Failed to update cart');
      }
    } catch (e: any) {
      setError(e.message);
    }
  };

  // Group items by store for Multi-Store Checkout
  const itemsByStore: Record<string, CartItem[]> = {};
  cartItems.forEach(item => {
    const storeKey = item.store_name || item.store_id;
    if (!itemsByStore[storeKey]) {
      itemsByStore[storeKey] = [];
    }
    itemsByStore[storeKey].push(item);
  });

  const storeCount = Object.keys(itemsByStore).length;
  const subtotal = cartItems.reduce((acc, item) => acc + item.price * item.quantity, 0);
  const deliveryFee = storeCount * 30.0; // ₹30 per store delivery
  const total = subtotal + deliveryFee;

  const handleCheckout = async () => {
    if (cartItems.length === 0) return;
    setError(null);
    setSubmitting(true);

    try {
      const payload = {
        items: cartItems.map(item => ({
          productId: item.product_id,
          quantity: item.quantity
        })),
        addressId: selectedAddressId,
        fulfillmentType: 'delivery',
        paymentMethod: 'cod',
        idempotencyKey: `idemp_${Date.now()}_${Math.random()}`
      };

      const res = await fetch('/api/customer/checkout', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Checkout failed. Please check stock availability.');
        return;
      }

      // Successful order creation
      onCartChange();
      onOrderSuccess();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Checkout failed');
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden">
      <div 
        className="absolute inset-0 bg-slate-900/50 backdrop-blur-xs transition-opacity" 
        onClick={onClose} 
      />

      <div className="fixed inset-y-0 right-0 max-w-full flex pl-10">
        <div className="w-screen max-w-md bg-white shadow-2xl flex flex-col justify-between">
          {/* Header */}
          <div className="p-4 sm:p-5 border-b border-slate-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShoppingBag className="w-5 h-5 text-emerald-600" />
              <h2 className="text-base font-bold text-slate-900">Your Shopping Cart</h2>
              <span className="text-xs text-slate-500 tabular-nums">({cartItems.length} items)</span>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Cart Content */}
          <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-5">
            {error && (
              <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800 font-medium">
                {error}
              </div>
            )}

            {cartItems.length === 0 ? (
              <div className="text-center py-16">
                <ShoppingBag className="w-12 h-12 text-slate-300 mx-auto mb-2" />
                <p className="text-sm font-semibold text-slate-700">Your cart is empty</p>
                <p className="text-xs text-slate-500 mt-1">
                  Add Amul Taaza Milk from Dwarka Fresh Mart to start your order.
                </p>
              </div>
            ) : (
              <>
                {/* Store grouped items */}
                {Object.keys(itemsByStore).map(storeName => (
                  <div key={storeName} className="border border-slate-200 rounded-xl p-4 bg-slate-50/50">
                    <div className="flex items-center justify-between mb-3 pb-2 border-b border-slate-200/80">
                      <span className="text-xs font-bold text-slate-900">{storeName}</span>
                      <span className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                        Delivery ₹30
                      </span>
                    </div>

                    <div className="space-y-3">
                      {itemsByStore[storeName].map(item => (
                        <div key={item.id} className="flex items-center justify-between gap-3 text-xs bg-white p-2.5 rounded-lg border border-slate-100">
                          {item.image && (
                            <img src={item.image} alt="" className="w-10 h-10 object-cover rounded shrink-0 border border-slate-100" />
                          )}
                          <div className="flex-1 min-w-0">
                            <h4 className="font-semibold text-slate-900 truncate">{item.name}</h4>
                            <span className="text-slate-500 tabular-nums">₹{item.price} each</span>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            <div className="flex items-center gap-1.5 bg-slate-100 rounded p-1">
                              <button
                                onClick={() => updateQuantity(item.product_id, item.quantity - 1)}
                                className="w-5 h-5 rounded bg-white text-slate-700 hover:bg-slate-200 flex items-center justify-center font-bold"
                              >
                                <Minus className="w-2.5 h-2.5" />
                              </button>
                              <span className="text-xs font-bold px-1 tabular-nums">{item.quantity}</span>
                              <button
                                onClick={() => updateQuantity(item.product_id, item.quantity + 1)}
                                className="w-5 h-5 rounded bg-white text-slate-700 hover:bg-slate-200 flex items-center justify-center font-bold"
                              >
                                <Plus className="w-2.5 h-2.5" />
                              </button>
                            </div>
                            <span className="font-bold text-slate-900 w-12 text-right tabular-nums">
                              ₹{item.price * item.quantity}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}

                {/* Delivery Address Selection */}
                <div className="border border-slate-200 rounded-xl p-4 bg-white">
                  <span className="text-xs font-bold text-slate-900 block mb-2">Delivery Address (Dwarka, New Delhi)</span>
                  {addresses.length > 0 ? (
                    <div className="space-y-2">
                      {addresses.map(addr => (
                        <label 
                          key={addr.id} 
                          className={`flex items-start gap-2.5 p-2.5 rounded-lg border cursor-pointer text-xs ${
                            selectedAddressId === addr.id ? 'border-emerald-500 bg-emerald-50/50' : 'border-slate-200'
                          }`}
                        >
                          <input
                            type="radio"
                            name="address"
                            checked={selectedAddressId === addr.id}
                            onChange={() => setSelectedAddressId(addr.id)}
                            className="mt-0.5 text-emerald-600"
                          />
                          <div>
                            <span className="font-bold text-slate-900">{addr.recipient_name}</span>
                            <p className="text-slate-600 mt-0.5">{addr.address_line}, {addr.city} {addr.pincode}</p>
                            <span className="text-slate-500 font-mono mt-0.5 block">{addr.phone}</span>
                          </div>
                        </label>
                      ))}
                    </div>
                  ) : (
                    <div className="p-3 bg-amber-50 rounded-lg text-xs text-amber-800">
                      Default demo address for Aarav Sharma will be applied.
                    </div>
                  )}
                </div>

                {/* Payment Option */}
                <div className="border border-slate-200 rounded-xl p-3.5 bg-slate-50 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-900">Payment Method</span>
                    <span className="font-semibold text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded text-[11px]">
                      Cash on Delivery (COD)
                    </span>
                  </div>
                  <p className="text-slate-500 mt-1 text-[11px]">
                    Pay cash upon delivery after sharing your delivery verification code with the rider.
                  </p>
                </div>
              </>
            )}
          </div>

          {/* Footer Checkout Actions */}
          {cartItems.length > 0 && (
            <div className="p-4 sm:p-5 border-t border-slate-200 bg-slate-50/80 space-y-3">
              <div className="space-y-1.5 text-xs text-slate-600">
                <div className="flex justify-between">
                  <span>Subtotal</span>
                  <span className="tabular-nums font-semibold text-slate-900">₹{subtotal}</span>
                </div>
                <div className="flex justify-between">
                  <span>Delivery ({storeCount} {storeCount > 1 ? 'stores' : 'store'})</span>
                  <span className="tabular-nums font-semibold text-slate-900">₹{deliveryFee}</span>
                </div>
                <div className="flex justify-between text-sm font-extrabold text-slate-900 pt-1.5 border-t border-slate-200">
                  <span>Grand Total</span>
                  <span className="tabular-nums text-emerald-800">₹{total}</span>
                </div>
              </div>

              <button
                onClick={handleCheckout}
                disabled={submitting}
                className="w-full py-3 px-4 rounded-xl text-sm font-bold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2 shadow-xs cursor-pointer"
              >
                {submitting ? 'Placing Order in Database...' : `Place Order (₹${total})`}
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
