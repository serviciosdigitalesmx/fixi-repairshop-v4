using RepairShop.Application.Abstractions;
using RepairShop.Application.Common;
using RepairShop.Application.Files;
using RepairShop.Application.RepairOrders;
using RepairShop.Domain.CommercialDocuments;
using RepairShop.Domain.Common;
using RepairShop.Domain.Customers;
using RepairShop.Domain.RepairOrders;
using RepairShop.Domain.Sales;
namespace RepairShop.Application.CommercialDocuments;

public sealed record IssueCommercialDocumentRequest(CommercialDocumentSourceType SourceType, Guid SourceId);
public sealed record CancelCommercialDocumentRequest(string Reason);

public sealed class CommercialDocumentService(
    ICommercialDocumentRepository documents, ISaleRepository sales, IRepairOrderRepository orders,
    IShopRepository shops, ICustomerRepository customers, IQuoteRepository quotes,
    IRepairOrderPaymentRepository payments, IRepairOrderPartUsageRepository parts,
    IInventoryItemRepository inventory, IRepairOrderReadModel readModel, ICounterService counters,
    IAuditLog audit, IUnitOfWork uow, IDateTimeProvider clock, FileService files)
{
    public async Task<CommercialDocument> GetAsync(Guid shopId, Guid id, CancellationToken ct)
        => await documents.GetAsync(shopId, id, ct) ?? throw new NotFoundException("Documento comercial no encontrado.");
    public async Task<PagedResult<CommercialDocument>> SearchAsync(Guid shopId, string? q, CommercialDocumentSourceType? sourceType, Guid? sourceId, int skip, int take, CancellationToken ct)
    {
        var result = await documents.SearchAsync(shopId, q, sourceType, sourceId, skip, take, ct);
        return new(result.Items, result.Total);
    }
    public Task<CommercialDocument> IssueAsync(Guid shopId, IssueCommercialDocumentRequest request, Actor actor, CancellationToken ct)
        => uow.InTransactionAsync(async tx =>
        {
            // One consistent snapshot across source, lines, prices and movements.
            await documents.BeginSnapshotAsync(tx);
            if (!Enum.IsDefined(request.SourceType)) throw new DomainException("Origen comercial inválido.");
            var shop = await shops.GetByIdAsync(shopId, tx) ?? throw new NotFoundException("Sucursal no encontrada.");
            var number = await counters.NextAsync(shopId, "commercial_document", tx);
            if (await documents.HasActiveAsync(shopId, request.SourceType, request.SourceId, tx))
                throw new ConflictException("Ya existe una factura comercial vigente para esta operación.");
            var lines = new List<CommercialDocumentLineInput>();
            var movements = new List<CommercialDocumentPaymentInput>();
            decimal discount = 0, change = 0, total;
            string currency, reference;
            Customer? customer;
            if (request.SourceType == CommercialDocumentSourceType.Sale)
            {
                var sale = await sales.GetByIdAsync(shopId, request.SourceId, tx) ?? throw new NotFoundException("Venta no encontrada.");
                if (sale.Status == SaleStatus.Voided) throw new DomainException("La venta está anulada.");
                currency = sale.Currency; reference = sale.Code; total = sale.Total; discount = sale.DiscountAmount; change = sale.ChangeAmount;
                customer = sale.CustomerId is null ? null : await customers.GetByIdAsync(shopId, sale.CustomerId.Value, tx);
                lines.AddRange(sale.Lines.OrderBy(l => l.Position).Select(l => new CommercialDocumentLineInput(l.Description, l.Quantity, l.UnitPrice, l.DiscountAmount, l.Sku)));
                movements.AddRange(sale.Payments.Select(p => new CommercialDocumentPaymentInput(CommercialPaymentMovementType.Payment, p.Method, p.Amount, Reference: p.Reference)));
                movements.AddRange(sale.Refunds.Select(p => new CommercialDocumentPaymentInput(CommercialPaymentMovementType.Refund, p.Method, p.Amount, Reference: p.Reason)));
            }
            else
            {
                var order = await orders.GetByIdAsync(shopId, request.SourceId, tx) ?? throw new NotFoundException("Orden no encontrada.");
                if (order.Status == RepairOrderStatus.Cancelled) throw new DomainException("La orden está cancelada.");
                if (order.QuoteAmount is null) throw new DomainException("La orden no tiene importe acordado.");
                var info = (await readModel.GetInfoAsync(shopId, new[] { order.Id }, tx))[order.Id];
                var financials = OrderMapping.Financials(order, info, shop.DefaultCurrency);
                currency = financials.Currency; total = financials.Total; reference = order.Code;
                customer = await customers.GetByIdAsync(shopId, order.CustomerId, tx);
                var quote = await quotes.GetApprovedAsync(shopId, order.Id, tx);
                if (quote is not null)
                {
                    if (quote.Currency != currency || quote.Total != order.QuoteAmount) throw new DomainException("La cotización aprobada no concilia con el importe acordado.");
                    lines.AddRange(quote.Items.OrderBy(l => l.Position).Select(l => new CommercialDocumentLineInput(l.Description, l.Quantity, l.UnitPrice)));
                    discount = quote.DiscountAmount;
                }
                else lines.Add(new CommercialDocumentLineInput($"Reparación {order.Code}: {order.IssueDescription}", 1, order.QuoteAmount.Value));
                var usages = await parts.ListByOrderAsync(shopId, order.Id, tx);
                foreach (var part in usages.Where(p => p.ChargedToCustomer))
                {
                    if (part.UnitPrice is null || part.UnitPriceCurrency != currency) throw new DomainException("Una refacción no tiene precio y moneda compatibles.");
                    var item = await inventory.GetByIdAsync(shopId, part.InventoryItemId, tx) ?? throw new DomainException("Refacción no encontrada.");
                    lines.Add(new(item.Name, part.QuantityUsed, part.UnitPrice.Value, Sku: item.Sku));
                }
                var receipts = await payments.ListByOrderAsync(shopId, order.Id, tx);
                if (receipts.Any(p => p.Currency != currency)) throw new DomainException("Los pagos tienen monedas incompatibles con la operación.");
                movements.AddRange(receipts.Select(p => new CommercialDocumentPaymentInput(
                    p.Type == PaymentType.Refund ? CommercialPaymentMovementType.Refund : CommercialPaymentMovementType.Payment,
                    p.Method, p.Amount, p.IsDeposit || (p.RefundOfPaymentId is not null && receipts.Any(original => original.Id == p.RefundOfPaymentId && original.IsDeposit)), p.Reference)));
            }
            var logo = await files.ReadBytesAsync(shopId, shop.LogoFileId, tx);
            var document = new CommercialDocument(shopId, request.SourceType, request.SourceId, number, currency,
                new(shop.Name, shop.LegalName, shop.Phone, shop.Email, shop.AddressLine, shop.City, shop.Country),
                customer is null ? null : new(customer.FullName, Phone: customer.Phone, Email: customer.Email, Address: customer.Address),
                lines, discount, movements, change, total, actor.UserId, clock.UtcNow, reference, logo is null ? null : Convert.ToBase64String(logo));
            await documents.AddAsync(document, tx);
            await audit.AddAsync(shopId, "commercial_document", document.Id, "commercial_document_issued", actor, new { document.Number, document.SourceType, document.SourceId, document.Total }, tx);
            await uow.SaveChangesAsync(tx);
            return document;
        }, ct);
    public Task<CommercialDocument> CancelAsync(Guid shopId, Guid id, string reason, Actor actor, CancellationToken ct)
        => uow.InTransactionAsync(async tx =>
        {
            var document = await GetAsync(shopId, id, tx);
            document.Cancel(reason, actor.UserId, clock.UtcNow);
            await audit.AddAsync(shopId, "commercial_document", id, "commercial_document_cancelled", actor, new { reason }, tx);
            await uow.SaveChangesAsync(tx);
            return document;
        }, ct);
}
