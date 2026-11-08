using RepairShop.Domain.CommercialDocuments;
namespace RepairShop.Application.Abstractions;
public interface ICommercialDocumentRepository
{
    Task BeginSnapshotAsync(CancellationToken ct);
    Task<CommercialDocument?> GetAsync(Guid shopId, Guid id, CancellationToken ct);
    Task<bool> HasActiveAsync(Guid shopId, CommercialDocumentSourceType type, Guid sourceId, CancellationToken ct);
    Task<(List<CommercialDocument> Items, int Total)> SearchAsync(Guid shopId, string? q, CommercialDocumentSourceType? sourceType, Guid? sourceId, int skip, int take, CancellationToken ct);
    Task AddAsync(CommercialDocument document, CancellationToken ct);
}
