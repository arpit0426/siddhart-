import React, { useEffect, useState } from 'react';
import { AlertTriangle, History, Minus, Plus, RefreshCw } from 'lucide-react';
import { Button, ErrorNote, Field, InfoNote, Modal, SelectField, Spinner } from '../ui';
import { refreshSeller, useSellerResource } from '../../context/SellerContext';
import { useToast } from '../../context/ToastContext';
import { api, errorMessage } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import type { Product } from '../../types';

export function StockAdjustModal({ product, onClose }: { product: Product | null; onClose: () => void }) {
  const toast = useToast(); const [mode, setMode] = useState('increase'); const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null); const [saving, setSaving] = useState(false); const [note, setNote] = useState('');
  const [history, setHistory] = useState(false);
  const live = useSellerResource(() => api.get<{ product: Product }>(`/api/seller/products/${product!.id}`), [product?.id], { enabled: Boolean(product) });
  const events = useSellerResource(() => api.get<{ events: { reason: string; stock_before: number; stock_after: number; reserved_before: number; reserved_after: number; created_at: string }[] }>(`/api/seller/inventory/${product!.id}/events`), [product?.id, history], { enabled: Boolean(product && history) });
  useEffect(() => { if (product) { setMode('increase'); setValue(''); setError(null); setNote(''); setHistory(false); } }, [product?.id]);
  const current = product && live.data?.product?.id === product.id ? live.data.product : product;
  const save = async () => {
    if (!current || live.loading || live.error) return;
    const quantity = Number(value);
    if (value === '' || !Number.isInteger(quantity) || quantity < 0 || (mode !== 'set' && quantity === 0)) { setError('Enter a valid whole-number quantity.'); return; }
    setSaving(true); setError(null);
    try {
      const result = await api.post<{ message: string }>(`/api/seller/products/${current.id}/stock`, { mode: mode === 'set' ? 'set' : 'delta', value: mode === 'decrease' ? -quantity : quantity, expectedVersion: current.inventory_version, reason: note || undefined });
      toast.push({ title: 'Stock updated', description: result.message, tone: 'success' }); refreshSeller(); onClose();
    } catch (err) { setError(errorMessage(err)); } finally { setSaving(false); }
  };
  return <Modal open={Boolean(product)} onClose={() => !saving && onClose()} title="Update stock" description={product?.name} footer={<><Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button><Button onClick={save} loading={saving} disabled={live.loading || Boolean(live.error) || !live.data}>Save stock update</Button></>}>
    {live.loading && !live.data ? <Spinner label="Checking current inventory…" /> : <><div className="grid grid-cols-3 gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4"><div><p className="text-xs text-slate-500">Stock</p><strong className="text-xl">{current?.stock_quantity ?? 0}</strong></div><div><p className="text-xs text-slate-500">Reserved</p><strong className="text-xl">{current?.reserved_quantity ?? 0}</strong></div><div><p className="text-xs text-slate-500">Available</p><strong className="text-xl text-blue-700">{current?.sellable ?? 0}</strong></div></div><SelectField label="Adjustment type" value={mode} onChange={(e) => { setMode(e.target.value); setValue(e.target.value === 'set' ? String(current?.stock_quantity ?? 0) : ''); }} options={[{ value: 'increase', label: 'Increase stock — add units' }, { value: 'decrease', label: 'Decrease stock — remove units' }, { value: 'set', label: 'Set exact stock — physical shelf count' }]} /><Field label={mode === 'set' ? 'New shelf quantity' : 'Number of units'} type="number" min={0} max={100000} step={1} value={value} onChange={(e) => setValue(e.target.value)} required placeholder="0" /><Field label="Adjustment note (optional)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="e.g. Morning restock" /><InfoNote>Reserved stock is protected. Shelf stock cannot go negative or below confirmed reservation holds.</InfoNote></>}
    {(error || live.error) && <><ErrorNote>{error || live.error}</ErrorNote><Button size="sm" variant="secondary" onClick={() => { live.reload(); setError(null); }}><RefreshCw size={13} />Refresh current stock</Button></>}
    <button type="button" className="seller-text-link" onClick={() => setHistory((v) => !v)}><History size={13} />{history ? 'Hide' : 'View'} recent inventory events</button>{history && <div className="text-xs">{events.loading ? 'Loading adjustments…' : events.error ? <ErrorNote>{events.error}</ErrorNote> : events.data?.events.length ? <ul className="space-y-3">{events.data.events.slice(0, 6).map((e, i) => <li key={i} className="border-t border-slate-100 pt-2"><strong className="font-medium text-slate-700">{e.reason.replace(/_/g, ' ')}</strong><p className="text-slate-500">Stock {e.stock_before} → {e.stock_after} · reserved {e.reserved_before} → {e.reserved_after}</p><small className="text-slate-400">{formatDateTime(e.created_at)}</small></li>)}</ul> : 'No adjustments recorded yet.'}</div>}
  </Modal>;
}
