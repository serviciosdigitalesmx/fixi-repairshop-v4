using Microsoft.EntityFrameworkCore;
using RepairShop.Application.Abstractions;
using RepairShop.Domain.CommercialDocuments;
using RepairShop.Infrastructure.Persistence;
namespace RepairShop.Infrastructure.Repositories;
public sealed class CommercialDocumentRepository(RepairShopDbContext db) : ICommercialDocumentRepository
{
    public Task BeginSnapshotAsync(CancellationToken ct)
        => db.Database.ExecuteSqlRawAsync("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ", ct);
    private IQueryable<CommercialDocument> All(Guid shopId) => db.CommercialDocuments.Where(d => d.ShopId == shopId)
        .Include(d => d.Lines).Include(d => d.Payments).AsSplitQuery();
    public Task<CommercialDocument?> GetAsync(Guid shopId, Guid id, CancellationToken ct) => All(shopId).FirstOrDefaultAsync(d => d.Id == id, ct);
    public Task<bool> HasActiveAsync(Guid shopId, CommercialDocumentSourceType type, Guid sourceId, CancellationToken ct)
        => db.CommercialDocuments.AnyAsync(d => d.ShopId == shopId && d.SourceType == type && d.SourceId == sourceId && d.Status == CommercialDocumentStatus.Issued, ct);
    public async Task<(List<CommercialDocument> Items, int Total)> SearchAsync(Guid shopId, string? q, CommercialDocumentSourceType? sourceType, Guid? sourceId, int skip, int take, CancellationToken ct)
    {
        var query = All(shopId);
        if (sourceType is not null) query = query.Where(d => d.SourceType == sourceType);
        if (sourceId is not null) query = query.Where(d => d.SourceId == sourceId);
        if (!string.IsNullOrWhiteSpace(q))
        {
            var term = q.Trim();
            int.TryParse(term.TrimStart('F', 'C', '-', '0'), out var number);
            query = query.Where(d => d.Number == number || d.Issuer.Name.Contains(term) || (d.Recipient != null && d.Recipient.Name.Contains(term)) || (d.SourceReference != null && d.SourceReference.Contains(term)));
        }
        var total = await query.CountAsync(ct);
        return (await query.OrderByDescending(d => d.Number).Skip(Math.Max(0, skip)).Take(Math.Clamp(take, 1, 100)).ToListAsync(ct), total);
    }
    public Task AddAsync(CommercialDocument document, CancellationToken ct) => db.CommercialDocuments.AddAsync(document, ct).AsTask();
}
