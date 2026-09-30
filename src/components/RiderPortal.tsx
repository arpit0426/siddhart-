import React, { useState, useEffect } from 'react';
import { Bike, MapPin, CheckCircle, Key, ArrowRight, DollarSign, Package, AlertCircle, RefreshCw } from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import type { DeliveryJob } from '../types/index.ts';

interface RiderPortalProps {
  currentTab: string;
}

export const RiderPortal: React.FC<RiderPortalProps> = ({ currentTab }) => {
  const { user, getAuthHeaders } = useAuth();
  const [availableJobs, setAvailableJobs] = useState<DeliveryJob[]>([]);
  const [activeJob, setActiveJob] = useState<DeliveryJob | null>(null);
  const [historyJobs, setHistoryJobs] = useState<DeliveryJob[]>([]);
  const [earnings, setEarnings] = useState<{ totalEarnings: number; completedJobs: number }>({
    totalEarnings: 0,
    completedJobs: 0
  });

  const [enteredPickupCode, setEnteredPickupCode] = useState('');
  const [enteredDeliveryCode, setEnteredDeliveryCode] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [actionNotice, setActionNotice] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const fetchRiderData = async () => {
    if (!user || user.role !== 'rider') return;
    try {
      const [availRes, activeRes, histRes] = await Promise.all([
        fetch('/api/rider/jobs/available', { headers: getAuthHeaders() }),
        fetch('/api/rider/jobs/active', { headers: getAuthHeaders() }),
        fetch('/api/rider/history', { headers: getAuthHeaders() })
      ]);

      if (availRes.ok) {
        const d = await availRes.json();
        setAvailableJobs(d.jobs || []);
      }
      if (activeRes.ok) {
        const d = await activeRes.json();
        setActiveJob(d.job || null);
      }
      if (histRes.ok) {
        const d = await histRes.json();
        setHistoryJobs(d.jobs || []);
        if (d.summary) {
          setEarnings(d.summary);
        }
      }
    } catch (e) {
      console.error('Failed to load rider data:', e);
    }
  };

  useEffect(() => {
    fetchRiderData();
  }, [user]);

  // Periodic poll so newly placed/ready orders appear
  useEffect(() => {
    const interval = setInterval(fetchRiderData, 4000);
    return () => clearInterval(interval);
  }, [user]);

  const handleClaimJob = async (jobId: string) => {
    setActionNotice(null);
    try {
      const res = await fetch(`/api/rider/jobs/${jobId}/claim`, {
        method: 'POST',
        headers: getAuthHeaders()
      });
      const data = await res.json();
      if (res.ok) {
        setActionNotice({ text: 'Job claimed! Head to the store for pickup verification.', type: 'success' });
        fetchRiderData();
      } else {
        setActionNotice({ text: data.error || 'Failed to claim job', type: 'error' });
      }
    } catch (e: any) {
      setActionNotice({ text: e.message, type: 'error' });
    }
  };

  const handleVerifyPickup = async () => {
    if (!activeJob || !enteredPickupCode) return;
    setIsVerifying(true);
    setActionNotice(null);
    try {
      const res = await fetch(`/api/rider/jobs/${activeJob.id}/verify-pickup`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ pickupCode: enteredPickupCode })
      });
      const data = await res.json();
      if (res.ok) {
        setActionNotice({ text: 'Pickup verified! Order is now Out for Delivery.', type: 'success' });
        setEnteredPickupCode('');
        fetchRiderData();
      } else {
        setActionNotice({ text: data.error || 'Incorrect pickup code', type: 'error' });
      }
    } catch (e: any) {
      setActionNotice({ text: e.message, type: 'error' });
    } finally {
      setIsVerifying(false);
    }
  };

  const handleVerifyDelivery = async () => {
    if (!activeJob || !enteredDeliveryCode) return;
    setIsVerifying(true);
    setActionNotice(null);
    try {
      const res = await fetch(`/api/rider/jobs/${activeJob.id}/verify-delivery`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ deliveryCode: enteredDeliveryCode })
      });
      const data = await res.json();
      if (res.ok) {
        setActionNotice({
          text: 'Delivery verified with customer! ₹40 credited to your account.',
          type: 'success'
        });
        setEnteredDeliveryCode('');
        fetchRiderData();
      } else {
        setActionNotice({ text: data.error || 'Incorrect delivery code', type: 'error' });
      }
    } catch (e: any) {
      setActionNotice({ text: e.message, type: 'error' });
    } finally {
      setIsVerifying(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Rider Status & Profile Card */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-700 shrink-0">
            <Bike className="w-7 h-7" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold text-slate-900">Arjun Kumar</h1>
              <span className="text-xs font-semibold text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded">
                Available On Duty
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Vehicle: Hero Splendor Plus · Reg: DL 9S AB 1234
            </p>
            <p className="text-xs text-slate-400 mt-0.5">
              Phone: +91 98111 22334 · Zone: Dwarka Sectors 6-12
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="text-right">
            <span className="text-xs text-slate-500 block">Total Earnings</span>
            <span className="text-xl font-extrabold text-blue-700 tabular-nums">
              ₹{earnings.totalEarnings}
            </span>
            <span className="text-[11px] text-slate-400 block tabular-nums">
              {earnings.completedJobs} completed deliveries
            </span>
          </div>

          <button
            onClick={fetchRiderData}
            className="p-2 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg border border-slate-200"
            title="Refresh jobs"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {actionNotice && (
        <div className={`p-3 rounded-lg text-xs font-medium flex items-center justify-between ${
          actionNotice.type === 'success' ? 'bg-emerald-50 text-emerald-900 border border-emerald-200' : 'bg-red-50 text-red-900 border border-red-200'
        }`}>
          <span>{actionNotice.text}</span>
          <button onClick={() => setActionNotice(null)} className="text-slate-500 hover:text-slate-900 ml-2">Dismiss</button>
        </div>
      )}

      {/* Active Job Stepper */}
      {activeJob && (
        <div className="bg-white border-2 border-blue-500 rounded-2xl p-5 sm:p-6 shadow-sm">
          <div className="flex items-center justify-between pb-3 border-b border-slate-200">
            <div>
              <span className="text-xs uppercase font-extrabold tracking-wider text-blue-600 block">
                Active Delivery in Progress
              </span>
              <h2 className="text-base font-bold text-slate-900 mt-0.5">
                Order {activeJob.order_number} · ₹{activeJob.order_total}
              </h2>
            </div>
            <span className="text-sm font-extrabold text-emerald-700 bg-emerald-50 px-3 py-1 rounded-lg border border-emerald-200 tabular-nums">
              Payout: ₹{activeJob.earnings}
            </span>
          </div>

          {/* Stepper Progress */}
          <div className="py-5 grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Stage 1: Store Pickup */}
            <div className={`p-4 rounded-xl border ${
              activeJob.status === 'claimed'
                ? 'bg-amber-50/70 border-amber-300 ring-2 ring-amber-400/20'
                : 'bg-emerald-50/50 border-emerald-200'
            }`}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-900">
                  Step 1: Store Pickup
                </span>
                {activeJob.status !== 'claimed' ? (
                  <span className="text-xs font-bold text-emerald-700 flex items-center gap-1">
                    <CheckCircle className="w-3.5 h-3.5" /> Verified
                  </span>
                ) : (
                  <span className="text-xs font-semibold text-amber-800 bg-amber-100 px-2 py-0.5 rounded">
                    Action Required
                  </span>
                )}
              </div>

              <p className="text-xs font-bold text-slate-900">{activeJob.store_name}</p>
              <p className="text-xs text-slate-600 mt-0.5">{activeJob.store_address}, {activeJob.store_city}</p>

              {activeJob.status === 'claimed' && (
                <div className="mt-4 pt-3 border-t border-amber-200/80">
                  <label className="block text-xs font-bold text-slate-900 mb-1">
                    Enter Seller Pickup Code (from Rahul Verma)
                  </label>
                  <p className="text-[11px] text-slate-500 mb-2">
                    Ask store manager Rahul Verma for the 4-digit code (e.g. PK-8421 or 8421).
                  </p>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      placeholder="PK-XXXX or 4 digits"
                      value={enteredPickupCode}
                      onChange={e => setEnteredPickupCode(e.target.value)}
                      className="px-3 py-1.5 text-xs font-mono font-bold uppercase bg-white border border-amber-300 rounded-lg outline-none focus:ring-2 focus:ring-amber-500 w-44"
                    />
                    <button
                      onClick={handleVerifyPickup}
                      disabled={isVerifying || !enteredPickupCode}
                      className="px-4 py-1.5 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-50 rounded-lg transition-colors shadow-xs"
                    >
                      {isVerifying ? 'Verifying...' : 'Verify Pickup'}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Stage 2: Customer Delivery */}
            <div className={`p-4 rounded-xl border ${
              activeJob.status === 'out_for_delivery' || activeJob.status === 'pickup_verified'
                ? 'bg-blue-50/70 border-blue-300 ring-2 ring-blue-400/20'
                : 'bg-slate-50 border-slate-200 opacity-60'
            }`}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-900">
                  Step 2: Customer Delivery
                </span>
                {activeJob.status === 'completed' && (
                  <span className="text-xs font-bold text-emerald-700 flex items-center gap-1">
                    <CheckCircle className="w-3.5 h-3.5" /> Completed
                  </span>
                )}
              </div>

              <p className="text-xs font-bold text-slate-900">Customer: {activeJob.customer_name || 'Aarav Sharma'}</p>
              <p className="text-xs text-slate-600 mt-0.5">
                {activeJob.address_snapshot?.address || 'Flat 402, Shivani Apartments, Sector 10'}, {activeJob.address_snapshot?.city || 'Dwarka, New Delhi'}
              </p>

              {(activeJob.status === 'out_for_delivery' || activeJob.status === 'pickup_verified') && (
                <div className="mt-4 pt-3 border-t border-blue-200/80">
                  <label className="block text-xs font-bold text-slate-900 mb-1">
                    Enter Customer Delivery Code (from Aarav Sharma)
                  </label>
                  <p className="text-[11px] text-slate-500 mb-2">
                    Customer provides this 4-digit code upon receiving their items (e.g. DL-3914 or 3914).
                  </p>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      placeholder="DL-XXXX or 4 digits"
                      value={enteredDeliveryCode}
                      onChange={e => setEnteredDeliveryCode(e.target.value)}
                      className="px-3 py-1.5 text-xs font-mono font-bold uppercase bg-white border border-blue-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 w-44"
                    />
                    <button
                      onClick={handleVerifyDelivery}
                      disabled={isVerifying || !enteredDeliveryCode}
                      className="px-4 py-1.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg transition-colors shadow-xs"
                    >
                      {isVerifying ? 'Verifying...' : 'Complete Delivery'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Available Jobs Queue */}
      {(currentTab === 'rider-jobs' || currentTab === 'rider') && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-slate-900">Available Delivery Jobs in Dwarka</h2>
              <p className="text-xs text-slate-500">
                Claim a job to lock it atomically. Only one rider can claim each delivery.
              </p>
            </div>
            <span className="text-xs font-semibold text-slate-500 tabular-nums">
              {availableJobs.length} available
            </span>
          </div>

          {availableJobs.length === 0 ? (
            <div className="p-12 text-center bg-white rounded-xl border border-slate-200">
              <Package className="w-10 h-10 text-slate-300 mx-auto mb-2" />
              <p className="text-sm font-semibold text-slate-700">No open jobs available right now</p>
              <p className="text-xs text-slate-500 mt-1">
                When a customer places an order from Dwarka Fresh Mart, it appears here instantly!
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {availableJobs.map((job) => (
                <div key={job.id} className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                      <span className="text-xs font-mono font-bold text-slate-900">{job.order_number}</span>
                      <span className="text-xs font-bold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200 tabular-nums">
                        Earn ₹{job.earnings}
                      </span>
                    </div>

                    <div className="mt-3 space-y-2 text-xs">
                      <div>
                        <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">Pickup:</span>
                        <span className="font-semibold text-slate-900">{job.store_name}</span>
                        <p className="text-slate-500">{job.store_address}, {job.store_city}</p>
                      </div>

                      <div className="pt-2 border-t border-slate-50">
                        <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">Drop-off:</span>
                        <span className="font-semibold text-slate-900">{job.address_snapshot?.name || 'Customer'}</span>
                        <p className="text-slate-500">{job.address_snapshot?.address || 'Dwarka, New Delhi'}</p>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between">
                    <span className="text-xs text-slate-500 tabular-nums">Order Value: ₹{job.order_total}</span>
                    <button
                      onClick={() => handleClaimJob(job.id)}
                      disabled={Boolean(activeJob)}
                      className="px-4 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-40 rounded-lg transition-colors flex items-center gap-1.5 shadow-xs"
                    >
                      Claim Job
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* History & Earnings Tab */}
      {currentTab === 'rider-history' && (
        <div className="space-y-4">
          <div>
            <h2 className="text-base font-bold text-slate-900">Your Completed Deliveries &amp; Payouts</h2>
            <p className="text-xs text-slate-500">Every delivery was completed using dual-code verification.</p>
          </div>

          {historyJobs.length === 0 ? (
            <div className="p-12 text-center bg-white rounded-xl border border-slate-200">
              <p className="text-xs text-slate-400">No completed jobs recorded yet.</p>
            </div>
          ) : (
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold uppercase tracking-wider text-[11px]">
                    <tr>
                      <th className="py-3 px-4">Order Number</th>
                      <th className="py-3 px-4">Store</th>
                      <th className="py-3 px-4">Customer</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4 text-right">Earned</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {historyJobs.map(j => (
                      <tr key={j.id} className="hover:bg-slate-50/50">
                        <td className="py-3 px-4 font-mono font-bold text-slate-900">{j.order_number}</td>
                        <td className="py-3 px-4 text-slate-800">{j.store_name}</td>
                        <td className="py-3 px-4 text-slate-600">{j.customer_name}</td>
                        <td className="py-3 px-4">
                          <span className={`px-2 py-0.5 rounded font-bold uppercase text-[11px] ${
                            j.status === 'completed' ? 'bg-emerald-50 text-emerald-800' : 'bg-blue-50 text-blue-800'
                          }`}>
                            {j.status}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right font-extrabold text-emerald-700 tabular-nums">
                          ₹{j.earnings}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
