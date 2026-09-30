import React, { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext.tsx';
import { Navbar } from './components/Navbar.tsx';
import { CustomerPortal } from './components/CustomerPortal.tsx';
import { SellerPortal } from './components/SellerPortal.tsx';
import { RiderPortal } from './components/RiderPortal.tsx';
import { CartDrawer } from './components/CartDrawer.tsx';
import { WalkthroughAssistant } from './components/WalkthroughAssistant.tsx';
import { AuthModal } from './components/AuthModal.tsx';
import { Shield, MapPin, Heart } from 'lucide-react';

function MainApp() {
  const { user, activeRoleView, setActiveRoleView, getAuthHeaders, demoLogin } = useAuth();
  const [currentTab, setCurrentTab] = useState<string>('discover');
  const [isCartOpen, setIsCartOpen] = useState<boolean>(false);
  const [isAuthOpen, setIsAuthOpen] = useState<boolean>(false);
  const [cartCount, setCartCount] = useState<number>(0);
  const [cartItemsCount, setCartItemsCount] = useState<Record<string, number>>({});

  const fetchCartCount = async () => {
    if (!user || user.role !== 'customer') {
      setCartCount(0);
      setCartItemsCount({});
      return;
    }
    try {
      const res = await fetch('/api/customer/cart', { headers: getAuthHeaders() });
      if (res.ok) {
        const data = await res.json();
        const total = (data.items || []).reduce((acc: number, item: any) => acc + item.quantity, 0);
        const map: Record<string, number> = {};
        (data.items || []).forEach((item: any) => {
          map[item.product_id] = item.quantity;
        });
        setCartCount(total);
        setCartItemsCount(map);
      }
    } catch {
      // Ignore
    }
  };

  useEffect(() => {
    fetchCartCount();
  }, [user]);

  // When active role changes, adjust default tab
  useEffect(() => {
    if (activeRoleView === 'customer') {
      if (!['discover', 'orders', 'requests'].includes(currentTab)) {
        setCurrentTab('discover');
      }
    } else if (activeRoleView === 'seller') {
      if (!['seller-orders', 'seller-inventory', 'seller-requests'].includes(currentTab)) {
        setCurrentTab('seller-orders');
      }
    } else if (activeRoleView === 'rider') {
      if (!['rider-jobs', 'rider-active', 'rider-history'].includes(currentTab)) {
        setCurrentTab('rider-jobs');
      }
    }
  }, [activeRoleView]);

  const handleAddToCart = async (productId: string, qty: number) => {
    if (!user) {
      await demoLogin('customer');
    }
    try {
      const res = await fetch('/api/customer/cart/items', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ productId, quantity: qty })
      });
      if (res.ok) {
        fetchCartCount();
      }
    } catch (e) {
      console.error('Failed to add to cart:', e);
    }
  };

  const handleOrderSuccess = () => {
    fetchCartCount();
    setCurrentTab('orders');
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#F8FAFC] text-slate-900 font-['Plus_Jakarta_Sans',sans-serif]">
      {/* Top Bar Navigation */}
      <Navbar
        onOpenCart={() => setIsCartOpen(true)}
        cartCount={cartCount}
        onOpenAuth={() => setIsAuthOpen(true)}
        currentTab={currentTab}
        setCurrentTab={setCurrentTab}
      />

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Interactive Guided Demo Roadmap */}
        <WalkthroughAssistant onNavigateTab={(tab) => setCurrentTab(tab)} />

        {/* Dynamic View based on Active Role Persona */}
        {activeRoleView === 'customer' && (
          <CustomerPortal
            currentTab={currentTab}
            onOrderPlaced={handleOrderSuccess}
            onAddToCart={handleAddToCart}
            cartItemsCount={cartItemsCount}
          />
        )}

        {activeRoleView === 'seller' && (
          <SellerPortal currentTab={currentTab} />
        )}

        {activeRoleView === 'rider' && (
          <RiderPortal currentTab={currentTab} />
        )}
      </main>

      {/* Cart Drawer */}
      <CartDrawer
        isOpen={isCartOpen}
        onClose={() => setIsCartOpen(false)}
        onOrderSuccess={handleOrderSuccess}
        onCartChange={fetchCartCount}
      />

      {/* Auth Modal */}
      <AuthModal
        isOpen={isAuthOpen}
        onClose={() => setIsAuthOpen(false)}
      />

      {/* Clean Footer */}
      <footer className="bg-white border-t border-slate-200 py-6 px-4 text-xs text-slate-500 mt-12">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="font-bold text-slate-900">NearBuy</span>
            <span>— What You Need, Already Nearby.</span>
          </div>

          <div className="flex items-center gap-4 text-slate-400">
            <span>Dwarka, New Delhi</span>
            <span>·</span>
            <span>All 3 Roles Seeded &amp; Persisted</span>
            <span>·</span>
            <span>Dual-Code Verification (PK/DL)</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <MainApp />
    </AuthProvider>
  );
}
