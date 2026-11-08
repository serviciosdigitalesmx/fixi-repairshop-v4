import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { get, getPage, post, newIdempotencyKey } from '../../api/http'
import { errorMessage } from '../../api/http'
import { useSession } from '../../auth/session'
import { Badge, Button, Card, EmptyState, ErrorState, Field, Input, Loading, Modal, PageHeader } from '../../components/ui'
import { money, dateTime } from '../../lib/format'
import { openPdf } from '../../lib/files'

type Source = 'Sale' | 'RepairOrder'
interface Party { name: string; legalName?: string; address?: string; phone?: string; email?: string }
interface Document {
  id: string; number: number; sourceType: Source; sourceId: string; sourceReference: string; status: 'Issued' | 'Cancelled'; issuedAtUtc: string
  issuer: Party; recipient?: Party; subtotal: number; discountAmount: number; total: number; changeAmount: number
  depositAmountAtIssue: number; paymentsAtIssue: number; paidAtIssue: number; balanceAtIssue: number; cancellationReason?: string
  lines: { id: string; description: string; quantity: number; unitPrice: number; discountAmount: number; total: number }[]
  payments: { id: string; type: string; method: string; amount: number; isDeposit: boolean; reference?: string }[]
}
export const commercialApi = {
  search: (q: string, sourceType?: Source, sourceId?: string, skip = 0) => getPage<Document>('/commercial-documents', { q, sourceType, sourceId, skip, take: 25 }),
  get: (id: string) => get<Document>(`/commercial-documents/${id}`),
  issue: (sourceType: Source, sourceId: string) => post<Document>('/commercial-documents', { sourceType, sourceId }, { idempotencyKey: newIdempotencyKey() }),
  cancel: (id: string, reason: string) => post<Document>(`/commercial-documents/${id}/cancel`, { reason }, { idempotencyKey: newIdempotencyKey() }),
}
const legend = 'Documento comercial sin validez fiscal. No constituye un CFDI'
export function CommercialInvoicesPage() {
  return <><PageHeader title="Facturas comerciales" subtitle={legend} /><CommercialInvoices /></>
}
export function CommercialInvoices({ sourceType, sourceId }: { sourceType?: Source; sourceId?: string }) {
  const { role, can } = useSession()
  const client = useQueryClient()
  const [q, setQ] = useState('')
  const [skip, setSkip] = useState(0)
  const [selected, setSelected] = useState<Document | null>(null)
  const [reason, setReason] = useState('')
  const query = useQuery({ queryKey: ['commercial-documents', sourceType, sourceId, q, skip], queryFn: () => commercialApi.search(q, sourceType, sourceId, skip), enabled: can('sales') })
  const refresh = () => { void client.invalidateQueries({ queryKey: ['commercial-documents'] }) }
  const issue = useMutation({ mutationFn: () => commercialApi.issue(sourceType!, sourceId!), onSuccess: (d) => { refresh(); setSelected(d); toast.success(`Factura FC-${d.number} emitida`) }, onError: (e) => toast.error(errorMessage(e)) })
  const cancel = useMutation({ mutationFn: () => commercialApi.cancel(selected!.id, reason), onSuccess: (d) => { refresh(); setSelected(d); setReason(''); toast.success('Cancelación administrativa registrada') }, onError: (e) => toast.error(errorMessage(e)) })
  if (!can('sales')) return null
  return <Card title="Facturación comercial" actions={sourceId && !query.data?.items.some(d => d.status === 'Issued') ? <Button disabled={!query.isSuccess} loading={issue.isPending} onClick={() => issue.mutate()}>Emitir factura comercial</Button> : undefined}>
    {!sourceId ? <Field label="Buscar folio, cliente o referencia"><Input value={q} onChange={e => { setQ(e.target.value); setSkip(0) }} /></Field> : null}
    {query.isLoading ? <Loading /> : query.isError ? <ErrorState error={errorMessage(query.error)} onRetry={() => void query.refetch()} /> : query.data?.items.length === 0 ? <EmptyState title="Sin facturas comerciales" description="Emite desde una venta u orden con importe acordado en MXN." /> : <div className="space-y-2">{query.data?.items.map(d => <div key={d.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 py-3">
      <div><strong>FC-{String(d.number).padStart(6, '0')}</strong> · {d.recipient?.name ?? 'Sin cliente asociado'}<p className="text-sm">{d.sourceReference} · {dateTime(d.issuedAtUtc)} · {money(d.total, 'MXN')}</p></div>
      <Badge tone={d.status === 'Issued' ? 'green' : 'slate'}>{d.status === 'Issued' ? 'Vigente' : 'Cancelada'}</Badge><Button onClick={() => { setSelected(d); setReason('') }}>Ver detalle</Button>
    </div>)}</div>}
    {!sourceId ? <div className="mt-3 flex gap-2"><Button disabled={skip === 0} onClick={() => setSkip(s => Math.max(0, s - 25))}>Anterior</Button><Button disabled={skip + 25 >= (query.data?.total ?? 0)} onClick={() => setSkip(s => s + 25)}>Siguiente</Button></div> : null}
    {selected ? <Modal open title={`Factura comercial FC-${selected.number}`} onClose={() => setSelected(null)} footer={<><Button onClick={() => void openPdf(`/commercial-documents/${selected.id}/pdf`)}>Descargar PDF / imprimir</Button><Button onClick={() => setSelected(null)}>Cerrar</Button></>}>
      <p>{legend}</p><p className="mt-2">{selected.issuer.legalName ?? selected.issuer.name} · {selected.recipient?.name}</p>
      {selected.lines.map(l => <p className="mt-2" key={l.id}>{l.description} · {l.quantity} × {money(l.unitPrice, 'MXN')} · descuento {money(l.discountAmount, 'MXN')} · {money(l.total, 'MXN')}</p>)}
      <p className="mt-3">Subtotal: {money(selected.subtotal, 'MXN')} · Descuento global: {money(selected.discountAmount, 'MXN')}</p>
      <p><strong>Total: {money(selected.total, 'MXN')}</strong></p><p>Anticipos netos: {money(selected.depositAmountAtIssue, 'MXN')} · Otros pagos netos: {money(selected.paymentsAtIssue, 'MXN')}</p>
      {selected.payments.map(p => <p key={p.id}>{p.type === 'Refund' ? 'Devolución' : 'Pago'} {p.isDeposit ? 'de anticipo' : ''} · {p.method} · {money(p.amount, 'MXN')}</p>)}
      <p>Cambio: {money(selected.changeAmount, 'MXN')}</p><p><strong>{selected.balanceAtIssue < 0 ? 'Saldo a favor' : 'Saldo pendiente'} al emitir: {money(Math.abs(selected.balanceAtIssue), 'MXN')}</strong></p>
      {selected.status === 'Cancelled' ? <p className="mt-3">Cancelada: {selected.cancellationReason}. Puedes reemitir desde la operación original.</p> : role === 'Admin' ? <div className="mt-4"><Field label="Motivo de cancelación administrativa"><Input value={reason} onChange={e => setReason(e.target.value)} /></Field><Button disabled={!reason.trim()} loading={cancel.isPending} onClick={() => cancel.mutate()}>Cancelar documento</Button></div> : null}
    </Modal> : null}
  </Card>
}
