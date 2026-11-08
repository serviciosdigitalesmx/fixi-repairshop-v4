using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RepairShop.Api.Common;
using RepairShop.Api.Security;
using RepairShop.Application.CommercialDocuments;
using RepairShop.Application.Documents;
using RepairShop.Domain.CommercialDocuments;
namespace RepairShop.Api.Controllers;
[ApiController]
[Route("api/v1/commercial-documents")]
[Authorize(Policy = Policies.Sales)]
public sealed class CommercialDocumentsController(CommercialDocumentService service, DocumentService documents) : ControllerBase
{
    [HttpGet]
    public async Task<IActionResult> Search(string? q, CommercialDocumentSourceType? sourceType, Guid? sourceId, int skip = 0, int take = 25, CancellationToken ct = default)
        => Ok(Envelope.Ok(Response.WithTotal(await service.SearchAsync(CurrentUser.GetShopId(User), q, sourceType, sourceId, skip, take, ct))));
    [HttpGet("{id:guid}")]
    public async Task<IActionResult> Get(Guid id, CancellationToken ct) => Ok(Envelope.Ok(await service.GetAsync(CurrentUser.GetShopId(User), id, ct)));
    [HttpPost]
    [Idempotent]
    public async Task<IActionResult> Issue(IssueCommercialDocumentRequest request, CancellationToken ct)
        => Ok(Envelope.Ok(await service.IssueAsync(CurrentUser.GetShopId(User), request, CurrentUser.GetActor(User), ct)));
    [HttpPost("{id:guid}/cancel")]
    [Authorize(Policy = Policies.AdminOnly)]
    [Idempotent]
    public async Task<IActionResult> Cancel(Guid id, CancelCommercialDocumentRequest request, CancellationToken ct)
        => Ok(Envelope.Ok(await service.CancelAsync(CurrentUser.GetShopId(User), id, request.Reason, CurrentUser.GetActor(User), ct)));
    [HttpGet("{id:guid}/pdf")]
    public async Task<IActionResult> Pdf(Guid id, CancellationToken ct)
    {
        var doc = await documents.CommercialInvoiceAsync(CurrentUser.GetShopId(User), id, ct);
        Response.Headers.ContentDisposition = $"inline; filename=\"{doc.FileName}\"";
        return File(doc.Content, doc.ContentType);
    }
}
