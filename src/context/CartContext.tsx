import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from './AuthContext';
import type { CartResponse } from '../types';

interface CartContextValue {
  cart: CartResponse | null;
  itemCount: number;
  loading: boolean;
  refresh: () => Promise<CartResponse | null>;
  updateItem: (productId: string, quantity: number) => Promise<CartResponse | null>;
  clear: () => Promise<void>;
}

const CartContext = createContext<CartContextValue | undefined>(undefined);

export const CartProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const [cart, setCart] = useState<CartResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const isCustomer = user?.role === 'customer';

  const refresh = useCallback(async () => {
    if (!isCustomer) {
      setCart(null);
      return null;
    }
    setLoading(true);
    try {
      const data = await api.get<CartResponse>('/api/customer/cart');
      setCart(data);
      return data;
    } catch {
      return null;
    } finally {
      setLoading(false);
    }
  }, [isCustomer]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const updateItem = useCallback(
    async (productId: string, quantity: number) => {
      await api.post('/api/customer/cart/items', { productId, quantity });
      return refresh();
    },
    [refresh]
  );

  const clear = useCallback(async () => {
    await api.del('/api/customer/cart/clear');
    await refresh();
  }, [refresh]);

  const itemCount = useMemo(
    () => (cart?.items ?? []).reduce((sum, item) => sum + item.quantity, 0),
    [cart]
  );

  const value = useMemo(
    () => ({ cart, itemCount, loading, refresh, updateItem, clear }),
    [cart, itemCount, loading, refresh, updateItem, clear]
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
};

export function useCart(): CartContextValue {
  const context = useContext(CartContext);
  if (!context) throw new Error('useCart must be used inside CartProvider');
  return context;
}
