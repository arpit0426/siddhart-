import React from 'react';
import { ShoppingBag, Store, Bike, User as UserIcon, LogOut, CheckCircle2, ChevronRight, Shield } from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import type { Role } from '../types/index.ts';

interface NavbarProps {
  onOpenCart: () => void;
  cartCount: number;
  onOpenAuth: () => void;
  currentTab: string;
  setCurrentTab: (tab: string) => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  onOpenCart,
  cartCount,
  onOpenAuth,
  currentTab,
  setCurrentTab
}) => {
  const { user, activeRoleView, setActiveRoleView, demoLogin, logout } = useAuth();

  const handleRoleSwitch = async (role: Role) => {
    setActiveRoleView(role);
    if (!user || user.role !== role) {
      await demoLogin(role);
    }
  };

  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-slate-200/80 shadow-xs">
      {/* Demo Persona Switcher Banner */}
      <div className="bg-slate-900 text-slate-100 text-xs py-1.5 px-4">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-emerald-400 flex items-center gap-1">
              <Shield className="w-3.5 h-3.5" />
              Demo Roles:
            </span>
            <span className="text-slate-300 hidden sm:inline">
              Switch roles instantly to test the complete persisted Customer → Seller → Rider loop:
            </span>
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto">
            <button
              onClick={() => handleRoleSwitch('customer')}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-all whitespace-nowrap flex items-center gap-1.5 ${
                activeRoleView === 'customer'
                  ? 'bg-emerald-600 text-white shadow-xs'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              <UserIcon className="w-3 h-3" />
              Customer (Aarav)
              {user?.role === 'customer' && <span className="w-1.5 h-1.5 rounded-full bg-emerald-300 animate-pulse" />}
            </button>

            <button
              onClick={() => handleRoleSwitch('seller')}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-all whitespace-nowrap flex items-center gap-1.5 ${
                activeRoleView === 'seller'
                  ? 'bg-amber-600 text-white shadow-xs'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              <Store className="w-3 h-3" />
              Seller (Dwarka Mart)
              {user?.role === 'seller' && <span className="w-1.5 h-1.5 rounded-full bg-amber-300 animate-pulse" />}
            </button>

            <button
              onClick={() => handleRoleSwitch('rider')}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-all whitespace-nowrap flex items-center gap-1.5 ${
                activeRoleView === 'rider'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              <Bike className="w-3 h-3" />
              Rider (Arjun)
              {user?.role === 'rider' && <span className="w-1.5 h-1.5 rounded-full bg-blue-300 animate-pulse" />}
            </button>
          </div>
        </div>
      </div>

      {/* Main Top Bar (Follows Top Bar Contract) */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Zone 1: Single text element Brand Wordmark */}
          <div className="flex items-center gap-6">
            <button
              onClick={() => setCurrentTab('discover')}
              className="text-2xl font-bold tracking-tight text-slate-900 hover:text-emerald-700 transition-colors flex items-center gap-1.5"
            >
              <span className="text-emerald-600">Near</span>Buy
            </button>

            <div className="hidden lg:flex items-center text-xs text-slate-500 font-medium">
              <span>Dwarka, New Delhi</span>
              <span className="mx-2">·</span>
              <span>Same-Day Local Fulfilment</span>
            </div>
          </div>

          {/* Zone 2: Navigation Links */}
          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600">
            {activeRoleView === 'customer' && (
              <>
                <button
                  onClick={() => setCurrentTab('discover')}
                  className={`transition-colors hover:text-slate-900 ${
                    currentTab === 'discover' ? 'text-emerald-700 font-semibold border-b-2 border-emerald-600 pb-0.5' : ''
                  }`}
                >
                  Nearby Stores & Items
                </button>
                <button
                  onClick={() => setCurrentTab('orders')}
                  className={`transition-colors hover:text-slate-900 ${
                    currentTab === 'orders' ? 'text-emerald-700 font-semibold border-b-2 border-emerald-600 pb-0.5' : ''
                  }`}
                >
                  My Orders & Live Code
                </button>
                <button
                  onClick={() => setCurrentTab('requests')}
                  className={`transition-colors hover:text-slate-900 ${
                    currentTab === 'requests' ? 'text-emerald-700 font-semibold border-b-2 border-emerald-600 pb-0.5' : ''
                  }`}
                >
                  Stock Requests
                </button>
              </>
            )}

            {activeRoleView === 'seller' && (
              <>
                <button
                  onClick={() => setCurrentTab('seller-orders')}
                  className={`transition-colors hover:text-slate-900 ${
                    currentTab === 'seller-orders' ? 'text-amber-700 font-semibold border-b-2 border-amber-600 pb-0.5' : ''
                  }`}
                >
                  Incoming Orders & Pickup Codes
                </button>
                <button
                  onClick={() => setCurrentTab('seller-inventory')}
                  className={`transition-colors hover:text-slate-900 ${
                    currentTab === 'seller-inventory' ? 'text-amber-700 font-semibold border-b-2 border-amber-600 pb-0.5' : ''
                  }`}
                >
                  Store Catalog & Stock
                </button>
                <button
                  onClick={() => setCurrentTab('seller-requests')}
                  className={`transition-colors hover:text-slate-900 ${
                    currentTab === 'seller-requests' ? 'text-amber-700 font-semibold border-b-2 border-amber-600 pb-0.5' : ''
                  }`}
                >
                  Customer Requests
                </button>
              </>
            )}

            {activeRoleView === 'rider' && (
              <>
                <button
                  onClick={() => setCurrentTab('rider-jobs')}
                  className={`transition-colors hover:text-slate-900 ${
                    currentTab === 'rider-jobs' ? 'text-blue-700 font-semibold border-b-2 border-blue-600 pb-0.5' : ''
                  }`}
                >
                  Available Jobs
                </button>
                <button
                  onClick={() => setCurrentTab('rider-active')}
                  className={`transition-colors hover:text-slate-900 ${
                    currentTab === 'rider-active' ? 'text-blue-700 font-semibold border-b-2 border-blue-600 pb-0.5' : ''
                  }`}
                >
                  Active Delivery Stepper
                </button>
                <button
                  onClick={() => setCurrentTab('rider-history')}
                  className={`transition-colors hover:text-slate-900 ${
                    currentTab === 'rider-history' ? 'text-blue-700 font-semibold border-b-2 border-blue-600 pb-0.5' : ''
                  }`}
                >
                  Earnings & History
                </button>
              </>
            )}
          </nav>

          {/* Zone 3: Actions */}
          <div className="flex items-center gap-3">
            {activeRoleView === 'customer' && (
              <button
                onClick={onOpenCart}
                className="relative flex items-center gap-2 px-3 py-2 text-sm font-medium text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
                aria-label="View shopping cart"
              >
                <ShoppingBag className="w-4 h-4 text-emerald-700" />
                <span className="hidden sm:inline">Cart</span>
                {cartCount > 0 && (
                  <span className="bg-emerald-600 text-white text-xs font-bold px-1.5 py-0.5 rounded-full min-w-[20px] text-center">
                    {cartCount}
                  </span>
                )}
              </button>
            )}

            {user ? (
              <div className="flex items-center gap-2">
                <div className="hidden sm:flex flex-col text-right">
                  <span className="text-xs font-semibold text-slate-900">{user.name}</span>
                  <span className="text-[11px] text-slate-500 capitalize">{user.role} Account</span>
                </div>
                <button
                  onClick={logout}
                  className="p-2 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                  title="Sign out"
                  aria-label="Sign out"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <button
                onClick={onOpenAuth}
                className="px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors whitespace-nowrap shadow-xs"
              >
                Sign In
              </button>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};
