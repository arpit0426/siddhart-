import React, { useEffect, useState } from 'react';
import { AlertTriangle, ArrowRight, Boxes, CheckCircle2, Package, PackageX, Plus, SlidersHorizontal } from 'lucide-react';
import { Badge, Button } from '../../components/ui';
import { MetricCard, PageHeader, PageSkeleton, Pager, Panel, ProductImage, ResourceError, SearchInput, SellerEmpty, Tabs } from '../../components/seller/ui';
import { StockAdjustModal } from '../../components/seller/StockAdjustModal';
import { useSellerResource } from '../../context/SellerContext';
import { useDebouncedValue } from '../../lib/hooks';
import { api } from '../../lib/api';
import { navigate, useQueryParams } from '../../lib/router';
import type { Product } from '../../types';
import type { Pagination } from '../../types/seller';

export function InventoryStatus({ product }: { product: Product }) {
  const stock = product.sellable ?? 0;
  return <Badge tone={stock <= 0 ? 'danger' : stock <= (product.low_stock_threshold ?? 5) ? 'warning' : 'success'}>{stock <= 0 ? 'Out of stock' : stock <= (product.low_stock_threshold ?? 5) ? 'Low stock' : 'Healthy'}</Badge>;
}
export function SellerInventoryPage() {
  const params = useQueryParams(); const [query, setQuery] = useState(params.get('query') ?? ''); const [stock, setStock] = useState(params.get('stock') ?? '');
  const [page, setPage] = useState(1); const [editing, setEditing] = useState<Product | null>(null); const debounced = useDebouncedValue(query);
  const search = new URLSearchParams({ query: debounced, stock, page: String(page), pageSize: '20' }).toString();
  const resource = useSellerResource(() => api.get<{ inventory: Product[]; summary: { products: number; inStock: number; lowStock: number; outOfStock: number; reserved: number; healthy: number }; pagination: Pagination }>(`/api/seller/inventory?${search}`), [search], { pollMs: 30000 });
  useEffect(() => setPage(1), [debounced, stock]);
  useEffect(() => { setQuery(params.get('query') ?? ''); setStock(params.get('stock') ?? ''); }, [params.toString()]);
  const summary = resource.data?.summary;
  return <div><PageHeader title="Inventory" subtitle="Healthy shelves. Fewer surprises. Keep your stock in check." action={<Button variant="secondary" onClick={() => navigate('/seller/products/new')}><Plus size={14} />Add product</Button>} />
    <div className="seller-kpi-grid seller-inventory-stats"><MetricCard label="Total Products" value={summary?.products ?? '—'} hint="Products in your catalogue" icon={<Boxes />} /><MetricCard label="In Stock" value={summary?.inStock ?? '—'} hint="Products with sellable units" icon={<CheckCircle2 />} color="green" /><MetricCard label="Low Stock" value={summary?.lowStock ?? '—'} hint="Positive stock at or below threshold" icon={<AlertTriangle />} color="amber" /><MetricCard label="Out of Stock" value={summary?.outOfStock ?? '—'} hint="No units available for purchase" icon={<PackageX />} color="red" /></div>
    <div className="seller-filter-bar"><SearchInput value={query} onChange={setQuery} placeholder="Search inventory or SKU…" label="Search inventory" /><span className="text-xs text-slate-500">{summary?.reserved ?? 0} units reserved</span></div><Tabs value={stock} onChange={setStock} label="Inventory stock filter" tabs={[{ value: '', label: 'All products', count: summary?.products }, { value: 'healthy', label: 'Healthy', count: summary?.healthy }, { value: 'low', label: 'Low stock', count: summary?.lowStock }, { value: 'out', label: 'Out of stock', count: summary?.outOfStock }]} />
    <ResourceError error={resource.error} onRetry={resource.reload} />
    {resource.loading && !resource.data ? <PageSkeleton /> : !resource.data?.inventory?.length ? <Panel><SellerEmpty title={debounced || stock ? 'No products in this view' : 'No inventory to manage yet'} description={debounced || stock ? 'Try another search or stock filter.' : 'Add a product to start tracking shelf stock and customer reservations.'} icon={<Package size={26} />} action={!stock && !debounced ? <Button onClick={() => navigate('/seller/products/new')}>Add product<ArrowRight size={13} /></Button> : undefined} /></Panel> : <><Panel className="seller-inventory-table"><table className="seller-table"><caption className="sr-only">Product stock, reservations and available inventory</caption><thead><tr><th>Product</th><th>SKU</th><th className="numeric">Stock</th><th className="numeric">Reserved</th><th className="numeric">Available</th><th>Status</th><th className="numeric">Action</th></tr></thead><tbody>{resource.data.inventory.map((p) => <tr key={p.id}><td><div className="seller-table-product"><ProductImage src={p.image} name={p.name} /><div><strong>{p.name}</strong><small>{p.category}</small></div></div></td><td>{p.sku || '—'}</td><td className="numeric">{p.stock_quantity}</td><td className="numeric">{p.reserved_quantity ?? 0}</td><td className="numeric"><b className="font-semibold">{p.sellable ?? 0}</b></td><td><InventoryStatus product={p} /></td><td className="numeric"><Button variant="secondary" size="sm" onClick={() => setEditing(p)}>{p.sellable ? 'Update' : 'Restock'}</Button></td></tr>)}</tbody></table></Panel><div className="seller-mobile-inventory">{resource.data.inventory.map((p) => <article className="seller-inventory-card" key={p.id}><header><div className="seller-table-product"><ProductImage src={p.image} name={p.name} /><div><strong>{p.name}</strong><small>{p.sku || 'No SKU'} · {p.category}</small></div></div><InventoryStatus product={p} /></header><dl><div><dt>Shelf stock</dt><dd>{p.stock_quantity}</dd></div><div><dt>Reserved</dt><dd>{p.reserved_quantity ?? 0}</dd></div><div><dt>Available</dt><dd>{p.sellable ?? 0}</dd></div></dl><footer><span>Low-stock threshold: {p.low_stock_threshold ?? 5}</span><Button variant="secondary" size="sm" onClick={() => setEditing(p)}>{p.sellable ? 'Update stock' : 'Restock'}</Button></footer></article>)}</div></>}
    <Pager pagination={resource.data?.pagination} onPage={setPage} loading={resource.loading} /><StockAdjustModal product={editing} onClose={() => setEditing(null)} />
  </div>;
}
