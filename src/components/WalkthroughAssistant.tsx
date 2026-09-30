import React, { useState } from 'react';
import { ChevronDown, ChevronUp, CheckCircle, ArrowRight, ShieldCheck, Sparkles, RefreshCw } from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';

interface WalkthroughAssistantProps {
  onNavigateTab: (tab: string) => void;
  activeStep?: number;
}

export const WalkthroughAssistant: React.FC<WalkthroughAssistantProps> = ({ onNavigateTab }) => {
  const [isExpanded, setIsExpanded] = useState<boolean>(true);
  const { user, activeRoleView, setActiveRoleView, demoLogin } = useAuth();

  const handleStepJump = async (role: 'customer' | 'seller' | 'rider', targetTab: string) => {
    setActiveRoleView(role);
    if (!user || user.role !== role) {
      await demoLogin(role);
    }
    onNavigateTab(targetTab);
  };

  const handleHardRefresh = () => {
    window.location.reload();
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm mb-6 overflow-hidden">
      <div 
        className="px-4 py-3 bg-slate-50 border-b border-slate-200/80 flex items-center justify-between cursor-pointer select-none"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-2">
          <span className="p-1 rounded bg-emerald-100 text-emerald-800">
            <ShieldCheck className="w-4 h-4" />
          </span>
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900">
              Demo Walkthrough Roadmap &amp; Real Data Flow
            </h3>
            <p className="text-[11px] text-slate-500">
              All 3 accounts are seeded in SQLite database. Test the end-to-end handoff with real codes.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleHardRefresh();
            }}
            className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-slate-600 bg-white border border-slate-200 rounded hover:bg-slate-100 transition-colors"
            title="Refresh page to verify database persistence"
          >
            <RefreshCw className="w-3 h-3 text-slate-500" />
            <span className="hidden sm:inline">Refresh to Verify Persistence</span>
          </button>

          <button className="text-slate-400 hover:text-slate-700">
            {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {isExpanded && (
        <div className="p-4 grid grid-cols-1 md:grid-cols-4 gap-3 text-xs">
          {/* Step 1 */}
          <div className="p-3 rounded-lg border border-emerald-200 bg-emerald-50/60 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="font-bold text-emerald-900">1. Customer Order</span>
                <span className="text-[10px] bg-emerald-200/80 text-emerald-800 font-semibold px-1.5 py-0.5 rounded">
                  Aarav
                </span>
              </div>
              <p className="text-slate-600 text-[11px] mb-2 leading-relaxed">
                Search <strong className="text-slate-900">“Amul Taaza”</strong> in Dwarka Fresh Mart, add to cart, and place order.
              </p>
            </div>
            <button
              onClick={() => handleStepJump('customer', 'discover')}
              className="mt-2 w-full text-left font-semibold text-emerald-700 hover:text-emerald-800 flex items-center justify-between text-[11px]"
            >
              <span>Go to Customer View</span>
              <ArrowRight className="w-3 h-3" />
            </button>
          </div>

          {/* Step 2 */}
          <div className="p-3 rounded-lg border border-amber-200 bg-amber-50/60 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="font-bold text-amber-900">2. Seller Fulfilment</span>
                <span className="text-[10px] bg-amber-200/80 text-amber-800 font-semibold px-1.5 py-0.5 rounded">
                  Dwarka Mart
                </span>
              </div>
              <p className="text-slate-600 text-[11px] mb-2 leading-relaxed">
                Accept order → Preparing → Pack → Mark <strong className="text-slate-900">Ready for Pickup</strong> to reveal the 4-digit pickup code.
              </p>
            </div>
            <button
              onClick={() => handleStepJump('seller', 'seller-orders')}
              className="mt-2 w-full text-left font-semibold text-amber-700 hover:text-amber-800 flex items-center justify-between text-[11px]"
            >
              <span>Go to Seller Orders</span>
              <ArrowRight className="w-3 h-3" />
            </button>
          </div>

          {/* Step 3 */}
          <div className="p-3 rounded-lg border border-blue-200 bg-blue-50/60 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="font-bold text-blue-900">3. Rider Pickup</span>
                <span className="text-[10px] bg-blue-200/80 text-blue-800 font-semibold px-1.5 py-0.5 rounded">
                  Arjun
                </span>
              </div>
              <p className="text-slate-600 text-[11px] mb-2 leading-relaxed">
                Claim job, enter seller's <strong className="text-slate-900">Pickup Code</strong>. Job transitions to Out for Delivery.
              </p>
            </div>
            <button
              onClick={() => handleStepJump('rider', 'rider-jobs')}
              className="mt-2 w-full text-left font-semibold text-blue-700 hover:text-blue-800 flex items-center justify-between text-[11px]"
            >
              <span>Go to Rider Jobs</span>
              <ArrowRight className="w-3 h-3" />
            </button>
          </div>

          {/* Step 4 */}
          <div className="p-3 rounded-lg border border-purple-200 bg-purple-50/60 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="font-bold text-purple-900">4. Delivery &amp; Sync</span>
                <span className="text-[10px] bg-purple-200/80 text-purple-800 font-semibold px-1.5 py-0.5 rounded">
                  Verify
                </span>
              </div>
              <p className="text-slate-600 text-[11px] mb-2 leading-relaxed">
                Rider enters Customer's <strong className="text-slate-900">Delivery Code</strong>. Order becomes Delivered across all 3 portals!
              </p>
            </div>
            <button
              onClick={() => handleStepJump('rider', 'rider-active')}
              className="mt-2 w-full text-left font-semibold text-purple-700 hover:text-purple-800 flex items-center justify-between text-[11px]"
            >
              <span>Go to Active Stepper</span>
              <ArrowRight className="w-3 h-3" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
