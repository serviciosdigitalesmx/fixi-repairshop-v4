using System.Net;
using System.Text;
using FluentAssertions;
namespace RepairShop.Api.IntegrationTests;
[Collection(ApiCollection.Name)]
public sealed class CommercialDocumentTests(ApiFactory factory)
{
    [IntegrationFact]
    public async Task Sale_emission_is_idempotent_tenant_scoped_and_supports_cancel_and_reissue()
    {
        var (api, _) = await ApiClient.SignupAsync(factory, "MX");
        await api.EnsureCashOpenAsync();
        var sale = await (await api.Post("/sales", new {
            currency = "MXN", lines = new[] { new { description = "Servicio real de prueba", quantity = 2, unitPrice = 100, discountAmount = 10 } },
            discountAmount = 20, payments = new[] { new { method = "Cash", amount = 200 } }
        })).DataAsync();
        var body = new { sourceType = "Sale", sourceId = sale.Str("id") };
        var key = Guid.NewGuid().ToString();
        var doc = await (await api.Post("/commercial-documents", body, key)).DataAsync();
        doc.Dec("total").Should().Be(sale.Dec("total"));
        doc.Dec("balanceAtIssue").Should().Be(0);
        doc.Str("currency").Should().Be("MXN");
        doc.GetProperty("number").GetInt32().Should().Be(1);
        (await (await api.Post("/commercial-documents", body, key)).DataAsync()).Str("id").Should().Be(doc.Str("id"));
        (await api.Post("/commercial-documents", body)).StatusCode.Should().Be(HttpStatusCode.Conflict);
        var pdf = await api.Get($"/commercial-documents/{doc.Str("id")}/pdf");
        pdf.StatusCode.Should().Be(HttpStatusCode.OK);
        Encoding.ASCII.GetString((await pdf.Content.ReadAsByteArrayAsync()).Take(5).ToArray()).Should().Be("%PDF-");
        var (other, _) = await ApiClient.SignupAsync(factory, "MX");
        (await other.Get($"/commercial-documents/{doc.Str("id")}")).StatusCode.Should().Be(HttpStatusCode.NotFound);
        (await other.Get($"/commercial-documents/{doc.Str("id")}/pdf")).StatusCode.Should().Be(HttpStatusCode.NotFound);
        (await other.Post($"/commercial-documents/{doc.Str("id")}/cancel", new { reason = "Intento cruzado" })).StatusCode.Should().Be(HttpStatusCode.NotFound);
        (await other.Post("/commercial-documents", body)).StatusCode.Should().Be(HttpStatusCode.NotFound);
        (await (await other.Get("/commercial-documents")).DataAsync()).GetArrayLength().Should().Be(0);
        var cancelled = await (await api.Post($"/commercial-documents/{doc.Str("id")}/cancel", new { reason = "Error administrativo" })).DataAsync();
        cancelled.Dec("total").Should().Be(doc.Dec("total"));
        cancelled.Str("status").Should().Be("Cancelled");
        var again = await (await api.Post("/commercial-documents", body)).DataAsync();
        again.GetProperty("number").GetInt32().Should().Be(2, "failed and duplicate emissions roll back their folio");
        (await (await api.Get($"/commercial-documents/{doc.Str("id")}")).DataAsync()).Str("status").Should().Be("Cancelled");
        var cashier = await ApiClient.LoginAsync(factory, "caja@local", "Caja123456");
        (await cashier.Post($"/commercial-documents/{doc.Str("id")}/cancel", new { reason = "Intento sin permisos" })).StatusCode.Should().Be(HttpStatusCode.Forbidden);
        var tech = await ApiClient.LoginAsync(factory, "tech@local", "Tech123456");
        (await tech.Get("/commercial-documents")).StatusCode.Should().Be(HttpStatusCode.Forbidden);
        (await tech.Post("/commercial-documents", body)).StatusCode.Should().Be(HttpStatusCode.Forbidden);
        (await tech.Post($"/commercial-documents/{doc.Str("id")}/cancel", new { reason = "Intento" })).StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    [IntegrationFact]
    public async Task Concurrent_emissions_have_one_active_document_and_do_not_change_payments()
    {
        var (api, _) = await ApiClient.SignupAsync(factory, "MX");
        var order = await api.CreateOrderAsync();
        var id = order.Str("id");
        (await api.Post("/commercial-documents", new { sourceType = "RepairOrder", sourceId = id })).StatusCode.Should().Be(HttpStatusCode.BadRequest);
        await (await api.Put($"/orders/{id}/quote", new { amount = 100, currency = "MXN" })).DataAsync();
        var results = await Task.WhenAll(Enumerable.Range(0, 6).Select(_ => api.Post("/commercial-documents", new { sourceType = "RepairOrder", sourceId = id })));
        results.Count(r => r.IsSuccessStatusCode).Should().Be(1);
        results.Where(r => !r.IsSuccessStatusCode).Should().OnlyContain(r => r.StatusCode == HttpStatusCode.Conflict);
        var document = await results.Single(r => r.IsSuccessStatusCode).DataAsync();
        document.GetProperty("number").GetInt32().Should().Be(1);
        document.Dec("total").Should().Be(100);
        await (await api.Put($"/orders/{id}/quote", new { amount = 120, currency = "MXN" })).DataAsync();
        var historical = await (await api.Get($"/commercial-documents/{document.Str("id")}")).DataAsync();
        historical.Dec("total").Should().Be(100);
        historical.GetProperty("lines")[0].GetProperty("unitPrice").GetDecimal().Should().Be(100);
        (await (await api.Get($"/orders/{id}/payments")).DataAsync()).GetArrayLength().Should().Be(0);
    }

    [IntegrationFact]
    public async Task Order_snapshot_separates_advance_refund_and_regular_payments_and_rejects_non_mxn()
    {
        var (api, _) = await ApiClient.SignupAsync(factory, "MX");
        await api.EnsureCashOpenAsync();
        var order = await api.CreateOrderAsync(); var id = order.Str("id");
        var deposit = await (await api.Post($"/orders/{id}/payments", new { amount = 40, currency = "MXN", method = "Transfer" })).DataAsync();
        await (await api.Post($"/orders/{id}/payments/{deposit.Str("id")}/refund", new { amount = 10, method = "Transfer", reason = "Devolución parcial" })).DataAsync();
        await (await api.Put($"/orders/{id}/quote", new { amount = 100, currency = "MXN" })).DataAsync();
        await (await api.Post($"/orders/{id}/payments", new { amount = 20, currency = "MXN", method = "Cash" })).DataAsync();
        var doc = await (await api.Post("/commercial-documents", new { sourceType = "RepairOrder", sourceId = id })).DataAsync();
        doc.Dec("total").Should().Be(100); doc.Dec("depositAmountAtIssue").Should().Be(30);
        doc.Dec("paymentsAtIssue").Should().Be(20); doc.Dec("balanceAtIssue").Should().Be(50);
        var otherOrder = await api.CreateOrderAsync();
        await (await api.Put($"/orders/{otherOrder.Str("id")}/quote", new { amount = 100, currency = "USD" })).DataAsync();
        (await api.Post("/commercial-documents", new { sourceType = "RepairOrder", sourceId = otherOrder.Str("id") })).StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }
}
